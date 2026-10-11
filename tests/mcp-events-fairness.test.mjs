import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteIntakeFixture} from './sqlite-intake-fixture.mjs';
import {createD1McpEventsStore} from '../src/adapters/d1-mcp-events.mjs';
import {createMcpEventsService} from '../src/application/mcp-events-service.mjs';
import {EVENT_LIMITS,PROJECT_REQUEST_CREATED} from '../src/domain/mcp-events.mjs';

const start=Date.parse('2026-10-11T12:00:00.000Z');
const owner='synthetic-fairness-owner',project='synthetic-fairness-project';
const secret='whsec_'+btoa('synthetic-fairness-key-not-a-secret');
const iso=time=>new Date(time).toISOString();

async function setup(t,{subscriptions=2}={}) {
  const fixture=sqliteIntakeFixture();t.after(()=>fixture.close());
  const store=createD1McpEventsStore(fixture.binding);
  const c={fixture,store,time:start,calls:[],status:204,sequence:0,subscriptions:[]};
  // All callback traffic stays in this synthetic transport; no network is opened.
  const transport={resolve:async()=>['93.184.216.34'],send:async q=>{
    const body=JSON.parse(q.body);
    if(body.type==='verification')return Response.json({challenge:body.challenge});
    c.calls.push({eventId:body.eventId,subscriptionId:q.headers['X-MCP-Subscription-Id']});
    return c.respond?c.respond(q,body):new Response(null,{status:c.status});
  }};
  c.service=createMcpEventsService({store,transport,clock:()=>iso(c.time),newId:()=>`synthetic-lease-${++c.sequence}`,authorize:async q=>q.ownerId===owner&&(q.action==='list'||q.arguments.projectId===project)});
  for(let i=0;i<subscriptions;i++)c.subscriptions.push(await c.service.subscribe(owner,{name:PROJECT_REQUEST_CREATED,arguments:{projectId:project},delivery:{mode:'webhook',url:`https://receiver.example.com/synthetic-fairness-${i}`,secret}}));
  c.enqueue=async id=>{const eventId=id+':created:v1';await c.service.enqueue({eventId,ownerId:owner,name:PROJECT_REQUEST_CREATED,arguments:{projectId:project},data:{requestId:id,projectId:project,version:1},createdAt:iso(c.time)});return eventId;};
  c.rows=()=>fixture.db.prepare('SELECT * FROM mcp_event_outbox ORDER BY next_attempt_at,event_id,subscription_id').all();
  return c;
}

test('two-slot preferred drains advance old pending and retry rows under continuous multi-subscription arrivals',async t=>{
  const c=await setup(t);
  const retry=await c.enqueue('synthetic-old-retry');c.status=503;
  assert.equal((await c.service.drain({limit:2})).retried,2);
  c.status=204;c.time+=2000;const pending=await c.enqueue('synthetic-old-pending');
  const rounds=[];
  for(let i=0;i<4;i++) {
    c.time+=1000;const preferredEventId=await c.enqueue('synthetic-fresh-'+i),before=c.calls.length;
    const result=await c.service.drain({limit:2,preferredEventId});
    assert.equal(result.processed,2);assert.equal(result.delivered,2);
    const calls=c.calls.slice(before);assert.equal(calls[1].eventId,preferredEventId);assert.notEqual(calls[0].eventId,preferredEventId);
    rounds.push(calls.map(call=>call.eventId));
  }
  const old=c.rows().filter(row=>[retry,pending].includes(row.event_id));
  t.diagnostic(JSON.stringify({rounds,old:old.map(row=>({eventId:row.event_id,state:row.state,attempts:row.attempts}))}));
  assert.equal(old.length,4);assert(old.every(row=>row.state==='delivered'),'older pending and retry rows must progress despite new events with two matching subscriptions');
  assert(old.filter(row=>row.event_id===retry).every(row=>row.attempts===2));
  assert(old.filter(row=>row.event_id===pending).every(row=>row.attempts===1));
});

test('limit one keeps advancing the oldest queue under continuous preferred arrivals',async t=>{
  const c=await setup(t),old=await c.enqueue('synthetic-single-slot-old');
  for(let i=0;i<2;i++) {
    c.time+=1000;const preferredEventId=await c.enqueue('synthetic-single-slot-new-'+i),before=c.calls.length;
    assert.equal((await c.service.drain({limit:1,preferredEventId})).delivered,1);
    assert.equal(c.calls[before].eventId,old);
  }
  assert(c.rows().filter(row=>row.event_id===old).every(row=>row.state==='delivered'));
});

test('default drain reserves one preferred slot and fills all remaining capacity from older due work',async t=>{
  const c=await setup(t);
  for(let i=0;i<30;i++) {await c.enqueue('synthetic-large-backlog-'+String(i).padStart(2,'0'));c.time+=1000;}
  const preferredEventId=await c.enqueue('synthetic-large-backlog-new');
  const result=await c.service.drain({preferredEventId});
  assert.equal(result.delivered,EVENT_LIMITS.maxDrain);
  assert.notEqual(c.calls[0].eventId,preferredEventId);assert.equal(c.calls[1].eventId,preferredEventId);
  assert.equal(c.calls.filter(call=>call.eventId===preferredEventId).length,1);
  assert.equal(new Set(c.calls.map(call=>JSON.stringify(call))).size,EVENT_LIMITS.maxDrain);
  assert.equal(c.rows().filter(row=>row.state==='pending').length,12);
});

for(const limit of [1,2,EVENT_LIMITS.maxDrain])test('no older backlog fills preferred subscriptions up to limit '+limit,async t=>{
  const c=await setup(t,{subscriptions:3}),preferredEventId=await c.enqueue('synthetic-only-new');
  const result=await c.service.drain({limit,preferredEventId});
  assert.equal(result.delivered,Math.min(limit,3));assert(c.calls.every(call=>call.eventId===preferredEventId));
  assert.equal(new Set(c.calls.map(call=>call.subscriptionId)).size,c.calls.length);
});

for(const preferredEventId of [null,'synthetic-absent:created:v1'])test('missing preferred work preserves FIFO and fills available slots: '+preferredEventId,async t=>{
  const c=await setup(t),old=await c.enqueue('synthetic-fifo-old');
  c.time+=1000;await c.enqueue('synthetic-fifo-later');
  assert.equal((await c.service.drain({limit:2,preferredEventId})).delivered,2);
  assert(c.calls.every(call=>call.eventId===old));
});

test('fair selection keeps retry and expired-lease order while excluding future, live, expired and exhausted work',async t=>{
  const c=await setup(t,{subscriptions:3});
  const retry=await c.enqueue('synthetic-filter-retry'),lease=await c.enqueue('synthetic-filter-expired-lease'),pending=await c.enqueue('synthetic-filter-pending');
  const future=await c.enqueue('synthetic-filter-future'),live=await c.enqueue('synthetic-filter-live-lease'),exhausted=await c.enqueue('synthetic-filter-exhausted');
  const preferredEventId=await c.enqueue('synthetic-filter-new');
  c.fixture.db.prepare("UPDATE mcp_event_outbox SET state='retry',attempts=1,next_attempt_at=? WHERE event_id=?").run(iso(start-3000),retry);
  c.fixture.db.prepare("UPDATE mcp_event_outbox SET state='delivering',attempts=1,next_attempt_at=?,lease_until=?,lease_token='synthetic-expired-token' WHERE event_id=?").run(iso(start-2000),iso(start-1),lease);
  c.fixture.db.prepare('UPDATE mcp_event_outbox SET next_attempt_at=? WHERE event_id=?').run(iso(start-1000),pending);
  c.fixture.db.prepare('UPDATE mcp_event_outbox SET next_attempt_at=? WHERE event_id=?').run(iso(start+60000),future);
  c.fixture.db.prepare("UPDATE mcp_event_outbox SET state='delivering',attempts=1,lease_until=?,lease_token='synthetic-live-token' WHERE event_id=?").run(iso(start+30000),live);
  c.fixture.db.prepare('UPDATE mcp_event_outbox SET attempts=? WHERE event_id=? OR (event_id=? AND subscription_id=?)').run(EVENT_LIMITS.maxAttempts,exhausted,preferredEventId,c.subscriptions[0].id);
  c.fixture.db.prepare('UPDATE mcp_event_subscriptions SET expires_at=? WHERE id=?').run(iso(start),c.subscriptions[2].id);
  assert.equal((await c.service.drain({limit:2,preferredEventId})).delivered,2);
  assert.deepEqual(c.calls.map(call=>call.eventId),[retry,preferredEventId]);
  assert.equal(c.calls[1].subscriptionId,c.subscriptions[1].id);
  const before=c.calls.length;assert.equal((await c.service.drain({preferredEventId})).delivered,5);
  assert.deepEqual(c.calls.slice(before).map(call=>call.eventId),[retry,lease,lease,pending,pending]);
  assert(!c.calls.some(call=>call.subscriptionId===c.subscriptions[2].id));
  const rows=c.rows();
  assert(rows.filter(row=>row.subscription_id===c.subscriptions[2].id).every(row=>row.state==='canceled'));
  assert(rows.filter(row=>row.event_id===future&&row.subscription_id!==c.subscriptions[2].id).every(row=>row.state==='pending'));
  assert(rows.filter(row=>row.event_id===live&&row.subscription_id!==c.subscriptions[2].id).every(row=>row.state==='delivering'));
  assert(rows.filter(row=>row.event_id===exhausted&&row.subscription_id!==c.subscriptions[2].id).every(row=>row.state==='failed'&&row.last_reason==='attempts_exhausted'));
  assert(rows.filter(row=>row.event_id===lease&&row.subscription_id!==c.subscriptions[2].id).every(row=>row.attempts===2));
});

test('concurrent preferred drainers still claim each subscription-event pair only once',async t=>{
  const c=await setup(t),old=await c.enqueue('synthetic-concurrent-old');
  c.time+=1000;const preferredEventId=await c.enqueue('synthetic-concurrent-new');
  const results=await Promise.all([c.service.drain({limit:2,preferredEventId}),c.service.drain({limit:2,preferredEventId})]);
  assert.equal(results.reduce((sum,result)=>sum+result.processed,0),2);
  assert.deepEqual(c.calls.map(call=>call.eventId),[old,preferredEventId]);
  assert.equal((await c.service.drain()).delivered,2);
  assert.equal(new Set(c.calls.map(call=>JSON.stringify(call))).size,4);
  assert(c.rows().every(row=>row.state==='delivered'&&row.attempts===1));
});

test('fairly selected expired lease is reclaimed without accepting the previous claim token',async t=>{
  const c=await setup(t,{subscriptions:1}),old=await c.enqueue('synthetic-fenced-old');
  const [item]=await c.store.due(iso(c.time),1,EVENT_LIMITS.maxAttempts);
  const original=await c.store.claim({...item,now:iso(c.time),leaseUntil:iso(c.time+EVENT_LIMITS.leaseMs),token:'synthetic-first-lease',maxAttempts:EVENT_LIMITS.maxAttempts});
  c.time+=EVENT_LIMITS.leaseMs+1;const preferredEventId=await c.enqueue('synthetic-fenced-new');
  const due=await c.store.due(iso(c.time),2,EVENT_LIMITS.maxAttempts,preferredEventId);
  assert.deepEqual(due.map(row=>row.eventId),[old,preferredEventId]);
  const replacement=await c.store.claim({...due[0],now:iso(c.time),leaseUntil:iso(c.time+EVENT_LIMITS.leaseMs),token:'synthetic-replacement-lease',maxAttempts:EVENT_LIMITS.maxAttempts});
  assert.equal(replacement.attempts,2);
  const finish=job=>c.store.finish({...job,state:'delivered',nextAttemptAt:iso(c.time),now:iso(c.time)});
  assert.equal(await finish(original),false);assert.equal(c.rows().find(row=>row.event_id===old).lease_token,replacement.token);
  assert.equal(await finish(replacement),true);
});

test('budget-limited actual drains advance backlog before storage and a slow preferred callback exhaust each invocation',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const c=await setup(t),retry=await c.enqueue('synthetic-budget-old-retry');c.status=503;
  assert.equal((await c.service.drain({limit:2})).retried,2);
  c.status=204;c.time+=2000;const pending=await c.enqueue('synthetic-budget-old-pending');let aborted=0;
  // Deterministic latency: real SQLite maintenance consumes 20 of the 25 seconds.
  const maintain=c.store.maintain;
  c.store.maintain=async(...args)=>{await maintain(...args);t.mock.timers.tick(20000);};
  c.respond=(q,body)=>body.eventId.startsWith('synthetic-budget-new-')?new Promise((resolve,reject)=>{
    q.signal.addEventListener('abort',()=>{aborted++;reject(Object.assign(Error('synthetic timeout'),{name:'AbortError'}));},{once:true});
    queueMicrotask(()=>t.mock.timers.tick(5000));
  }):new Response(null,{status:204});
  for(let i=0;i<4;i++) {
    c.time+=1000;const preferredEventId=await c.enqueue('synthetic-budget-new-'+i),before=c.calls.length;
    const result=await c.service.drain({limit:2,preferredEventId,budgetMs:25000});
    assert.equal(result.budgetExhausted,true);assert.equal(result.delivered,1);
    assert.deepEqual(c.calls.slice(before).map(call=>call.eventId),[i<2?retry:pending,preferredEventId]);
  }
  assert.equal(aborted,4);
  assert(c.rows().filter(row=>[retry,pending].includes(row.event_id)).every(row=>row.state==='delivered'));
  assert.equal(c.rows().filter(row=>row.state==='delivering').length,4);
});
