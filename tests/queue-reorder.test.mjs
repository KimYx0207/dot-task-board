import test from 'node:test';import assert from 'node:assert/strict';
import {sqliteIntakeFixture} from './sqlite-intake-fixture.mjs';import {createD1IntakeStore} from '../src/adapters/d1-intake.mjs';import {createIntakeService} from '../src/application/intake-service.mjs';import {createD1DispatchQueue} from '../src/adapters/d1-dispatch-queue.mjs';import {createDispatchService} from '../src/application/dispatch-service.mjs';import {handleDispatchRequest} from '../src/presentation/dispatch-http.mjs';
const now='2026-10-07T18:00:00.000Z';
function setup(t,{capacity=6,binding}={}){
 const db=sqliteIntakeFixture();t.after(()=>db.close());let n=0;const id=()=>`test-${++n}`;
 const requests=createIntakeService({store:createD1IntakeStore(db.binding,{guardDispatchOwnership:true}),capabilities:{canSubmit:true,storageAvailable:true},clock:()=>now,newId:id,readBoard:async()=>({status:200,body:{snapshotRevision:'sha256:'+'0'.repeat(64),projectSummaries:[{id:'p',name:'Synthetic project'}],tasks:[]}})});
 const store=createD1DispatchQueue(binding?binding(db.binding):db.binding),service=createDispatchService({store,requests,enabled:true,capacity,clock:()=>now,newId:id});
 async function add(owner='owner',priority=0){let r=(await requests.submit('p',owner,{clientSubmissionId:'synthetic-submit-'+id(),body:'Synthetic request '+n,contextTaskId:null,viewedSnapshotRevision:'sha256:'+'0'.repeat(64),viewedSnapshotImportedAt:now,contextSummary:''})).request;r=(await requests.append(r.id,{eventId:id(),expectedVersion:r.version,status:'read',summary:'Actually read for this test'},owner)).request;r=(await requests.append(r.id,{eventId:id(),expectedVersion:r.version,status:'accepted',summary:'Accepted in this test'},owner)).request;return (await service.enqueue(owner,{eventId:id(),requestId:r.id,expectedRequestVersion:r.version,environment:{type:'native_cloud'},priority})).job;}
 const items=jobs=>jobs.map(j=>({id:j.id,expectedVersion:j.version}));return {db,requests,store,service,add,items,id};
}
test('persisted full reorder changes the next actual claim and replay never writes a second time',async t=>{
 const c=setup(t,{capacity:1}),a=await c.add(),b=await c.add(),d=await c.add();const input={eventId:c.id(),items:c.items([d,a,b])};
 const reordered=await c.service.reorder('owner',input);assert.deepEqual(reordered.jobs.map(j=>j.id),[d.id,a.id,b.id]);assert.deepEqual(reordered.jobs.map(j=>j.priority),[3,2,1]);const versions=reordered.jobs.map(j=>j.version);
 const replay=await c.service.reorder('owner',input);assert.equal(replay.replayed,true);assert.deepEqual(replay.jobs.map(j=>j.version),versions);
 assert.deepEqual((await c.service.view('owner')).jobs.map(j=>j.id),[d.id,a.id,b.id]);assert.equal((await c.service.claim('owner',{eventId:c.id()})).job.id,d.id);
});
test('missing/new/claimed/stale/cross-owner membership rejects the whole reorder without partial priority writes',async t=>{
 const c=setup(t),a=await c.add(),b=await c.add(),other=await c.add('other');let before=await c.store.list('owner');
 for(const items of [c.items([a]),c.items([b,other]),c.items([a,a]),[{id:a.id,expectedVersion:99},...c.items([b])]]){await assert.rejects(c.service.reorder('owner',{eventId:c.id(),items}));assert.deepEqual(await c.store.list('owner'),before);}
 const stale=c.items([b,a]);await c.add();before=await c.store.list('owner');await assert.rejects(c.service.reorder('owner',{eventId:c.id(),items:stale}),{code:'version_conflict'});assert.deepEqual(await c.store.list('owner'),before);
 const current=await c.store.list('owner'),claimed=await c.service.claim('owner',{eventId:c.id()});before=await c.store.list('owner');await assert.rejects(c.service.reorder('owner',{eventId:c.id(),items:c.items(current)}),{code:'version_conflict'});assert.deepEqual(await c.store.list('owner'),before);assert.equal((await c.store.get('owner',claimed.job.id)).holdsSlot,true);
});
test('claim winning after UI read makes reorder fail atomically',async t=>{
 const c=setup(t),a=await c.add(),b=await c.add(),original=c.store.reorder.bind(c.store);let claimed;
 c.store.reorder=async(...args)=>{claimed=await c.service.claim('owner',{eventId:c.id()});return original(...args);};
 await assert.rejects(c.service.reorder('owner',{eventId:c.id(),items:c.items([b,a])}),{code:'version_conflict'});assert.equal((await c.store.get('owner',b.id)).priority,0);assert.equal((await c.store.get('owner',a.id)).priority,0);assert.equal((await c.store.get('owner',claimed.job.id)).holdsSlot,true);
});
test('six slots are reserved atomically; seventh waits and a safe release permits exactly one replacement',async t=>{
 const c=setup(t);for(let i=0;i<8;i++)await c.add();const claims=await Promise.all(Array.from({length:10},()=>c.service.claim('owner',{eventId:c.id()})));const occupied=claims.filter(x=>x.job);assert.equal(occupied.length,6);assert.equal((await c.service.view('owner')).counts.heldSlots,6);assert.equal((await c.service.claim('owner',{eventId:c.id()})).job,null);
 const job=occupied[0].job;await c.service.update('owner',{jobId:job.id,eventId:c.id(),expectedVersion:job.version,action:'checkpoint',dispatchKey:job.dispatchKey,threadId:null,environment:{type:'native_cloud'},noActiveWriter:true,nextState:'blocked',summary:'Synthetic reservation had not created a writer'});
 const replacement=await Promise.all([c.service.claim('owner',{eventId:c.id()}),c.service.claim('owner',{eventId:c.id()})]);assert.equal(replacement.filter(x=>x.job).length,1);assert.equal((await c.service.view('owner')).counts.heldSlots,6);
});
test('database failure rolls back both changed order and operation receipt',async t=>{
 let breakBatch=false;const c=setup(t,{binding:db=>({...db,batch:statements=>db.batch(breakBatch?[...statements,db.prepare('INSERT INTO deliberately_missing VALUES (1)')]:statements)})});const a=await c.add(),b=await c.add(),before=await c.store.list('owner'),event=c.id();breakBatch=true;
 await assert.rejects(c.service.reorder('owner',{eventId:event,items:c.items([b,a])}));assert.deepEqual(await c.store.list('owner'),before);assert.equal(await c.store.operation('owner',event),null);
});
test('queue HTTP requires the owner and same origin; response hides execution identifiers',async t=>{
 const c=setup(t),a=await c.add(),b=await c.add();const call=(method,path,body,headers={})=>handleDispatchRequest(new Request('https://board.example.com'+path,{method,headers:{'content-type':'application/json',...headers},body:body?JSON.stringify(body):undefined}),{dispatch:c.service});
 assert.equal((await call('GET','/api/dispatch/queue')).status,401);
 const result=await(await call('GET','/api/dispatch/queue',null,{'oai-authenticated-user-id':'owner'})).json();assert.equal(result.jobs.length,2);for(const field of ['ownerId','threadId','turnId','dispatchKey','environmentId'])assert(!Object.hasOwn(result.jobs[0],field));assert.equal(result.capacity,6);
 const payload={eventId:c.id(),items:c.items([b,a])};assert.equal((await call('POST','/api/dispatch/reorder',payload,{'oai-authenticated-user-id':'owner',origin:'https://evil.example.com'})).status,403);
 assert.equal((await call('POST','/api/dispatch/reorder',payload,{'oai-authenticated-user-id':'owner',origin:'https://board.example.com'})).status,200);
});
