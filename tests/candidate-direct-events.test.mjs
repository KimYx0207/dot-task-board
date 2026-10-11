import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Worker} from 'node:worker_threads';
import {sqliteIntakeFixture} from './sqlite-intake-fixture.mjs';
import {createD1CandidateStore} from '../src/adapters/d1-candidates.mjs';
import {createD1IntakeStore} from '../src/adapters/d1-intake.mjs';
import {createD1McpEventsStore} from '../src/adapters/d1-mcp-events.mjs';
import {createCandidateService} from '../src/application/candidate-service.mjs';
import {candidateCapabilities,candidateIntakeSubmission} from '../src/domain/candidates.mjs';
import {intakeDigest} from '../src/domain/intake.mjs';
import {PROJECT_REQUEST_CREATED} from '../src/domain/mcp-events.mjs';

const owner='synthetic-direct-candidate-owner',project='synthetic-direct-project';
const now='2026-10-11T18:00:00.000Z',revision='sha256:'+'a'.repeat(64);
const executionTables=['dispatch_jobs','dispatch_operations','dispatch_manual_authorizations','native_dispatch_journal','dispatch_resource_leases'];
const intakeTables=['intake_requests','intake_events','mcp_events','mcp_event_outbox'];
const event=(eventId='synthetic-approval',decision='approve')=>({eventId,decision,expectedVersion:1,note:'Synthetic owner review'});

function setup(t,{events=true,file=false}={}){
  const folder=file?mkdtempSync(join(tmpdir(),'candidate-direct-events-')):null;
  const filename=folder?join(folder,'candidates.sqlite'):':memory:';
  const fixture=sqliteIntakeFixture(filename);
  if(file)fixture.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000');
  t.after(()=>{fixture.close();if(folder)rmSync(folder,{recursive:true,force:true});});
  let sequence=0,batches=0;
  const binding={...fixture.binding,batch:async statements=>{batches++;return fixture.binding.batch(statements);}};
  const eventStore=createD1McpEventsStore(binding);
  const store=events?createD1CandidateStore(binding,{eventStore}):createD1CandidateStore(binding);
  const service=createCandidateService({store,requests:createD1IntakeStore(binding),clock:()=>now,newId:()=>`synthetic-direct-${++sequence}`,capabilities:candidateCapabilities({canSubmit:true},true),readBoard:async()=>({status:200,body:{projectSummaries:[{id:project}],tasks:[],snapshotRevision:revision}})});
  const proposal=(clientSubmissionId='synthetic-direct-proposal')=>service.propose(owner,{clientSubmissionId,projectId:project,title:'Synthetic candidate',reason:'Synthetic private candidate context',expectedOutcome:'Synthetic reviewed outcome',sourceReferences:[{kind:'message',label:'Synthetic source',reference:'synthetic-private-reference'}],viewedSnapshotRevision:revision,viewedSnapshotImportedAt:now});
  const subscribe=async(id='synthetic-subscription',scope={})=>eventStore.saveSubscription({id,ownerId:owner,name:PROJECT_REQUEST_CREATED,arguments:{projectId:project},url:`https://receiver.example/${id}`,secret:'synthetic-key',expiresAt:'2026-10-12T18:00:00.000Z',verifiedUntil:'2026-10-12T18:00:00.000Z',now,rotationUntil:now,...scope});
  const count=table=>fixture.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  const assertCounts=(expected)=>{for(const table of intakeTables)assert.equal(count(table),expected,table);for(const table of executionTables)assert.equal(count(table),0,table);};
  return {fixture,filename,binding,eventStore,store,service,proposal,subscribe,count,assertCounts,batches:()=>batches};
}
async function requestFor(candidate,id){
  const submission=candidateIntakeSubmission(candidate,id);
  return {...submission,id,ownerId:owner,payloadDigest:await intakeDigest(submission),contextStale:false,createdAt:now};
}
const reviewDigest=(id,review)=>intakeDigest({candidateId:id,...review});

// Independent SQLite connections exercise real write contention, rather than
// serial promises against one synchronous in-memory connection.
async function compete(filename,candidate,{sameEvent=false,workers=8}={}){
  const gate=new SharedArrayBuffer(4),slots=[];
  const workerSource=`
    const {parentPort,workerData}=require('node:worker_threads');
    (async()=>{
      const {sqliteIntakeFixture}=await import(workerData.fixtureUrl);
      const {createD1CandidateStore}=await import(workerData.candidateUrl);
      const {createD1McpEventsStore}=await import(workerData.eventUrl);
      const fixture=sqliteIntakeFixture(workerData.filename);
      fixture.db.exec('PRAGMA busy_timeout=10000');
      try {
        const store=createD1CandidateStore(fixture.binding,{eventStore:createD1McpEventsStore(fixture.binding)});
        parentPort.postMessage({ready:true});
        Atomics.wait(new Int32Array(workerData.gate),0,0);
        try {
          const result=await store.review(workerData.owner,workerData.candidateId,workerData.event,workerData.digest,workerData.now,workerData.request);
          parentPort.postMessage({result:{requestId:result.candidate.requestId,replayed:result.replayed}});
        } catch(error) {parentPort.postMessage({result:{error:error.code||error.message}});}
      } finally {fixture.close();}
    })().catch(error=>{throw error;});
  `;
  for(let index=0;index<workers;index++){
    const review=event(sameEvent?'synthetic-shared-review':`synthetic-competing-review-${index}`);
    const worker=new Worker(workerSource,{eval:true,workerData:{filename,gate,owner,now,candidateId:candidate.id,event:review,digest:await reviewDigest(candidate.id,review),request:await requestFor(candidate,`synthetic-competing-request-${index}`),fixtureUrl:new URL('./sqlite-intake-fixture.mjs',import.meta.url).href,candidateUrl:new URL('../src/adapters/d1-candidates.mjs',import.meta.url).href,eventUrl:new URL('../src/adapters/d1-mcp-events.mjs',import.meta.url).href}});
    let markReady,finish,failReady,failResult;
    const ready=new Promise((resolve,reject)=>{markReady=resolve;failReady=reject;});
    const result=new Promise((resolve,reject)=>{finish=resolve;failResult=reject;});
    worker.on('message',message=>{if(message.ready)markReady();if(message.result)finish(message.result);});
    worker.on('error',error=>{failReady(error);failResult(error);});
    worker.on('exit',code=>{if(code!==0){const error=Error(`Synthetic approval worker exited ${code}`);failReady(error);failResult(error);}});
    slots.push({worker,ready,result});
  }
  try {
    await Promise.all(slots.map(slot=>slot.ready));
    Atomics.store(new Int32Array(gate),0,1);Atomics.notify(new Int32Array(gate),0);
    return await Promise.all(slots.map(slot=>slot.result));
  } finally {await Promise.all(slots.map(slot=>slot.worker.terminate()));}
}

test('candidate approval commits one received request, receipt, minimal MCP event and scoped outbox in one batch',async t=>{
  const c=setup(t);await c.subscribe();
  await c.subscribe('synthetic-other-owner',{ownerId:'synthetic-other-owner'});
  await c.subscribe('synthetic-other-project',{arguments:{projectId:'synthetic-other-project'}});
  await c.subscribe('synthetic-expired',{expiresAt:'2026-10-10T18:00:00.000Z'});
  const {candidate}=await c.proposal();c.assertCounts(0);
  const before=c.batches(),approved=await c.service.review(owner,candidate.id,event());
  assert.equal(c.batches()-before,1);
  assert.equal(approved.replayed,false);assert.equal(approved.candidate.status,'approved');assert.equal(approved.request.status,'received');
  assert.equal(approved.candidate.requestId,approved.request.id);assert.equal(approved.candidate.version,2);c.assertCounts(1);
  const saved=c.fixture.db.prepare('SELECT * FROM mcp_events').get();
  assert.equal(saved.event_id,approved.request.id+':created:v1');assert.equal(saved.name,PROJECT_REQUEST_CREATED);
  assert.equal(saved.owner_id,owner);assert.equal(saved.project_id,project);
  assert.deepEqual(JSON.parse(saved.data_json),{requestId:approved.request.id,projectId:project,version:1});
  assert.deepEqual(JSON.parse(saved.arguments_json),{projectId:project});
  assert(!saved.data_json.includes('private'));assert.equal(saved.occurred_at,now);
  const outbox=c.fixture.db.prepare('SELECT * FROM mcp_event_outbox').get();
  assert.equal(outbox.event_id,saved.event_id);assert.equal(outbox.subscription_id,'synthetic-subscription');assert.equal(outbox.state,'pending');assert.equal(outbox.attempts,0);
  assert.deepEqual(c.fixture.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('exact approval replay and concurrent service retries preserve one request/event/outbox',async t=>{
  const c=setup(t);await c.subscribe();const {candidate}=await c.proposal(),review=event();
  const results=await Promise.all(Array.from({length:12},()=>c.service.review(owner,candidate.id,review)));
  assert.equal(results.filter(result=>!result.replayed).length,1);assert.equal(new Set(results.map(result=>result.request.id)).size,1);
  assert.equal((await c.service.review(owner,candidate.id,review)).replayed,true);c.assertCounts(1);
  const directReplay=await c.store.review(owner,candidate.id,review,await reviewDigest(candidate.id,review),now,await requestFor(candidate,'synthetic-losing-retry'));
  assert.equal(directReplay.replayed,true);assert.equal(directReplay.candidate.requestId,results[0].request.id);c.assertCounts(1);
  assert.equal(c.fixture.db.prepare("SELECT COUNT(*) AS n FROM intake_requests WHERE id='synthetic-losing-retry'").get().n,0);
});

test('missing optional event store preserves existing approval behavior',async t=>{
  const c=setup(t,{events:false});await c.subscribe();const {candidate}=await c.proposal();
  const approved=await c.service.review(owner,candidate.id,event());assert.equal(approved.request.status,'received');
  for(const table of ['intake_requests','intake_events'])assert.equal(c.count(table),1);
  for(const table of ['mcp_events','mcp_event_outbox',...executionTables])assert.equal(c.count(table),0,table);
});

test('rejection and stale approval CAS never create requests or events',async t=>{
  const c=setup(t);await c.subscribe();const {candidate}=await c.proposal();
  await c.service.review(owner,candidate.id,event('synthetic-rejection','reject'));c.assertCounts(0);
  const stale=event('synthetic-stale-approval');
  await assert.rejects(c.store.review(owner,candidate.id,stale,await reviewDigest(candidate.id,stale),now,await requestFor(candidate,'synthetic-stale-request')),error=>error.code==='candidate_version_conflict');
  assert.equal((await c.store.get(owner,candidate.id)).candidate.status,'rejected');c.assertCounts(0);
});

for(const table of ['mcp_events','mcp_event_outbox'])test(`candidate ${table} failure rolls back review, request, receipt and Events; exact retry recovers`,async t=>{
  const c=setup(t);await c.subscribe();const {candidate}=await c.proposal(),review=event();
  c.fixture.db.exec(`CREATE TRIGGER synthetic_candidate_event_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic candidate event failure'); END`);
  await assert.rejects(c.service.review(owner,candidate.id,review),/synthetic candidate event failure/);
  const saved=(await c.store.get(owner,candidate.id)).candidate;
  assert.equal(saved.status,'proposed');assert.equal(saved.version,1);assert.equal(saved.requestId,null);assert.equal(saved.review,null);c.assertCounts(0);
  c.fixture.db.exec('DROP TRIGGER synthetic_candidate_event_failure');
  const approved=await c.service.review(owner,candidate.id,review);assert.equal(approved.replayed,false);c.assertCounts(1);
});

test('final candidate linkage failure rolls back already-prepared request receipt, event and outbox',async t=>{
  const c=setup(t);await c.subscribe();const {candidate}=await c.proposal();
  c.fixture.db.exec("CREATE TRIGGER synthetic_candidate_link_failure BEFORE UPDATE ON task_candidates BEGIN SELECT RAISE(ABORT,'synthetic candidate link failure'); END");
  await assert.rejects(c.service.review(owner,candidate.id,event()),/synthetic candidate link failure/);
  assert.equal((await c.store.get(owner,candidate.id)).candidate.status,'proposed');c.assertCounts(0);
});

test('eight independent SQLite approval CAS contenders produce one event and seven conflicts',async t=>{
  const c=setup(t,{file:true});await c.subscribe();const {candidate}=await c.proposal();
  const results=await compete(c.filename,candidate),success=results.filter(result=>!result.error);
  assert.equal(success.length,1,JSON.stringify(results));assert.equal(success[0].replayed,false);
  assert.equal(results.filter(result=>result.error==='candidate_version_conflict').length,7);c.assertCounts(1);
  assert.equal((await c.store.get(owner,candidate.id)).candidate.requestId,success[0].requestId);
});

test('eight independent SQLite same-event approvals return one fresh receipt and seven replays',async t=>{
  const c=setup(t,{file:true});await c.subscribe();const {candidate}=await c.proposal();
  const results=await compete(c.filename,candidate,{sameEvent:true});
  assert(results.every(result=>!result.error),JSON.stringify(results));assert.equal(new Set(results.map(result=>result.requestId)).size,1);
  assert.equal(results.filter(result=>result.replayed===false).length,1);assert.equal(results.filter(result=>result.replayed===true).length,7);c.assertCounts(1);
});
