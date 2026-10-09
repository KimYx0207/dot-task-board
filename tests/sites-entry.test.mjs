import vm from 'node:vm';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';import {DatabaseSync} from 'node:sqlite';
import {createSitesPrivateEntry} from '../src/application/sites-entry.mjs';import {sqliteIntakeFixture} from './sqlite-intake-fixture.mjs';import {createD1DispatchQueue} from '../src/adapters/d1-dispatch-queue.mjs';
import {presentationScope,projectPresentationKind,presentationBoard} from '../public/project-clarity.js';
const sample=JSON.parse(readFileSync(new URL('../fixtures/synthetic.json',import.meta.url),'utf8'));
const env={DOT_BOARD_INGRESS:'sites-owner-private-v1',DOT_BOARD_OWNER_ID:'synthetic-owner',DOT_BOARD_AUDIENCE:'https://example.com',DOT_BOARD_SNAPSHOT:JSON.stringify(sample),DOT_BOARD_PROJECT_REGISTRY:JSON.stringify([{id:'synthetic-project',name:sample.tasks[0].project,aliases:[],executionState:'paused'}]),DOT_BOARD_INTAKE_MCP_ENABLED:'true'};
const request=(path,owner='synthetic-owner',origin='https://example.com')=>new Request(origin+path,{headers:owner?{'oai-authenticated-user-id':owner}:{}});
test('Sites-only entry fails closed on missing identity, different site, different owner and standalone configuration',async()=>{const entry=createSitesPrivateEntry();for(const path of ['/','/app.js','/api/board','/api/dispatch/queue','/mcp']){assert.equal((await entry.fetch(request(path,null),env)).status,401);assert.equal((await entry.fetch(request(path,'other'),env)).status,403);assert.equal((await entry.fetch(request(path,'synthetic-owner','https://other.example.com'),env)).status,403);assert.equal((await entry.fetch(request(path),{...env,DOT_BOARD_INGRESS:'public-worker'})).status,503);}});
test('Sites owner reads real source projection; callback delivery remains disabled regardless of env toggle',async t=>{const db=sqliteIntakeFixture();t.after(()=>db.close());const entry=createSitesPrivateEntry(),e={...env,DB:db.binding,DOT_BOARD_EVENTS_ENABLED:'true',DOT_BOARD_QUEUE_ENABLED:'true'};const response=await entry.fetch(request('/api/board'),e);assert.equal(response.status,200);const b=await response.json();assert.equal(b.tasks.length,sample.tasks.length);assert.equal(b.queueUpdates,undefined);assert.deepEqual(await entry.scheduled(null,e),{disabled:true,reason:'events_not_verified_on_sites'});const r=await entry.fetch(new Request('https://example.com/mcp',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':'synthetic-owner'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'server/discover'})}),e);assert(!((await r.json()).result.capabilities.events));});
test('generated append-only Sites migration preserves ten prior execution-history records',()=>{
 const db=new DatabaseSync(':memory:');try{const files=readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort();for(const f of files.slice(0,3))db.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));
 for(let i=0;i<10;i++){
 db.prepare("INSERT INTO intake_requests(id,owner_id,project_id,client_submission_id,payload_digest,body,viewed_snapshot_revision,viewed_snapshot_imported_at,context_summary,status,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run('r'+i,'owner','validation','submission'+i,'digest','Synthetic historical test','sha256:synthetic','2026-10-07T00:00:00Z','','completed','2026-10-07T00:00:00Z','2026-10-07T00:00:00Z',1);
 db.prepare("INSERT INTO dispatch_jobs(id,owner_id,project_id,request_id,request_version,state,environment_type,root_job_id,thread_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run('j'+i,'owner','validation','r'+i,1,'completed','native_cloud','j'+i,'original-'+i,'2026-10-07T00:00:00Z','2026-10-07T00:00:00Z');}
 const before=db.prepare('SELECT id,state,thread_id FROM dispatch_jobs ORDER BY id').all();for(const f of files.slice(3))db.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));assert.deepEqual(db.prepare('SELECT id,state,thread_id FROM dispatch_jobs ORDER BY id').all(),before);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dispatch_jobs').get().n,10);assert(db.prepare('PRAGMA table_info(dispatch_jobs)').all().some(x=>x.name==='resources_json'));assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{db.close();}
});

test('real-project overview does not inherit historical queue counts or legacy project cards',()=>{const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');assert(app.includes('function observationBoard(){return currentBoard();}'));assert(!app.includes('function observationBoard(){return withoutManagedQueueTasks'));});

test('real task counts and the persistent automatic-wakeup notice remain explicit after rendering',()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),overview=readFileSync(new URL('../public/project-overview.js',import.meta.url),'utf8');
 const element=()=>({textContent:'',dataset:{},setAttribute(){},append(){},replaceChildren(){}}),nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},ui={project:'',recordScope:'business'};
 const board={projects:['Synthetic project'],tasks:[{id:'synthetic-task',project:'Synthetic project',state:'partial'}]};
 const sandbox=vm.createContext({$:node,ui,projectNames:()=>['Synthetic project'],currentBoard:()=>board,visibleBoard:()=>presentationBoard(board,false),presentationScope,projectPresentationKind,list:value=>Array.isArray(value)?value:[],button:element,el:element,setProject(){}});
 const rendering=app.slice(app.indexOf('function renderProjects(){'),app.indexOf('function renderFilters(){'));
 for(const project of ['', 'Synthetic project', 'Removed project']){
  ui.project=project;node('project-context-note').textContent='stale';vm.runInContext(rendering+'\nrenderProjects();',sandbox);
  assert.match(node('project-context-note').textContent,/本页队列不会自行执行/);
  assert.match(node('project-context-note').textContent,/另行配置并授权的 dot 检查沿原任务推进/);
  assert.match(node('project-context-note').textContent,/本地自动派发仍待验收/);
  assert.match(node('project-context-note').textContent,/Agent 当前活动需新鲜执行回执确认/);
 }
 assert(overview.includes('项已有任务'));
});

test('project navigation hover labels describe observed tasks rather than dispatch jobs',()=>{const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');assert(app.includes("count+' 项已有任务'"));assert(!app.includes("count+' 项队列记录'"));});
