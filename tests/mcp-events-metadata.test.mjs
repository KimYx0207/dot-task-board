import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSitesPrivateEntry} from '../src/application/sites-entry.mjs';
import {sqliteIntakeFixture} from './sqlite-intake-fixture.mjs';
import {handleIntakeMcp} from '../src/presentation/intake-mcp.mjs';
import {createMcpEventsService} from '../src/application/mcp-events-service.mjs';
import {createSitesOpenAIEventTransport} from '../src/adapters/sites-openai-event-transport.mjs';
import {McpEventsError,EVENT_LIMITS} from '../src/domain/mcp-events.mjs';

// Synthetic in-memory stores/transports only; no native subscription or HTTP call.
const owner='synthetic-owner',secret='whsec_'+btoa('synthetic-metadata-signing-key-000');
const callback='https://RECEIVER.example.org:443/private-path?token=synthetic-private-query';
const meta=()=>({'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{},'io.modelcontextprotocol/clientInfo':{name:'synthetic-client',version:'1'}});
const params=(unsubscribe=false)=>({name:'project_request.created',arguments:{projectId:'synthetic-project'},delivery:{mode:'webhook',url:callback,...(!unsubscribe?{secret}:{})},_meta:meta()});
const source={createSitesPrivateEntry,handleIntakeMcp,createMcpEventsService,createSitesOpenAIEventTransport,McpEventsError};
const compiled=new Function(readFileSync(new URL('../dist/sites/index.js',import.meta.url),'utf8').replace('export default ','const compiledDefault = ')+'\nreturn {createSitesPrivateEntry,handleIntakeMcp,createMcpEventsService,createSitesOpenAIEventTransport,McpEventsError};')();
function setup(t,api,{disabled=true,allowed=true}={}){
 const records=[],revocations=[],access=[],logs=[],storageCalls=[];
 t.mock.method(console,'warn',(...args)=>logs.push(args));
 t.mock.method(globalThis,'fetch',()=>{throw Error('Network prohibited in metadata test');});
 const store={getVerification:async(...args)=>{storageCalls.push(args);return '2026-10-11T20:05:00.000Z';},saveSubscription:async value=>records.push(value),revoke:async(...args)=>revocations.push(args)};
 const transport=disabled?api.createSitesOpenAIEventTransport({DOT_BOARD_EVENTS_ENABLED:'false'}):{kind:'platform-managed-public-https-v1',validateCallback:()=>{},sendPublicHttps:()=>{throw Error('Cached synthetic verification must not send');}};
 const events=api.createMcpEventsService({store,transport,clock:()=>Date.parse('2026-10-11T20:00:00.000Z'),authorize:async details=>{access.push(details);return allowed;}});
 const rpc=async(method,p=params(method==='events/unsubscribe'),{user=owner,protocol='2026-07-28',origin='https://board.example.com',service=events,mcpEnabled=true,eventsEnabled=true}={})=>{
  const response=await api.handleIntakeMcp(new Request('https://board.example.com/mcp',{method:'POST',headers:{'content-type':'application/json',...(protocol?{'mcp-protocol-version':protocol}:{}),...(user?{'oai-authenticated-user-id':user}:{}),origin},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:p})}),{events:service,mcpEnabled,eventsEnabled});
  return {status:response.status,...await response.json()};
 };
 return {rpc,records,revocations,access,logs,storageCalls};
}
for(const [label,api] of [['source',source],['compiledSites',compiled]]){
 test(`${label}: standard request metadata reaches disabled gate and owner-scoped unsubscribe`,async t=>{
  const c=setup(t,api);
  const rejected=await c.rpc('events/subscribe');assert.equal(rejected.status,503);assert.equal(rejected.error.data.reason,'direct_events_disabled');
  assert.equal(rejected.error.data.offeredCallbackOrigin,'https://receiver.example.org');
  assert.deepEqual((await c.rpc('events/unsubscribe')).result,{});assert.equal(c.revocations.length,1);assert.equal(c.revocations[0][0],owner);
  assert.equal(c.records.length,0);assert.equal(c.storageCalls.length,0);
  assert.equal(c.logs.length,1);const log=JSON.stringify(c.logs);assert(log.includes('direct_events_disabled'));assert(log.includes('https://receiver.example.org'));
  for(const sensitive of [owner,secret,'private-path','synthetic-private-query','synthetic-client'])assert(!log.includes(sensitive));
 });
 test(`${label}: metadata never changes identity, authorization, persistence or TTL`,async t=>{
  const c=setup(t,api,{disabled:false});const first=params();delete first._meta;
  const baseline=await c.rpc('events/subscribe',first);assert(baseline.result.id);
  const p=params();p.ttlMs=Number.MAX_SAFE_INTEGER;p._meta['org.example/context']={ownerId:'synthetic-forged-owner',secret,allow:true};p._meta.progressToken=123;p._meta['io.modelcontextprotocol/clientCapabilities']={extensions:{'org.example/feature':{}},'org.example/custom':{}};
  const withMeta=await c.rpc('events/subscribe',p);assert.equal(withMeta.result.id,baseline.result.id);assert.equal(Date.parse(withMeta.result.refreshBefore)-Date.parse('2026-10-11T20:00:00.000Z'),EVENT_LIMITS.maxTtlMs);
  assert.equal(c.records.length,2);for(const row of c.records){assert(!Object.hasOwn(row,'_meta'));assert.equal(row.ownerId,owner);assert(!JSON.stringify(row).includes('synthetic-forged-owner'));}
  assert(c.access.every(a=>a.ownerId===owner&&!JSON.stringify(a).includes('_meta')));
  await c.rpc('events/unsubscribe');assert.equal(c.revocations[0][1],baseline.result.id);
 });
 test(`${label}: unknown business parameters remain invalid for both methods`,async t=>{
  const c=setup(t,api);
  for(const method of ['events/subscribe','events/unsubscribe'])for(const mutation of [p=>({...p,unknown:secret}),p=>({...p,arguments:{...p.arguments,ownerId:owner}}),p=>({...p,delivery:{...p.delivery,headers:{authorization:secret}}})]){
   const r=await c.rpc(method,mutation(params(method==='events/unsubscribe')));assert.equal(r.status,400);assert.equal(r.error.message,'invalid_event_parameters');
  }
  assert.equal(c.access.length,0);assert.equal(c.revocations.length,0);assert.equal(c.storageCalls.length,0);
 });
 test(`${label}: malformed metadata shells and known fields reject before service access`,async t=>{
  const c=setup(t,api);
  const malformed=[null,[],true,'bad',{}, {...meta(),'io.modelcontextprotocol/protocolVersion':42},{...meta(),'io.modelcontextprotocol/clientCapabilities':null},{...meta(),'io.modelcontextprotocol/clientCapabilities':[]},{...meta(),'io.modelcontextprotocol/clientInfo':[]},{...meta(),'io.modelcontextprotocol/clientInfo':{name:'client'}},{...meta(),progressToken:{}},{...meta(),'io.modelcontextprotocol/logLevel':'private-log-level'},{...meta(),'invalid/key/shape':1},{...meta(),'io.modelcontextprotocol/clientInfo':{name:'client',version:'1',icons:[{src:42}]}},{...meta(),'io.modelcontextprotocol/clientCapabilities':{sampling:{tools:[]}}},{...meta(),'io.modelcontextprotocol/clientCapabilities':{extensions:{'invalid':{}}}},{...meta(),'io.modelcontextprotocol/clientCapabilities':{elicitation:{form:null}}}];
  for(const method of ['events/subscribe','events/unsubscribe'])for(const value of malformed){const p=params(method==='events/unsubscribe');p._meta=value;const r=await c.rpc(method,p);assert.equal(r.status,400);assert.equal(r.error.code,-32602);assert.equal(r.error.message,'invalid_event_metadata');}
  assert.equal(c.access.length,0);assert.equal(c.records.length,0);assert.equal(c.revocations.length,0);
 });
 test(`${label}: metadata version mismatch and unsupported version fail closed`,async t=>{
  const c=setup(t,api);let p=params();
  let r=await c.rpc('events/subscribe',p,{protocol:'2025-06-18'});assert.equal(r.status,400);assert.equal(r.error.message,'event_protocol_header_mismatch');assert.equal(r.error.code,-32020);
  p._meta['io.modelcontextprotocol/protocolVersion']='2099-01-01';r=await c.rpc('events/subscribe',p,{protocol:null});assert.equal(r.status,400);assert.equal(r.error.message,'unsupported_event_protocol_version');assert.equal(r.error.code,-32022);assert.equal(c.access.length,0);
 });
 test(`${label}: metadata cannot override authentication, origin, disabled bridge or denied access`,async t=>{
  const c=setup(t,api,{allowed:false});const p=params();p._meta['org.example/authorization']={ownerId:owner,enabled:true,allow:true};
  assert.equal((await c.rpc('events/subscribe',p,{user:null})).status,401);
  assert.equal((await c.rpc('events/subscribe',p,{origin:'https://untrusted.example.org'})).status,403);
  assert.equal((await c.rpc('events/subscribe',p,{mcpEnabled:false})).status,403);
  assert.equal((await c.rpc('events/subscribe',p)).error.message,'event_access_denied');
  assert.equal(c.records.length,0);assert.equal(c.storageCalls.length,0);assert.equal(c.revocations.length,0);
 });
 test(`${label}: failure response and log whitelist error fields and recompute callback origin`,async t=>{
  const c=setup(t,api);const error=new api.McpEventsError('sites_event_transport_not_ready',503,-32014);
  error.message=secret;error.stack=secret;error.data={reason:'direct_events_disabled',offeredCallbackOrigin:'https://evil.example.org/private?token='+secret,secret,body:'synthetic-private-body',signature:'synthetic-private-signature',toJSON(){return {secret};}};
  const r=await c.rpc('events/subscribe',params(),{service:{subscribe:async()=>{throw error;}}});
  assert.deepEqual(r.error,{code:-32014,message:'sites_event_transport_not_ready',data:{reason:'direct_events_disabled',offeredCallbackOrigin:'https://receiver.example.org'}});
  assert.equal(c.logs.length,1);const output=JSON.stringify([r,c.logs]);for(const value of [secret,owner,'private-path','synthetic-private-query','synthetic-private-body','synthetic-private-signature','evil.example.org'])assert(!output.includes(value));
 });
 test(`${label}: unrecognized exceptions and malicious error reasons never escape`,async t=>{
  const c=setup(t,api);
  for(const error of [new Error(secret),new api.McpEventsError(secret,499,-32015,secret),Object.assign(new api.McpEventsError('sites_event_transport_not_ready',503,-32014),{data:{reason:secret,offeredCallbackOrigin:callback}})]){
   const r=await c.rpc('events/subscribe',params(),{service:{subscribe:async()=>{throw error;}}});assert([503].includes(r.status));assert(!JSON.stringify([r,c.logs]).includes(secret));assert(!JSON.stringify([r,c.logs]).includes('private-path'));assert(!JSON.stringify([r,c.logs]).includes('synthetic-private-query'));
  }
  assert.equal(c.logs.length,3);
 });
 test(`${label}: changing exception getters are read once and cannot bypass category allowlists`,async t=>{
  const c=setup(t,api);const error=new api.McpEventsError('sites_event_transport_not_ready',503,-32014);let codeReads=0,reasonReads=0;
  Object.defineProperty(error,'code',{get:()=>++codeReads===1?'sites_event_transport_not_ready':secret});error.data={get reason(){return ++reasonReads===1?'direct_events_disabled':secret;}};
  const r=await c.rpc('events/subscribe',params(),{service:{subscribe:async()=>{throw error;}}});assert.equal(r.error.message,'sites_event_transport_not_ready');assert.equal(r.error.data.reason,'direct_events_disabled');assert.equal(codeReads,1);assert.equal(reasonReads,1);assert(!JSON.stringify([r,c.logs]).includes(secret));
 });
 test(`${label}: unsafe callback forms never enter failure diagnostics`,async t=>{
  const c=setup(t,api);const unsafe=['https://user:synthetic-private-password@receiver.example.org/private-path','https://receiver.example.org/private-path#synthetic-private-fragment','https://receiver.example.org:444/private-path','http://receiver.example.org/private-path','https://127.0.0.1/private-path','https://receiver.example.org\\private-path','https://receiver.example.org\n/private-path','https://receiver.example.org%2fprivate-path'];
  for(const url of unsafe){const p=params();p.delivery.url=url;const r=await c.rpc('events/subscribe',p,{service:{subscribe:async()=>{throw new api.McpEventsError('invalid_callback_url');}}});assert.equal(r.error.data?.offeredCallbackOrigin,undefined);}
  assert.equal(c.logs.length,unsafe.length);const log=JSON.stringify(c.logs);for(const value of ['receiver.example.org','private-path','synthetic-private-password','synthetic-private-fragment',secret])assert(!log.includes(value));
 });
 test(`${label}: actual Sites entry retains owner, project and disabled-policy gates with standard metadata`,async t=>{
  const c=setup(t,api);const fixture=sqliteIntakeFixture();t.after(()=>fixture.close());const sample=JSON.parse(readFileSync(new URL('../fixtures/synthetic.json',import.meta.url),'utf8'));
  const env={DB:fixture.binding,DOT_BOARD_INGRESS:'sites-owner-private-v1',DOT_BOARD_OWNER_ID:owner,DOT_BOARD_AUDIENCE:'https://board.example.com',DOT_BOARD_EVENTS_ENABLED:'false',DOT_BOARD_SNAPSHOT:JSON.stringify(sample),DOT_BOARD_PROJECT_REGISTRY:JSON.stringify([{id:'synthetic-project',name:sample.tasks[0].project,aliases:[]}]),DOT_BOARD_INTAKE_ENABLED:'true',DOT_BOARD_INTAKE_MCP_ENABLED:'true'};
  const entry=api.createSitesPrivateEntry();const call=async(method,p=params(method==='events/unsubscribe'),user=owner)=>{const response=await entry.fetch(new Request('https://board.example.com/mcp',{method:'POST',headers:{'content-type':'application/json','mcp-protocol-version':'2026-07-28','oai-authenticated-user-id':user},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:p})}),env);return {status:response.status,...await response.json()};};
  assert.equal((await call('events/subscribe',params(),'synthetic-other-owner')).status,403);assert.equal((await call('events/subscribe')).error.data.reason,'direct_events_disabled');
  env.DOT_BOARD_EVENTS_ENABLED='true';assert.equal((await call('events/subscribe')).error.data.reason,'callback_policy_missing');env.DOT_BOARD_EVENTS_ENABLED='false';
  env.DOT_BOARD_PROJECT_REGISTRY=JSON.stringify([{id:'synthetic-project',name:sample.tasks[0].project,executionState:'stopped',acceptNewRequests:false}]);assert.equal((await call('events/subscribe')).error.message,'event_access_denied');assert.deepEqual((await call('events/unsubscribe')).result,{});
  for(const table of ['mcp_event_subscriptions','mcp_events','mcp_event_outbox'])assert.equal(fixture.db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0);assert(c.logs.length>=3);
 });
 test(`${label}: logging failure cannot change the safe rejection response`,async t=>{
  const c=setup(t,api);t.mock.method(console,'warn',()=>{throw Error(secret);});const r=await c.rpc('events/subscribe');assert.equal(r.status,503);assert.equal(r.error.data.reason,'direct_events_disabled');
 });
}
