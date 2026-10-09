import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {applyTaskStatusOverlay,taskStatusOverlayMetadata} from '../src/domain/task-status-overlay.mjs';
import {readEnvironmentSnapshot,readEnvironmentTaskStatusOverlay} from '../src/adapters/snapshot.mjs';
import {buildBoard} from '../src/application/board-service.mjs';
import {intakeDigest} from '../src/domain/intake.mjs';
import {boardConfig} from '../config/board.mjs';
import {createWorker} from '../worker.mjs';
import {sqliteIntakeFixture} from './sqlite-intake-fixture.mjs';
const fixture=JSON.parse(await readFile(new URL('../fixtures/synthetic.json',import.meta.url),'utf8'));
const now=Date.parse('2026-10-07T09:00:00Z');
function sample(){const value=structuredClone(fixture);value.importedAt='2026-10-01T12:00:00Z';value.tasks[0].observedAt='2026-10-01T12:00:00Z';value.futureField={nested:['preserve',9]};value.tasks[0].futureDetail={value:'preserve this unknown input field'};return value;}
function patch(input=sample(),version=1){return {schemaVersion:'dot-board.task-status-overlay/1',version,updates:[{taskId:input.tasks[0].id,expected:{title:input.tasks[0].title,state:input.tasks[0].state},observedAt:'2026-10-07T08:00:00Z',sourceLabel:'Synthetic verified observation',set:{state:'partial',stage:'Synthetic bounded continuation',observation:'Synthetic work resumed; full acceptance remains open.',blocker:'',nextAction:'Run the remaining synthetic checks',nextOwnerRole:'Synthetic owner'}}]};}
async function policy(value){return {...boardConfig,taskStatusOverlay:{version:value.version,sha256:await intakeDigest(value)}};}
async function apply(input,value,config){return applyTaskStatusOverlay(input,value,config??await policy(value),now);}

test('overlay changes only selected fields and preserves original input, unknown fields and old import time',async()=>{
  const input=sample(),before=structuredClone(input),value=patch(input),result=await apply(input,value);
  assert.deepEqual(input,before);assert.notEqual(result,input);assert.deepEqual(result.futureField,before.futureField);assert.deepEqual(result.tasks[0].futureDetail,before.tasks[0].futureDetail);
  assert.equal(result.importedAt,before.importedAt);assert.deepEqual(result.agents,before.agents);assert.deepEqual(result.tasks.slice(1),before.tasks.slice(1));
  const allowed=new Set([...Object.keys(value.updates[0].set),'observedAt']);for(const key of Object.keys(before.tasks[0]))if(!allowed.has(key))assert.deepEqual(result.tasks[0][key],before.tasks[0][key]);
});
test('same approved patch is idempotent without changing observation times',async()=>{
  const input=sample(),value=patch(input),config=await policy(value),first=await apply(input,value,config),second=await apply(first,value,config);
  assert.equal(second,first);assert.equal(second.tasks[0].observedAt,value.updates[0].observedAt);
});
test('code-pinned version and digest reject old versions and altered same-version payloads',async()=>{
  const input=sample(),v1=patch(input),v2=patch(input,2),config2=await policy(v2);
  await assert.rejects(apply(input,v1,config2),{code:'invalid_status_overlay'});
  const changed=structuredClone(v2);changed.updates[0].set.state='done';await assert.rejects(apply(input,changed,config2),{code:'invalid_status_overlay'});
  const latest=await apply(input,v2,config2);await assert.rejects(apply(latest,v1,config2),{code:'invalid_status_overlay'});
});
test('no overlay means no source, counts, fields or import-time change',async()=>{const input=sample();assert.equal(await applyTaskStatusOverlay(input,null,boardConfig),input);assert.equal(taskStatusOverlayMetadata(input),null);});
test('target drift, unknown identities, duplicate targets and forbidden fields reject the whole batch',async()=>{
  for(const change of [v=>v.updates[0].expected.state='done',v=>v.updates[0].expected.title='Different title',v=>v.updates[0].taskId='missing',v=>v.updates.push(structuredClone(v.updates[0])),v=>v.updates[0].set.project='Other',v=>v.updates[0].set.verification={businessAcceptance:{state:'passed'}},v=>v.updates[0].set.id='new-identity']){
    const input=sample(),before=structuredClone(input),value=patch(input);change(value);await assert.rejects(apply(input,value),{code:'invalid_status_overlay'});assert.deepEqual(input,before);
  }
});
test('evidence cannot be older than the record, missing, future, private or invalid',async()=>{
  for(const change of [v=>v.updates[0].observedAt='2026-09-01T00:00:00Z',v=>v.updates[0].observedAt=null,v=>v.updates[0].observedAt='2026-10-08T00:00:00Z',v=>v.updates[0].sourceLabel='/workspace/private',v=>v.updates[0].set.observation='/workspace/private',v=>v.updates[0].set.state='invented',v=>delete v.updates[0].set.observation]){const input=sample(),value=patch(input);change(value);await assert.rejects(apply(input,value),{code:'invalid_status_overlay'});}
});
test('unmodified records and Agent clocks remain stale; scoped metadata cannot be forged in source JSON',async()=>{
  const input=sample(),value=patch(input),config=await policy(value),result=await apply(input,value,config),board=buildBoard(result,config,now);
  assert.equal(board.statusUpdates.taskCount,1);assert.equal(board.statusUpdates.agentRecordsUpdated,false);assert.equal(board.importedAt,input.importedAt);
  assert.equal(board.tasks.find(t=>t.id===value.updates[0].taskId).observedAt,value.updates[0].observedAt);
  for(const task of input.tasks.slice(1))assert.equal(board.tasks.find(t=>t.id===task.id).observedAt,task.observedAt??null);
  assert.equal(buildBoard({...input,statusUpdates:{taskCount:99,agentRecordsUpdated:true}},config,now).statusUpdates,undefined);
});
test('overlay transport is separately bounded and cannot rewrite original snapshot chunks',async()=>{
  const input=sample(),value=patch(input),raw=JSON.stringify(input),size=Math.ceil(raw.length/12),env={DOT_BOARD_SNAPSHOT_PARTS:'12',DOT_BOARD_TASK_STATUS_OVERLAY_PARTS:'2'},overlay=JSON.stringify(value);
  for(let i=0;i<12;i++)env[`DOT_BOARD_SNAPSHOT_${i}`]=raw.slice(i*size,(i+1)*size);env.DOT_BOARD_TASK_STATUS_OVERLAY_0=overlay.slice(0,100);env.DOT_BOARD_TASK_STATUS_OVERLAY_1=overlay.slice(100);const before=structuredClone(env);
  await apply(readEnvironmentSnapshot(env),readEnvironmentTaskStatusOverlay(env));assert.deepEqual(env,before);
  for(const bad of [{DOT_BOARD_TASK_STATUS_OVERLAY:'{'},{DOT_BOARD_TASK_STATUS_OVERLAY:'x'.repeat(32769)},{DOT_BOARD_TASK_STATUS_OVERLAY_PARTS:'13'},{DOT_BOARD_TASK_STATUS_OVERLAY_PARTS:'2',DOT_BOARD_TASK_STATUS_OVERLAY_0:'{}'}])assert.throws(()=>readEnvironmentTaskStatusOverlay(bad),{code:'invalid_status_overlay'});
});
test('Worker keeps D1 queue, registry, request inputs and original environment unchanged',async t=>{
  const input=sample(),value=patch(input),config=await policy(value),db=sqliteIntakeFixture();t.after(()=>db.close());
  const env={DB:db.binding,DOT_BOARD_SNAPSHOT:JSON.stringify(input),DOT_BOARD_TASK_STATUS_OVERLAY:JSON.stringify(value),DOT_BOARD_PROJECT_REGISTRY:JSON.stringify([{id:'synthetic-project',name:input.tasks[0].project,aliases:[]}]),DOT_BOARD_INTAKE_MCP_ENABLED:'true',DOT_BOARD_INTAKE_CONNECTION_VERIFIED:'true',DOT_BOARD_INTAKE_ENABLED:'true',DOT_BOARD_INTAKE_READER_VERIFIED:'false',DOT_BOARD_INTAKE_WRITER_VERIFIED:'false'};
  const serial=()=>JSON.stringify(env,(key,value)=>key==='DB'?undefined:value),before=serial(),worker=createWorker({},config);
  const response=await worker.fetch(new Request('https://example.com/api/board'),env),board=await response.json();assert.equal(response.status,200);assert.equal(board.statusUpdates.taskCount,1);assert.equal(board.tasks.find(t=>t.id===value.updates[0].taskId).projectId,'synthetic-project');assert.equal(board.importedAt,input.importedAt);
  const reread=await(await worker.fetch(new Request('https://example.com/api/board'),env)).json();assert.equal(reread.snapshotRevision,board.snapshotRevision);assert.deepEqual(reread.tasks,board.tasks);assert.equal(reread.importedAt,board.importedAt);
  const capabilities=await(await worker.fetch(new Request('https://example.com/api/intake/capabilities'),env)).json();assert.equal(capabilities.canSubmit,true);
  const tools=await(await worker.fetch(new Request('https://example.com/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})}),env)).json();assert(tools.result.tools.some(x=>x.name==='get_board_snapshot'));assert(tools.result.tools.some(x=>x.name==='record_project_request_event'));
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM intake_requests').get().n,0);assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM intake_events').get().n,0);assert.equal(serial(),before);
});
test('UI explicitly calls the update partial without replacing the old import timestamp',async()=>{const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');assert(app.includes('项任务局部更新'));assert(app.includes('未更新任务及 Agent 记录仍沿用原时间'));assert(app.includes('Agent 数量不是运行数'));assert(app.includes('formatted(board.importedAt)'));});
test('approved cancellation hides only its exact task without deleting source or refreshing other records',async()=>{
  const input=sample(),before=structuredClone(input),value=patch(input);value.updates[0].set.state='canceled';value.updates[0].hideFromBoard=true;const config=await policy(value),result=await apply(input,value,config);
  assert.deepEqual(input,before);assert.equal(result.tasks.length,input.tasks.length-1);assert.deepEqual(result.tasks,input.tasks.slice(1));assert.equal(result.importedAt,input.importedAt);assert.deepEqual(result.agents,input.agents);
  assert.equal(taskStatusOverlayMetadata(result).taskCount,0);assert.equal(taskStatusOverlayMetadata(result).hiddenTaskCount,1);assert.equal(taskStatusOverlayMetadata(result).latestObservedAt,null);assert.equal(await apply(result,value,config),result);
  const board=buildBoard(result,config,now);assert(!board.tasks.some(t=>t.id===value.updates[0].taskId));assert.equal(board.coverage.includedCount,input.tasks.length-1);
});
test('hidden visibility requires explicit boolean and canceled state in the approved overlay',async()=>{
  for(const mutation of [v=>v.updates[0].hideFromBoard='true',v=>v.updates[0].hideFromBoard=true]){const input=sample(),value=patch(input);mutation(value);await assert.rejects(apply(input,value),{code:'invalid_status_overlay'});}
  const input=sample();input.tasks[0].hideFromBoard=true;assert.equal((await applyTaskStatusOverlay(input,null,boardConfig)).tasks.length,input.tasks.length);
});
