import {get as httpGet} from 'node:http';
import test from 'node:test';import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,symlink,mkdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {createLocalBoardServer,requireExternalDataPath} from '../src/adapters/node-local.mjs';import {openLocalStore} from '../src/adapters/sqlite-local.mjs';
const snapshot=JSON.parse(await readFile(new URL('../examples/synthetic-snapshot.json',import.meta.url)));const registry=[{id:'demo-project',name:snapshot.tasks[0].project,aliases:[]}];
async function listen(dbPath){const server=await createLocalBoardServer({snapshot,registry,dbPath,queue:true,capacity:1});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {base:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};}
function api(base){let n=0;return {get:async path=>{const r=await fetch(base+path);return [r.status,await r.json()];},post:async(path,body,headers={})=>{const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',origin:base,...headers},body:JSON.stringify(body)});return [r.status,await r.json()];},tool:async(name,args={})=>{const r=await fetch(base+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++n,method:'tools/call',params:{name,arguments:args}})});const b=await r.json();assert(!b.error,JSON.stringify(b));assert(!b.result.isError,JSON.stringify(b));return b.result.structuredContent;}};}
const submission=board=>({clientSubmissionId:'synthetic-browser-submission-001',body:'Synthetic local request',contextTaskId:null,viewedSnapshotRevision:board.snapshotRevision,viewedSnapshotImportedAt:board.importedAt,contextSummary:'Synthetic task context'});

test('real loopback HTTP persists an idempotent request across stop/reopen and exposes a usable MCP receipt flow',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dot-local-test-')),dbPath=join(dir,'requests.sqlite');let app=await listen(dbPath);try{
  let a=api(app.base);const [healthStatus,health]=await a.get('/health');assert.equal(healthStatus,200);assert.equal(health.nativeExecutionConnected,false);assert.equal(health.eventsEnabled,false);
  const [,board]=await a.get('/api/board');let [status,result]=await a.post('/api/projects/demo-project/requests',submission(board),{'oai-authenticated-user-id':'forged-owner'});assert.equal(status,201);const id=result.request.id;
  [status,result]=await a.post('/api/projects/demo-project/requests',submission(board));assert.equal(status,200);assert.equal(result.request.id,id);
  await app.close();app=await listen(dbPath);a=api(app.base);const request=await a.tool('get_project_request',{requestId:id});assert.equal(request.request.status,'received');
  const read=await a.tool('acknowledge_project_request',{requestId:id,eventId:'synthetic-read',expectedVersion:request.request.version});assert.equal(read.request.status,'read');
  const accepted=await a.tool('record_project_request_event',{requestId:id,eventId:'synthetic-accept',expectedVersion:read.request.version,status:'accepted',summary:'Actual synthetic test accepted'});
  const queued=await a.tool('enqueue_request_dispatch',{requestId:id,eventId:'synthetic-enqueue',expectedRequestVersion:accepted.request.version,environment:{type:'native_cloud'},priority:2});assert.equal(queued.job.state,'queued');
  const first=await a.tool('claim_next_dispatch',{eventId:'synthetic-claim'}),duplicate=await a.tool('claim_next_dispatch',{eventId:'synthetic-claim'});assert.equal(duplicate.job.id,first.job.id);assert.equal(duplicate.replayed,true);
  const [,after]=await a.get('/api/board');assert(after.tasks.some(t=>t.id==='dispatch:'+queued.job.id));assert(!after.agents.some(x=>x.id.startsWith('dispatch-agent:')));assert.equal(after.importedAt,board.importedAt);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
test('local mode rejects hostile Host, cross-site requests and spoofed browser origin',async()=>{
 const app=await listen(':memory:');try{
  const hostStatus=await new Promise((resolve,reject)=>httpGet(app.base+'/api/board',{headers:{Host:'evil.example.com'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject));assert.equal(hostStatus,403);
  for(const headers of [{'sec-fetch-site':'cross-site'},{origin:'https://evil.example.com'}])assert.equal((await fetch(app.base+'/api/board',{headers})).status,403,JSON.stringify(headers));
  const response=await fetch(app.base+'/mcp',{method:'POST',headers:{origin:'https://evil.example.com','content-type':'application/json'},body:'{}'});assert.equal(response.status,403);
 }finally{await app.close();}
});
test('source aliases cannot conceal data paths inside the checkout',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dot-path-test-'));try{await symlink(new URL('../',import.meta.url).pathname,join(dir,'source-alias'),'dir');assert.throws(()=>requireExternalDataPath(join(dir,'source-alias','runtime','data.sqlite')),/outside/);assert.equal(requireExternalDataPath(join(dir,'safe','data.sqlite')),join(dir,'safe','data.sqlite'));}finally{await rm(dir,{recursive:true,force:true});}
});
test('newer or edited migration ledger blocks incompatible rollback before user tables change',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dot-ledger-test-')),path=join(dir,'data.sqlite');try{
  let store=await openLocalStore(path);store.close();let db=new DatabaseSync(path);db.prepare('INSERT INTO local_migrations VALUES (?,?,?)').run('9999_future.sql','synthetic','2026-01-01T00:00:00Z');db.close();await assert.rejects(openLocalStore(path),/newer/);
  db=new DatabaseSync(path);assert(db.prepare("SELECT name FROM sqlite_master WHERE name='intake_requests'").get());db.prepare('DELETE FROM local_migrations WHERE name=?').run('9999_future.sql');db.prepare('UPDATE local_migrations SET sha256=? WHERE name=?').run('changed','0000_project_intake.sql');db.close();await assert.rejects(openLocalStore(path),/modified/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('local entry serves every referenced static asset and truthfully gates unsupported manual status',async()=>{
 const app=await listen(':memory:');try{
  const html=await(await fetch(app.base+'/')).text(),refs=new Set([...html.matchAll(/(?:src|href)="(\/[a-z][^"?]*)"/g)].map(m=>m[1]));refs.delete('/');
  for(const script of ['app.js','project-clarity.js']){const body=await(await fetch(app.base+'/'+script)).text();for(const match of body.matchAll(/from '\.\/([^']+)'/g))refs.add('/'+match[1]);}
  for(const path of refs){const response=await fetch(app.base+path);assert.equal(response.status,200,path);assert((await response.arrayBuffer()).byteLength>0,path);if(path.endsWith('.png'))assert.equal(response.headers.get('content-type'),'image/png');}
  for(const name of ['project-clarity.js','task-display.js','project-clarity.css','board-brand.css','brand-links.js','board-team.png'])assert(refs.has('/'+name),name);
  assert.equal((await(await fetch(app.base+'/api/config')).json()).manualStatusEnabled,false);
  const response=await fetch(app.base+'/api/tasks/'+encodeURIComponent(snapshot.tasks[0].id)+'/status',{method:'POST',headers:{origin:app.base,'content-type':'application/json'},body:JSON.stringify({expectedVersion:0,state:'completed',eventId:'synthetic-disabled-status'})});assert.equal(response.status,503);assert.equal((await response.json()).error,'manual_status_unavailable');
 }finally{await app.close();}
});
