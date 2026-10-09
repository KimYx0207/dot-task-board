import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Worker} from 'node:worker_threads';
import {once} from 'node:events';
import {sqliteIntakeFixture} from './sqlite-intake-fixture.mjs';
import {createD1IntakeStore} from '../src/adapters/d1-intake.mjs';
import {createIntakeService} from '../src/application/intake-service.mjs';
import {createD1DispatchQueue} from '../src/adapters/d1-dispatch-queue.mjs';
import {dispatchOne} from '../src/application/dispatch-host.mjs';
import {createDispatchService,dispatchCapacity} from '../src/application/dispatch-service.mjs';
const now='2026-10-07T20:00:00.000Z',env={type:'computer',id:'synthetic-computer'};
function setup(t,{capacity=6,file=false}={}){
 const folder=file?mkdtempSync(join(tmpdir(),'capacity-sqlite-')):null;
 const filename=file?join(folder,'queue.db'):':memory:';
 const db=sqliteIntakeFixture(filename);
 if(file)db.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000');
 t.after(()=>{db.close();if(folder)rmSync(folder,{recursive:true,force:true});});
 let seq=0;const id=()=>`independent-${++seq}`;
 const requests=createIntakeService({store:createD1IntakeStore(db.binding),capabilities:{canSubmit:true,storageAvailable:true},clock:()=>now,newId:id,readBoard:async()=>({status:200,body:{snapshotRevision:'sha256:'+'0'.repeat(64),projectSummaries:[{id:'p',name:'Synthetic'}],tasks:[]}})});
 const store=createD1DispatchQueue(db.binding),service=createDispatchService({store,requests,enabled:true,capacity,clock:()=>now,newId:id});
 async function enqueue(owner='owner',priority=0){
  let {request}=await requests.submit('p',owner,{clientSubmissionId:'independent-client-'+id(),body:'Independent synthetic test',contextTaskId:null,viewedSnapshotRevision:'sha256:'+'0'.repeat(64),viewedSnapshotImportedAt:now,contextSummary:''});
  for(const status of ['read','accepted'])({request}=await requests.append(request.id,{eventId:id(),expectedVersion:request.version,status,summary:status},owner));
  return (await service.enqueue(owner,{eventId:id(),requestId:request.id,expectedRequestVersion:request.version,environment:env,priority})).job;
 }
 const update=(job,action,extra={})=>service.update(job.ownerId,{jobId:job.id,eventId:id(),expectedVersion:job.version,action,dispatchKey:job.dispatchKey,threadId:job.threadId,environment:env,summary:'Independent '+action,...extra});
 return {db,filename,requests,store,service,enqueue,update,id};
}
async function compete(filename,{workers=12,count=2,sharedEvent=null}={}){
 const gate=new SharedArrayBuffer(4),slots=[];
 const all=[];
 for(let id=0;id<workers;id++){
  const worker=new Worker(new URL('./claim-concurrency-worker.mjs',import.meta.url),{workerData:{filename,id,count,sharedEvent,gate}});
  const ready=new Promise((resolve,reject)=>{worker.on('message',message=>{if(message.ready)resolve();});worker.once('error',reject);});
  const done=new Promise((resolve,reject)=>{worker.on('message',message=>{if(message.error)reject(Error(JSON.stringify(message.error)));if(message.output)resolve(message.output);});worker.once('error',reject);});
  slots.push({worker,ready,done,exit:once(worker,'exit')});
 }
 try {
  await Promise.all(slots.map(slot=>slot.ready));
  Atomics.store(new Int32Array(gate),0,1);Atomics.notify(new Int32Array(gate),0);
  for(const output of await Promise.all(slots.map(slot=>slot.done)))all.push(...output);
  await Promise.all(slots.map(slot=>slot.exit));
  return all;
 } finally {await Promise.all(slots.map(slot=>slot.worker.terminate()));}
}
test('independent six-capacity: 12 SQLite connections issue 24 competing claims',async t=>{
 const c=setup(t,{file:true});for(let i=0;i<24;i++)await c.enqueue();
 const output=await compete(c.filename);
 const claimed=output.filter(x=>x.id),held=(await c.service.list('owner')).jobs.filter(x=>x.holdsSlot);
 assert.equal(claimed.length,6);assert.equal(new Set(claimed.map(x=>x.id)).size,6);assert.equal(held.length,6);assert(held.every(x=>x.dispatchAttempt===1&&x.state==='claimed'));
 assert.equal(c.db.db.prepare("SELECT COUNT(*) AS n FROM dispatch_operations WHERE action='claim'").get().n,24);
 t.diagnostic(`real workers=12 connections=12 competing claims=24 held=${held.length} queued=18`);
});
test('independent six-capacity is per owner, not global',async t=>{
 const c=setup(t);for(const owner of ['owner-a','owner-b'])for(let i=0;i<7;i++)await c.enqueue(owner);
 for(const owner of ['owner-a','owner-b']){const results=await Promise.all(Array.from({length:9},()=>c.service.claim(owner,{eventId:c.id()})));assert.equal(results.filter(x=>x.job).length,6);}
 assert.equal(c.db.db.prepare('SELECT COUNT(*) AS n FROM dispatch_jobs WHERE holds_slot=1').get().n,12);
});
test('independent empty capacity receipt stays idempotent after slot release',async t=>{
 const c=setup(t,{capacity:1});await c.enqueue();await c.enqueue();const first=(await c.service.claim('owner',{eventId:c.id()})).job,eventId=c.id();
 assert.equal((await c.service.claim('owner',{eventId})).job,null);
 await c.update(first,'checkpoint',{noActiveWriter:true,nextState:'blocked'});
 const replay=await c.service.claim('owner',{eventId});assert.equal(replay.job,null);assert.equal(replay.replayed,true);
 assert((await c.service.claim('owner',{eventId:c.id()})).job);
});
test('independent failure in final claim statement rolls back slot and event together',async t=>{
 const c=setup(t),job=await c.enqueue();
 c.db.db.exec("CREATE TRIGGER abort_claim_link BEFORE UPDATE OF job_id ON dispatch_operations WHEN NEW.action='claim' BEGIN SELECT RAISE(ABORT,'independent intent link failure'); END");
 const eventId=c.id();await assert.rejects(c.service.claim('owner',{eventId}),/independent intent link failure/);
 assert.deepEqual(await c.store.get('owner',job.id),job);assert.equal(await c.store.operation('owner',eventId),null);
 c.db.db.exec('DROP TRIGGER abort_claim_link');
 const retry=await c.service.claim('owner',{eventId});assert.equal(retry.job.dispatchAttempt,1);assert.equal(retry.job.holdsSlot,true);
});
test('independent direct SQL cannot reserve two writers for one owner/thread',async t=>{
 const c=setup(t),a=await c.enqueue(),b=await c.enqueue();
 c.db.db.prepare("UPDATE dispatch_jobs SET thread_id='synthetic-thread',holds_slot=1 WHERE id=?").run(a.id);
 assert.throws(()=>c.db.db.prepare("UPDATE dispatch_jobs SET thread_id='synthetic-thread',holds_slot=1 WHERE id=?").run(b.id),/UNIQUE constraint failed/);
 assert.equal((await c.store.get('owner',b.id)).holdsSlot,false);
});
test('independent concurrent duplicate claim receipts must mark all but one as replayed',async t=>{
 const c=setup(t,{file:true});for(let i=0;i<8;i++)await c.enqueue();
 const output=await compete(c.filename,{workers:12,count:1,sharedEvent:'same-claim-event'});
 assert.equal(new Set(output.map(x=>x.id)).size,1);assert(output.every(x=>x.id));
 assert.equal(c.db.db.prepare('SELECT COUNT(*) AS n FROM dispatch_jobs WHERE holds_slot=1').get().n,1);
 assert.equal(c.db.db.prepare("SELECT COUNT(*) AS n FROM dispatch_operations WHERE action='claim'").get().n,1);
 const fresh=output.filter(x=>x.replayed===false).length;t.diagnostic(`same event: returned job ids=1 persisted slots=1 persisted operations=1 fresh receipts=${fresh} replayed receipts=${12-fresh}`);
 assert.equal(fresh,1,'A replayed claim receipt must not be exposed as a fresh dispatch intent');
});

function forceSameEventPreflight(c,count){
 const original=c.store.operation.bind(c.store);let arrived=0,release;const gate=new Promise(resolve=>{release=resolve;});
 c.store.operation=async(...args)=>{const value=await original(...args);if(!value&&args[1]==='forced-claim-event'){arrived++;if(arrived===count)release();await gate;}return value;};
}
test('deterministic duplicate claim counterexample: eight preflight reads see no event',async t=>{
 const c=setup(t);await c.enqueue();forceSameEventPreflight(c,8);
 const results=await Promise.all(Array.from({length:8},()=>c.service.claim('owner',{eventId:'forced-claim-event'})));
 assert.equal(new Set(results.map(result=>result.job.id)).size,1);
 const fresh=results.filter(result=>result.replayed===false).length;
 t.diagnostic(`controlled replay preflight race: fresh=${fresh}, persisted held slots=1`);
 assert.equal(fresh,1,'Concurrent same-event claims must identify only one fresh intent');
});
test('host duplicate claim race returns one execution and seven harmless replays',async t=>{
 const c=setup(t);await c.enqueue();forceSameEventPreflight(c,8);let creates=0;
 const adapter={environmentStatus:async()=>({available:true}),create:async({environment})=>{creates++;return {threadId:'race-thread',turnId:'race-turn',started:true,environment};},followup:async()=>{throw Error('Unexpected followup');}};
 const results=await Promise.allSettled(Array.from({length:8},()=>dispatchOne({service:c.service,ownerId:'owner',eventId:'forced-claim-event',adapter,newId:c.id})));
 assert.equal(creates,1);assert.equal(results.filter(result=>result.status==='fulfilled').length,8);
 const values=results.map(result=>result.value);assert.equal(values.filter(result=>result.executed).length,1);assert.equal(values.filter(result=>result.replayed===true&&result.executed===false).length,7);
 t.diagnostic('create calls=1; fulfilled=8; harmless replay receipts=7');
});
