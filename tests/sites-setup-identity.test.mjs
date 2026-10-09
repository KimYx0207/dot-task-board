import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSitesPrivateEntry} from '../src/application/sites-entry.mjs';
import {createWorker} from '../worker.mjs';
const compiledFactory=new Function(readFileSync(new URL('../dist/sites/index.js',import.meta.url),'utf8').replace('export default ','const compiledDefault = ')+';return createSitesPrivateEntry;')();
const origin='https://synthetic-setup.example';
function environment(extra={}){return {DOT_BOARD_INGRESS:'sites-owner-private-v1',DOT_BOARD_AUDIENCE:origin,DOT_BOARD_IDENTITY_SETUP_ENABLED:'true',...extra};}
function request(path='/api/setup/identity',{identity='synthetic-site-user',headers={},method='GET',url}={}){return new Request(url??origin+path,{method,headers:{...(identity===null?{}:{'oai-authenticated-user-id':identity}),...headers}});}
for(const [kind,factory] of [['source',createSitesPrivateEntry],['compiled',compiledFactory]]){
 test(`${kind}: identity setup is strictly opt-in and does not open ordinary routes`,async()=>{
  const app=factory();
  for(const flag of [undefined,'false','TRUE',true]){const env=environment({DOT_BOARD_IDENTITY_SETUP_ENABLED:flag});for(const path of ['/setup','/api/setup/identity'])assert.equal((await app.fetch(request(path),env)).status,404);}
  for(const path of ['/','/api/board','/api/config','/api/dispatch/queue','/health','/mcp'])assert.equal((await app.fetch(request(path),environment())).status,503,path);
  for(const path of ['/setup','/api/setup/identity'])assert.equal((await createWorker().fetch(request(path),environment())).status,404,'generic Worker must not expose Sites setup');
 });
 test(`${kind}: authenticated setup returns only the current request identity without reading or writing storage`,async()=>{
  const env=environment({DOT_BOARD_SNAPSHOT:'PRIVATE_SNAPSHOT_NOT_RETURNED',DOT_BOARD_PROJECT_REGISTRY:'PRIVATE_REGISTRY_NOT_RETURNED',DOT_BOARD_EVENT_RELAY_SECRET:'PRIVATE_SECRET_NOT_RETURNED'});
  Object.defineProperty(env,'DB',{get(){assert.fail('setup must not access the database');}});Object.freeze(env);
  const response=await factory().fetch(request(),env),body=await response.json();
  assert.equal(response.status,200);assert.deepEqual(body,{siteOrigin:origin,siteUserId:'synthetic-site-user',identitySource:'sites_authenticated_request',ownerBindingChanged:false,ownershipVerifiedByThisEndpoint:false});
  assert.equal(Object.hasOwn(env,'DOT_BOARD_OWNER_ID'),false);assert.match(response.headers.get('cache-control'),/private.*no-store/);assert.equal(response.headers.get('access-control-allow-origin'),null);assert.equal(response.headers.get('referrer-policy'),'no-referrer');
 });
 test(`${kind}: setup rejects untrusted ingress, non-HTTPS audience and actual origin mismatches`,async()=>{
  const app=factory();
  for(const ingress of [undefined,'public','proxy','sites-owner-private-v1 '])assert.equal((await app.fetch(request(),environment({DOT_BOARD_INGRESS:ingress}))).status,503);
  for(const audience of [undefined,'http://synthetic-setup.example',origin+'/',origin+'/path','not-a-url'])assert.equal((await app.fetch(request(),environment({DOT_BOARD_AUDIENCE:audience}))).status,503);
  assert.equal((await app.fetch(request(undefined,{url:'https://wrong.example/api/setup/identity',headers:{'x-forwarded-host':'synthetic-setup.example',origin}}),environment())).status,403);
  assert.equal((await app.fetch(request(undefined,{headers:{origin:'https://wrong.example'}}),environment())).status,403);
 });
 test(`${kind}: anonymous and identity-less service access cannot obtain a user identity`,async()=>{
  const app=factory();for(const identity of [null,'',' '.repeat(2),'x'.repeat(513)]){
   const response=await app.fetch(request(undefined,{identity,headers:{authorization:'Bearer synthetic-service-placeholder','OAI-Sites-Authorization':'Bearer synthetic-service-placeholder','oai-authenticated-user-email':'synthetic@example.invalid'}}),environment());assert.equal(response.status,401);
   assert(!JSON.stringify(await response.json()).includes('synthetic-service-placeholder'));
  }
 });
 test(`${kind}: setup is GET-only and URL or body identity cannot bind an owner`,async()=>{
  const app=factory(),env=environment();for(const method of ['HEAD','POST','PUT','PATCH','DELETE','OPTIONS']){
   const response=await app.fetch(request(undefined,{method}),env);assert.equal(response.status,405);assert.equal(response.headers.get('allow'),'GET');
  }
  assert.equal((await app.fetch(request('/api/setup/identity?ownerId=other-user'),env)).status,400);
  assert.equal((await app.fetch(request('/setup?DOT_BOARD_OWNER_ID=other-user'),env)).status,400);
  assert.equal(env.DOT_BOARD_OWNER_ID,undefined);
 });
 test(`${kind}: an existing owner binding closes setup and preserves owner authorization`,async()=>{
  const app=factory(),env=environment({DOT_BOARD_OWNER_ID:'synthetic-site-user'});
  for(const path of ['/setup','/api/setup/identity']){assert.equal((await app.fetch(request(path),env)).status,409);assert.equal((await app.fetch(request(path,{identity:'other-user'}),env)).status,403);}
  assert.equal((await app.fetch(request('/api/config'),env)).status,200);
  assert.equal((await app.fetch(request('/api/config',{identity:'other-user'}),env)).status,403);
 });
 test(`${kind}: setup HTML escapes opaque identity and exposes no email, token or executable input`,async()=>{
  const identity='synthetic-<script>bad()</script>&"\'',response=await factory().fetch(request('/setup',{identity,headers:{'oai-authenticated-user-email':'private-display@example.invalid',authorization:'Bearer synthetic-secret-placeholder'}}),environment());
  assert.equal(response.status,200);const html=await response.text();assert(html.includes('synthetic-&lt;script&gt;bad()&lt;/script&gt;&amp;&quot;&#39;'));assert(!html.includes('<script>'));assert(!html.includes('private-display@example.invalid'));assert(!html.includes('synthetic-secret-placeholder'));assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);assert.match(response.headers.get('cache-control'),/no-store/);
 });
 test(`${kind}: two authenticated visitors cannot race to claim the site through a read-only lookup`,async()=>{
  const app=factory(),env=environment();const responses=await Promise.all(['synthetic-first','synthetic-second'].map(identity=>app.fetch(request(undefined,{identity}),env).then(r=>r.json())));
  assert.deepEqual(responses.map(r=>r.siteUserId),['synthetic-first','synthetic-second']);assert(responses.every(r=>r.ownerBindingChanged===false&&r.ownershipVerifiedByThisEndpoint===false));assert.equal(env.DOT_BOARD_OWNER_ID,undefined);assert.equal((await app.fetch(request('/api/board'),env)).status,503);
 });
}
