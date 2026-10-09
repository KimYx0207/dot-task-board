import test from 'node:test';import assert from 'node:assert/strict';
import {sqliteIntakeFixture} from './sqlite-intake-fixture.mjs';
import {createD1IntakeStore} from '../src/adapters/d1-intake.mjs';
import {createIntakeService} from '../src/application/intake-service.mjs';
import {createD1DispatchQueue} from '../src/adapters/d1-dispatch-queue.mjs';
import {createDispatchService} from '../src/application/dispatch-service.mjs';
import {dispatchOne} from '../src/application/dispatch-host.mjs';
function setup(t){
 const db=sqliteIntakeFixture();t.after(()=>db.close());let n=0,now='2026-10-08T00:00:00Z';const id=()=>`synthetic-${++n}`,environment={type:'computer',id:'fixture-computer'},contexts=[],registry=[{id:'p',executionState:'active'},{id:'q',executionState:'active'}];
 const requests=createIntakeService({store:createD1IntakeStore(db.binding),capabilities:{canSubmit:true,storageAvailable:true},clock:()=>now,newId:id,readBoard:async()=>({status:200,body:{snapshotRevision:'sha256:'+'0'.repeat(64),projectSummaries:registry.map(p=>({...p,name:p.id})),tasks:contexts}})});
 const store=createD1DispatchQueue(db.binding),service=createDispatchService({store,requests,enabled:true,capacity:6,clock:()=>now,newId:id,readRegistry:async()=>registry});
 async function enqueue({project='p',resources=[],contextTaskId=null}={}){let {request:r}=await requests.submit(project,'owner',{clientSubmissionId:'synthetic-client-'+id(),body:'Synthetic guarded work',viewedSnapshotRevision:'sha256:'+'0'.repeat(64),viewedSnapshotImportedAt:now,contextTaskId});for(const status of ['read','accepted'])r=(await requests.append(r.id,{eventId:id(),expectedVersion:r.version,status,summary:status},'owner')).request;const input={eventId:id(),requestId:r.id,expectedRequestVersion:r.version,environment,resources};return {...await service.enqueue('owner',input),input};}
 const update=(job,action,extra={})=>service.update('owner',{jobId:job.id,eventId:id(),expectedVersion:job.version,dispatchKey:job.dispatchKey,threadId:job.threadId,environment,action,summary:'Synthetic '+action,...extra});
 const control=(scope,targetId,state,expectedVersion=0)=>service.control('owner',{scope,targetId,state,expectedVersion,reason:'Synthetic explicit user decision'});
 const calls=[],adapter={environmentStatus:async()=>({available:true}),create:async x=>{calls.push(['create',x]);return {threadId:'fixture-thread-'+calls.length,turnId:id(),environment,started:true};},followup:async x=>{calls.push(['followup',x]);return {threadId:x.threadId,turnId:id(),environment,started:true};}};
 return {db,service,store,enqueue,control,update,adapter,calls,registry,contexts,id,environment,setTime:x=>now=x,run:()=>dispatchOne({service,ownerId:'owner',eventId:id(),adapter,newId:id})};
}

import {createCloudThreadsAdapter} from '../src/adapters/cloud-threads-adapter.mjs';
import {createCloudThreadDecoder} from '../src/adapters/cloud-thread-observation.mjs';
import {createD1NativeDispatchJournal} from '../src/adapters/d1-native-dispatch-journal.mjs';
import {reconcileNativeDispatch,createNativeHostPreflight} from '../src/application/native-dispatch-host.mjs';
test('synthetic native provider + durable guards: admission holds lease; accepted terminal receipt releases next job',async t=>{
 const c=setup(t),resources=[{kind:'browser',id:'shared-synthetic-browser'}];
 const first=await c.enqueue({resources}),second=await c.enqueue({resources});let accepted=false,creates=0;
 const jobFor=async requestId=>(await c.store.list('owner')).find(j=>j.requestId===requestId);
 const data=structuredContent=>({structuredContent,isError:false});
 const provider={read:{list_environments:async()=>data({environments:[{environmentId:c.environment.id,status:'connected',is_authorized_for_tasks:true}]}),list_threads:async()=>data({threads:[],nextCursor:null}),read:async({threadId})=>data({threadId,latestTurn:{id:'synthetic-turn-1',status:'completed',error:null},items:[{id:'synthetic-result',turnId:'synthetic-turn-1',role:'assistant',text:'Synthetic acceptance fixture only.'}]})},write:{create:async()=>{creates++;return data({threadId:'synthetic-thread-'+creates,turnId:'synthetic-turn-'+creates});},send_message:async()=>{throw Error('No followup expected');}}};
 const decodeObservation=createCloudThreadDecoder({lookupBinding:async({requestId})=>{const job=await jobFor(requestId);return {verified:true,threadId:job.threadId,environment:c.environment};},acceptResult:async()=>accepted?{verified:true,outcome:'completed',noActiveWriter:true,completedScope:['Synthetic checked result'],pendingChecks:[]}:null,clock:()=> '2026-10-08T00:00:00Z'});
 const adapter=createCloudThreadsAdapter({ownerId:'owner',provider,journal:createD1NativeDispatchJournal(c.db.binding),decodeObservation,
  loadAuthorization:async({requestId})=>{const job=await jobFor(requestId);return {ownerId:'owner',requestId,environment:c.environment,threadId:job.threadId,executionAllowed:true,readAllowed:true,allowCreate:true,allowFollowup:true,title:'Synthetic task',approvedPrompt:'Synthetic fixture, never execute a real task.'};},
  preflight:createNativeHostPreflight({service:c.service,loadCurrentJob:(_owner,requestId)=>jobFor(requestId),authorizeRead:async()=>true})
 });
 const run=()=>dispatchOne({service:c.service,ownerId:'owner',eventId:c.id(),adapter,newId:c.id});
 let result=await run();assert.equal(result.job.id,first.job.id);assert.equal(result.job.state,'assigned');assert.equal(result.job.holdsSlot,true);assert.equal(result.job.executionEvidence,null);assert.equal(creates,1);
 assert.equal((await c.service.claim('owner',{eventId:c.id()})).job,null);
 let observed=await reconcileNativeDispatch({service:c.service,ownerId:'owner',job:result.job,adapter,newId:c.id});assert.equal(observed.released,false);assert.equal((await c.store.leases('owner',result.job.id)).length,1);
 accepted=true;observed=await reconcileNativeDispatch({service:c.service,ownerId:'owner',job:result.job,adapter,newId:c.id});assert.equal(observed.released,true);assert.equal(observed.job.state,'completed');assert.equal(observed.job.executionEvidence.source,'cloud_threads.read');assert.equal((await c.store.leases('owner',result.job.id)).length,0);
 result=await run();assert.equal(result.job.id,second.job.id);assert.equal(result.job.state,'assigned');assert.equal(creates,2);
});

import {normalizeIntakeEvent} from '../src/domain/intake.mjs';
test('ordinary assigned request cannot skip directly to completed without verified terminal dispatch proof',()=>{
 const event={eventId:'synthetic-complete',expectedVersion:1,status:'completed',summary:'Synthetic claim',evidenceLinks:[{label:'Synthetic link',url:'https://example.com/result'}]};
 assert.throws(()=>normalizeIntakeEvent(event,{status:'assigned'}),{code:'invalid_transition'});
 assert.equal(normalizeIntakeEvent(event,{status:'assigned'},{verifiedDispatchResult:true}).status,'completed');
});
