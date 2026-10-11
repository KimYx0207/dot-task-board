import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSitesOpenAIEventTransport} from '../src/adapters/sites-openai-event-transport.mjs';
import {createSitesPrivateEntry} from '../src/application/sites-entry.mjs';
import {createD1McpEventsStore} from '../src/adapters/d1-mcp-events.mjs';
import {createMcpEventsService} from '../src/application/mcp-events-service.mjs';
import {verifyStandardWebhook,PROJECT_REQUEST_CREATED} from '../src/domain/mcp-events.mjs';
import {sqliteIntakeFixture} from './sqlite-intake-fixture.mjs';

// All destinations, identity, data and policy evidence here are synthetic. fetch
// is intercepted; these tests are protocol/storage tests, not platform attestation.
const audience='https://board.example.com',owner='synthetic-owner',project='synthetic-project';
const callback='https://receiver.example.org/native-path?capability=synthetic-private-query';
const secret='whsec_'+btoa('synthetic-signing-material-12345678');
const sample=JSON.parse(readFileSync(new URL('../fixtures/synthetic.json',import.meta.url),'utf8'));
const policy=()=>({schema:'sites-openai-event-policy/1',deploymentAudience:audience,runtime:{kind:'cloudflare-workers-global-fetch',evidenceRef:'synthetic-runtime-evidence',routing:{kind:'strict-public',evidenceScope:'complete-outbound-chain',evidenceRef:'synthetic-complete-outbound-chain-evidence'}},callbackOrigins:[{origin:'https://receiver.example.org',provider:'openai',nativeSubscriptionEvidenceRef:'synthetic-native-origin-evidence',providerOwnershipEvidenceRef:'synthetic-independent-ownership-evidence'}]});
const params=(extra={})=>({name:PROJECT_REQUEST_CREATED,arguments:{projectId:project},delivery:{mode:'webhook',url:callback,secret},...extra});
const event=(id='synthetic-request')=>({eventId:id+':created:v1',ownerId:owner,name:PROJECT_REQUEST_CREATED,arguments:{projectId:project},data:{requestId:id,projectId:project,version:1},createdAt:new Date().toISOString()});
function intercepted(t,handle){const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});globalThis.fetch=handle;}
function transportEnv(p=policy()){return {DOT_BOARD_AUDIENCE:audience,DOT_BOARD_EVENTS_ENABLED:'true',...(p?{DOT_BOARD_SITES_EVENT_POLICY:JSON.stringify(p)}:{})};}
function requestOptions(overrides={}){return {url:callback,hostname:'receiver.example.org',method:'POST',redirect:'error',responseLimitBytes:1024,signal:new AbortController().signal,headers:{'content-type':'application/json','webhook-id':'synthetic-id','webhook-timestamp':'1','webhook-signature':'v1,synthetic','x-mcp-subscription-id':'synthetic-sub'},body:'{}',...overrides};}
function setup(t,{configured=true,bundled=false}={}){
 const fixture=sqliteIntakeFixture();t.after(()=>fixture.close());const calls=[],background=[];
 const env={...transportEnv(configured?policy():null),DB:fixture.binding,DOT_BOARD_INGRESS:'sites-owner-private-v1',DOT_BOARD_OWNER_ID:owner,DOT_BOARD_EVENTS_ENABLED:'true',DOT_BOARD_SNAPSHOT:JSON.stringify(sample),DOT_BOARD_PROJECT_REGISTRY:JSON.stringify([{id:project,name:sample.tasks[0].project,aliases:[]}]),DOT_BOARD_INTAKE_ENABLED:'true',DOT_BOARD_INTAKE_MCP_ENABLED:'true',DOT_BOARD_INTAKE_CONNECTION_VERIFIED:'true'};
 intercepted(t,async(url,options)=>{calls.push({url,...options});const body=JSON.parse(options.body);assert.equal(url,callback);assert(await verifyStandardWebhook({secret,id:options.headers.get('webhook-id'),timestamp:options.headers.get('webhook-timestamp'),signature:options.headers.get('webhook-signature'),body:options.body}));return body.type==='verification'?Response.json({challenge:body.challenge}):new Response(null,{status:204});});
 const factory=bundled?new Function(readFileSync(new URL('../dist/sites/index.js',import.meta.url),'utf8').replace('export default ','const compiledDefault = ')+'\nreturn createSitesPrivateEntry;')():createSitesPrivateEntry;
 const entry=factory();const call=(path,{method='GET',body,user=owner,origin=audience,ctx={waitUntil:p=>background.push(p)}}={})=>entry.fetch(new Request(origin+path,{method,headers:{...(user?{'oai-authenticated-user-id':user}:{}),...(body?{'content-type':'application/json',origin}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);
 const rpc=async(method,params={},options={})=>{const response=await call('/mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method,params},...options});return {status:response.status,...await response.json()};};
 const rows=table=>fixture.db.prepare('SELECT * FROM '+table).all();
 const submit=async(key='synthetic-submit')=>{const board=await(await call('/api/board')).json();const response=await call('/api/projects/'+project+'/requests',{method:'POST',body:{clientSubmissionId:key,body:'Synthetic request content stays in authenticated storage',viewedSnapshotRevision:board.snapshotRevision,viewedSnapshotImportedAt:board.importedAt,contextSummary:''}});return {status:response.status,...await response.json()};};
 return {fixture,env,calls,background,entry,call,rpc,rows,submit,deliveries:()=>calls.filter(call=>!JSON.parse(call.body).type)};
}

test('missing/unverified policy is not readiness or permission; only a safe offered origin is disclosed',async t=>{
 let calls=0;intercepted(t,async()=>{calls++;throw Error('unexpected');});
 for(const p of [null,{}, {...policy(),deploymentAudience:'https://other.example.com'}, {...policy(),runtime:{}}, {...policy(),callbackOrigins:[]}, {...policy(),callbackOrigins:[{origin:'https://receiver.example.org',provider:'openai',verified:true}]}]){
  const transport=createSitesOpenAIEventTransport(transportEnv(p));assert.equal(transport.readiness().ready,false);
  await assert.rejects(transport.sendPublicHttps(requestOptions()),error=>error.rpcCode===-32014&&error.data.offeredCallbackOrigin==='https://receiver.example.org'&&!JSON.stringify(error).includes('native-path')&&!JSON.stringify(error).includes('synthetic-private-query'));
 }
 assert.equal(calls,0);
});

test('exact origins require full-chain public routing proof; no hostname, wildcard or suffix shortcuts',async t=>{
 let calls=0;intercepted(t,async()=>{calls++;return new Response(null,{status:204});});
 const env=transportEnv(),transport=createSitesOpenAIEventTransport(env);
 for(const value of ['http://receiver.example.org/x','https://receiver.example.org:444/x','https://name@receiver.example.org/x','https://127.0.0.1/x','https://[::1]/x','https://receiver.example.org./x','https://receiver.example.org.evil.com/x','https://evilreceiver.example.org/x','https://receiver.example.org/x#fragment','https://board.example.com/x','https://xn--e1afmkfd.example.org/x'])await assert.rejects(transport.sendPublicHttps(requestOptions({url:value,hostname:new URL(value).hostname})));
 for(const origin of ['https://*.example.org','https://receiver.example.org/','https://receiver.example.org/path','https://receiver.example.org?query']){const p=policy();p.callbackOrigins[0].origin=origin;env.DOT_BOARD_SITES_EVENT_POLICY=JSON.stringify(p);assert.equal(transport.readiness().ready,false);}
 // Even a complete list of zone hostnames is not a routing proof for a
 // custom callback hostname: the zone-only contract is deliberately unsupported.
 const p=policy();p.runtime.routing={kind:'effective-zone-exclusion',evidenceRef:'synthetic-zone-list',evidenceScope:'complete-outbound-chain',effectiveZoneHostnames:['example.com']};env.DOT_BOARD_SITES_EVENT_POLICY=JSON.stringify(p);assert.equal(transport.readiness().reason,'runtime_contract_unsupported');
 const incomplete=policy();delete incomplete.runtime.routing.evidenceScope;env.DOT_BOARD_SITES_EVENT_POLICY=JSON.stringify(incomplete);assert.equal(transport.readiness().reason,'runtime_contract_missing');
 const partial=policy();partial.runtime.routing.evidenceScope='entry-worker-only';env.DOT_BOARD_SITES_EVENT_POLICY=JSON.stringify(partial);assert.equal(transport.readiness().reason,'runtime_contract_missing');
 env.DOT_BOARD_SITES_EVENT_POLICY=JSON.stringify(policy());assert.equal(transport.readiness().ready,true);
 assert.equal(calls,0);
});

test('transport reconstructs only constrained fetch and rejects caller headers/options and redirects',async t=>{
 const calls=[];intercepted(t,async(url,options)=>{calls.push({url,options});return new Response(null,{status:204});});
 const transport=createSitesOpenAIEventTransport(transportEnv());
 for(const extra of [{cf:{resolveOverride:'private'}},{address:'127.0.0.1'},{credentials:'include'},{fetcher:()=>{}},{redirect:'follow'},{responseLimitBytes:2048},{method:'GET'}])await assert.rejects(transport.sendPublicHttps(requestOptions(extra)),{code:'unsafe_callback_destination'});
 for(const header of ['Host','Authorization','Cookie','X-Unrelated'])await assert.rejects(transport.sendPublicHttps(requestOptions({headers:{...requestOptions().headers,[header]:'synthetic'}})),{code:'unsafe_callback_destination'});
 assert.equal(calls.length,0);await transport.sendPublicHttps(requestOptions());assert.equal(calls.length,1);assert.equal(calls[0].url,callback);assert.deepEqual(Object.keys(calls[0].options).sort(),['body','headers','method','redirect','signal']);assert.deepEqual([...calls[0].options.headers.keys()].sort(),Object.keys(requestOptions().headers).sort());
 for(const status of [301,302,303,307,308]){globalThis.fetch=async()=>new Response(null,{status,headers:{location:'https://elsewhere.example.org/private'}});await assert.rejects(transport.sendPublicHttps(requestOptions()),{code:'callback_redirect_rejected'});}
 globalThis.fetch=async()=>({status:204,redirected:true});await assert.rejects(transport.sendPublicHttps(requestOptions()),{code:'callback_redirect_rejected'});
});

for(const bundled of [false,true])test((bundled?'compiled: ':'source: ')+'native protocol-shaped subscription, atomic save and bounded HTTP delivery; 2xx means receipt only',async t=>{
 const c=setup(t,{bundled});assert((await c.rpc('server/discover')).result.capabilities.events);assert.equal((await c.rpc('events/list')).result.events[0].name,PROJECT_REQUEST_CREATED);
 const subscribed=await c.rpc('events/subscribe',params());assert(subscribed.result.id);assert.equal(c.rows('mcp_event_subscriptions').length,1);
 const saved=await c.submit();assert.equal(saved.status,201);assert.equal(c.background.length,1);await Promise.all(c.background.splice(0));assert.equal(c.deliveries().length,1);
 const delivery=JSON.parse(c.deliveries()[0].body);assert.equal(delivery.eventId,saved.request.id+':created:v1');assert.deepEqual(delivery.data,{requestId:saved.request.id,projectId:project,version:1});assert(!c.deliveries()[0].body.includes('Synthetic request content'));assert.equal(c.rows('mcp_event_outbox')[0].state,'delivered');assert.equal(c.rows('intake_requests')[0].status,'received');assert.equal(c.rows('dispatch_jobs').length,0);
 const replay=await c.submit();assert.equal(replay.status,200);assert.equal(c.background.length,0);assert.equal(c.rows('intake_requests').length,1);assert.equal(c.rows('mcp_events').length,1);
 const config=await(await c.call('/api/config')).json();assert.equal(config.eventDelivery.canSubscribe,true);assert.equal(config.eventDelivery.activeSubscriptions,1);assert.equal(config.eventDelivery.outbox.delivered,1);assert.equal(config.eventDelivery.autonomousRetry,false);assert(!JSON.stringify(config).includes('native-path'));assert(!JSON.stringify(config).includes(secret));
 await c.rpc('events/unsubscribe',{name:PROJECT_REQUEST_CREATED,arguments:{projectId:project},delivery:{mode:'webhook',url:callback}});assert.equal(c.rows('mcp_event_subscriptions')[0].active,0);
});

test('discovery bootstraps without callback policy; no challenge, subscription or ready claim',async t=>{
 const c=setup(t,{configured:false});assert((await c.rpc('server/discover')).result.capabilities.events);assert.equal((await c.rpc('events/list')).result.events.length,1);
 const rejected=await c.rpc('events/subscribe',params());assert.equal(rejected.error.code,-32014);assert.equal(rejected.error.data.reason,'callback_policy_missing');assert.equal(rejected.error.data.offeredCallbackOrigin,'https://receiver.example.org');assert.equal(c.calls.length,0);assert.equal(c.rows('mcp_event_subscriptions').length,0);
 const saved=await c.submit();assert.equal(saved.status,201);assert.equal(c.rows('mcp_events').length,1);assert.equal(c.rows('mcp_event_outbox').length,0);assert.equal(c.background.length,0);
 const state=(await(await c.call('/api/config')).json()).eventDelivery;assert.equal(state.discoveryReady,true);assert.equal(state.canSubscribe,false);assert.equal(state.reason,'callback_policy_missing');assert.equal(state.activeSubscriptions,0);
});

test('cached verification and every delivery recheck current policy without leaking URL or secret',async t=>{
 const c=setup(t);const transport=createSitesOpenAIEventTransport(c.env),store=createD1McpEventsStore(c.env.DB),service=createMcpEventsService({store,transport,authorize:async()=>true});
 await service.subscribe(owner,params());const before=c.calls.length;
 delete c.env.DOT_BOARD_SITES_EVENT_POLICY;await assert.rejects(service.subscribe(owner,params()),{code:'sites_event_transport_not_ready'});assert.equal(c.calls.length,before);
 await store.enqueue(event());assert.equal((await service.drain()).retried,1);assert.equal(c.calls.length,before);assert.equal(c.rows('mcp_event_outbox')[0].state,'retry');assert(!JSON.stringify(c.rows('mcp_event_outbox')).includes('synthetic-private-query'));
 c.env.DOT_BOARD_SITES_EVENT_POLICY=JSON.stringify(policy());await service.subscribe(owner,params());assert.equal(c.calls.length,before); // still-valid challenge cache, newly approved policy
 const p=policy();p.callbackOrigins[0].origin='https://different.example.org';c.env.DOT_BOARD_SITES_EVENT_POLICY=JSON.stringify(p);await assert.rejects(service.subscribe(owner,params()),error=>error.data.reason==='callback_origin_not_approved');assert.equal(c.calls.length,before);
});

test('owner, audience, hidden project, storage and conflicting modes fail closed',async t=>{
 const c=setup(t);assert.equal((await c.rpc('events/list',{}, {user:null})).status,401);assert.equal((await c.rpc('events/list',{}, {user:'other'})).status,403);assert.equal((await c.rpc('events/list',{}, {origin:'https://other.example.com'})).status,403);
 c.env.DOT_BOARD_HIDDEN_PROJECT_IDS=JSON.stringify([project]);assert.equal((await c.rpc('events/subscribe',params())).error.code,-32012);delete c.env.DOT_BOARD_HIDDEN_PROJECT_IDS;
 c.env.DOT_BOARD_EVENT_BRIDGE_ENABLED='true';assert.equal((await c.call('/api/config')).status,503);assert.equal((await c.rpc('events/subscribe',params())).error,'event_delivery_mode_conflict');delete c.env.DOT_BOARD_EVENT_BRIDGE_ENABLED;
 c.fixture.db.exec('DROP TABLE mcp_event_outbox');const state=(await(await c.call('/api/config')).json()).eventDelivery;assert.equal(state.storageReady,false);assert.equal(state.canSubscribe,false);assert.equal(state.reason,'event_storage_unavailable');assert.equal((await c.submit()).status,503);assert.equal(c.calls.length,0);
});

test('candidate approval uses the same direct event transaction and HTTP trigger; proposal and replay do not emit',async t=>{
 const c=setup(t);await c.rpc('events/subscribe',params());const board=await(await c.call('/api/board')).json();
 const proposal=await(await c.call('/api/candidates',{method:'POST',body:{clientSubmissionId:'synthetic-candidate-submit',projectId:project,title:'Synthetic candidate',reason:'Synthetic source',expectedOutcome:'Synthetic outcome',sourceReferences:[{kind:'reference',label:'Synthetic source',reference:'synthetic-source'}],viewedSnapshotRevision:board.snapshotRevision,viewedSnapshotImportedAt:board.importedAt}})).json();assert(proposal.candidate);assert.equal(c.rows('mcp_events').length,0);assert.equal(c.background.length,0);
 const review={eventId:'synthetic-review',expectedVersion:1,decision:'approve',note:'Synthetic approval'};
 const approved=await(await c.call('/api/candidates/'+proposal.candidate.id+'/review',{method:'POST',body:review})).json();assert(approved.request);assert.equal(c.background.length,1);await Promise.all(c.background.splice(0));assert.equal(c.deliveries().length,1);assert.equal(c.rows('mcp_events').length,1);assert.equal(c.rows('dispatch_jobs').length,0);
 const replay=await c.rpc('tools/call',{name:'review_candidate',arguments:{candidateId:proposal.candidate.id,...review}});assert.equal(replay.result.structuredContent.replayed,true);assert.equal(c.background.length,0);assert.equal(c.rows('mcp_events').length,1);
});

test('transient delivery failure is durable retry and does not create a scheduler or lose saved request',async t=>{
 const c=setup(t);await c.rpc('events/subscribe',params());globalThis.fetch=async()=>new Response(null,{status:503});const saved=await c.submit();assert.equal(saved.status,201);const result=await Promise.all(c.background.splice(0));assert.equal(result[0].retried,1);assert.equal(c.rows('mcp_event_outbox')[0].state,'retry');assert.equal(c.rows('intake_requests')[0].status,'received');assert.deepEqual(await c.entry.scheduled(null,c.env),{disabled:true,reason:'no_sites_retry_trigger_configured'});
});

test('bounded drain aborts on total budget without starting the next delivery; lease stays recoverable',async t=>{
 const fixture=sqliteIntakeFixture();t.after(()=>fixture.close());const store=createD1McpEventsStore(fixture.binding);let calls=0,aborted=false;
 const transport={kind:'platform-managed-public-https-v1',sendPublicHttps:async q=>{const data=JSON.parse(q.body);if(data.type==='verification')return Response.json({challenge:data.challenge});calls++;return new Promise((resolve,reject)=>q.signal.addEventListener('abort',()=>{aborted=true;reject(Object.assign(Error('synthetic abort'),{name:'AbortError'}));},{once:true}));}};
 const service=createMcpEventsService({store,transport,authorize:async()=>true});await service.subscribe(owner,params());await store.enqueue(event('synthetic-one'));await store.enqueue(event('synthetic-two'));
 const result=await service.drain({limit:2,budgetMs:30});assert.equal(result.budgetExhausted,true);assert.equal(calls,1);assert.equal(aborted,true);
 const rows=fixture.db.prepare('SELECT state FROM mcp_event_outbox ORDER BY event_id').all();assert.deepEqual(rows.map(row=>row.state),['delivering','pending']);await assert.rejects(service.drain({budgetMs:30000}),{code:'invalid_drain_budget'});
});


test('Sites catalog remains discoverable with existing EVENTS_ENABLED=false, without enabling writes or blocking intake',async t=>{
 const c=setup(t,{configured:false});c.env.DOT_BOARD_EVENTS_ENABLED='false';
 assert((await c.rpc('server/discover')).result.capabilities.events);assert.equal((await c.rpc('events/list')).result.events[0].name,PROJECT_REQUEST_CREATED);
 const rejected=await c.rpc('events/subscribe',params());assert.equal(rejected.error.code,-32014);assert.equal(rejected.error.data.reason,'direct_events_disabled');assert.equal(rejected.error.data.offeredCallbackOrigin,'https://receiver.example.org');
 const saved=await c.submit();assert.equal(saved.status,201);assert.equal(c.rows('mcp_events').length,0);assert.equal(c.rows('mcp_event_subscriptions').length,0);assert.equal(c.calls.length,0);assert.equal(c.background.length,0);
 c.fixture.db.exec('DROP TABLE mcp_event_outbox');assert((await c.rpc('server/discover')).result.capabilities.events);assert.equal((await c.submit('synthetic-submit-two')).status,201);
 const state=(await(await c.call('/api/config')).json()).eventDelivery;assert.equal(state.discoveryReady,true);assert.equal(state.canSubscribe,false);assert.equal(state.reason,'direct_events_disabled');
});


test('stopped/revoked/hidden projects cannot subscribe or deliver even if listed historically',async t=>{
 const c=setup(t);const records=JSON.parse(c.env.DOT_BOARD_PROJECT_REGISTRY);
 for(const control of [{executionState:'paused'},{executionState:'deferred'},{executionState:'canceled'},{acceptNewRequests:false}]){
  c.env.DOT_BOARD_PROJECT_REGISTRY=JSON.stringify(records.map(row=>({...row,...control})));
  assert.equal((await c.rpc('events/subscribe',params())).error.code,-32012);
 }
 c.env.DOT_BOARD_PROJECT_REGISTRY=JSON.stringify(records);await c.rpc('events/subscribe',params());
 // No waitUntil: event remains durable until the next actual allowed trigger.
 const board=await(await c.call('/api/board')).json();const response=await c.call('/api/projects/'+project+'/requests',{method:'POST',body:{clientSubmissionId:'synthetic-held-event',body:'Synthetic held event',viewedSnapshotRevision:board.snapshotRevision,viewedSnapshotImportedAt:board.importedAt,contextSummary:''},ctx:{}});assert.equal(response.status,201);assert.equal(c.deliveries().length,0);
 c.env.DOT_BOARD_PROJECT_REGISTRY=JSON.stringify(records.map(row=>({...row,executionState:'canceled'})));
 // A different newly saved request is not needed or invented to test revocation:
 // use the current service with the actual Sites authorization implementation.
 const factory=new Function(readFileSync(new URL('../dist/sites/index.js',import.meta.url),'utf8').replace('export default ','const compiledDefault = ')+'\nreturn sitesEventAuthorized;')();
 const service=createMcpEventsService({store:createD1McpEventsStore(c.env.DB),transport:createSitesOpenAIEventTransport(c.env),authorize:details=>factory(details,c.env)});
 assert.equal((await service.drain()).canceled,1);assert.equal(c.deliveries().length,0);assert.equal(c.rows('mcp_event_outbox')[0].state,'canceled');assert.equal(c.rows('mcp_event_subscriptions')[0].active,0);
 c.env.DOT_BOARD_PROJECT_REGISTRY='[]';assert.equal((await c.rpc('events/subscribe',params())).error.code,-32012);
});

test('MCP candidate approval triggers one atomic direct event; rejection never triggers it',async t=>{
 const c=setup(t);await c.rpc('events/subscribe',params());const board=await(await c.call('/api/board')).json();
 const create=async key=>{const result=await c.rpc('tools/call',{name:'propose_candidate',arguments:{clientSubmissionId:key,projectId:project,title:'Synthetic MCP candidate',reason:'Synthetic source',expectedOutcome:'Synthetic outcome',sourceReferences:[{kind:'reference',label:'Synthetic source',reference:'synthetic-reference'}],viewedSnapshotRevision:board.snapshotRevision,viewedSnapshotImportedAt:board.importedAt}});return result.result.structuredContent.candidate;};
 const rejected=await create('synthetic-rejected-candidate');await c.rpc('tools/call',{name:'review_candidate',arguments:{candidateId:rejected.id,eventId:'synthetic-reject-review',expectedVersion:1,decision:'reject'}});assert.equal(c.background.length,0);assert.equal(c.rows('mcp_events').length,0);
 const proposed=await create('synthetic-approved-candidate');const approved=await c.rpc('tools/call',{name:'review_candidate',arguments:{candidateId:proposed.id,eventId:'synthetic-approve-review',expectedVersion:1,decision:'approve'}});assert(approved.result.structuredContent.request);assert.equal(c.background.length,1);await Promise.all(c.background.splice(0));assert.equal(c.deliveries().length,1);assert.equal(c.rows('dispatch_jobs').length,0);
});


test('two-delivery limit attempts older backlog first and reserves a slot for the newly committed request',async t=>{
 const c=setup(t);await c.rpc('events/subscribe',params());const store=createD1McpEventsStore(c.env.DB);
 for(const id of ['synthetic-backlog-one','synthetic-backlog-two','synthetic-backlog-three'])await store.enqueue(event(id));
 const saved=await c.submit('synthetic-fresh-submission');await Promise.all(c.background.splice(0));
 const deliveries=c.deliveries().map(row=>JSON.parse(row.body));assert.equal(deliveries.length,2);assert.equal(deliveries[0].data.requestId,'synthetic-backlog-one');assert.equal(deliveries[1].data.requestId,saved.request.id);assert.equal(c.rows('mcp_event_outbox').filter(row=>row.state==='pending').length,2);
});

test('policy withdrawn during a signed challenge prevents activation; callback failures stay sanitized',async t=>{
 const c=setup(t);globalThis.fetch=async(_url,options)=>{delete c.env.DOT_BOARD_SITES_EVENT_POLICY;return Response.json({challenge:JSON.parse(options.body).challenge});};
 const rejected=await c.rpc('events/subscribe',params());assert.equal(rejected.error.data.reason,'callback_policy_missing');assert.equal(c.rows('mcp_event_subscriptions').length,0);
 c.env.DOT_BOARD_SITES_EVENT_POLICY=JSON.stringify(policy());globalThis.fetch=async()=>{throw Error(callback+' '+secret+' synthetic-private-upstream');};
 const failed=await c.rpc('events/subscribe',params());assert.equal(failed.error.data.reason,'connection_refused');assert(!JSON.stringify(failed).includes(callback));assert(!JSON.stringify(failed).includes(secret));assert(!JSON.stringify(failed).includes('synthetic-private-upstream'));
});

test('budget exhausted during storage cannot subsequently claim or send',async()=>{
 let release;const held=new Promise(resolve=>{release=resolve;});let due=0;
 const service=createMcpEventsService({store:{maintain:()=>held,due:()=>{due++;return [];}},transport:{kind:'platform-managed-public-https-v1',sendPublicHttps:async()=>{throw Error('must not send');}},authorize:async()=>true});
 assert.equal((await service.drain({limit:2,budgetMs:10})).budgetExhausted,true);release();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(due,0);
});


for(const state of ['stopped','hidden','removed'])test('owner can unsubscribe an exact '+state+' project subscription without transport readiness',async t=>{
 const c=setup(t);const own=await c.rpc('events/subscribe',params());const store=createD1McpEventsStore(c.env.DB);await store.enqueue(event());
 const original=await store.getSubscription(own.result.id,owner);await store.saveSubscription({...original,id:'synthetic-unrelated-subscription',ownerId:'synthetic-other-owner',now:new Date().toISOString(),rotationUntil:new Date().toISOString()});
 if(state==='stopped')c.env.DOT_BOARD_PROJECT_REGISTRY=JSON.stringify(JSON.parse(c.env.DOT_BOARD_PROJECT_REGISTRY).map(row=>({...row,executionState:'canceled'})));
 if(state==='hidden')c.env.DOT_BOARD_HIDDEN_PROJECT_IDS=JSON.stringify([project]);
 if(state==='removed')c.env.DOT_BOARD_PROJECT_REGISTRY='[]';
 c.env.DOT_BOARD_EVENTS_ENABLED='false';delete c.env.DOT_BOARD_SITES_EVENT_POLICY;const before=c.calls.length;
 const input={name:PROJECT_REQUEST_CREATED,arguments:{projectId:project},delivery:{mode:'webhook',url:callback}};
 assert.equal((await c.rpc('events/unsubscribe',input,{user:'synthetic-other-owner'})).status,403);
 const reply=await c.rpc('events/unsubscribe',input);assert.deepEqual(reply.result,{});assert.deepEqual((await c.rpc('events/unsubscribe',input)).result,{});
 assert.equal((await store.getSubscription(own.result.id,owner)).active,false);assert.equal(c.rows('mcp_event_outbox')[0].state,'canceled');assert.equal((await store.getSubscription('synthetic-unrelated-subscription','synthetic-other-owner')).active,true);assert.equal(c.calls.length,before);
});
