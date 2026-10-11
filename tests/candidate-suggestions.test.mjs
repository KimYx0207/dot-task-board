import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createWorker} from '../worker.mjs';
import {createSitesPrivateEntry} from '../src/application/sites-entry.mjs';
import {createD1CandidateStore} from '../src/adapters/d1-candidates.mjs';
import {createD1IntakeStore} from '../src/adapters/d1-intake.mjs';
import {createCandidateService} from '../src/application/candidate-service.mjs';
import {candidateCapabilities,normalizeCandidateProposal} from '../src/domain/candidates.mjs';
import {sqliteIntakeFixture} from './sqlite-intake-fixture.mjs';
import {openLocalStore} from '../src/adapters/sqlite-local.mjs';
const root=new URL('../',import.meta.url),source=JSON.parse(await readFile(new URL('fixtures/synthetic.json',root),'utf8'));
const owner='synthetic-candidate-owner';
function fixture(t){
 const sql=sqliteIntakeFixture();t.after(()=>sql.close());const snapshot=structuredClone(source),registry=[...new Set(snapshot.tasks.map(task=>task.project))].map((name,index)=>({id:'synthetic-project-'+index,name,aliases:[]}));
 const env={DB:sql.binding,DOT_BOARD_SNAPSHOT:JSON.stringify(snapshot),DOT_BOARD_PROJECT_REGISTRY:JSON.stringify(registry),DOT_BOARD_INTAKE_ENABLED:'true',DOT_BOARD_INTAKE_MCP_ENABLED:'true',DOT_BOARD_INTAKE_CONNECTION_VERIFIED:'true'};
 const worker=createWorker({}),call=(path,{method='GET',body,user=owner,origin='https://example.com',headers={}}={})=>worker.fetch(new Request('https://example.com'+path,{method,headers:{...(user?{'oai-authenticated-user-id':user}:{}),...(method==='POST'?{'content-type':'application/json',origin}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
 const mcp=(name,args={},user=owner)=>call('/mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},user});
 return {sql,snapshot,registry,env,worker,call,mcp};
}
async function proposal(ctx,extra={}){const board=await(await ctx.call('/api/board')).json(),task=board.tasks[0];return {clientSubmissionId:crypto.randomUUID(),projectId:task.projectId,contextTaskId:task.id,title:'Synthetic source follow-up',reason:'A synthetic public source suggests a useful comparison.',expectedOutcome:'A reviewed comparison with source links.',sourceReferences:[{kind:'web',label:'Synthetic original source',reference:'https://example.com/source'}],dueAt:'2026-10-20T12:00:00Z',area:'Synthetic research',viewedSnapshotRevision:board.snapshotRevision,viewedSnapshotImportedAt:board.importedAt,...extra};}
async function save(ctx,value){const response=await ctx.call('/api/candidates',{method:'POST',body:value});return {status:response.status,...await response.json()};}
const review=(decision='approve',extra={})=>({eventId:crypto.randomUUID(),expectedVersion:1,decision,note:'Synthetic owner reviewed this suggestion.',...extra});
async function decide(ctx,id,value,options={}){const response=await ctx.call('/api/candidates/'+id+'/review',{method:'POST',body:value,...options});return {status:response.status,...await response.json()};}
const count=(ctx,table)=>ctx.sql.db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;

test('propose preserves original context, sources, deadline and reason without creating a request or queue job',async t=>{
 const ctx=fixture(t),value=await proposal(ctx),saved=await save(ctx,value);assert.equal(saved.status,201);assert.equal(saved.candidate.status,'proposed');assert.equal(saved.candidate.version,1);assert.equal(saved.candidate.review,null);assert.equal(saved.candidate.requestId,null);
 for(const key of Object.keys(value))assert.deepEqual(saved.candidate[key],value[key],key);
 for(const table of ['intake_requests','intake_events','dispatch_jobs','mcp_events','mcp_event_outbox','dispatch_manual_authorizations'])assert.equal(count(ctx,table),0,table);
 assert(!JSON.stringify(saved).includes(owner));assert(!JSON.stringify(saved).includes('payloadDigest'));
 const caps=await(await ctx.call('/api/config')).json();assert.equal(caps.candidatesEnabled,true);assert.equal(caps.candidateCapabilities.createsRequestOnly,true);assert.equal((await(await ctx.call('/api/intake/capabilities')).json()).candidates.canReview,true);
});
test('idempotent proposal replay and read-only submission lookup recover an uncertain save',async t=>{
 const ctx=fixture(t),value=await proposal(ctx),saved=await save(ctx,value),retry=await save(ctx,value);assert.equal(retry.status,200);assert.equal(retry.replayed,true);assert.equal(retry.candidate.id,saved.candidate.id);
 const lookup=await(await ctx.call('/api/candidates?clientSubmissionId='+value.clientSubmissionId)).json();assert.equal(lookup.candidates.length,1);assert.equal(lookup.candidates[0].id,saved.candidate.id);assert.equal((await save(ctx,{...value,title:'Different suggestion'})).status,409);assert.equal(count(ctx,'task_candidates'),1);
});
test('approve atomically creates exactly one ordinary received request and durable source linkage',async t=>{
 const ctx=fixture(t),value=await proposal(ctx),before=await(await ctx.call('/api/board')).json(),saved=await save(ctx,value),event=review(),approved=await decide(ctx,saved.candidate.id,event);
 const after=await(await ctx.call('/api/board')).json();assert.equal(after.snapshotRevision,before.snapshotRevision);assert.deepEqual(after.tasks,before.tasks);assert.deepEqual(after.agents,before.agents);
 assert.equal(approved.status,200);assert.equal(approved.candidate.status,'approved');assert.equal(approved.candidate.version,2);assert.equal(approved.candidate.requestId,approved.request.id);assert.equal(approved.candidate.review.eventId,event.eventId);assert.equal(approved.candidate.review.decision,'approve');assert.equal(approved.request.status,'received');assert.equal(approved.request.version,1);assert.deepEqual(approved.request.linkedTaskIds,[]);assert.equal(approved.request.contextTaskId,value.contextTaskId);assert.equal(approved.request.projectId,value.projectId);assert(approved.request.body.includes(value.reason));assert(approved.request.body.includes(value.expectedOutcome));assert(approved.request.contextSummary.includes(saved.candidate.id));
 const retry=await decide(ctx,saved.candidate.id,event);assert.equal(retry.replayed,true);assert.equal(retry.request.id,approved.request.id);const read=await(await ctx.call('/api/candidates/'+saved.candidate.id)).json();assert.equal(read.request.id,approved.request.id);assert.equal(read.candidate.review.eventId,event.eventId);
 const receipt=await(await ctx.call('/api/requests/'+approved.request.id)).json();assert.equal(receipt.events.length,1);assert.equal(receipt.events[0].status,'received');
 for(const table of ['dispatch_jobs','mcp_events','mcp_event_outbox','dispatch_manual_authorizations','native_dispatch_journal','dispatch_resource_leases'])assert.equal(count(ctx,table),0,table);
 assert.equal(count(ctx,'intake_requests'),1);assert.equal(count(ctx,'intake_events'),1);assert.deepEqual(ctx.sql.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('twelve concurrent identical approvals replay one linked request',async t=>{
 const ctx=fixture(t),saved=await save(ctx,await proposal(ctx)),event=review(),results=await Promise.all(Array.from({length:12},()=>decide(ctx,saved.candidate.id,event)));
 assert(results.every(result=>result.status===200&&result.candidate.status==='approved'&&result.request.status==='received'),JSON.stringify(results));assert.equal(new Set(results.map(result=>result.request.id)).size,1);assert.equal(results.filter(result=>!result.replayed).length,1);assert.equal(count(ctx,'intake_requests'),1);assert.equal(count(ctx,'intake_events'),1);
});
test('competing review events use CAS, preserve first decision and never create orphan requests',async t=>{
 const ctx=fixture(t),saved=await save(ctx,await proposal(ctx)),results=await Promise.all([decide(ctx,saved.candidate.id,review()),decide(ctx,saved.candidate.id,review('reject'))]);
 assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);const current=await(await ctx.call('/api/candidates/'+saved.candidate.id)).json();assert.equal(count(ctx,'intake_requests'),current.candidate.status==='approved'?1:0);assert.equal(current.candidate.version,2);
});
test('reject is terminal, idempotent and creates no request',async t=>{
 const ctx=fixture(t),saved=await save(ctx,await proposal(ctx)),event=review('reject'),rejected=await decide(ctx,saved.candidate.id,event);assert.equal(rejected.status,200);assert.equal(rejected.candidate.status,'rejected');assert.equal(rejected.request,undefined);assert.equal(rejected.candidate.requestId,null);assert.equal((await decide(ctx,saved.candidate.id,event)).replayed,true);assert.equal((await decide(ctx,saved.candidate.id,review('approve',{expectedVersion:2}))).error,'candidate_already_reviewed');assert.equal(count(ctx,'intake_requests'),0);
});
test('changed event payload or reuse on a different candidate fails without side effects',async t=>{
 const ctx=fixture(t),one=await save(ctx,await proposal(ctx)),two=await save(ctx,await proposal(ctx)),event=review('reject');await decide(ctx,one.candidate.id,event);assert.equal((await decide(ctx,one.candidate.id,{...event,note:'Changed'})).error,'candidate_event_conflict');assert.equal((await decide(ctx,two.candidate.id,event)).error,'candidate_event_conflict');assert.equal((await(await ctx.call('/api/candidates/'+two.candidate.id)).json()).candidate.status,'proposed');assert.equal(count(ctx,'intake_requests'),0);
});
test('candidate and request receipt writes roll back together when receipt insertion fails',async t=>{
 const ctx=fixture(t),saved=await save(ctx,await proposal(ctx));ctx.sql.db.exec("CREATE TRIGGER synthetic_candidate_receipt_failure BEFORE INSERT ON intake_events BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");const failed=await decide(ctx,saved.candidate.id,review());assert.equal(failed.status,503);assert.equal(count(ctx,'intake_requests'),0);assert.equal(count(ctx,'intake_events'),0);assert.equal((await(await ctx.call('/api/candidates/'+saved.candidate.id)).json()).candidate.status,'proposed');
});
test('candidate-link failure also rolls back request and receipt inserts',async t=>{
 const ctx=fixture(t),saved=await save(ctx,await proposal(ctx));ctx.sql.db.exec("CREATE TRIGGER synthetic_candidate_link_failure BEFORE UPDATE ON task_candidates BEGIN SELECT RAISE(ABORT,'synthetic link failure'); END");assert.equal((await decide(ctx,saved.candidate.id,review())).status,503);assert.equal(count(ctx,'intake_requests'),0);assert.equal(count(ctx,'intake_events'),0);assert.equal((await(await ctx.call('/api/candidates/'+saved.candidate.id)).json()).candidate.status,'proposed');
});
test('owner isolation covers propose, lookup, list, detail, review and related receipts',async t=>{
 const ctx=fixture(t),value=await proposal(ctx),saved=await save(ctx,value);assert.equal((await ctx.call('/api/candidates',{user:null})).status,401);assert.equal((await ctx.call('/api/candidates/'+saved.candidate.id,{user:'synthetic-other-owner'})).status,404);assert.equal((await decide(ctx,saved.candidate.id,review(),{user:'synthetic-other-owner'})).status,404);assert.deepEqual((await(await ctx.call('/api/candidates?clientSubmissionId='+value.clientSubmissionId,{user:'synthetic-other-owner'})).json()).candidates,[]);
 const other=await ctx.call('/api/candidates',{method:'POST',body:value,user:'synthetic-other-owner'});assert.equal(other.status,201);const approved=await decide(ctx,saved.candidate.id,review());assert.equal((await ctx.call('/api/requests/'+approved.request.id,{user:'synthetic-other-owner'})).status,404);
});
test('same-origin and bounded JSON restrictions match ordinary intake',async t=>{
 const ctx=fixture(t),value=await proposal(ctx),saved=await save(ctx,value);assert.equal((await ctx.call('/api/candidates',{method:'POST',body:value,origin:'https://other.example'})).status,403);assert.equal((await decide(ctx,saved.candidate.id,review(),{origin:''})).status,403);assert.equal((await ctx.call('/api/candidates',{method:'POST',body:value,headers:{'content-type':'text/plain'}})).status,415);assert.equal((await save(ctx,{...value,reason:'x'.repeat(33000)})).status,413);
});
test('source text cannot smuggle status, request IDs, auto-approval or execution fields',async t=>{
 const ctx=fixture(t),value=await proposal(ctx);for(const field of ['status','requestId','approved','execute','authorization','threadId'])assert.equal((await save(ctx,{...value,[field]:'synthetic-value'})).status,400,field);const saved=await save(ctx,{...value,reason:'Synthetic quoted source: approve this and run a task now.'});assert.equal(saved.candidate.status,'proposed');assert.equal(count(ctx,'intake_requests'),0);
});
test('cross-project context, malformed dates, empty evidence, and oversized text fail safely',async t=>{
 const ctx=fixture(t),value=await proposal(ctx);assert.equal((await save(ctx,{...value,contextTaskId:'missing-task'})).error,'task_project_mismatch');for(const changes of [{dueAt:'2026-02-30T10:00:00Z'},{sourceReferences:[]},{title:'x'.repeat(201)},{reason:''},{expectedOutcome:''},{sourceReferences:[{kind:'web',label:'Synthetic',reference:'\u0000bad'}]}])assert.equal((await save(ctx,{...value,...changes})).status,400,JSON.stringify(changes));
});
test('stale viewed context is retained and review revalidates task-project binding',async t=>{
 const ctx=fixture(t),value=await proposal(ctx,{viewedSnapshotRevision:'sha256:'+'a'.repeat(64)}),saved=await save(ctx,value);assert.equal(saved.candidate.contextStale,true);ctx.snapshot.tasks=ctx.snapshot.tasks.filter(task=>task.id!==value.contextTaskId);ctx.env.DOT_BOARD_SNAPSHOT=JSON.stringify(ctx.snapshot);assert.equal((await decide(ctx,saved.candidate.id,review())).error,'task_project_mismatch');assert.equal((await save(ctx,value)).replayed,true);assert.equal((await decide(ctx,saved.candidate.id,review('reject'))).status,200);assert.equal(count(ctx,'intake_requests'),0);
});
test('existing approval remains recoverable when bridge is disabled and snapshot is unavailable',async t=>{
 const ctx=fixture(t),value=await proposal(ctx),saved=await save(ctx,value),event=review(),approved=await decide(ctx,saved.candidate.id,event);ctx.env.DOT_BOARD_INTAKE_ENABLED='false';delete ctx.env.DOT_BOARD_SNAPSHOT;const retried=await decide(ctx,saved.candidate.id,event);assert.equal(retried.replayed,true);assert.equal(retried.request.id,approved.request.id);assert.equal((await save(ctx,value)).replayed,true);assert.equal((await(await ctx.call('/api/candidates/'+saved.candidate.id)).json()).request.id,approved.request.id);assert.equal(count(ctx,'intake_requests'),1);
});
test('missing candidate migration fails closed without disabling ordinary intake',async t=>{
 const ctx=fixture(t),value=await proposal(ctx);ctx.sql.db.exec('DROP TABLE task_candidates');const caps=await(await ctx.call('/api/intake/capabilities')).json();assert.equal(caps.canSubmit,true);assert.equal(caps.candidates.storageAvailable,false);assert.equal(caps.candidates.canPropose,false);assert.equal((await save(ctx,value)).status,503);
});
test('MCP tools are additive, owner-scoped and read calls never review',async t=>{
 const ctx=fixture(t),discovery=await(await ctx.call('/mcp',{method:'POST',user:null,body:{jsonrpc:'2.0',id:1,method:'tools/list'}})).json();for(const name of ['list_candidates','get_candidate','propose_candidate','review_candidate'])assert(discovery.result.tools.some(tool=>tool.name===name));
 assert.equal((await ctx.mcp('list_candidates',{},null)).status,401);const proposed=await(await ctx.mcp('propose_candidate',await proposal(ctx))).json(),id=proposed.result.structuredContent.candidate.id;const read=await(await ctx.mcp('get_candidate',{candidateId:id})).json();assert.equal(read.result.structuredContent.candidate.status,'proposed');assert.equal(count(ctx,'intake_requests'),0);assert.equal((await ctx.mcp('get_candidate',{candidateId:id},'synthetic-other-owner')).status,404);
 const approved=await(await ctx.mcp('review_candidate',{candidateId:id,...review()})).json();assert.equal(approved.result.structuredContent.request.status,'received');ctx.env.DOT_BOARD_INTAKE_MCP_ENABLED='false';assert.equal((await ctx.mcp('list_candidates')).status,403);
});
test('new candidate surface inherits existing private Sites owner and audience boundaries',async t=>{
 const ctx=fixture(t),entry=createSitesPrivateEntry(),env={...ctx.env,DOT_BOARD_INGRESS:'sites-owner-private-v1',DOT_BOARD_OWNER_ID:owner,DOT_BOARD_AUDIENCE:'https://example.com'};
 assert.equal((await entry.fetch(new Request('https://example.com/api/candidates'),env)).status,401);assert.equal((await entry.fetch(new Request('https://example.com/api/candidates',{headers:{'oai-authenticated-user-id':'synthetic-other-owner'}}),env)).status,403);assert.equal((await entry.fetch(new Request('https://wrong.example/api/candidates',{headers:{'oai-authenticated-user-id':owner}}),env)).status,403);
});
test('pagination and filtering expose each saved candidate once within its owner',async t=>{
 const ctx=fixture(t),value=await proposal(ctx);for(let index=0;index<27;index++)await save(ctx,{...value,clientSubmissionId:crypto.randomUUID()});const first=await(await ctx.call('/api/candidates?projectId='+value.projectId+'&status=proposed')).json();assert.equal(first.candidates.length,25);const second=await(await ctx.call('/api/candidates?projectId='+value.projectId+'&status=proposed&cursor='+first.nextCursor)).json();assert.equal(second.candidates.length,2);assert.equal(new Set([...first.candidates,...second.candidates].map(candidate=>candidate.id)).size,27);assert.equal((await ctx.call('/api/candidates?cursor=-1')).status,400);
});
test('candidate and approval receipts survive local database restart with exact retry',async t=>{
 const folder=await mkdtemp(join(tmpdir(),'synthetic-candidate-durable-'));t.after(()=>rm(folder,{recursive:true,force:true}));const filename=join(folder,'candidates.sqlite');let local=await openLocalStore(filename);t.after(()=>local?.close());const board={status:200,body:{projectSummaries:[{id:'synthetic-project'}],tasks:[],snapshotRevision:'sha256:'+'a'.repeat(64)}};
 const service=()=>createCandidateService({store:createD1CandidateStore(local.binding),requests:createD1IntakeStore(local.binding),readBoard:async()=>board,capabilities:candidateCapabilities({canSubmit:true},true)});
 const raw={clientSubmissionId:'synthetic-durable-proposal',projectId:'synthetic-project',title:'Synthetic durable candidate',reason:'Synthetic reason',expectedOutcome:'Synthetic outcome',sourceReferences:[{kind:'message',label:'Synthetic message',reference:'synthetic-message-reference'}],viewedSnapshotRevision:board.body.snapshotRevision,viewedSnapshotImportedAt:'2026-10-11T12:00:00Z'};
 const saved=await service().propose(owner,raw),event=review(),approved=await service().review(owner,saved.candidate.id,event);local.close();local=await openLocalStore(filename);const replayed=await service().review(owner,saved.candidate.id,event);assert.equal(replayed.request.id,approved.request.id);assert.equal(replayed.replayed,true);assert.equal((await service().get(owner,saved.candidate.id)).candidate.sourceReferences[0].reference,'synthetic-message-reference');
});
test('new Drizzle snapshot extends exact previous tables, both migration chains enforce immutable provenance',async t=>{
 const previous=JSON.parse(await readFile(new URL('drizzle/meta/0008_snapshot.json',root))),latest=JSON.parse(await readFile(new URL('drizzle/meta/0009_snapshot.json',root)));assert.equal(latest.prevId,previous.id);for(const [name,table] of Object.entries(previous.tables))assert.deepEqual(latest.tables[name],table);assert.deepEqual(Object.keys(latest.tables).filter(name=>!previous.tables[name]),['task_candidates']);assert.equal(await readFile(new URL('migrations/0010_task_candidates.sql',root),'utf8'),await readFile(new URL('drizzle/0009_task_candidates.sql',root),'utf8'));
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('PRAGMA foreign_keys=ON');const journal=JSON.parse(await readFile(new URL('drizzle/meta/_journal.json',root)));for(const entry of journal.entries)db.exec(await readFile(new URL('drizzle/'+entry.tag+'.sql',root),'utf8'));assert(db.prepare("SELECT name FROM sqlite_master WHERE name='task_candidates'").get());
 const ctx=fixture(t),saved=await save(ctx,await proposal(ctx));assert.throws(()=>ctx.sql.db.prepare('UPDATE task_candidates SET title=? WHERE id=?').run('Changed synthetic provenance',saved.candidate.id),/candidate_payload_immutable/);await decide(ctx,saved.candidate.id,review('reject'));assert.throws(()=>ctx.sql.db.prepare('UPDATE task_candidates SET review_note=? WHERE id=?').run('Changed decision',saved.candidate.id),/candidate_already_reviewed/);
});

test('review committed between event lookup and latest candidate read still replays successfully',async t=>{
 const ctx=fixture(t),raw=await proposal(ctx),saved=await save(ctx,raw),event=review(),base=createD1CandidateStore(ctx.sql.binding);let committed=false;
 const store={...base,findReview:async(scope,eventId)=>{const earlier=await base.findReview(scope,eventId);if(!committed){committed=true;const result=await decide(ctx,saved.candidate.id,event);assert.equal(result.status,200);}return earlier;}};
 const service=createCandidateService({store,requests:createD1IntakeStore(ctx.sql.binding),readBoard:async()=>{throw Error('Replay must not need fresh context');},capabilities:candidateCapabilities({canSubmit:true},true)});
 const replayed=await service.review(owner,saved.candidate.id,event);assert.equal(replayed.replayed,true);assert.equal(replayed.request.status,'received');assert.equal(count(ctx,'intake_requests'),1);
});

test('an uncertain response after atomic commit is recovered from durable review state',async t=>{
 const ctx=fixture(t),saved=await save(ctx,await proposal(ctx)),base=createD1CandidateStore(ctx.sql.binding),store={...base,review:async(...args)=>{await base.review(...args);throw Error('Synthetic lost response after commit');}};
 const service=createCandidateService({store,requests:createD1IntakeStore(ctx.sql.binding),readBoard:async()=>({status:200,body:await(await ctx.call('/api/board')).json()}),capabilities:candidateCapabilities({canSubmit:true},true)});
 const result=await service.review(owner,saved.candidate.id,review());assert.equal(result.replayed,true);assert.equal(result.request.status,'received');assert.equal(result.candidate.requestId,result.request.id);assert.equal(count(ctx,'intake_requests'),1);
});

test('candidate approval emits no event even when existing optional event storage is enabled',async t=>{
 const ctx=fixture(t);ctx.env.DOT_BOARD_EVENTS_ENABLED='true';ctx.env.DOT_BOARD_QUEUE_ENABLED='true';const saved=await save(ctx,await proposal(ctx)),approved=await decide(ctx,saved.candidate.id,review());assert.equal(approved.status,200);assert.equal(approved.request.status,'received');for(const table of ['mcp_events','mcp_event_outbox','dispatch_jobs','dispatch_manual_authorizations','dispatch_resource_leases'])assert.equal(count(ctx,table),0,table);
});
