import test from 'node:test';
import assert from 'node:assert/strict';
import {createSitesEventBridge, drainSourceObservations} from '../src/adapters/sites-event-bridge.mjs';
import {verifyBridge} from '../src/adapters/event-bridge-auth.mjs';
import {createD1BoardObservationOutbox} from '../src/adapters/d1-board-observation-outbox.mjs';
import {createD1BoardObservationStore} from '../src/adapters/d1-board-observations.mjs';
import {createBoardObservationService} from '../src/application/board-observation-service.mjs';
import {sqliteIntakeFixture} from './sqlite-intake-fixture.mjs';

// Offline adapter/outbox contract tests only. The injected fetcher returns
// protocol fixtures: it is NOT a relay implementation, durable remote queue,
// callback verifier, production connection, or evidence of end-to-end delivery.
// The key, owner, IDs and domains below are synthetic, and no network is used.
const OWNER='synthetic-contract-owner';
const TARGET='https://relay.example.com/bridge';
const SECRET=btoa('synthetic-contract-key'.padEnd(32,'0'));
const INITIAL_TIME=Date.parse('2026-10-08T07:00:00.000Z');
const envFor=(changes={})=>({DOT_BOARD_EVENT_BRIDGE_ENABLED:'true',DOT_BOARD_EVENT_BRIDGE_URL:TARGET,DOT_BOARD_EVENT_BRIDGE_SECRET:SECRET,DOT_BOARD_OWNER_ID:OWNER,...changes});
const eventFor=(changes={})=>({eventId:'board-observed:'+'a'.repeat(64),name:'board.task_observed',timestamp:'2026-10-08T06:59:00.000Z',data:{projectId:'synthetic-project',taskId:'synthetic-task',status:'partial'},...changes});
const errorCode=(code,status,rpcCode)=>error=>error.code===code&&error.status===status&&error.rpcCode===rpcCode;
const bridgeFor=fetcher=>createSitesEventBridge({env:envFor(),clock:()=>INITIAL_TIME,fetcher});

test('unconfigured, disabled and invalid bridge destinations reject before invoking any transport',async()=>{
  let calls=0;
  const variants=[{},envFor({DOT_BOARD_EVENT_BRIDGE_ENABLED:undefined}),envFor({DOT_BOARD_EVENT_BRIDGE_ENABLED:'false'}),envFor({DOT_BOARD_EVENT_BRIDGE_ENABLED:true}),envFor({DOT_BOARD_EVENT_BRIDGE_ENABLED:'TRUE'}),envFor({DOT_BOARD_OWNER_ID:''}),envFor({DOT_BOARD_EVENT_BRIDGE_SECRET:'not-a-key'}),envFor({DOT_BOARD_EVENT_BRIDGE_SECRET:btoa('short')})];
  for(const url of ['http://relay.example.com/bridge','https://relay.example.com/other','https://relay.example.com/bridge?query=1','https://relay.example.com/bridge#fragment','https://user:password@relay.example.com/bridge','https://127.0.0.1/bridge','https://relay.internal/bridge','https://relay.example.com:444/bridge'])variants.push(envFor({DOT_BOARD_EVENT_BRIDGE_URL:url}));
  for(const env of variants){const bridge=createSitesEventBridge({env,fetcher:async()=>{calls++;throw Error('Unexpected protocol fixture invocation');}});assert.equal(bridge.configured,false);await assert.rejects(bridge.list(OWNER),errorCode('event_bridge_unconfigured',503,-32603));}
  assert.equal(calls,0);
});

test('adapter exact-owner rejection covers every action without accepting caller identity claims',async()=>{
  let calls=0;const bridge=bridgeFor(async()=>{calls++;return Response.json({result:{}});});assert.equal(bridge.configured,true);
  for(const owner of [undefined,null,'', 'another-owner',OWNER+' ',{ownerId:OWNER}]){
    for(const invoke of [()=>bridge.list(owner),()=>bridge.subscribe(owner,{ownerId:OWNER}),()=>bridge.unsubscribe(owner,{ownerId:OWNER}),()=>bridge.enqueue(owner,eventFor())])await assert.rejects(invoke(),errorCode('event_access_denied',403,-32012));
  }
  assert.equal(calls,0);
});

test('protocol fixture receives fixed POST, denied redirects, bounded signal and verified signed body',async()=>{
  const calls=[];const bridge=bridgeFor(async(url,options)=>{
    calls.push(JSON.parse(options.body));assert.equal(url,TARGET);assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert(options.signal instanceof AbortSignal);assert.equal(options.signal.aborted,false);
    const request=new Request(url,options);assert(await verifyBridge(request,{secret:SECRET,audience:TARGET,body:options.body,now:INITIAL_TIME}));assert.equal(await verifyBridge(request,{secret:SECRET,audience:TARGET,body:options.body+' ',now:INITIAL_TIME}),null);
    assert(!Object.values(options.headers).includes(SECRET));return Response.json({result:{fixture:true}});
  });
  assert.deepEqual(await bridge.list(OWNER),{fixture:true});await bridge.subscribe(OWNER,{name:'synthetic-event'});await bridge.unsubscribe(OWNER,{name:'synthetic-event'});await bridge.enqueue(OWNER,eventFor());
  assert.deepEqual(calls.map(call=>call.action),['events/list','events/subscribe','events/unsubscribe','enqueue']);assert(calls.every(call=>call.ownerId===OWNER));
});

test('enqueue protocol envelope preserves exact minimal outbox payload without forwarding unrelated fields',async()=>{
  let sent;const event=eventFor({cursor:'synthetic-private-cursor',observation:'Synthetic full source text',source:{threadId:'synthetic-thread'}}),before=structuredClone(event);
  const bridge=bridgeFor(async(url,options)=>{sent=JSON.parse(options.body);return Response.json({result:{eventId:event.eventId}});});await bridge.enqueue(OWNER,event);
  assert.deepEqual(sent,{action:'enqueue',ownerId:OWNER,params:{eventId:event.eventId,ownerId:OWNER,name:event.name,arguments:{projectId:event.data.projectId},data:event.data,createdAt:event.timestamp}});assert.deepEqual(event,before);
  assert(!JSON.stringify(sent).includes(event.cursor));assert(!JSON.stringify(sent).includes(event.observation));assert(!JSON.stringify(sent).includes('threadId'));
});

test('request payload limit is exact and measured in UTF-8 bytes before transport',async()=>{
  let calls=0;const bridge=bridgeFor(async()=>{calls++;return Response.json({result:{}});});
  const emptySize=new TextEncoder().encode(JSON.stringify({action:'events/subscribe',ownerId:OWNER,params:{body:''}})).length;
  await bridge.subscribe(OWNER,{body:'x'.repeat(32768-emptySize)});assert.equal(calls,1);
  await assert.rejects(bridge.subscribe(OWNER,{body:'x'.repeat(32769-emptySize)}),errorCode('event_payload_too_large',400,-32602));
  await assert.rejects(bridge.subscribe(OWNER,{body:'汉'.repeat(12000)}),errorCode('event_payload_too_large',400,-32602));assert.equal(calls,1);
});

test('HTTP redirects and already-followed responses are rejected and their bodies are canceled',async()=>{
  for(const variant of [{status:301},{status:302},{status:307},{status:308},{status:200,redirected:true}]){
    let canceled=0;const body=new ReadableStream({cancel(){canceled++;}}),response=new Response(body,{status:variant.status});if(variant.redirected)Object.defineProperty(response,'redirected',{value:true});
    await assert.rejects(bridgeFor(async()=>response).list(OWNER),errorCode('event_bridge_redirect',503,-32603));assert.equal(canceled,1);
  }
});

test('response byte cap accepts exactly 16 KiB and rejects larger ASCII or UTF-8 bodies',async()=>{
  const wrapperBytes=new TextEncoder().encode(JSON.stringify({result:''})).length;
  const boundary='x'.repeat(16384-wrapperBytes);assert.equal(await bridgeFor(async()=>Response.json({result:boundary})).list(OWNER),boundary);
  for(const result of ['x'.repeat(16385-wrapperBytes),'汉'.repeat(6000)])await assert.rejects(bridgeFor(async()=>Response.json({result})).list(OWNER),errorCode('event_bridge_invalid_response',503,-32603));
});

test('streamed response limit is cumulative and cancellation occurs on excess bytes',async()=>{
  let read=0,canceled=0;
  const response={ok:true,status:200,redirected:false,body:{getReader(){return {async read(){read++;return {done:false,value:new Uint8Array(9000)};},async cancel(){canceled++;}};}}};
  await assert.rejects(bridgeFor(async()=>response).list(OWNER),errorCode('event_bridge_invalid_response',503,-32603));assert.equal(read,2);assert.equal(canceled,1);
});

test('streaming decoder preserves a multibyte character split across response chunks',async()=>{
  const expected={fixture:'汉字🙂'},bytes=new TextEncoder().encode(JSON.stringify({result:expected}));let index=0,canceled=0;
  const response={ok:true,status:200,redirected:false,body:{getReader(){return {async read(){if(index>=bytes.length)return {done:true};const value=bytes.slice(index,index+1);index++;return {done:false,value};},async cancel(){canceled++;}};}}};
  assert.deepEqual(await bridgeFor(async()=>response).list(OWNER),expected);assert.equal(canceled,1);
});

test('absent, malformed, incomplete and unreadable response bodies fail closed',async()=>{
  for(const makeResponse of [()=>new Response(null),()=>new Response(''),()=>new Response('{bad json'),()=>Response.json(null),()=>Response.json({other:'field'}),()=>new Response(new ReadableStream({start(controller){controller.error(Error('Synthetic read failure'));}}))])await assert.rejects(bridgeFor(async()=>makeResponse()).list(OWNER),errorCode('event_bridge_invalid_response',503,-32603));
});

test('transport failures and remote error envelopes expose only bounded error categories',async()=>{
  await assert.rejects(bridgeFor(async()=>{throw Error('Synthetic transport failure containing private detail');}).list(OWNER),errorCode('event_bridge_unreachable',503,-32603));
  await assert.rejects(bridgeFor(async()=>Response.json({rpcCode:-32012,private:'synthetic detail'},{status:403})).list(OWNER),errorCode('event_access_denied',403,-32012));
  for(const reason of ['connection_refused','timeout','tls_error','challenge_failed','http_4xx','http_5xx'])await assert.rejects(bridgeFor(async()=>Response.json({rpcCode:-32015,data:{reason,private:'synthetic detail'}},{status:502})).list(OWNER),error=>errorCode('event_callback_failed',502,-32015)(error)&&JSON.stringify(error.data)===JSON.stringify({reason}));
  await assert.rejects(bridgeFor(async()=>Response.json({rpcCode:-32015,data:{reason:'unrecognized-private-text'}},{status:502})).list(OWNER),error=>errorCode('event_bridge_rejected',503,-32603)(error)&&error.data===undefined);
});

async function outboxFixture(t,{count=1}={}){
  const sql=sqliteIntakeFixture();t.after(()=>sql.close());let ms=INITIAL_TIME;
  const clock=()=>new Date(ms).toISOString(),outbox=createD1BoardObservationOutbox(sql.binding,{clock}),store=createD1BoardObservationStore(sql.binding,{clock,observationOutbox:outbox}),service=createBoardObservationService({store,clock});
  const snapshot={tasks:[{id:'synthetic-task',title:'Synthetic task',project:'Synthetic project',state:'unknown',observedAt:'2026-10-08T06:00:00.000Z'}],agents:[]},bindings=[{taskId:'synthetic-task',threadId:'synthetic-thread',environment:null,readAllowed:true}],registry=[{id:'synthetic-project',name:'Synthetic project',aliases:[],executionState:'deferred'}];
  for(let i=0;i<count;i++)await service.record(OWNER,{taskId:'synthetic-task',eventId:'synthetic-observation-'+i,expectedVersion:i,source:{threadId:'synthetic-thread',environment:null,turnId:'synthetic-turn',itemId:'synthetic-item-'+i,observedAt:new Date(INITIAL_TIME-60000+i*1000).toISOString()},changes:{state:'partial',observation:'Synthetic source detail '+i}},snapshot,bindings,registry);
  // Guard every execution-related table, so even a temporary write would fail.
  const executionTables=sql.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'dispatch_%' OR name='native_dispatch_journal') ORDER BY name").all().map(row=>row.name);
  for(const table of executionTables)for(const operation of ['INSERT','UPDATE','DELETE'])sql.db.exec(`CREATE TEMP TRIGGER contract_no_${table}_${operation} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'Synthetic test forbids execution writes'); END`);
  const sourceBefore=sql.db.prepare('SELECT * FROM board_observation_events ORDER BY version').all();
  const unchanged=()=>{assert.deepEqual(sql.db.prepare('SELECT * FROM board_observation_events ORDER BY version').all(),sourceBefore);for(const table of executionTables)assert.equal(sql.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0,table);};
  return {...sql,outbox,clock:()=>ms,setNow:value=>{ms=value;},advance:value=>{ms+=value;},unchanged,rows:()=>sql.db.prepare('SELECT * FROM board_observation_outbox ORDER BY event_id').all(),drain:bridge=>drainSourceObservations({ownerId:OWNER,outbox,bridge,clock:()=>ms})};
}

test('matching protocol ACK commits delivered only after the reply and never writes dispatch or source observations',async t=>{
  const f=await outboxFixture(t),eventId=f.rows()[0].event_id;let calls=0;
  const bridge=bridgeFor(async(url,options)=>{calls++;assert.equal(f.rows()[0].state,'delivering');assert.equal(f.rows()[0].delivered_at,null);return Response.json({result:{eventId:JSON.parse(options.body).params.eventId}});});
  assert.deepEqual(await f.drain(bridge),{accepted:1,pending:0});const row=f.rows()[0];assert.equal(row.event_id,eventId);assert.equal(row.state,'delivered');assert.equal(row.delivered_at,new Date(INITIAL_TIME).toISOString());assert.equal(row.lease_token,null);assert.equal(row.lease_until,null);assert.deepEqual(await f.drain(bridge),{accepted:0,pending:0});assert.equal(calls,1);f.unchanged();
});

test('missing or mismatched protocol ACK stays pending and retry preserves exact event identity',async t=>{
  for(const ack of [null,{}, {eventId:'different-event'}]){
    const f=await outboxFixture(t),before=(await f.outbox.get(OWNER,f.rows()[0].event_id)).event,sent=[];let response=ack;
    const bridge=bridgeFor(async(url,options)=>{sent.push(JSON.parse(options.body));return Response.json({result:response});});
    assert.deepEqual(await f.drain(bridge),{accepted:0,pending:1});let row=f.rows()[0];assert.equal(row.state,'pending');assert.equal(row.delivered_at,null);assert.equal(row.attempts,1);assert.equal(row.lease_token,null);assert.equal(row.next_attempt_at,new Date(INITIAL_TIME+2000).toISOString());assert.deepEqual(await f.drain(bridge),{accepted:0,pending:0});
    response={eventId:row.event_id};f.setNow(Date.parse(row.next_attempt_at));assert.deepEqual(await f.drain(bridge),{accepted:1,pending:0});row=f.rows()[0];assert.equal(row.state,'delivered');assert.equal(row.attempts,2);assert.deepEqual(sent[0],sent[1]);assert.deepEqual((await f.outbox.get(OWNER,row.event_id)).event,before);f.unchanged();
  }
});

test('offline, redirect, denied and invalid first hops remain retryable without recording delivered',async t=>{
  const fixtures=[async()=>{throw Error('Synthetic offline transport');},async()=>new Response('redirect',{status:302}),async()=>Response.json({rpcCode:-32012},{status:403}),async()=>new Response('{malformed'),async()=>Response.json({result:'x'.repeat(16385)})];
  for(const fetcher of fixtures){const f=await outboxFixture(t);assert.deepEqual(await f.drain(bridgeFor(fetcher)),{accepted:0,pending:1});const row=f.rows()[0];assert.equal(row.state,'pending');assert.equal(row.delivered_at,null);assert.equal(row.lease_token,null);f.setNow(Date.parse(row.next_attempt_at));assert.equal((await f.outbox.due(OWNER)).length,1);f.unchanged();}
});

test('disabled bridge leaves committed source event retryable and does not fabricate delivery',async t=>{
  const f=await outboxFixture(t);let calls=0;const bridge=createSitesEventBridge({env:envFor({DOT_BOARD_EVENT_BRIDGE_ENABLED:'false'}),fetcher:async()=>{calls++;throw Error('Unexpected transport invocation');}});
  assert.deepEqual(await f.drain(bridge),{accepted:0,pending:1});assert.equal(calls,0);assert.equal(f.rows()[0].state,'pending');f.unchanged();
});

test('drain obeys owner scope, batch limit and an already claimed lease',async t=>{
  const f=await outboxFixture(t,{count:3});let calls=0;const bridge=bridgeFor(async(url,options)=>{calls++;return Response.json({result:{eventId:JSON.parse(options.body).params.eventId}});});
  assert.deepEqual(await drainSourceObservations({ownerId:'another-owner',outbox:f.outbox,bridge,clock:f.clock}),{accepted:0,pending:0});assert.equal(calls,0);
  const held=await f.outbox.claim(OWNER,f.rows()[0].event_id);assert(held);assert.deepEqual(await drainSourceObservations({ownerId:OWNER,outbox:f.outbox,bridge,limit:1,clock:f.clock}),{accepted:1,pending:0});assert.equal(calls,1);assert.deepEqual(f.rows().map(row=>row.state).sort(),['delivered','delivering','pending']);f.unchanged();
});

test('repeated unsuccessful attempts use bounded backoff and never create a new source event',async t=>{
  const f=await outboxFixture(t),id=f.rows()[0].event_id;const bridge=bridgeFor(async()=>{throw Error('Synthetic offline transport');});
  for(let attempt=1;attempt<=8;attempt++){const start=f.clock();assert.deepEqual(await f.drain(bridge),{accepted:0,pending:1});const row=f.rows()[0];assert.equal(row.event_id,id);assert.equal(row.attempts,attempt);assert.equal(Date.parse(row.next_attempt_at)-start,Math.min(60000,1000*2**Math.min(attempt,6)));f.setNow(Date.parse(row.next_attempt_at));}
  assert.equal(f.rows().length,1);assert.equal(f.rows()[0].state,'pending');f.unchanged();
});

test('lost claim race is skipped without calling the bridge or acknowledging another lease',async()=>{
  let calls=0;const outbox={due:async()=>[{eventId:'synthetic-event'}],claim:async()=>null,ack:async()=>{throw Error('Unexpected ACK');},retry:async()=>{throw Error('Unexpected retry');}},bridge={enqueue:async()=>{calls++;}};
  assert.deepEqual(await drainSourceObservations({ownerId:OWNER,outbox,bridge}),{accepted:0,pending:0});assert.equal(calls,0);
});

test('expired local ACK lease must not be reported as accepted and remains recoverable',async t=>{
  const f=await outboxFixture(t),bridge=bridgeFor(async(url,options)=>{f.advance(30000);return Response.json({result:{eventId:JSON.parse(options.body).params.eventId}});});
  const result=await f.drain(bridge),row=f.rows()[0];assert.equal(row.state,'delivering');assert.equal(row.delivered_at,null);assert.equal((await f.outbox.due(OWNER)).length,1);f.unchanged();
  const retryBridge=bridgeFor(async(url,options)=>Response.json({result:{eventId:JSON.parse(options.body).params.eventId}}));assert.deepEqual(await f.drain(retryBridge),{accepted:1,pending:0});assert.equal(f.rows()[0].state,'delivered');assert.equal(f.rows()[0].event_id,row.event_id);assert.equal(f.rows()[0].attempts,2);f.unchanged();
  // Regression: a matching remote protocol fixture is insufficient when the
  // local leased acknowledgement did not persist.
  assert.deepEqual(result,{accepted:0,pending:1},'A false local outbox ACK cannot count as accepted');
});

test('stale ACK cannot retry, release or overwrite a newer claimant lease',async t=>{
  const f=await outboxFixture(t),id=f.rows()[0].event_id;let newerClaim,claimedRow,retryCalls=0;
  const bridge=bridgeFor(async()=>{
    f.advance(30000);newerClaim=await f.outbox.claim(OWNER,id);assert(newerClaim);claimedRow=f.rows()[0];assert.equal(claimedRow.attempts,2);assert.equal(claimedRow.state,'delivering');
    return Response.json({result:{eventId:id}});
  });
  const observedOutbox={...f.outbox,retry:async(...args)=>{retryCalls++;return f.outbox.retry(...args);}};
  const result=await drainSourceObservations({ownerId:OWNER,outbox:observedOutbox,bridge,clock:f.clock});
  assert.deepEqual(result,{accepted:0,pending:1});assert.equal(retryCalls,0);assert.deepEqual(f.rows()[0],claimedRow);assert.deepEqual(await f.outbox.due(OWNER),[]);
  assert.equal(await f.outbox.ack(OWNER,id,newerClaim.leaseToken),true);assert.equal(f.rows()[0].state,'delivered');assert.equal(f.rows()[0].attempts,2);f.unchanged();
});

test('only a literal persisted ACK success increments accepted without a second enqueue or retry',async()=>{
  for(const persisted of [false,undefined,null,true]){
    let enqueues=0,retries=0,acks=0;const event=eventFor(),outbox={due:async()=>[{eventId:event.eventId}],claim:async()=>({event,leaseToken:'synthetic-token',attempts:1}),ack:async()=>{acks++;return persisted;},retry:async()=>{retries++;}},bridge={enqueue:async()=>{enqueues++;return {eventId:event.eventId};}};
    assert.deepEqual(await drainSourceObservations({ownerId:OWNER,outbox,bridge}),{accepted:persisted===true?1:0,pending:persisted===true?0:1});assert.equal(enqueues,1);assert.equal(acks,1);assert.equal(retries,0);
  }
});
