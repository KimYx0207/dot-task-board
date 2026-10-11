import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSitesPrivateEntry,sitesEventAuthorized,sitesProjectEventScopeFor} from '../src/application/sites-entry.mjs';
import {createSitesOpenAIEventTransport} from '../src/adapters/sites-openai-event-transport.mjs';
import {createD1McpEventsStore} from '../src/adapters/d1-mcp-events.mjs';
import {createMcpEventsService} from '../src/application/mcp-events-service.mjs';
import {createD1DispatchQueue} from '../src/adapters/d1-dispatch-queue.mjs';
import {createDispatchService} from '../src/application/dispatch-service.mjs';
import {readEnvironmentProjectRegistry} from '../src/adapters/project-registry.mjs';
import {PROJECT_REQUEST_CREATED,verifyStandardWebhook} from '../src/domain/mcp-events.mjs';
import {sqliteIntakeFixture} from './sqlite-intake-fixture.mjs';

// Synthetic identities and intercepted callbacks only; no deployment, native
// subscription, production request or actual executor is used by these tests.
const owner='synthetic-notification-owner',audience='https://notification.example.com',projectId='synthetic-deferred-project';
const callback='https://receiver.example.org/synthetic-notification',secret='whsec_'+btoa('synthetic-notification-signing-key');
const sample=JSON.parse(readFileSync(new URL('../fixtures/synthetic.json',import.meta.url),'utf8'));
const project={id:projectId,name:sample.tasks[0].project,aliases:[],executionState:'deferred'};
const key='DOT_BOARD_REQUEST_NOTIFICATION_PROJECT_IDS',allowed=JSON.stringify([projectId]);
const policy={schema:'sites-openai-event-policy/1',deploymentAudience:audience,runtime:{kind:'cloudflare-workers-global-fetch',evidenceRef:'synthetic-runtime-evidence',routing:{kind:'strict-public',evidenceScope:'complete-outbound-chain',evidenceRef:'synthetic-full-route-evidence'}},callbackOrigins:[{origin:'https://receiver.example.org',provider:'openai',nativeSubscriptionEvidenceRef:'synthetic-native-offer',providerOwnershipEvidenceRef:'synthetic-provider-evidence'}]};
const baseEnv=()=>({DOT_BOARD_INGRESS:'sites-owner-private-v1',DOT_BOARD_OWNER_ID:owner,DOT_BOARD_AUDIENCE:audience,DOT_BOARD_INTAKE_MCP_ENABLED:'true',DOT_BOARD_INTAKE_ENABLED:'true',DOT_BOARD_INTAKE_CONNECTION_VERIFIED:'true',DOT_BOARD_EVENTS_ENABLED:'true',DOT_BOARD_QUEUE_ENABLED:'true',DOT_BOARD_PROJECT_REGISTRY:JSON.stringify([project]),DOT_BOARD_SNAPSHOT:JSON.stringify(sample),DOT_BOARD_SITES_EVENT_POLICY:JSON.stringify(policy)});
const params=()=>({name:PROJECT_REQUEST_CREATED,arguments:{projectId},delivery:{mode:'webhook',url:callback,secret}});
const details=(action='subscribe',extra={})=>({ownerId:owner,name:PROJECT_REQUEST_CREATED,action,arguments:{projectId},...extra});
const source={createSitesPrivateEntry,sitesEventAuthorized,sitesProjectEventScopeFor,createSitesOpenAIEventTransport,createD1McpEventsStore,createMcpEventsService,createD1DispatchQueue,createDispatchService,readEnvironmentProjectRegistry};
const compiled=new Function(readFileSync(new URL('../dist/sites/index.js',import.meta.url),'utf8').replace('export default ','const compiledDefault = ')+'\nreturn {'+Object.keys(source).join(',')+'};')();
const invalid=[null,false,42,[],{},'{','null','false','42','{}',JSON.stringify({projectIds:[projectId]}),JSON.stringify([projectId,{extra:true}]),JSON.stringify([projectId,null]),JSON.stringify([projectId,42]),JSON.stringify([projectId,projectId]),JSON.stringify([projectId,'invalid id']),JSON.stringify([projectId,'*']),JSON.stringify([projectId,'x'.repeat(101)]),JSON.stringify(Array.from({length:201},(_,i)=>'synthetic-'+i)),JSON.stringify([projectId])+' '.repeat(32768)];
function setup(t,api){
 const fixture=sqliteIntakeFixture();t.after(()=>fixture.close());
 const sql=[],calls=[],background=[],env={...baseEnv(),[key]:allowed,DB:{...fixture.binding,prepare:query=>{sql.push(query);return fixture.binding.prepare(query);}}};
 const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});
 globalThis.fetch=async(url,options)=>{assert.equal(url,callback);calls.push({url,...options});assert(await verifyStandardWebhook({secret,id:options.headers.get('webhook-id'),timestamp:options.headers.get('webhook-timestamp'),signature:options.headers.get('webhook-signature'),body:options.body}));const body=JSON.parse(options.body);return body.type==='verification'?Response.json({challenge:body.challenge}):new Response(null,{status:204});};
 const entry=api.createSitesPrivateEntry();
 const call=async(path,{body,user=owner,origin=audience,ctx={waitUntil:p=>background.push(p)}}={})=>{const response=await entry.fetch(new Request(origin+path,{method:body?'POST':'GET',headers:{...(user?{'oai-authenticated-user-id':user}:{}),...(body?{'content-type':'application/json',origin}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:response.status,body:await response.json()};};
 const rpc=(method,input={},options={})=>call('/mcp',{...options,body:{jsonrpc:'2.0',id:1,method,params:input}});
 const store=api.createD1McpEventsStore(env.DB),service=api.createMcpEventsService({store,transport:api.createSitesOpenAIEventTransport(env),authorize:d=>api.sitesEventAuthorized(d,env)});
 const enqueue=async(id='synthetic-pending-request')=>store.enqueue({eventId:id+':created:v1',ownerId:owner,name:PROJECT_REQUEST_CREATED,arguments:{projectId},data:{requestId:id,projectId,version:1},createdAt:new Date().toISOString()});
 const rows=table=>fixture.db.prepare('SELECT * FROM '+table).all();
 const executionUnchanged=()=>{assert.deepEqual(sql.filter(query=>/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(query)&&/\b(dispatch_\w+|native_dispatch_journal|task_manual_status_events|task_requirement_events|board_observation_events)\b/i.test(query)),[]);for(const name of ['dispatch_jobs','dispatch_operations','dispatch_controls','dispatch_resource_leases','dispatch_task_bindings','dispatch_manual_authorizations','native_dispatch_journal'])assert.equal(rows(name).length,0);assert.equal(JSON.parse(env.DOT_BOARD_PROJECT_REGISTRY)[0].executionState,'deferred');};
 return {fixture,env,sql,calls,background,call,rpc,store,service,enqueue,rows,executionUnchanged};
}
for(const [label,api] of [['source',source],['compiled',compiled]]){
 test(label+': notification allowlist is exact, bounded and fail closed without changing active defaults',()=>{
  for(const raw of [undefined,'','[]',JSON.stringify(['other-project']),JSON.stringify([projectId.toUpperCase()]),JSON.stringify([projectId+'-suffix'])]){const env={...baseEnv(),[key]:raw};assert.deepEqual(api.sitesProjectEventScopeFor({ownerId:owner,projectId},env),{allowed:false,reason:'project_deferred'});for(const action of ['subscribe','deliver'])assert.equal(api.sitesEventAuthorized(details(action),env),false);}
  for(const raw of invalid){const env={...baseEnv(),[key]:raw};assert.deepEqual(api.sitesProjectEventScopeFor({ownerId:owner,projectId},env),{allowed:false,reason:'invalid_notification_configuration'});for(const action of ['subscribe','deliver'])assert.equal(api.sitesEventAuthorized(details(action),env),false);}
  for(const raw of [undefined,'','[]',allowed,...invalid])for(const executionState of [undefined,'active']){const env={...baseEnv(),[key]:raw,DOT_BOARD_PROJECT_REGISTRY:JSON.stringify([{...project,executionState}])};assert.deepEqual(api.sitesProjectEventScopeFor({ownerId:owner,projectId},env),{allowed:true,reason:'project_scope_allowed'});}
  for(const ids of [[projectId],Array.from({length:199},(_,i)=>'synthetic-'+i).concat(projectId)]){const env={...baseEnv(),[key]:JSON.stringify(ids)},before=JSON.stringify(env);assert.deepEqual(api.sitesProjectEventScopeFor({ownerId:owner,projectId},env),{allowed:true,reason:'project_notification_allowed'});for(const action of ['subscribe','deliver'])assert.equal(api.sitesEventAuthorized(details(action),env),true);assert.equal(JSON.stringify(env),before);}
 });
 test(label+': allowlisted notifications preserve every project and identity denial',()=>{
  const gates=[
   [{DOT_BOARD_PROJECT_REGISTRY:''},'project_registry_absent'],[{DOT_BOARD_PROJECT_REGISTRY:'{'},'project_registry_invalid'],[{DOT_BOARD_PROJECT_REGISTRY:'[]'},'project_not_found'],
   [{DOT_BOARD_HIDDEN_PROJECT_IDS:allowed},'project_hidden'],[{DOT_BOARD_HIDDEN_PROJECT_IDS:''},'empty_hidden_configuration'],[{DOT_BOARD_HIDDEN_PROJECT_IDS:'{}'},'invalid_hidden_configuration'],
   ...['paused','canceled'].map(executionState=>[{DOT_BOARD_PROJECT_REGISTRY:JSON.stringify([{...project,executionState}])},'project_'+executionState]),
   [{DOT_BOARD_PROJECT_REGISTRY:JSON.stringify([{...project,acceptNewRequests:false}])},'project_requests_closed']
  ];
  for(const [override,reason] of gates){const env={...baseEnv(),[key]:allowed,...override};assert.deepEqual(api.sitesProjectEventScopeFor({ownerId:owner,projectId},env),{allowed:false,reason});for(const action of ['subscribe','deliver'])assert.equal(api.sitesEventAuthorized(details(action),env),false);assert.equal(api.sitesEventAuthorized(details('unsubscribe'),env),true);}
  for(const action of ['subscribe','deliver','unsubscribe'])for(const extra of [{ownerId:'foreign-owner'},{ownerId:null},{name:'board.task_observed'},{name:'unknown-event'}])assert.equal(api.sitesEventAuthorized(details(action,extra),{...baseEnv(),[key]:allowed}),false);
  for(const action of ['subscribe','deliver'])assert.equal(api.sitesEventAuthorized(details(action,{arguments:{projectId:'unregistered-project'}}),{...baseEnv(),[key]:JSON.stringify([projectId,'unregistered-project'])}),false);
 });
 test(label+': scope diagnostics and readiness agree; notification is never execution readiness',async t=>{
  const c=setup(t,api);const list=()=>c.rpc('tools/call',{name:'list_request_projects',arguments:{}});
  const before=c.fixture.db.prepare('SELECT total_changes() AS n').get().n;
  for(const [raw,reason,ready] of [[undefined,'project_deferred',false],['[]','project_deferred',false],['{}','invalid_notification_configuration',false],[allowed,'project_notification_allowed',true]]){
   c.env[key]=raw;const listed=await list();assert.deepEqual(listed.body.result.structuredContent.projects,[{id:projectId,name:project.name,eventScope:{allowed:ready,reason}}]);const config=(await c.call('/api/config')).body;assert.equal(config.eventDelivery.canSubscribe,ready);assert.equal(config.eventDelivery.reason,ready?'ready_for_native_subscription':'event_project_scope_unavailable');
  }
  c.env.DOT_BOARD_HIDDEN_PROJECT_IDS='';assert.equal((await c.call('/api/config')).body.eventDelivery.canSubscribe,false);assert.equal((await list()).body.result.structuredContent.projects[0].eventScope.reason,'empty_hidden_configuration');delete c.env.DOT_BOARD_HIDDEN_PROJECT_IDS;
  for(const options of [{user:null},{user:'foreign-owner'},{origin:'https://other.example.com'}]){const denied=await c.rpc('events/subscribe',params(),options);assert.equal(denied.status,options.user===null?401:403);}
  assert.equal(c.calls.length,0);assert.equal(c.fixture.db.prepare('SELECT total_changes() AS n').get().n,before);c.executionUnchanged();
 });
 test(label+': exact deferred subscription and real storage delivery leave all execution paths untouched',async t=>{
  const c=setup(t,api);const subscribed=await c.rpc('events/subscribe',params());assert(subscribed.body.result.id);
  const board=(await c.call('/api/board')).body;const saved=await c.call('/api/projects/'+projectId+'/requests',{body:{clientSubmissionId:'synthetic-notification-save',body:'Synthetic notification must not execute this request',viewedSnapshotRevision:board.snapshotRevision,viewedSnapshotImportedAt:board.importedAt,contextSummary:''}});
  assert.equal(saved.status,201);await Promise.all(c.background);assert.equal(c.calls.filter(call=>!JSON.parse(call.body).type).length,1);assert.equal(c.rows('mcp_event_outbox')[0].state,'delivered');assert.equal(c.rows('intake_requests')[0].status,'received');assert.equal(c.rows('intake_requests')[0].version,1);
  const dispatch=api.createDispatchService({store:api.createD1DispatchQueue(c.env.DB),enabled:true,requests:{get:async()=>({request:{id:'synthetic-accepted-request',projectId,status:'accepted',version:1}})},readRegistry:async()=>api.readEnvironmentProjectRegistry(c.env).records});
  await assert.rejects(dispatch.enqueue(owner,{eventId:'synthetic-denied-dispatch',requestId:'synthetic-accepted-request',expectedRequestVersion:1,environment:{type:'native_cloud'}}),{code:'execution_paused'});
  c.executionUnchanged();
 });
 test(label+': removal blocks cached subscribe, revokes queued delivery and does not revive on re-add',async t=>{
  const c=setup(t,api);const subscribed=await c.service.subscribe(owner,params());await c.enqueue();const before=c.calls.length;
  c.env[key]='[]';await assert.rejects(c.service.subscribe(owner,params()),{code:'event_access_denied'});assert.equal(c.calls.length,before);
  const result=await c.service.drain();assert.equal(result.canceled,1);assert.equal(c.calls.length,before);assert.equal((await c.store.getSubscription(subscribed.id,owner)).active,false);assert.equal(c.rows('mcp_event_outbox')[0].state,'canceled');assert.equal(c.rows('mcp_event_outbox')[0].last_reason,'access_revoked');
  c.env[key]=allowed;await c.enqueue('synthetic-after-readd');assert.equal((await c.service.drain()).processed,0);assert.equal(c.calls.length,before);assert.equal(c.rows('mcp_event_outbox').length,1);assert.equal((await c.store.getSubscription(subscribed.id,owner)).active,false);c.executionUnchanged();
 });
 for(const change of ['paused','canceled','closed','hidden','missing','invalid'])test(label+': changed '+change+' gate revokes a deferred notification before delivery',async t=>{
  const c=setup(t,api);const subscription=await c.service.subscribe(owner,params());await c.enqueue();const before=c.calls.length;
  if(['paused','canceled'].includes(change))c.env.DOT_BOARD_PROJECT_REGISTRY=JSON.stringify([{...project,executionState:change}]);
  if(change==='closed')c.env.DOT_BOARD_PROJECT_REGISTRY=JSON.stringify([{...project,acceptNewRequests:false}]);
  if(change==='hidden')c.env.DOT_BOARD_HIDDEN_PROJECT_IDS=allowed;
  if(change==='missing')c.env.DOT_BOARD_PROJECT_REGISTRY='[]';
  if(change==='invalid')c.env[key]='{}';
  const registryBefore=c.env.DOT_BOARD_PROJECT_REGISTRY;
  assert.equal((await c.service.drain()).canceled,1);assert.equal(c.calls.length,before);assert.equal((await c.store.getSubscription(subscription.id,owner)).active,false);assert.equal(c.rows('mcp_event_outbox')[0].last_reason,'access_revoked');assert.equal(c.env.DOT_BOARD_PROJECT_REGISTRY,registryBefore);
  c.env.DOT_BOARD_PROJECT_REGISTRY=JSON.stringify([project]);c.executionUnchanged();
 });
 test(label+': client fields cannot supply the deployment notification allowlist',async t=>{
  const c=setup(t,api);delete c.env[key];
  for(const input of [{...params(),[key]:[projectId]},{...params(),arguments:{projectId,[key]:[projectId]}},{...params(),arguments:{projectId,notificationAllowed:true}}])assert.equal((await c.rpc('events/subscribe',input)).body.error.code,-32602);
  assert.equal(c.env[key],undefined);assert.equal(c.calls.length,0);assert.equal(c.rows('mcp_event_subscriptions').length,0);c.executionUnchanged();
 });
 test(label+': permission removed while callback challenge is pending cannot save a subscription',async t=>{
  const c=setup(t,api);let release,arrived;const started=new Promise(resolve=>{arrived=resolve;}),pending=new Promise(resolve=>{release=resolve;});
  const original=globalThis.fetch;globalThis.fetch=async(...args)=>{const response=await original(...args);arrived();await pending;return response;};
  const subscription=c.service.subscribe(owner,params());await started;delete c.env[key];release();await assert.rejects(subscription,{code:'event_access_denied'});assert.equal(c.rows('mcp_event_subscriptions').length,0);assert.equal(c.calls.length,1);c.executionUnchanged();
 });
 test(label+': new HTTP request rechecks removal before draining an existing subscription',async t=>{
  const c=setup(t,api);assert((await c.rpc('events/subscribe',params())).body.result.id);await c.enqueue();const before=c.calls.length;delete c.env[key];
  const denied=await c.rpc('events/subscribe',params());assert.equal(denied.body.error.code,-32012);
  const board=(await c.call('/api/board')).body;const saved=await c.call('/api/projects/'+projectId+'/requests',{body:{clientSubmissionId:'synthetic-after-scope-removal',body:'Synthetic save does not restore notification or execution permission',viewedSnapshotRevision:board.snapshotRevision,viewedSnapshotImportedAt:board.importedAt}});
  assert.equal(saved.status,201);await Promise.all(c.background);assert.equal(c.calls.length,before);assert.equal(c.rows('mcp_event_subscriptions')[0].active,0);assert(c.rows('mcp_event_outbox').every(row=>row.state==='canceled'));c.executionUnchanged();
 });
 for(const change of ['removed','hidden','missing-project','invalid'])test(label+': owner can unsubscribe after '+change+' notification permission',async t=>{
  const c=setup(t,api);const subscription=(await c.rpc('events/subscribe',params())).body.result;await c.enqueue();const before=c.calls.length;
  delete c.env[key];if(change==='hidden')c.env.DOT_BOARD_HIDDEN_PROJECT_IDS=allowed;if(change==='missing-project')c.env.DOT_BOARD_PROJECT_REGISTRY='[]';if(change==='invalid')c.env[key]='{}';
  c.env.DOT_BOARD_EVENTS_ENABLED='false';delete c.env.DOT_BOARD_SITES_EVENT_POLICY;
  const input={name:PROJECT_REQUEST_CREATED,arguments:{projectId},delivery:{mode:'webhook',url:callback}};
  assert.equal((await c.rpc('events/unsubscribe',input,{user:'foreign-owner'})).status,403);assert.deepEqual((await c.rpc('events/unsubscribe',input)).body.result,{});assert.deepEqual((await c.rpc('events/unsubscribe',input)).body.result,{});assert.equal((await c.store.getSubscription(subscription.id,owner)).active,false);assert.equal(c.rows('mcp_event_outbox')[0].state,'canceled');assert.equal(c.calls.length,before);
  if(change==='missing-project')c.env.DOT_BOARD_PROJECT_REGISTRY=JSON.stringify([project]);c.executionUnchanged();
 });
}
