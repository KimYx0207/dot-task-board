import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {sqliteIntakeFixture} from './sqlite-intake-fixture.mjs';
import {createD1McpEventsStore} from '../src/adapters/d1-mcp-events.mjs';
import {createMcpEventsService} from '../src/application/mcp-events-service.mjs';
import {EVENT_LIMITS,PROJECT_REQUEST_CREATED,signStandardWebhook,verifyStandardWebhook,validateCallbackUrl,isPublicCallbackAddress} from '../src/domain/mcp-events.mjs';

// Deliberately synthetic keys and addresses; the suite never opens a network socket.
const secret='whsec_'+btoa('synthetic-key-one-not-a-secret-0001');
const secret2='whsec_'+btoa('synthetic-key-two-not-a-secret-0002');
const owner='synthetic-owner';
const project='synthetic-project';
const url='https://receiver.example.com/synthetic-events';
const start=Date.parse('2026-10-07T12:00:00.000Z');
const params=(extra={})=>({name:PROJECT_REQUEST_CREATED,arguments:{projectId:project},delivery:{mode:'webhook',url,secret},cursor:null,...extra});
const unsubscribeParams=(overrides={})=>({name:PROJECT_REQUEST_CREATED,arguments:{projectId:project},delivery:{mode:'webhook',url},...overrides});
const event=(id='synthetic-request-1',extra={})=>({eventId:id+':created:v1',ownerId:owner,name:PROJECT_REQUEST_CREATED,arguments:{projectId:project},data:{requestId:id,projectId:project,version:1},createdAt:new Date(start).toISOString(),...extra});

function setup(t,{filename,fixture=sqliteIntakeFixture(filename),time=start}={}) {
  t.after(()=>{try{fixture.close();}catch{/* Already closed for restart tests. */}});
  const ctx={fixture,time,sequence:0,calls:[],addresses:['93.184.216.34'],allowed:true,keys:[secret],owners:new Set([owner]),response:null};
  const store=createD1McpEventsStore(fixture.binding);
  const authorize=async q=>ctx.allowed&&ctx.owners.has(q.ownerId)&&(q.action==='list'||q.arguments.projectId===project);
  const transport={
    async resolve(hostname,{signal}) {assert.equal(hostname,'receiver.example.com');assert.equal(signal.aborted,false);return ctx.addresses;},
    async send(q) {
      assert.equal(q.address,'93.184.216.34');assert.equal(q.hostname,'receiver.example.com');assert.equal(q.redirect,'error');assert.equal(q.method,'POST');
      const body=JSON.parse(q.body);
      const valid=(await Promise.all(ctx.keys.map(key=>verifyStandardWebhook({secret:key,id:q.headers['webhook-id'],timestamp:q.headers['webhook-timestamp'],signature:q.headers['webhook-signature'],body:q.body,nowMs:ctx.time})))).some(Boolean);
      ctx.calls.push({...q,parsed:body});
      if(!valid)return new Response('synthetic signature rejection',{status:401});
      if(ctx.response)return ctx.response(q,body);
      return body.type==='verification'?Response.json({challenge:body.challenge}):new Response(null,{status:204});
    }
  };
  const options={store,transport,clock:()=>new Date(ctx.time).toISOString(),newId:()=>`synthetic-id-${++ctx.sequence}`,authorize};
  Object.assign(ctx,{store,transport,authorize,options,service:createMcpEventsService(options),rows:()=>fixture.db.prepare('SELECT * FROM mcp_event_outbox ORDER BY event_id').all(),subs:()=>fixture.db.prepare('SELECT id,active,expires_at FROM mcp_event_subscriptions').all(),deliveries:()=>ctx.calls.filter(c=>c.parsed.type!=='verification'),verifications:()=>ctx.calls.filter(c=>c.parsed.type==='verification')});
  return ctx;
}

test('authenticated catalog; deterministic owner-scoped identity and idempotent refresh',async t=>{
  const c=setup(t);
  await assert.rejects(c.service.list(null),{code:'authentication_required'});
  await assert.rejects(c.service.list('unknown-owner'),{code:'event_access_denied'});
  const catalog=await c.service.list(owner);assert.equal(catalog.events[0].name,PROJECT_REQUEST_CREATED);assert.deepEqual(catalog.events[0].delivery,['webhook']);
  const first=await c.service.subscribe(owner,params({ttlMs:60000}));c.time+=1000;
  const next=await c.service.subscribe(owner,params({ttlMs:120000}));
  assert.equal(next.id,first.id);assert.equal(c.subs().length,1);assert.equal(c.verifications().length,1);assert.equal(Date.parse(next.refreshBefore),c.time+120000);assert.equal(next.cursor,null);
  c.owners.add('synthetic-other-owner');const other=await c.service.subscribe('synthetic-other-owner',params());assert.notEqual(other.id,first.id);assert.equal(c.verifications().length,2);
  assert(!JSON.stringify([catalog,first,next]).includes(secret));assert(!JSON.stringify([catalog,first,next]).includes(owner));
});

test('owner and project filters constrain discovery, subscriptions and outbox delivery',async t=>{
  const c=setup(t);await c.service.subscribe(owner,params());
  await assert.rejects(c.service.subscribe(owner,params({arguments:{projectId:'other-project'}})),{code:'event_access_denied'});
  await assert.rejects(c.service.enqueue(event('unauthorized',{ownerId:'unknown-owner'})),{code:'event_access_denied'});
  await c.store.enqueue(event('wrong-project',{arguments:{projectId:'other-project'},data:{requestId:'wrong-project',projectId:'other-project',version:1}}));
  await c.store.enqueue(event('wrong-owner',{ownerId:'unknown-owner'}));assert.equal(c.rows().length,0);
  await c.service.enqueue(event());assert.equal((await c.service.drain()).delivered,1);assert.equal(c.deliveries().length,1);
  assert.deepEqual(Object.keys(c.deliveries()[0].parsed.data).sort(),['projectId','requestId','version']);
});

test('missing authorization and transport fail closed, with no global fetch fallback',async t=>{
  const c=setup(t);const denied=createMcpEventsService({store:c.store});await assert.rejects(denied.list(owner),{code:'event_access_denied'});
  const disabled=createMcpEventsService({...c.options,transport:undefined});await assert.rejects(disabled.subscribe(owner,params()),{code:'event_transport_disabled'});
  assert.deepEqual(await disabled.drain(),{processed:0,delivered:0,retried:0,failed:0,canceled:0,disabled:true});assert.equal(c.calls.length,0);
});

test('signed callback challenge rejects echo mismatch, signature rejection and old challenge replay',async t=>{
  const c=setup(t);c.response=()=>Response.json({challenge:'wrong'});
  await assert.rejects(c.service.subscribe(owner,params()),e=>e.rpcCode===-32015&&e.data.reason==='challenge_failed');assert.equal(c.subs().length,0);
  c.response=null;c.keys=[secret2];await assert.rejects(c.service.subscribe(owner,params()),e=>e.rpcCode===-32015&&e.data.reason==='http_4xx');assert.equal(c.subs().length,0);
  c.keys=[secret];await c.service.subscribe(owner,params());const old=c.verifications().at(-1).parsed.challenge;c.time+=EVENT_LIMITS.verificationMs+1;
  c.response=()=>Response.json({challenge:old});await assert.rejects(c.service.subscribe(owner,params()),e=>e.data.reason==='challenge_failed');
  assert.notEqual(c.verifications().at(-1).parsed.challenge,old);
});

test('callback syntax and every resolved address are validated before send; redirects fail closed',async t=>{
  for(const unsafe of ['http://receiver.example.com','https://127.0.0.1','https://2130706433','https://0x7f000001','https://[::1]','https://receiver.local','https://localhost','https://user:pass@receiver.example.com','https://receiver.example.com/#fragment','https://receiver.example.com:8443'])assert.throws(()=>validateCallbackUrl(unsafe));
  for(const address of ['127.0.0.1','10.0.0.1','100.64.1.1','169.254.169.254','172.16.1.1','192.168.1.1','198.18.0.1','203.0.113.1','224.0.0.1','::1','::ffff:127.0.0.1','2606:4700:4700::1111'])assert.equal(isPublicCallbackAddress(address),false,address);
  const c=setup(t);c.addresses=['93.184.216.34','10.0.0.1'];await assert.rejects(c.service.subscribe(owner,params()),{code:'unsafe_callback_destination'});assert.equal(c.calls.length,0);
  c.addresses=['93.184.216.34'];c.response=()=>new Response(null,{status:302,headers:{location:'https://127.0.0.1/'}});await assert.rejects(c.service.subscribe(owner,params()),{code:'callback_redirect_rejected'});
  c.response=null;await c.service.subscribe(owner,params());await c.service.enqueue(event());const count=c.calls.length;c.addresses=['169.254.169.254'];const result=await c.service.drain();assert.equal(result.failed,1);assert.equal(c.calls.length,count);assert.equal(c.rows()[0].last_reason,'unsafe_callback_destination');
});

test('Standard Webhooks signatures match independent HMAC and reject tampering and stale replay',async()=>{
  const body='{"eventId":"synthetic-event","data":{"version":1}}',id='synthetic-event',timestamp=String(start/1000);
  const signed=await signStandardWebhook(secret,id,timestamp,body);
  const independentlySigned=createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(`${id}.${timestamp}.${body}`).digest('base64');assert.equal(signed,'v1,'+independentlySigned);
  const input={secret,id,timestamp,body,signature:signed,nowMs:start};assert.equal(await verifyStandardWebhook(input),true);
  assert.equal(await verifyStandardWebhook({...input,body:body+' '}),false);assert.equal(await verifyStandardWebhook({...input,id:'another'}),false);assert.equal(await verifyStandardWebhook({...input,nowMs:start+301000}),false);assert.equal(await verifyStandardWebhook({...input,signature:'v1,invalid'}),false);
});

test('durable event idempotency rejects conflicting reuse and never backfills a later subscription',async t=>{
  const c=setup(t);await c.service.enqueue(event('before-subscription'));await c.service.subscribe(owner,params());await c.service.enqueue(event('before-subscription'));assert.equal(c.rows().length,0);
  await Promise.all(Array.from({length:5},()=>c.service.enqueue(event())));assert.equal(c.rows().length,1);
  await assert.rejects(c.service.enqueue(event('synthetic-request-1',{data:{requestId:'different',projectId:project,version:1}})),{code:'event_id_conflict'});
  await c.service.drain();await c.service.enqueue(event());await c.service.drain();assert.equal(c.deliveries().length,1);
});

test('transient retries preserve event identity/body and refresh signature; attempts are bounded',async t=>{
  const c=setup(t);await c.service.subscribe(owner,params());await c.service.enqueue(event());c.response=()=>new Response(null,{status:503});
  for(let i=1;i<=EVENT_LIMITS.maxAttempts;i++) {const result=await c.service.drain();assert.equal(result.processed,1);assert.equal(c.rows()[0].attempts,i);c.time=Date.parse(c.rows()[0].next_attempt_at);}
  assert.equal(c.rows()[0].state,'failed');assert.equal(c.rows()[0].last_reason,'attempts_exhausted');assert.equal((await c.service.drain()).processed,0);
  assert.equal(new Set(c.deliveries().map(x=>x.headers['webhook-id'])).size,1);assert.equal(new Set(c.deliveries().map(x=>x.body)).size,1);assert.equal(new Set(c.deliveries().map(x=>x.headers['webhook-signature'])).size,EVENT_LIMITS.maxAttempts);
});

test('permanent 413/400 failures do not retry; 410 also revokes all queued deliveries',async t=>{
  for(const status of [413,400,410]) {
    const c=setup(t);await c.service.subscribe(owner,params());await c.service.enqueue(event());await c.service.enqueue(event('synthetic-request-2'));c.response=()=>new Response(null,{status});
    await c.service.drain();c.time+=60000;await c.service.drain();assert.equal(c.deliveries().length,status===410?1:2);
    assert(c.rows().every(row=>row.state===(status===410?'canceled':'failed')));assert.equal(c.subs()[0].active,status===410?0:1);
  }
});

test('refresh extends finite expiry, expired backlog stops and null TTL still receives a finite grant',async t=>{
  const c=setup(t);await c.service.subscribe(owner,params({ttlMs:1000}));await c.service.enqueue(event());c.time+=500;
  const refreshed=await c.service.subscribe(owner,params({ttlMs:1000}));assert.equal(Date.parse(refreshed.refreshBefore),start+1500);
  c.time+=1001;await c.service.drain();assert.equal(c.deliveries().length,0);assert.equal(c.rows()[0].state,'canceled');
  const resumed=await c.service.subscribe(owner,params({ttlMs:null}));assert.equal(Date.parse(resumed.refreshBefore),c.time+EVENT_LIMITS.defaultTtlMs);await c.service.drain();assert.equal(c.deliveries().length,0);
  await assert.rejects(c.service.subscribe(owner,params({cursor:'synthetic-old-cursor'})),{code:'replay_not_supported'});
});

test('refresh after lapse cancels pending backlog even when a drain has not run',async t=>{
  const c=setup(t);await c.service.subscribe(owner,params({ttlMs:1000}));await c.service.enqueue(event());c.time+=1001;
  await c.service.subscribe(owner,params());await c.service.drain();assert.equal(c.deliveries().length,0);assert.equal(c.rows()[0].state,'canceled');
});

test('access revocation and owner-scoped idempotent unsubscribe stop delivery',async t=>{
  const c=setup(t);const first=await c.service.subscribe(owner,params());await c.service.enqueue(event());
  c.owners.add('synthetic-other-owner');await c.service.unsubscribe('synthetic-other-owner',unsubscribeParams());assert.equal((await c.store.getSubscription(first.id,owner)).active,true);
  c.allowed=false;await c.service.drain();assert.equal(c.deliveries().length,0);assert.equal(c.rows()[0].state,'canceled');assert.equal(c.subs()[0].active,0);
  c.allowed=true;await c.service.subscribe(owner,params());await c.service.enqueue(event('new-request'));await c.service.unsubscribe(owner,unsubscribeParams());await c.service.unsubscribe(owner,unsubscribeParams());await c.service.drain();assert.equal(c.deliveries().length,0);
});

test('secret rotation verifies new key and signs with both keys only during bounded rotation',async t=>{
  const c=setup(t);const original=await c.service.subscribe(owner,params());c.keys=[secret,secret2];c.time+=1000;
  const rotated=await c.service.subscribe(owner,params({delivery:{mode:'webhook',url,secret:secret2}}));assert.equal(rotated.id,original.id);assert.equal(c.verifications().length,2);
  await c.service.enqueue(event());await c.service.drain();let delivery=c.deliveries().at(-1);assert.equal(delivery.headers['webhook-signature'].split(' ').length,2);
  for(const key of [secret,secret2])assert.equal(await verifyStandardWebhook({secret:key,id:delivery.headers['webhook-id'],timestamp:delivery.headers['webhook-timestamp'],signature:delivery.headers['webhook-signature'],body:delivery.body,nowMs:c.time}),true);
  c.time+=EVENT_LIMITS.rotationMs+1;await c.service.enqueue(event('post-rotation'));await c.service.drain();delivery=c.deliveries().at(-1);assert.equal(delivery.headers['webhook-signature'].split(' ').length,1);assert.equal((await c.store.getSubscription(original.id,owner)).previousSecret,null);
});

test('SQLite restart retains subscription and recovers an abandoned delivery lease',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'synthetic-events-'));t.after(()=>rm(directory,{recursive:true,force:true}));const filename=join(directory,'events.sqlite');
  const one=setup(t,{filename});const sub=await one.service.subscribe(owner,params());await one.service.enqueue(event());
  const [due]=await one.store.due(new Date(one.time).toISOString(),1,EVENT_LIMITS.maxAttempts);const claimed=await one.store.claim({...due,now:new Date(one.time).toISOString(),leaseUntil:new Date(one.time+EVENT_LIMITS.leaseMs).toISOString(),token:'synthetic-lost-process',maxAttempts:EVENT_LIMITS.maxAttempts});assert.equal(claimed.attempts,1);one.fixture.close();
  const two=setup(t,{filename,time:start+EVENT_LIMITS.leaseMs+1});assert.equal((await two.store.getSubscription(sub.id,owner)).active,true);assert.equal((await two.service.drain()).delivered,1);assert.equal(two.rows()[0].attempts,2);assert.equal(two.verifications().length,0);assert.equal(two.deliveries()[0].parsed.eventId,event().eventId);
});

test('concurrent drainers claim once and deliver out-of-order occurrences without duplicating ids',async t=>{
  const c=setup(t);await c.service.subscribe(owner,params());
  await c.service.enqueue(event('newer',{createdAt:new Date(start+10000).toISOString()}));await c.service.enqueue(event('older',{createdAt:new Date(start+1000).toISOString()}));c.time=start+10000;
  await Promise.all([c.service.drain(),c.service.drain()]);assert.equal(c.deliveries().length,2);assert.equal(new Set(c.deliveries().map(x=>x.parsed.eventId)).size,2);assert(c.rows().every(row=>row.state==='delivered'&&row.attempts===1));
});

test('atomic intake hook rolls back together and does not emit for a losing idempotent insert',async t=>{
  const c=setup(t);await c.service.subscribe(owner,params());
  const insert=(id,key)=>c.fixture.binding.prepare("INSERT INTO intake_requests (id,owner_id,project_id,client_submission_id,payload_digest,body,viewed_snapshot_revision,viewed_snapshot_imported_at,context_summary,context_stale,status,created_at,updated_at,version,linked_task_ids,latest_summary) VALUES (?,?,?,?,?,'synthetic body','synthetic revision',?,'',0,'received',?,?,1,'[]','') ON CONFLICT(owner_id,client_submission_id) DO NOTHING").bind(id,owner,project,key,'synthetic digest',new Date(start).toISOString(),new Date(start).toISOString(),new Date(start).toISOString());
  const q=id=>({id,ownerId:owner,projectId:project,createdAt:new Date(start).toISOString()});
  await c.fixture.binding.batch([insert('atomic-one','synthetic-submission-1'),...await c.store.intakeCreatedStatements(q('atomic-one'))]);assert.equal(c.rows().length,1);
  await c.fixture.binding.batch([insert('atomic-loser','synthetic-submission-1'),...await c.store.intakeCreatedStatements(q('atomic-loser'))]);assert.equal(c.rows().length,1);assert.equal(c.fixture.db.prepare('SELECT COUNT(*) AS n FROM mcp_events').get().n,1);
  c.fixture.db.exec("CREATE TRIGGER synthetic_outbox_failure BEFORE INSERT ON mcp_event_outbox BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
  await assert.rejects(c.fixture.binding.batch([insert('atomic-fail','synthetic-submission-2'),...await c.store.intakeCreatedStatements(q('atomic-fail'))]));assert.equal(c.fixture.db.prepare("SELECT COUNT(*) AS n FROM intake_requests WHERE id='atomic-fail'").get().n,0);assert.equal(c.fixture.db.prepare('SELECT COUNT(*) AS n FROM mcp_events').get().n,1);
});

test('callback errors and drain results never expose secrets, owner ids or raw response text',async t=>{
  const c=setup(t);c.response=()=>{throw Error(secret+' private upstream response '+owner);};let caught;
  try{await c.service.subscribe(owner,params());}catch(error){caught=error;}assert(caught);assert.equal(caught.data.reason,'connection_refused');assert(!String(caught).includes(secret));assert(!JSON.stringify(caught).includes(owner));
  c.response=null;await c.service.subscribe(owner,params());await c.service.enqueue(event());c.response=()=>{throw Error(secret);};const result=await c.service.drain();assert.equal(result.retried,1);assert(!JSON.stringify([result,c.rows()]).includes(secret));assert.equal(c.rows()[0].last_reason,'connection_refused');
});

test('verification response size and elapsed challenge lifetime are bounded',async t=>{
  const c=setup(t);c.response=()=>Response.json({challenge:'x'.repeat(2048)});
  await assert.rejects(c.service.subscribe(owner,params()),e=>e.data.reason==='challenge_failed');assert.equal(c.subs().length,0);
  c.response=(_q,body)=>{c.time+=EVENT_LIMITS.requestTimeoutMs+1;return Response.json({challenge:body.challenge});};
  await assert.rejects(c.service.subscribe(owner,params()),e=>e.data.reason==='challenge_failed');assert.equal(c.subs().length,0);
});

test('authorization exceptions are sanitized and delivery retries recover when authorization returns',async t=>{
  const c=setup(t);const unavailable=createMcpEventsService({...c.options,authorize:async()=>{throw Error(secret);}});
  await assert.rejects(unavailable.subscribe(owner,params()),error=>error.code==='event_authorization_unavailable'&&!JSON.stringify(error).includes(secret));
  await c.service.subscribe(owner,params());await c.service.enqueue(event());assert.equal((await unavailable.drain()).retried,1);assert.equal(c.rows()[0].last_reason,'authorization_unavailable');
  c.time=Date.parse(c.rows()[0].next_attempt_at);assert.equal((await c.service.drain()).delivered,1);
});

test('abandoned final lease terminates without exceeding attempt budget',async t=>{
  const c=setup(t);await c.service.subscribe(owner,params());await c.service.enqueue(event());
  c.fixture.db.prepare("UPDATE mcp_event_outbox SET state='delivering',attempts=?,lease_token='synthetic-stale-token',lease_until=?").run(EVENT_LIMITS.maxAttempts,new Date(start-1).toISOString());
  assert.equal((await c.service.drain()).processed,0);assert.equal(c.rows()[0].state,'failed');assert.equal(c.rows()[0].last_reason,'attempts_exhausted');assert.equal(c.deliveries().length,0);
});
