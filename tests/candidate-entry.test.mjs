import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createCandidateEntry} from '../src/application/candidate-entry.mjs';
import {createPlatformPublicTransport} from '../src/adapters/platform-transport.mjs';
const env={DOT_BOARD_CANDIDATE_ENABLED:'true',DOT_BOARD_OWNER_ID:'owner',DOT_BOARD_AUDIENCE:'synthetic-board'};
const identity={verified:true,ownerId:'owner',audience:'synthetic-board',expiresAt:'2099-01-01T00:00:00Z'};
const grant={ownerId:'owner',audience:'synthetic-board',active:true,boardAccess:true,projectIds:['p']};
const req=path=>new Request('https://example.com'+path,{headers:{'oai-authenticated-user-id':'owner'}});
const make=(id=identity,g=grant)=>createCandidateEntry({authenticate:async()=>id,grantsFor:async()=>g,assets:{'/index.html':'synthetic-private-board'}});
const paths=['/','/index.html','/app.js','/health','/api/board','/api/dispatch/queue','/api/intake/capabilities','/api/projects/p/requests','/api/requests/r','/mcp'];
test('all routes bind verified identity and grant to exact site owner and audience before storage',async()=>{
 for(const path of paths){
  assert.equal((await make({...identity,ownerId:'other'}).fetch(req(path),env)).status,403);
  assert.equal((await make({...identity,audience:'other'}).fetch(req(path),env)).status,403);
  for(const g of [null,{...grant,active:false},{...grant,boardAccess:false},{...grant,ownerId:'other'},{...grant,audience:'other'},{ownerId:'owner',active:true,projectIds:['p']}])assert.equal((await make(identity,g).fetch(req(path),env)).status,403);
 }
 const response=await make().fetch(req('/'),env);assert.equal(response.status,200);assert.equal(await response.text(),'synthetic-private-board');
});
test('invalid, expired, header-only and unconfigured identity remain closed',async()=>{
 for(const id of [null,{ownerId:'owner'},{...identity,verified:false},{...identity,expiresAt:'invalid'},{...identity,expiresAt:'2000-01-01T00:00:00Z'},{...identity,ownerId:' owner'}])assert.equal((await make(id).fetch(req('/api/board'),env)).status,401);
 assert.equal((await createCandidateEntry().fetch(req('/api/board'),env)).status,401);
 assert.equal((await make().fetch(req('/api/board'),{DOT_BOARD_CANDIDATE_ENABLED:'true'})).status,503);
 assert.equal((await make().fetch(req('/api/board'),{})).status,503);
 assert.deepEqual(await make().scheduled(null,{}),{disabled:true});
});
test('revocation and adapter exceptions fail closed without leaking details',async()=>{
 let active=true;const entry=createCandidateEntry({authenticate:async()=>identity,grantsFor:async()=>({...grant,active}),assets:{'/index.html':'private'}});
 assert.equal((await entry.fetch(req('/'),env)).status,200);active=false;assert.equal((await entry.fetch(req('/'),env)).status,403);
 for(const key of ['authenticate','grantsFor']){const entry=createCandidateEntry({authenticate:async()=>identity,grantsFor:async()=>grant,[key]:async()=>{throw Error('private-adapter-failure');}});const response=await entry.fetch(req('/'),env);assert.equal(response.status,503);assert(!await response.text().then(x=>x.includes('private-adapter-failure')));}
});
test('transport uses only global fetch, original HTTPS hostname, filtered headers and redirect:error',async t=>{
 const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});let sent;globalThis.fetch=async(...args)=>{sent=args;return new Response(null,{status:204});};
 const transport=createPlatformPublicTransport({fetchPublic:()=>{throw Error('must not use injected binding');}});
 const q={url:'https://receiver.example.com/callback',hostname:'receiver.example.com',method:'POST',redirect:'error',headers:{host:'internal.example.com',authorization:'discard','webhook-id':'synthetic'},body:'{}'};
 await transport.sendPublicHttps({...q,cf:{resolveOverride:'internal.example.com'}});assert.equal(sent[0],q.url);assert.equal(sent[1].redirect,'error');assert.equal(sent[1].headers.get('host'),null);assert.equal(sent[1].headers.get('authorization'),null);assert(!('cf' in sent[1]));
 for(const x of [{url:'http://receiver.example.com'},{url:'https://127.0.0.1'},{url:'https://[::1]'},{url:'https://receiver.local'},{url:'https://receiver.example.com:8443'},{url:'https://user:password@receiver.example.com'},{hostname:'other.example.com'},{address:'8.8.8.8'},{redirect:'follow'},{method:'GET'}])await assert.rejects(transport.sendPublicHttps({...q,...x}));
});
test('candidate bundle default-denies; deployment config has no resources, triggers or public routes',async()=>{
 const config=JSON.parse(await readFile(new URL('../config/wrangler.candidate.jsonc',import.meta.url),'utf8'));
 assert.deepEqual(config.compatibility_flags,['global_fetch_strictly_public']);for(const k of ['services','vpc_services','vpc_networks','containers','d1_databases','triggers','routes','account_id'])assert.equal(config[k],undefined);
 assert(Object.values(config.vars).every(v=>v==='false'));assert.equal(config.workers_dev,false);assert.equal(config.preview_urls,false);
 const {default:entry}=await import('../dist/candidate/index.js');assert.equal((await entry.fetch(req('/'),{})).status,503);assert.equal((await entry.fetch(req('/'),env)).status,401);
});
