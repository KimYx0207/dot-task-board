import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createSitesPrivateEntry} from '../src/application/sites-entry.mjs';
import {sqliteIntakeFixture} from './sqlite-intake-fixture.mjs';
import {createD1BoardObservationOutbox} from '../src/adapters/d1-board-observation-outbox.mjs';
import {createSitesEventBridge,drainSourceObservations} from '../src/adapters/sites-event-bridge.mjs';
import {bridgeHeaders,verifyBridge} from '../src/adapters/event-bridge-auth.mjs';

const source=JSON.parse(readFileSync(new URL('../fixtures/synthetic.json',import.meta.url),'utf8'));

// Portable integration boundary: real owner-private Sites entry -> real source
// outbox -> real signed HTTP bridge. The receiver below is only a contract
// fixture, with a synthetic SQLite inbox and deterministic protocol responses.
// No independent relay implementation, private bindings, external scheduler or
// callback delivery is imported or claimed to be verified by these tests.
function setup(t){
 const siteDB=sqliteIntakeFixture(),receiverDB=new DatabaseSync(':memory:');
 receiverDB.exec('CREATE TABLE received_events(event_id TEXT PRIMARY KEY,payload_json TEXT NOT NULL)');
 t.after(()=>{siteDB.close();receiverDB.close();});
 const now=Date.now(),secret=btoa('synthetic-bridge-key'.padEnd(32,'0'));
 const callbackSecret='whsec_'+btoa('synthetic-callback-key'.padEnd(32,'0'));
 const target='https://relay.example.com/bridge',requests=[];
 let failure=null;
 const snapshot=structuredClone(source);
 snapshot.tasks[0]={...snapshot.tasks[0],state:'unknown',observedAt:null};
 const task=snapshot.tasks[0];
 const env={DB:siteDB.binding,DOT_BOARD_INGRESS:'sites-owner-private-v1',DOT_BOARD_OWNER_ID:'synthetic-owner',DOT_BOARD_AUDIENCE:'https://example.com',DOT_BOARD_OBSERVATIONS_ENABLED:'true',DOT_BOARD_INTAKE_MCP_ENABLED:'true',DOT_BOARD_PROJECT_REGISTRY:JSON.stringify([{id:'p',name:task.project,aliases:[],executionState:'deferred'}]),DOT_BOARD_SNAPSHOT:JSON.stringify(snapshot),DOT_BOARD_OBSERVATION_BINDINGS:JSON.stringify([{taskId:task.id,threadId:'synthetic-original-thread',environment:null,readAllowed:true}]),DOT_BOARD_EVENT_BRIDGE_ENABLED:'true',DOT_BOARD_EVENT_BRIDGE_URL:target,DOT_BOARD_EVENT_BRIDGE_SECRET:secret};
 const prior=globalThis.fetch;t.after(()=>{globalThis.fetch=prior;});
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,target);assert.equal(options.method,'POST');assert.equal(options.redirect,'error');
  assert(options.signal instanceof AbortSignal);
  const request=new Request(url,options),body=await request.text();
  const verified=await verifyBridge(request,{secret,audience:target,body});
  assert(verified,'every request must have a valid body- and audience-bound signature');
  assert(!requests.some(previous=>previous.requestId===verified.id),'each HTTP attempt has a new replay ID');
  const payload=JSON.parse(body);requests.push({requestId:verified.id,payload});
  assert.equal(payload.ownerId,'synthetic-owner');
  assert.deepEqual(Object.keys(payload).sort(),['action','ownerId','params']);
  if(failure==='offline')throw Error('synthetic network failure');
  if(failure==='rejected')return Response.json({rpcCode:-32012},{status:403});
  if(failure==='redirect')return new Response(null,{status:302,headers:{location:'https://other.example.com/bridge'}});
  if(failure==='malformed')return new Response('{');
  if(failure==='oversized')return new Response('x'.repeat(16385));
  if(failure==='missing-result')return Response.json({});
  if(payload.action==='events/list')return Response.json({result:{events:[{name:'board.task_observed',delivery:['webhook']}]}});
  if(payload.action==='events/subscribe'){
   assert.equal(payload.params.name,'board.task_observed');
   assert.deepEqual(payload.params.arguments,{projectId:'p'});
   assert.deepEqual(payload.params.delivery,{mode:'webhook',url:'https://callback.example.com/events',secret:callbackSecret});
   return Response.json({result:{id:'synthetic-subscription',cursor:null,truncated:false}});
  }
  if(payload.action==='events/unsubscribe')return Response.json({result:{}});
  assert.equal(payload.action,'enqueue');
  assert.equal(siteDB.db.prepare('SELECT COUNT(*) n FROM board_observation_events').get().n,1,'source observation must already be durable before egress');
  const event=payload.params;
  assert.deepEqual(Object.keys(event).sort(),['arguments','createdAt','data','eventId','name','ownerId']);
  assert.equal(event.ownerId,'synthetic-owner');assert.equal(event.name,'board.task_observed');
  assert.match(event.eventId,/^board-observed:[a-f0-9]{64}$/);
  assert.deepEqual(event.arguments,{projectId:'p'});
  assert.deepEqual(Object.keys(event.data).sort(),['projectId','status','taskId']);
  assert.equal(event.data.projectId,'p');assert.equal(event.data.taskId,task.id);
  assert(!body.includes('Synthetic source evidence'));assert(!body.includes('synthetic-original-thread'));
  assert(!body.includes('synthetic-turn'));assert(!body.includes('whsec_'));
  const existing=receiverDB.prepare('SELECT payload_json FROM received_events WHERE event_id=?').get(event.eventId);
  if(existing)assert.deepEqual(JSON.parse(existing.payload_json),event);
  else receiverDB.prepare('INSERT INTO received_events VALUES (?,?)').run(event.eventId,JSON.stringify(event));
  if(failure==='lost-after-commit')throw Error('synthetic lost acknowledgement');
  return Response.json({result:{eventId:failure==='wrong-ack'?'synthetic-wrong-event':event.eventId}});
 };
 const factory=process.env.SITE_BRIDGE_COMPILED==='true'
  ?new Function(readFileSync(new URL('../dist/sites/index.js',import.meta.url),'utf8').replace('export default ','const compiledDefault = ')+';return createSitesPrivateEntry;')()
  :createSitesPrivateEntry;
 const entry=factory();
 const event={taskId:task.id,eventId:'synthetic-observation-1',expectedVersion:0,source:{threadId:'synthetic-original-thread',environment:null,turnId:'synthetic-turn',itemId:'synthetic-item',observedAt:new Date(now-1000).toISOString()},changes:{state:'partial',observation:'Synthetic source evidence stays only on Site.'}};
 const rpc=async(method,params={},owner='synthetic-owner',origin='https://example.com')=>{
  const response=await entry.fetch(new Request(origin+'/mcp',{method:'POST',headers:{'content-type':'application/json',origin,...(owner?{'oai-authenticated-user-id':owner}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),env);
  return {status:response.status,body:await response.json()};
 };
 const subscribe=()=>rpc('events/subscribe',{name:'board.task_observed',arguments:{projectId:'p'},delivery:{mode:'webhook',url:'https://callback.example.com/events',secret:callbackSecret}});
 const record=()=>rpc('tools/call',{name:'record_task_observation',arguments:event});
 const received=()=>receiverDB.prepare('SELECT payload_json FROM received_events ORDER BY event_id').all().map(row=>JSON.parse(row.payload_json));
 const drain=()=>{
  const future=Date.now()+10000,outbox=createD1BoardObservationOutbox(env.DB,{clock:()=>new Date(future).toISOString()});
  return drainSourceObservations({ownerId:'synthetic-owner',outbox,bridge:createSitesEventBridge({env}),clock:()=>future});
 };
 return {siteDB,env,requests,event,task,rpc,subscribe,record,received,drain,failWith:value=>{failure=value;}};
}

test('owner-private MCP discovers and forwards subscriptions; only committed minimal observations cross the signed HTTP boundary',async t=>{
 const c=setup(t);
 assert((await c.rpc('server/discover')).body.result.capabilities.events);
 assert.deepEqual((await c.rpc('events/list')).body.result.events,[{name:'board.task_observed',delivery:['webhook']}]);
 const subscription=await c.subscribe();assert.equal(subscription.status,200);assert.equal(subscription.body.result.id,'synthetic-subscription');assert(!JSON.stringify(subscription).includes('whsec_'));
 const saved=await c.record();assert.equal(saved.body.result.structuredContent.version,1);assert.equal(saved.body.result.structuredContent.eventDelivery.accepted,1);
 assert.equal(c.siteDB.db.prepare('SELECT state FROM board_observation_outbox').get().state,'delivered');
 assert.deepEqual(c.received()[0].data,{projectId:'p',taskId:c.task.id,status:'partial'});
 assert(!JSON.stringify(c.received()).includes(c.event.changes.observation));
 await c.record();
 assert.equal(c.siteDB.db.prepare('SELECT COUNT(*) n FROM board_observation_outbox').get().n,1);
 assert.equal(c.received().length,1);assert.equal(c.requests.filter(row=>row.payload.action==='enqueue').length,1);
 assert.equal(c.siteDB.db.prepare('SELECT COUNT(*) n FROM dispatch_jobs').get().n,0);
});

test('source first-hop failure remains durable pending then explicit drain resumes without a new observation',async t=>{
 const c=setup(t);await c.subscribe();c.failWith('offline');
 const saved=await c.record();assert.equal(saved.body.result.structuredContent.version,1);assert.equal(saved.body.result.structuredContent.eventDelivery.pending,1);
 assert.equal(c.received().length,0);assert.equal(c.siteDB.db.prepare('SELECT state FROM board_observation_outbox').get().state,'pending');
 c.failWith(null);assert.equal((await c.drain()).accepted,1);assert.equal(c.received().length,1);
 assert.equal(c.siteDB.db.prepare('SELECT state FROM board_observation_outbox').get().state,'delivered');
});

test('task cancellation dominates observed status before leaving source; owner and audience gates block all bridge I/O',async t=>{
 const c=setup(t);await c.subscribe();const before=c.requests.length;
 assert.equal((await c.rpc('events/list',{},'wrong-owner')).status,403);
 assert.equal((await c.rpc('events/list',{},null)).status,401);
 assert.equal((await c.rpc('events/list',{},'synthetic-owner','https://other.example.com')).status,403);
 assert.equal(c.requests.length,before);
 await c.rpc('tools/call',{name:'set_task_execution_control',arguments:{taskId:c.task.id,expectedVersion:0,state:'canceled',reason:'Synthetic scope cancellation'}});
 await c.record();assert.equal(c.received()[0].data.status,'canceled');
 assert.equal(c.siteDB.db.prepare('SELECT COUNT(*) n FROM dispatch_jobs').get().n,0);
});

test('disabled configuration never advertises events or creates an outbox row or HTTP request',async t=>{
 const c=setup(t);c.env.DOT_BOARD_EVENT_BRIDGE_ENABLED='false';
 assert(!(await c.rpc('server/discover')).body.result.capabilities.events);
 await c.record();assert.equal(c.siteDB.db.prepare('SELECT COUNT(*) n FROM board_observation_outbox').get().n,0);
 assert.equal(c.requests.length,0);assert.equal(c.received().length,0);
});

for(const failure of ['rejected','redirect','malformed','oversized','missing-result','wrong-ack','lost-after-commit']){
 test(`the ${failure} first-hop response cannot falsely acknowledge the durable source event`,async t=>{
  const c=setup(t);await c.subscribe();c.failWith(failure);
  const saved=await c.record();assert.equal(saved.body.result.structuredContent.version,1);
  assert.deepEqual(saved.body.result.structuredContent.eventDelivery,{accepted:0,pending:1,automaticSourceRetry:false});
  assert.equal(c.siteDB.db.prepare('SELECT state FROM board_observation_outbox').get().state,'pending');
  assert.equal(c.received().length,['wrong-ack','lost-after-commit'].includes(failure)?1:0);
  c.failWith(null);assert.deepEqual(await c.drain(),{accepted:1,pending:0});
  assert.equal(c.received().length,1);assert.equal(c.siteDB.db.prepare('SELECT COUNT(*) n FROM board_observation_outbox').get().n,1);
  assert.equal(c.siteDB.db.prepare('SELECT state FROM board_observation_outbox').get().state,'delivered');
  const attempts=c.requests.filter(row=>row.payload.action==='enqueue');assert.equal(attempts.length,2);
  assert.deepEqual(attempts[0].payload,attempts[1].payload);assert.notEqual(attempts[0].requestId,attempts[1].requestId);
 });
}

test('bridge signatures bind the body, audience, timestamp and request identity',async()=>{
 const secret=btoa('synthetic-bridge-key'.padEnd(32,'0')),audience='https://relay.example.com/bridge',now=Date.now();
 const body=JSON.stringify({action:'events/list',ownerId:'synthetic-owner',params:{}});
 const headers=await bridgeHeaders({secret,audience,body,now});
 const request=(overrides={})=>new Request(audience,{method:'POST',headers:{...headers,...overrides},body});
 assert(await verifyBridge(request(),{secret,audience,body,now}));
 assert.equal(await verifyBridge(request(),{secret,audience,body:body+' ',now}),null);
 assert.equal(await verifyBridge(request(),{secret,audience:'https://other.example.com/bridge',body,now}),null);
 assert.equal(await verifyBridge(request(),{secret,audience,body,now:now+61000}),null);
 assert.equal(await verifyBridge(request({'x-board-bridge-id':'different-synthetic-request-id'}),{secret,audience,body,now}),null);
 assert.equal(await verifyBridge(request(),{secret:btoa('other-synthetic-key'.padEnd(32,'0')),audience,body,now}),null);
});

test('bridge refuses unconfigured, unsafe destinations and a different owner before sending',async t=>{
 const c=setup(t);
 for(const override of [
  {DOT_BOARD_EVENT_BRIDGE_ENABLED:'false'},
  {DOT_BOARD_EVENT_BRIDGE_SECRET:'invalid'},
  {DOT_BOARD_EVENT_BRIDGE_URL:'http://relay.example.com/bridge'},
  {DOT_BOARD_EVENT_BRIDGE_URL:'https://127.0.0.1/bridge'},
  {DOT_BOARD_EVENT_BRIDGE_URL:'https://relay.example.com/not-bridge'},
  {DOT_BOARD_EVENT_BRIDGE_URL:'https://relay.example.com/bridge?token=synthetic'},
  {DOT_BOARD_OWNER_ID:''}
 ]){
  const bridge=createSitesEventBridge({env:{...c.env,...override}});assert.equal(bridge.configured,false);
  await assert.rejects(bridge.list('synthetic-owner'),{code:'event_bridge_unconfigured'});
 }
 await assert.rejects(createSitesEventBridge({env:c.env}).list('wrong-owner'),{code:'event_access_denied'});
 assert.equal(c.requests.length,0);
});
