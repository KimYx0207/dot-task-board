import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Worker} from 'node:worker_threads';
import {createD1BoardObservationStore} from '../src/adapters/d1-board-observations.mjs';
import {createBoardObservationService} from '../src/application/board-observation-service.mjs';
import {BOARD_OBSERVATION_OUTBOX_EVENT_NAME,createD1BoardObservationOutbox} from '../src/adapters/d1-board-observation-outbox.mjs';
import {sqliteBoardObservationFixture} from './sqlite-board-observation-fixture.mjs';

const initialNow='2026-10-08T07:00:00.000Z';
const snapshot={schemaVersion:'dot-board.snapshot/2',importedAt:'2026-10-08T01:00:00.000Z',tasks:[{id:'task-a',title:'Synthetic business work',project:'Synthetic project',state:'unknown',observedAt:'2026-10-08T01:00:00.000Z'}],agents:[]};
const bindings=[{taskId:'task-a',threadId:'private-source-thread',environment:null,readAllowed:true}];
const registry=[{id:'project-a',name:'Synthetic project',aliases:['Alias project'],executionState:'deferred'}];
const input=(patch={})=>({taskId:'task-a',eventId:'private-observation-1',expectedVersion:0,source:{threadId:'private-source-thread',environment:null,turnId:'private-source-turn',itemId:'private-source-item',observedAt:'2026-10-08T06:00:00.000Z'},changes:{state:'partial',observation:'Private source-backed business detail',blocker:'Private acceptance detail'},...patch});
const next=()=>input({eventId:'private-observation-2',expectedVersion:1,source:{...input().source,observedAt:'2026-10-08T06:10:00.000Z'},changes:{observation:'A fresh private business observation'}});
const code=name=>error=>error.code===name;
function fixture(t,{enabled=true,filename=':memory:',bindingDecorator=value=>value}={}){
  const sql=sqliteBoardObservationFixture(filename);t.after(()=>sql.close());let now=initialNow;const clock=()=>now;
  const binding=bindingDecorator(sql.binding,sql.db),outbox=createD1BoardObservationOutbox(binding,{clock});
  const store=createD1BoardObservationStore(binding,{clock,observationOutbox:enabled?outbox:null}),service=createBoardObservationService({store,clock});
  const record=(value=input(),base=snapshot,controls=registry,owner='owner-a')=>service.record(owner,value,base,bindings,controls);
  return {...sql,binding,outbox,store,service,record,clock,setNow:value=>{now=value;},counts:()=>({observations:sql.db.prepare('SELECT COUNT(*) AS count FROM board_observation_events').get().count,outbox:sql.db.prepare('SELECT COUNT(*) AS count FROM board_observation_outbox').get().count})};
}
async function firstId(f,owner='owner-a'){const due=await f.outbox.due(owner);assert.equal(due.length,1);return due[0].eventId;}

test('opt-in journal and minimal event commit atomically, without source or body content',async t=>{
  const f=fixture(t);assert.equal(await f.store.available(),true);await f.record();assert.deepEqual(f.counts(),{observations:1,outbox:1});
  const eventId=await firstId(f),row=await f.outbox.get('owner-a',eventId);
  assert.match(eventId,/^board-observed:[a-f0-9]{64}$/);assert.deepEqual(row.event,{eventId,name:BOARD_OBSERVATION_OUTBOX_EVENT_NAME,timestamp:input().source.observedAt,data:{projectId:'project-a',taskId:'task-a',status:'partial'},cursor:null});
  const serialized=JSON.stringify(row.event);for(const text of ['private-source','private-observation','Private','owner-a','threadId','secret','blocker'])assert.equal(serialized.includes(text),false);
  assert.deepEqual(Object.keys(row.event.data).sort(),['projectId','status','taskId']);
});
test('source outbox defaults off, and enabling later does not backfill a repeated historical observation',async t=>{
  const f=fixture(t,{enabled:false});await f.record();assert.deepEqual(f.counts(),{observations:1,outbox:0});const enabled=createBoardObservationService({store:createD1BoardObservationStore(f.binding,{clock:f.clock,observationOutbox:f.outbox}),clock:f.clock});
  assert.equal((await enabled.record('owner-a',input(),snapshot,bindings,registry)).duplicate,true);assert.deepEqual(f.counts(),{observations:1,outbox:0});
  await enabled.record('owner-a',next(),snapshot,bindings,registry);assert.deepEqual(f.counts(),{observations:2,outbox:1});
});
test('exact duplicate observations never enqueue again, including after delivery and newer observations',async t=>{
  const f=fixture(t);await f.record();const id=await firstId(f),job=await f.outbox.claim('owner-a',id);assert.equal(await f.outbox.ack('owner-a',id,job.leaseToken),true);
  assert.equal((await f.record()).duplicate,true);await f.record(next());assert.equal((await f.record()).duplicate,true);assert.deepEqual(f.counts(),{observations:2,outbox:2});assert.equal((await f.outbox.due('owner-a')).length,1);assert.equal((await f.outbox.get('owner-a',id)).state,'delivered');
});
test('outbox INSERT failure rolls back the preceding successful observation INSERT',async t=>{
  const f=fixture(t);f.db.exec("CREATE TRIGGER reject_outbox BEFORE INSERT ON board_observation_outbox BEGIN SELECT RAISE(ABORT,'synthetic outbox write failure'); END");
  await assert.rejects(f.record(),/synthetic outbox write failure/);assert.deepEqual(f.counts(),{observations:0,outbox:0});
  f.db.exec('DROP TRIGGER reject_outbox');await f.record();assert.deepEqual(f.counts(),{observations:1,outbox:1});
});
test('unavailable outbox schema fails closed before an observation can commit',async t=>{
  const f=fixture(t);f.db.exec('DROP TABLE board_observation_outbox');assert.equal(await f.store.available(),false);await assert.rejects(f.record(),/no such table/);assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM board_observation_events').get().count,0);
});
test('a lost response after COMMIT is recoverable by identical retry with only one event',async t=>{
  let lost=true;const f=fixture(t,{bindingDecorator:binding=>({...binding,batch:async statements=>{const result=await binding.batch(statements);if(lost){lost=false;throw Error('synthetic response lost after commit');}return result;}})});
  await assert.rejects(f.record(),/response lost after commit/);assert.deepEqual(f.counts(),{observations:1,outbox:1});assert.equal((await f.record()).duplicate,true);assert.deepEqual(f.counts(),{observations:1,outbox:1});
});
test('pause/cancel controls dominate event status while deferred permits actual partial observations',async t=>{
  for(const state of ['paused','canceled']){
    const f=fixture(t);await f.record(input(),{...snapshot,tasks:[{...snapshot.tasks[0],state}]});const id=await firstId(f);assert.equal((await f.outbox.get('owner-a',id)).event.data.status,state);
    const r=fixture(t);await r.record(input(),snapshot,[{...registry[0],executionState:state}]);assert.equal((await r.outbox.get('owner-a',await firstId(r))).event.data.status,state);
  }
  const f=fixture(t);await f.record();assert.equal((await f.outbox.get('owner-a',await firstId(f))).event.data.status,'partial');
  const canceled=fixture(t);await canceled.record(input(),{...snapshot,tasks:[{...snapshot.tasks[0],state:'paused'}]},[{...registry[0],executionState:'canceled'}]);assert.equal((await canceled.outbox.get('owner-a',await firstId(canceled))).event.data.status,'canceled');
});
test('sparse observations use cumulative state and exact alias-resolved project ID',async t=>{
  const f=fixture(t);const base={...snapshot,tasks:[{...snapshot.tasks[0],project:'Alias project'}]};await f.record(input(),base);await f.record(next(),base);for(const row of await f.outbox.due('owner-a'))assert.deepEqual((await f.outbox.get('owner-a',row.eventId)).event.data,{projectId:'project-a',taskId:'task-a',status:'partial'});
});
test('outbox-enabled writes without a registry project fail before either append',async t=>{
  const f=fixture(t);await assert.rejects(f.record(input(),snapshot,[]),code('observation_event_project_unmapped'));assert.deepEqual(f.counts(),{observations:0,outbox:0});
});
test('owners are isolated and the same source event ID gets distinct opaque event IDs per owner',async t=>{
  const f=fixture(t);await f.record();const id=await firstId(f);assert.deepEqual(await f.outbox.due('owner-b'),[]);assert.equal(await f.outbox.get('owner-b',id),null);assert.equal(await f.outbox.claim('owner-b',id),null);
  const job=await f.outbox.claim('owner-a',id);assert.equal(await f.outbox.ack('owner-b',id,job.leaseToken),false);assert.equal(await f.outbox.retry('owner-b',id,job.leaseToken,{nextAttemptAt:initialNow}),false);
  await f.record(input(),snapshot,registry,'owner-b');assert.notEqual(await firstId(f,'owner-b'),id);
});
test('leasing permits one owner-scoped claim and fences ACK/retry by unexpired token',async t=>{
  const f=fixture(t);await f.record();const id=await firstId(f);const [a,b]=await Promise.all([f.outbox.claim('owner-a',id),f.outbox.claim('owner-a',id)]);const job=a??b;assert.ok(job);assert.equal([a,b].filter(Boolean).length,1);assert.equal(job.attempts,1);assert.equal(await f.outbox.ack('owner-a',id,'wrong-token'),false);assert.equal(await f.outbox.retry('owner-a',id,'wrong-token',{nextAttemptAt:initialNow}),false);assert.deepEqual(await f.outbox.due('owner-a'),[]);
  f.setNow('2026-10-08T07:00:30.000Z');assert.equal(await f.outbox.ack('owner-a',id,job.leaseToken),false);assert.equal((await f.outbox.due('owner-a')).length,1);const reclaimed=await f.outbox.claim('owner-a',id);assert.equal(reclaimed.attempts,2);assert.notEqual(reclaimed.leaseToken,job.leaseToken);assert.equal(await f.outbox.ack('owner-a',id,job.leaseToken),false);assert.equal(await f.outbox.ack('owner-a',id,reclaimed.leaseToken),true);assert.deepEqual(await f.outbox.due('owner-a'),[]);
});
test('explicit retry preserves the identical event ID/body and is available only when due',async t=>{
  const f=fixture(t);await f.record();const id=await firstId(f),job=await f.outbox.claim('owner-a',id);
  assert.equal(await f.outbox.retry('owner-a',id,job.leaseToken,{nextAttemptAt:'2026-10-08T07:05:00Z'}),true);assert.equal(await f.outbox.claim('owner-a',id),null);assert.deepEqual(await f.outbox.due('owner-a'),[]);
  f.setNow('2026-10-08T07:05:00.000Z');const retry=await f.outbox.claim('owner-a',id);assert.deepEqual(retry.event,job.event);assert.equal(retry.attempts,2);assert.equal(await f.outbox.ack('owner-a',id,retry.leaseToken),true);
});
test('restart recovers expired delivery lease; completion remains durable',async t=>{
  const f=fixture(t);await f.record();const id=await firstId(f);await f.outbox.claim('owner-a',id);f.setNow('2026-10-08T07:01:00.000Z');const restarted=createD1BoardObservationOutbox(f.binding,{clock:f.clock});assert.equal((await restarted.due('owner-a')).length,1);const job=await restarted.claim('owner-a',id);assert.equal(await restarted.ack('owner-a',id,job.leaseToken),true);assert.equal((await createD1BoardObservationOutbox(f.binding,{clock:f.clock}).get('owner-a',id)).state,'delivered');
});
test('immutable event columns and append-only outbox survive delivery-state updates',async t=>{
  const f=fixture(t);await f.record();assert.throws(()=>f.db.prepare("UPDATE board_observation_outbox SET status='completed'").run(),/event_immutable/);assert.throws(()=>f.db.prepare("UPDATE board_observation_outbox SET project_id='other'").run(),/event_immutable/);assert.throws(()=>f.db.prepare('DELETE FROM board_observation_outbox').run(),/append_only/);const id=await firstId(f),job=await f.outbox.claim('owner-a',id);assert.equal(await f.outbox.ack('owner-a',id,job.leaseToken),true);
});
test('different database bindings, nontransactional stores, arbitrary event data and bad retry times fail closed',async t=>{
  const f=fixture(t),other=fixture(t);assert.throws(()=>createD1BoardObservationStore(f.binding,{observationOutbox:other.outbox}),code('observation_outbox_database_mismatch'));assert.throws(()=>createD1BoardObservationStore({prepare:f.binding.prepare},{observationOutbox:f.outbox}),code('observation_outbox_database_mismatch'));
  await assert.rejects(f.outbox.appendStatement('owner-a',input(),'a'.repeat(64),{projectId:'project-a',status:'partial',body:'not allowed'},initialNow),code('invalid_observation_outbox_context'));
  await f.record();const id=await firstId(f),job=await f.outbox.claim('owner-a',id);for(const nextAttemptAt of ['bad','2026-10-08T06:59:59Z','2026-10-10T07:00:00Z'])await assert.rejects(f.outbox.retry('owner-a',id,job.leaseToken,{nextAttemptAt}),code('invalid_observation_outbox_retry'));
});

async function race(t,values,{crashDuringBatch=false}={}){
  const directory=mkdtempSync(join(tmpdir(),'board-observation-outbox-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));const filename=join(directory,'journal.sqlite');const sql=sqliteBoardObservationFixture(filename);t.after(()=>sql.close());
  const workers=values.map(value=>new Worker(new URL('./board-observation-concurrency-worker.mjs',import.meta.url),{workerData:{filename,now:initialNow,owner:'owner-a',input:value,snapshot,bindings,registry,outbox:true,crashDuringBatch}}));t.after(async()=>{await Promise.all(workers.map(worker=>worker.terminate()));});
  await Promise.all(workers.map(worker=>new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);})));
  const results=workers.map(worker=>new Promise((resolve,reject)=>{worker.once(crashDuringBatch?'exit':'message',resolve);worker.once('error',reject);}));workers.forEach(worker=>worker.postMessage('go'));
  return {...sql,filename,results:await Promise.all(results)};
}
test('eight different CAS writers commit exactly one journal and one outbox row',async t=>{
  const f=await race(t,Array.from({length:8},(_,index)=>input({eventId:'concurrent-observation-'+index})));assert.equal(f.results.filter(value=>value.ok).length,1,JSON.stringify(f.results));assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM board_observation_events').get().count,1);assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM board_observation_outbox').get().count,1);
});
test('eight identical concurrent retries create exactly one outbox event and all succeed',async t=>{
  const f=await race(t,Array.from({length:8},()=>input()));assert.equal(f.results.every(value=>value.ok),true,JSON.stringify(f.results));assert.equal(f.results.filter(value=>value.duplicate===false).length,1);assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM board_observation_events').get().count,1);assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM board_observation_outbox').get().count,1);
});
test('worker exit after journal INSERT but before outbox INSERT rolls back; retry restores both',async t=>{
  const f=await race(t,[input()],{crashDuringBatch:true});assert.deepEqual(f.results,[77]);assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM board_observation_events').get().count,0);assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM board_observation_outbox').get().count,0);
  const clock=()=>initialNow,outbox=createD1BoardObservationOutbox(f.binding,{clock}),service=createBoardObservationService({store:createD1BoardObservationStore(f.binding,{clock,observationOutbox:outbox}),clock});await service.record('owner-a',input(),snapshot,bindings,registry);assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM board_observation_events').get().count,1);assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM board_observation_outbox').get().count,1);
});
