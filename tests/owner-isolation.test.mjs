import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createWorker} from '../worker.mjs';
import compiledWorker from '../dist/server/index.js';
import {sqliteIntakeFixture} from './sqlite-intake-fixture.mjs';
const sample=JSON.parse(await readFile(new URL('../fixtures/synthetic.json',import.meta.url),'utf8'));
const ownerA='independent-synthetic-owner-A',ownerB='independent-synthetic-owner-B';
function scenario(t,worker){
 const fixture=sqliteIntakeFixture();t.after(()=>fixture.close());
 const source=structuredClone(sample);source.agents=[];
 source.tasks=[{...source.tasks[0],id:'independent-task-a',project:'Independent Alpha'},{...source.tasks[0],id:'independent-task-b',project:'Independent Beta'}];
 const registry=[{id:'project-a',name:'Independent Alpha'},{id:'project-b',name:'Independent Beta'}];
 const env={DB:fixture.binding,DOT_BOARD_SNAPSHOT:JSON.stringify(source),DOT_BOARD_PROJECT_REGISTRY:JSON.stringify(registry),DOT_BOARD_INTAKE_ENABLED:'true',DOT_BOARD_INTAKE_MCP_ENABLED:'true',DOT_BOARD_INTAKE_CONNECTION_VERIFIED:'true',DOT_BOARD_INTAKE_READER_VERIFIED:'true',DOT_BOARD_INTAKE_WRITER_VERIFIED:'true'};
 async function call(path,{method='GET',body,owner=ownerA,origin='https://synthetic.example'}={}){
  const response=await worker.fetch(new Request('https://synthetic.example'+path,{method,headers:{...(owner===null?{}:{'oai-authenticated-user-id':owner}),...(method==='POST'?{'content-type':'application/json',...(origin===null?{}:{origin})}:{} )},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
  return {status:response.status,headers:response.headers,body:await response.json()};
 }
 const mcp=(name,args={},options={})=>call('/mcp',{method:'POST',body:{jsonrpc:'2.0',id:17,method:'tools/call',params:{name,arguments:args}},...options});
 const input=async(extra={})=>{const {body:board}=await call('/api/board');return {clientSubmissionId:crypto.randomUUID(),body:'Independent synthetic request',contextTaskId:null,viewedSnapshotRevision:board.snapshotRevision,viewedSnapshotImportedAt:board.importedAt,contextSummary:'',...extra};};
 const submit=async(project='project-a',extra={},options={})=>call(`/api/projects/${project}/requests`,{method:'POST',body:await input(extra),...options});
 const count=()=>({requests:fixture.db.prepare('SELECT COUNT(*) AS n FROM intake_requests').get().n,events:fixture.db.prepare('SELECT COUNT(*) AS n FROM intake_events').get().n});
 return {source,registry,env,call,mcp,input,submit,count,fixture};
}
for(const [label,worker] of [['source',createWorker({})],['compiled',compiledWorker]]){
 test(`${label}: independent cross-owner reads, acknowledgement and event writes cannot access or change a foreign receipt`,async t=>{
  const c=scenario(t,worker),created=await c.submit(),id=created.body.request.id;
  assert.equal(created.status,201);assert.equal((await c.call('/api/requests/'+id,{owner:ownerB})).status,404);
  for(const [name,args] of [['get_project_request',{requestId:id}],['acknowledge_project_request',{requestId:id,eventId:'foreign-ack',expectedVersion:1}],['record_project_request_event',{requestId:id,eventId:'foreign-event',expectedVersion:1,status:'accepted',summary:'Foreign synthetic write'}]]){
   const r=await c.mcp(name,args,{owner:ownerB});assert.equal(r.body.result.isError,true);assert.equal(r.body.result.structuredContent.error,'request_not_found');
  }
  const retained=await c.call('/api/requests/'+id);assert.equal(retained.body.request.version,1);assert.equal(retained.body.events.length,1);assert.deepEqual(c.count(),{requests:1,events:1});
  assert.deepEqual((await c.call('/api/projects/project-a/requests',{owner:ownerB})).body.requests,[]);
 });
 test(`${label}: identical submission key stays owner-scoped, injected owner/project/digest fields are ignored`,async t=>{
  const c=scenario(t,worker),key='same-synthetic-submission-key';
  const a=await c.submit('project-a',{clientSubmissionId:key,ownerId:ownerB,projectId:'project-b',payloadDigest:'synthetic-injected-digest',body:'Only synthetic owner A'});
  const b=await c.submit('project-a',{clientSubmissionId:key,body:'Only synthetic owner B'},{owner:ownerB});
  assert.equal(a.status,201);assert.equal(b.status,201);assert.notEqual(a.body.request.id,b.body.request.id);assert.equal(a.body.request.projectId,'project-a');
  const stored=c.fixture.db.prepare('SELECT owner_id FROM intake_requests WHERE id=?').get(a.body.request.id);assert.equal(stored.owner_id,ownerA);
  for(const [owner,body] of [[ownerA,'Only synthetic owner A'],[ownerB,'Only synthetic owner B']]){const list=await c.call('/api/projects/project-a/requests',{owner});assert.equal(list.body.requests.length,1);assert.equal(list.body.requests[0].body,body);assert(!JSON.stringify(list.body).includes('owner_id'));assert(!JSON.stringify(list.body).includes('payloadDigest'));}
 });
 test(`${label}: real foreign-project task and cross-project idempotence cannot reroute a receipt`,async t=>{
  const c=scenario(t,worker);const bad=await c.submit('project-a',{contextTaskId:'independent-task-b'});assert.equal(bad.status,409);assert.equal(bad.body.error,'task_project_mismatch');assert.deepEqual(c.count(),{requests:0,events:0});
  const first=await c.submit('project-a',{clientSubmissionId:'independent-shared-key',contextTaskId:'independent-task-a'});assert.equal(first.status,201);
  const reroute=await c.submit('project-b',{clientSubmissionId:'independent-shared-key',contextTaskId:'independent-task-b'});assert.equal(reroute.status,409);assert.equal(reroute.body.error,'idempotency_conflict');
  assert.deepEqual((await c.call('/api/projects/project-b/requests')).body.requests,[]);assert.equal((await c.call('/api/projects/project-a/requests')).body.requests[0].id,first.body.request.id);assert.deepEqual(c.count(),{requests:1,events:1});
 });
 test(`${label}: exact-origin browser writes and MCP reject foreign/null/prefix origins before any write`,async t=>{
  const c=scenario(t,worker);for(const origin of ['https://synthetic.example.evil','http://synthetic.example','https://synthetic.example:444','null','https://synthetic.example/']){
   assert.equal((await c.submit('project-a',{}, {origin})).status,403);
   assert.equal((await c.mcp('get_board_snapshot',{}, {origin})).status,403);
  }
  assert.equal((await c.submit('project-a',{}, {origin:null})).status,403);
  assert.equal((await c.mcp('get_board_snapshot',{}, {origin:null})).status,200);
  assert.deepEqual(c.count(),{requests:0,events:0});
  const board=await c.call('/api/board');assert.equal(board.headers.get('access-control-allow-origin'),null);assert.match(board.headers.get('cache-control'),/private, no-store/);
 });
 test(`${label}: event ID collision across owners cannot replay foreign event content or mutate either receipt`,async t=>{
  const c=scenario(t,worker),a=await c.submit(),b=await c.submit('project-b',{}, {owner:ownerB});
  const ackA=await c.mcp('acknowledge_project_request',{requestId:a.body.request.id,eventId:'independent-shared-event',expectedVersion:1});assert.equal(ackA.body.result.isError,false);
  const ackB=await c.mcp('acknowledge_project_request',{requestId:b.body.request.id,eventId:'independent-shared-event',expectedVersion:1},{owner:ownerB});assert.equal(ackB.body.result.isError,true);assert.equal(ackB.body.result.structuredContent.error,'event_conflict');assert(!JSON.stringify(ackB.body).includes(a.body.request.id));
  assert.equal((await c.call('/api/requests/'+a.body.request.id)).body.request.version,2);assert.equal((await c.call('/api/requests/'+b.body.request.id,{owner:ownerB})).body.request.version,1);
 });
 test(`${label}: unknown source/env secrets, unsafe labels, ordinary unsafe links and storage errors do not reflect`,async t=>{
  const c=scenario(t,worker);c.env.SYNTHETIC_EXTRA_SECRET='ENV_ONLY_SYNTHETIC_MARKER';c.source.privateBlob='SOURCE_ONLY_SYNTHETIC_MARKER';c.source.tasks[0].privateBlob='TASK_ONLY_SYNTHETIC_MARKER';c.source.tasks[0].observation='Bearer SYNTHETIC0123456789';c.source.tasks[0].evidence=[{label:'unsafe query',url:'https://example.com/r?token=SYNTHETIC_QUERY_VALUE'},{label:'unsafe path',url:'https://example.com/user_notes/SYNTHETIC_PATH_VALUE'}];c.env.DOT_BOARD_SNAPSHOT=JSON.stringify(c.source);
  for(const r of [await c.call('/api/board'),await c.mcp('get_board_snapshot')])for(const marker of ['ENV_ONLY_SYNTHETIC_MARKER','SOURCE_ONLY_SYNTHETIC_MARKER','TASK_ONLY_SYNTHETIC_MARKER','SYNTHETIC0123456789','SYNTHETIC_QUERY_VALUE','SYNTHETIC_PATH_VALUE'])assert(!JSON.stringify(r.body).includes(marker),marker);
  c.env.DB={prepare(){throw Error('SYNTHETIC_PRIVATE_STORAGE_ERROR');},batch(){throw Error('SYNTHETIC_PRIVATE_STORAGE_ERROR');}};const r=await c.call('/api/requests/synthetic-request');assert.equal(r.status,503);assert(!JSON.stringify(r.body).includes('SYNTHETIC_PRIVATE_STORAGE_ERROR'));
 });
 test(`${label}: document deployment-scoped base snapshot and upstream identity trust rather than claiming built-in tenant isolation`,async t=>{
  const c=scenario(t,worker),anonymous=await c.call('/api/board',{owner:null}),a=await c.mcp('get_board_snapshot'),b=await c.mcp('get_board_snapshot',{}, {owner:ownerB});
  assert.equal(anonymous.status,200);assert.deepEqual(a.body.result.structuredContent.snapshot.tasks,b.body.result.structuredContent.snapshot.tasks);assert.equal(anonymous.body.tasks.length,2);
  assert.equal((await c.mcp('get_board_snapshot',{}, {owner:null})).status,401);
 });
 test(`${label}: privacy regression - credential-shaped registry IDs must not be reflected`,async t=>{
  const c=scenario(t,worker),marker='sk-SYNTHETIC_ONLY0123456789';c.registry[0].id=marker;c.env.DOT_BOARD_PROJECT_REGISTRY=JSON.stringify(c.registry);
  const results=[await c.call('/api/board'),await c.mcp('list_request_projects'),await c.mcp('get_board_snapshot')];
  assert(results.every(r=>!JSON.stringify(r.body).includes(marker)),'Credential-shaped synthetic registry ID was reflected in public projection');
 });
 test(`${label}: privacy regression - credential-shaped Agent IDs must not be reflected`,async t=>{
  const c=scenario(t,worker),marker='sk-SYNTHETIC_AGENT0123456789';c.source.agents=[{id:marker,name:'Synthetic worker',type:'agent',kind:'worker',parentAgentId:null,projectNames:['Independent Alpha'],taskIds:['independent-task-a']}];c.env.DOT_BOARD_SNAPSHOT=JSON.stringify(c.source);
  const results=[await c.call('/api/board'),await c.mcp('get_board_snapshot')];assert(results.every(r=>!JSON.stringify(r.body).includes(marker)),'Credential-shaped synthetic Agent ID was reflected in public projection');
 });
 test(`${label}: privacy regression - secret URL fragments must not be reflected`,async t=>{
  const c=scenario(t,worker),marker='SYNTHETIC_FRAGMENT_SECRET';c.source.tasks[0].evidence=[{label:'Synthetic fragment',url:'https://example.com/report#access_token='+marker}];c.env.DOT_BOARD_SNAPSHOT=JSON.stringify(c.source);
  const results=[await c.call('/api/board'),await c.mcp('get_board_snapshot')];assert(results.every(r=>!JSON.stringify(r.body).includes(marker)),'Synthetic access_token URL fragment was reflected in public projection');
 });
}
