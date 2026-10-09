import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {normalizeExecutionEvidence,executionEvidenceView,executionEvidenceTtlMs} from '../src/domain/execution-evidence.mjs';
import {sqliteIntakeFixture} from './sqlite-intake-fixture.mjs';
import {createD1IntakeStore} from '../src/adapters/d1-intake.mjs';
import {createIntakeService} from '../src/application/intake-service.mjs';
import {createD1DispatchQueue} from '../src/adapters/d1-dispatch-queue.mjs';
import {createDispatchService} from '../src/application/dispatch-service.mjs';
import {dispatchOne} from '../src/application/dispatch-host.mjs';
import {projectDispatchJobs} from '../src/application/dispatch-projection.mjs';
import {executionThreadId} from '../src/domain/dispatch-queue.mjs';

const instant='2026-10-07T18:00:00.000Z',environment={type:'native_cloud'};
const proof=(kind='tool_result',observedAt=instant)=>({kind,observedAt,source:'Synthetic execution adapter',step:'Synthetic test command produced output',reference:'synthetic-result',...(kind==='active_process'?{active:true}:{})});
test('canonical native thread identity is preserved and cannot admit arbitrary paths',()=>{
 assert.equal(executionThreadId('/root/synthetic_reviewer'),'/root/synthetic_reviewer');
 for(const value of ['/workspace/private','/root/../other','/root/reviewer?token=secret'])assert.throws(()=>executionThreadId(value));
});
function setup(t){
 const db=sqliteIntakeFixture();t.after(()=>db.close());let sequence=0,now=instant;const id=()=>`proof-${++sequence}`,clock=()=>now;
 const requests=createIntakeService({store:createD1IntakeStore(db.binding,{guardDispatchOwnership:true}),capabilities:{canSubmit:true,storageAvailable:true},clock,newId:id,readBoard:async()=>({status:200,body:{snapshotRevision:'sha256:'+'0'.repeat(64),projectSummaries:[{id:'p',name:'Synthetic project'}],tasks:[]}})});
 const store=createD1DispatchQueue(db.binding),service=createDispatchService({store,requests,enabled:true,capacity:6,clock,newId:id});
 async function add(owner='owner'){
  let r=(await requests.submit('p',owner,{clientSubmissionId:'synthetic-client-'+id(),body:'Synthetic requested task',contextTaskId:null,viewedSnapshotRevision:'sha256:'+'0'.repeat(64),viewedSnapshotImportedAt:instant,contextSummary:''})).request;
  for(const status of ['read','accepted'])r=(await requests.append(r.id,{eventId:id(),expectedVersion:r.version,status,summary:'Synthetic '+status},owner)).request;
  return (await service.enqueue(owner,{eventId:id(),requestId:r.id,expectedRequestVersion:r.version,environment})).job;
 }
 const update=(job,action,extra={})=>service.update(job.ownerId,{jobId:job.id,eventId:id(),expectedVersion:job.version,action,dispatchKey:job.dispatchKey,threadId:job.threadId,turnId:job.turnId,environment,summary:'Synthetic '+action,...extra});
 const adapter={environmentStatus:async()=>({available:true}),create:async()=>({threadId:id(),turnId:id(),environment,started:true}),followup:async()=>{throw Error('Not used');}};
 const run=async()=> (await dispatchOne({service,ownerId:'owner',eventId:id(),adapter,newId:id})).job;
 return {db,store,service,add,update,run,id,advance:milliseconds=>{now=new Date(Date.parse(now)+milliseconds).toISOString();}};
}

test('concrete evidence expires at its per-kind boundary, never extending source time',()=>{
 for(const kind of Object.keys(executionEvidenceTtlMs)){
  const job={state:'running',executionEvidence:proof(kind)},ttl=executionEvidenceTtlMs[kind];
  assert.equal(executionEvidenceView(job,Date.parse(instant)+ttl-1).effectiveState,'running');
  const expired=executionEvidenceView(job,Date.parse(instant)+ttl);
  assert.equal(expired.effectiveState,'unknown');assert.equal(expired.lastExecutionObservedAt,instant);assert.equal(expired.currentStep,null);assert.equal(expired.lastEffectiveAction,job.executionEvidence.step);
 }
 assert.equal(executionEvidenceView({state:'running',executionObservedAt:instant},instant).effectiveState,'unknown');
});
test('actual terminal proof can finish without a fabricated public URL but live process evidence cannot',async t=>{
 const c=setup(t);await c.add();let job=await c.run();
 await assert.rejects(c.update(job,'complete',{noActiveWriter:true,executionEvidence:proof('active_process')}),{code:'result_evidence_required'});
 await assert.rejects(c.update(job,'complete',{noActiveWriter:true,executionEvidence:{...proof('progress_output'),step:'Still processing, no terminal output'}}),{code:'result_evidence_required'});
 job=(await c.update(job,'complete',{noActiveWriter:true,executionEvidence:{...proof('tool_result'),terminal:true,active:false}})).job;
 assert.equal(job.state,'completed');assert.equal(job.holdsSlot,false);assert.deepEqual(job.evidenceLinks,[]);
 const view=await c.service.view('owner');assert.equal(view.jobs[0].evidenceReference,null);assert.equal(view.jobs[0].lastEffectiveAction,'Synthetic test command produced output');assert.equal(view.counts.heldSlots,0);
});
test('waiting, future, malformed, inactive and replayed observations cannot manufacture green activity',()=>{
 for(const value of [{...proof(),kind:'waiting_response'},{...proof(),observedAt:'2026-10-07T18:00:01.000Z'},{...proof(),reference:''},{...proof('active_process'),active:false}])assert.throws(()=>normalizeExecutionEvidence(value,instant),{code:'invalid_execution_evidence'});
 assert.throws(()=>normalizeExecutionEvidence(proof(),instant,proof()),{code:'invalid_execution_evidence'});
 assert.equal(executionEvidenceView({state:'running',executionEvidence:{...proof(),active:false}},instant).effectiveState,'unknown');
 assert.equal(executionEvidenceView({state:'running',executionEvidence:'broken'},instant).effectiveState,'unknown');
});
test('public evidence fields remove private source paths and never expose opaque proof identifiers',()=>{
 const view=executionEvidenceView({state:'running',executionEvidence:{...proof(),source:'/workspace/private/source',step:'/root/private/output',reference:'private-thread-id'}},instant);
 assert.equal(view.evidenceSource,null);assert.equal(view.currentStep,null);assert.equal(view.lastEffectiveAction,null);assert.equal(view.evidenceReference,null);
 assert.equal(executionEvidenceView({state:'running',executionEvidence:{...proof(),reference:'https://example.com/result?token=private'}},instant).evidenceReference,null);
});
test('a start receipt is unknown until original-turn activity is persisted; refresh and expiry retain the slot',async t=>{
 const c=setup(t);await c.add();let job=await c.run();let view=await c.service.view('owner');
 assert.equal(job.state,'running');assert.equal(view.jobs[0].state,'unknown');assert.equal(view.jobs[0].lastExecutionObservedAt,null);assert.equal(view.counts.running,0);assert.equal(view.counts.heldSlots,1);
 await assert.rejects(c.update(job,'observe',{turnId:'another-turn',executionEvidence:proof()}),{code:'dispatch_binding_conflict'});
 job=(await c.update(job,'observe',{executionEvidence:proof('active_process')})).job;const persisted=structuredClone(job);
 view=await c.service.view('owner');assert.equal(view.jobs[0].state,'running');assert.equal(view.counts.running,1);assert.deepEqual(view.projectTotals[0].current.map(row=>row.taskNumber),[1]);
 assert.deepEqual(await c.store.get('owner',job.id),persisted);c.advance(60000);view=await c.service.view('owner');
 assert.equal(view.jobs[0].state,'unknown');assert.equal(view.jobs[0].lastExecutionObservedAt,instant);assert.equal(view.counts.heldSlots,1);assert.deepEqual(view.projectTotals[0].unverifiedRunning,[1]);assert.deepEqual(await c.store.get('owner',job.id),persisted);
 await assert.rejects(c.update(job,'observe',{executionEvidence:proof('active_process')}),{code:'invalid_execution_evidence'});
});
test('task numbers persist across priority, cancellation and additions; totals include removed tasks and explicit scope events',async t=>{
 const c=setup(t),a=await c.add(),b=await c.add(),d=await c.add();
 assert.deepEqual([a.taskNumber,b.taskNumber,d.taskNumber],[1,2,3]);
 await c.service.reorder('owner',{eventId:c.id(),items:[d,b,a].map(job=>({id:job.id,expectedVersion:job.version}))});
 await c.update(await c.store.get('owner',b.id),'cancel');c.advance(1000);const next=await c.add();assert.equal(next.taskNumber,4);
 const view=await c.service.view('owner'),totals=view.projectTotals[0];assert.equal(totals.registered,4);assert.equal(totals.removed,1);assert.equal(totals.activeRegistered,3);assert.equal(totals.completed,0);
 assert.equal(totals.scopeChanges.length,5);assert.equal(totals.scopeChanges.filter(row=>row.type==='removed')[0].taskNumber,2);assert.equal(totals.scopeChanges.find(row=>row.taskNumber===4).recordedAt,'2026-10-07T18:00:01.000Z');assert.equal((await c.store.get('owner',a.id)).taskNumber,1);
 await c.add('another-owner');assert.equal((await c.service.view('owner')).projectTotals[0].registered,4);
});
test('project current list supports parallel confirmed tasks, excludes unproved starts, and completion updates totals',async t=>{
 const c=setup(t);for(let i=0;i<3;i++)await c.add();const first=await c.run(),second=await c.run();await c.run();
 const one=(await c.update(first,'observe',{executionEvidence:proof()})).job;await c.update(second,'observe',{executionEvidence:proof('progress_output')});
 let totals=(await c.service.view('owner')).projectTotals[0];assert.equal(totals.current.length,2);assert.equal(totals.unverifiedRunning.length,1);
 c.advance(1000);await c.update(one,'complete',{noActiveWriter:true,executionEvidence:{...proof('tool_result','2026-10-07T18:00:01.000Z'),active:false,terminal:true},evidenceLinks:[{label:'Synthetic result',url:'https://example.com/result'}]});totals=(await c.service.view('owner')).projectTotals[0];assert.equal(totals.registered,3);assert.equal(totals.completed,1);assert.equal(totals.current.length,1);
});
test('project totals remain complete when more than 500 creation records are omitted from the view',async t=>{
 const c=setup(t);const a=await c.add();
 // Stored fixture rows exercise the projection limit without fabricating live execution.
 c.db.db.exec('BEGIN');for(let i=2;i<=505;i++){
  const request='bulk-r-'+i,id='bulk-j-'+i;
  c.db.db.prepare('INSERT INTO intake_requests SELECT ?,owner_id,project_id,?,payload_digest,body,context_task_id,viewed_snapshot_revision,viewed_snapshot_imported_at,context_summary,context_stale,status,created_at,updated_at,version,linked_task_ids,latest_summary FROM intake_requests WHERE id=?').run(request,'bulk-client-'+i,a.requestId);
  c.db.db.prepare("INSERT INTO dispatch_jobs(id,owner_id,project_id,request_id,request_version,state,environment_type,root_job_id,created_at,updated_at,task_number) VALUES(?,'owner','p',?,3,'queued','native_cloud',?,?,?,?)").run(id,request,id,instant,instant,i);
  c.db.db.prepare("INSERT INTO dispatch_operations VALUES('owner',?,?,?,'enqueue',?)").run('bulk-event-'+i,id,'synthetic',instant);
 }c.db.db.exec('COMMIT');
 const view=await c.service.view('owner'),total=view.projectTotals[0];assert.equal(total.registered,505);assert.equal(view.coverage.truncated,true);assert.equal(total.coverage.totalsComplete,true);assert.equal(total.coverage.scopeChangesShown,500);assert.equal(total.coverage.scopeChangesOmitted,5);
});
test('a new unobserved turn supersedes an older completion without fabricating its observation time',()=>{
 const original={schemaVersion:'dot-board.snapshot/2',importedAt:instant,tasks:[],agents:[]};
 const previous={id:'old',requestId:'r1',ownerId:'owner',projectId:'p',rootJobId:'old',threadId:'thread',state:'completed',updatedAt:instant,executionObservedAt:instant};
 const current={...previous,id:'new',requestId:'r2',state:'running',updatedAt:'2026-10-07T18:01:00.000Z',executionObservedAt:'2026-10-07T18:01:00.000Z'};
 for(const jobs of [[previous,current],[current,previous]]){
  const projected=projectDispatchJobs(original,jobs,[{id:'r1',body:'Previous'},{id:'r2',body:'Current'}],[{id:'p',name:'Synthetic'}],{now:Date.parse('2026-10-07T18:01:00.000Z')});
  assert.equal(projected.agents[0].activity.state,'unknown');assert.equal(projected.agents[0].activity.observedAt,null);
 }
});
test('additive migration backfills stable project numbering including canceled records without inventing evidence',()=>{
 const db=new DatabaseSync(':memory:');try{
  for(const name of ['0000_project_intake.sql','0001_events_dispatch.sql'])for(const sql of readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8').split('--> statement-breakpoint'))db.exec(sql);
  db.exec('PRAGMA foreign_keys=OFF');
  for(const [id,state,createdAt] of [['older','canceled','2026-10-06T00:00:00Z'],['newer','queued',instant]])db.prepare("INSERT INTO dispatch_jobs(id,owner_id,project_id,request_id,request_version,state,environment_type,root_job_id,created_at,updated_at) VALUES(?,'owner','p',?,1,?,'native_cloud',?,?,?)").run(id,id,state,id,createdAt,createdAt);
  for(const sql of readFileSync(new URL('../migrations/0002_execution_evidence.sql',import.meta.url),'utf8').split('--> statement-breakpoint'))db.exec(sql);
  assert.deepEqual(db.prepare('SELECT id,task_number,execution_evidence FROM dispatch_jobs ORDER BY task_number').all().map(row=>({...row})),[{id:'older',task_number:1,execution_evidence:null},{id:'newer',task_number:2,execution_evidence:null}]);
 }finally{db.close();}
});

test('public execution evidence suppresses credential shapes and fragments',()=>{
 const token='ghp_'+'x'.repeat(36);const view=executionEvidenceView({state:'running',executionEvidence:{...proof(),source:token,step:token,reference:'https://example.com/result#access_token='+token}},instant);assert.equal(view.evidenceSource,null);assert.equal(view.currentStep,null);assert.equal(view.lastEffectiveAction,null);assert.equal(view.evidenceReference,null);
});
