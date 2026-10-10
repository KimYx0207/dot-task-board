import test from 'node:test';
import assert from 'node:assert/strict';
import {createDotSessionDispatchClient} from '../src/application/dot-session-dispatch-client.mjs';
import {bindDotSessionTools,dotSessionToolNames} from '../src/adapters/dot-session-tools.mjs';

const clone=x=>structuredClone(x),ok=x=>({structuredContent:clone(x)});
function fixture(options={}){
 let sequence=0,reads=0,reviews=0,checks=0;
 const job={id:'synthetic-job',requestId:'synthetic-request',requestVersion:2,projectId:'synthetic-project',contextTaskId:'synthetic-task',threadId:'synthetic-thread',turnId:null,environmentType:'existing_thread',environmentId:null,state:'queued',version:1,dispatchKey:null,holdsSlot:false};
 const request={id:job.requestId,version:2,projectId:job.projectId,contextTaskId:job.contextTaskId,status:'accepted',body:'Synthetic request, not executable authority'};
 const binding={taskId:job.contextTaskId,threadId:job.threadId,environment:null,readAllowed:true};
 const raw={threadId:job.threadId,latestTurn:{id:'synthetic-prior-turn',status:'completed'},items:[{id:'synthetic-prior-item',turnId:'synthetic-prior-turn',role:'assistant',text:'Synthetic fixture terminal evidence'}]};
 const calls=[],events=new Map();
 const impl={
  listJobs:async()=>({jobs:[clone(job)]}),getRequest:async()=>({request:clone(request)}),getBinding:async()=>({sourceBinding:clone(binding)}),getWithdrawal:async()=>({requestId:job.requestId,futureAdmissionStopped:false,intent:null}),
  readThread:async()=>{reads++;return clone(raw);},
  claim:async a=>{
   if(events.has(a.eventId))return {job:clone(events.get(a.eventId)),replayed:true};
   if(job.state!=='queued')return {job:null,replayed:false};
   Object.assign(job,{state:'claimed',holdsSlot:true,dispatchKey:'synthetic-operation',version:job.version+1});events.set(a.eventId,clone(job));return {job:clone(job),replayed:false};
  },
  preflight:async a=>{checks++;assert.equal(a.jobId,job.id);assert.equal(a.expectedVersion,job.version);assert.equal(a.dispatchKey,job.dispatchKey);return clone(job);},
  sendMessage:async a=>{assert.equal(a.threadId,job.threadId);assert.equal(a.prompt,'Owner-reviewed synthetic instruction');raw.latestTurn={id:'synthetic-new-turn',status:'inProgress'};raw.items=[];return {threadId:job.threadId,turnId:'synthetic-new-turn',status:'admitted'};},
  update:async a=>{
   assert.equal(a.expectedVersion,job.version);assert.equal(a.dispatchKey,job.dispatchKey);assert.equal(a.threadId,job.threadId);assert.deepEqual(a.environment,{type:'existing_thread',id:null});
   const states={begin:'dispatching',bind:'assigned',uncertain:'uncertain',complete:'completed',fail:'failed'};
   assert(states[a.action]);job.state=states[a.action];job.version++;
   if(a.turnId)job.turnId=a.turnId;
   if(['complete','fail'].includes(a.action)){job.holdsSlot=false;job.executionEvidence=clone(a.executionEvidence);}
   if(a.action==='bind'){request.status='assigned';request.version++;job.requestVersion=request.version;}
   return {job:clone(job),replayed:false};
  }
 };
 const nativeTools={};for(const [name,key]of Object.entries(dotSessionToolNames))nativeTools[key]=async args=>{calls.push({name,args:clone(args)});return ok(await impl[name](args));};
 const dependencies={nativeTools,newEventId:()=>`synthetic-event-${++sequence}`,clock:()=> '2026-01-01T00:00:00Z',
  reviewContinuation:async({job:j,raw:r})=>{reviews++;return {verified:true,noActiveWriter:true,requestId:j.requestId,threadId:j.threadId,priorTurnId:r.latestTurn.id,approvedPrompt:'Owner-reviewed synthetic instruction',reference:'synthetic-host-inspection'};},
  reviewCompletion:async({job:j,raw:r})=>({verified:true,noActiveWriter:true,requestId:j.requestId,threadId:j.threadId,turnId:j.turnId,resultItemId:r.items[0]?.id,outcome:'completed',completedScope:['Synthetic scoped step checked'],pendingChecks:[]})
 };
 Object.assign(dependencies,options);
 const client=createDotSessionDispatchClient(dependencies);
 return {job,request,binding,raw,calls,impl,nativeTools,dependencies,client,get reads(){return reads;},get reviews(){return reviews;},get checks(){return checks;},dispatch:()=>client.dispatchNext({requestId:job.requestId,claimEventId:'synthetic-claim'}),terminal:()=>{raw.latestTurn={id:job.turnId,status:'completed'};raw.items=[{id:'synthetic-result',turnId:job.turnId,role:'assistant',text:'Synthetic result with independently reviewed no-writer evidence'}];},count:name=>calls.filter(c=>c.name===name).length};
}
test('missing real host reviewers fail before any tool or queue mutation',()=>{
 let calls=0;assert.throws(()=>createDotSessionDispatchClient({nativeTools:new Proxy({},{get(){calls++;return ()=>{};}})}),{code:'host_review_dependencies_missing'});assert.equal(calls,0);
});
test('fixed session tool binding rejects missing capabilities and error/unstructured results',async()=>{
 assert.throws(()=>bindDotSessionTools({}),{code:'session_capability_missing'});
 const f=fixture();f.nativeTools[dotSessionToolNames.claim]=async()=>({isError:true,structuredContent:{job:f.job}});
 await assert.rejects(bindDotSessionTools(f.nativeTools).claim({eventId:'synthetic'}),{code:'unverified_tool_result'});
 f.nativeTools[dotSessionToolNames.claim]=async()=>({content:[{text:'success'}]});await assert.rejects(bindDotSessionTools(f.nativeTools).claim({}),{code:'unverified_tool_result'});
});
test('normal existing request uses durable begin, two server checks and exact native admission',async()=>{
 const f=fixture(),r=await f.dispatch();assert.equal(r.outcome,'assigned');assert.equal(f.job.state,'assigned');assert.equal(f.job.holdsSlot,true);assert.equal(f.count('sendMessage'),1);assert.equal(f.checks,2);assert.equal(f.reviews,2);
 assert.deepEqual(f.calls.filter(c=>['claim','preflight','update','sendMessage'].includes(c.name)).map(c=>c.name==='update'?c.args.action:c.name),['claim','preflight','begin','preflight','sendMessage','bind']);
 assert(!f.calls.some(c=>c.args.action==='running'));assert.equal(f.request.body,'Synthetic request, not executable authority');
});
test('completed and uncertain jobs never cause a new claim or send',async()=>{
 for(const state of ['completed','uncertain','dispatching','assigned','blocked']){const f=fixture();f.job.state=state;f.job.holdsSlot=true;assert.equal((await f.dispatch()).outcome,'stopped');assert.equal(f.count('claim'),0);assert.equal(f.count('sendMessage'),0);}
});
test('multiple queued requests or an unknown selected request do not claim',async()=>{
 const f=fixture();f.impl.listJobs=async()=>({jobs:[clone(f.job),{...clone(f.job),id:'other-job',requestId:'other-request'}]});await f.dispatch();assert.equal(f.count('claim'),0);
 const g=fixture();await g.client.dispatchNext({requestId:'missing-request',claimEventId:'synthetic-claim'});assert.equal(g.count('claim'),0);
});
test('a full unpaginated queue page cannot prove a unique selected candidate',async()=>{
 const f=fixture();f.impl.listJobs=async()=>({jobs:[clone(f.job),...Array.from({length:499},(_,i)=>({...clone(f.job),id:`history-${i}`,requestId:`history-request-${i}`,state:'completed'}))]});assert.equal((await f.dispatch()).reason,'queue_read_incomplete');assert.equal(f.count('claim'),0);assert.equal(f.count('sendMessage'),0);
});
test('request, binding and withdrawal failures stop before claiming',async()=>{
 const changes=[f=>{f.request.status='completed';},f=>{f.request.contextTaskId='other-task';},f=>{f.request.version++;},f=>{f.binding.threadId='other-thread';},f=>{f.binding.readAllowed=false;},f=>{f.binding.environment={type:'computer',id:'other-environment'};},f=>{f.impl.getWithdrawal=async()=>({requestId:f.job.requestId,futureAdmissionStopped:true});},f=>{f.impl.getWithdrawal=async()=>({requestId:f.job.requestId});}];
 for(const change of changes){const f=fixture();change(f);assert.equal((await f.dispatch()).outcome,'stopped');assert.equal(f.count('claim'),0);assert.equal(f.count('sendMessage'),0);}
});
test('terminal status alone and unreviewed request text cannot approve execution',async()=>{
 for(const proof of [null,{verified:true,noActiveWriter:false},{verified:true,noActiveWriter:true}]){const f=fixture({reviewContinuation:async()=>proof});await f.dispatch();assert.equal(f.count('claim'),0);assert.equal(f.count('sendMessage'),0);}
 const f=fixture();f.raw.latestTurn.status='inProgress';await f.dispatch();assert.equal(f.count('claim'),0);
});
test('replayed claim is never sent even when receipt contains a claimed job',async()=>{
 const f=fixture();f.impl.claim=async()=>({job:{...clone(f.job),state:'claimed',holdsSlot:true,dispatchKey:'synthetic-operation'},replayed:true});assert.equal((await f.dispatch()).reason,'claim_replayed_no_send');assert.equal(f.count('sendMessage'),0);
});
test('claim without explicit fresh-acquisition receipt cannot send',async()=>{
 const f=fixture();f.impl.claim=async()=>({job:{...clone(f.job),state:'claimed',holdsSlot:true,dispatchKey:'synthetic-operation'}});assert.equal((await f.dispatch()).reason,'claim_receipt_unverified_no_send');assert.equal(f.count('sendMessage'),0);
});
test('an unexpected concurrent claim is retained without sending or releasing it',async()=>{
 const f=fixture();f.impl.claim=async()=>({job:{...clone(f.job),id:'other-job',requestId:'other-request',state:'claimed',holdsSlot:true,dispatchKey:'other-operation'},replayed:false});const r=await f.dispatch();assert.equal(r.reason,'unexpected_claim_no_send');assert.equal(r.job.holdsSlot,true);assert.equal(f.count('sendMessage'),0);assert.equal(f.count('update'),0);
});
test('changed original turn after claim stops without send or slot release',async()=>{
 const f=fixture(),read=f.impl.readThread;f.impl.readThread=async()=>{const value=await read();if(f.reads===2)value.latestTurn.id='changed-turn';return value;};const r=await f.dispatch();assert.equal(r.reason,'original_turn_changed_no_send');assert.equal(f.count('sendMessage'),0);assert.equal(f.job.holdsSlot,true);
});
test('changed approved prompt stops without native send',async()=>{
 let n=0;const f=fixture({reviewContinuation:async({job,raw})=>({verified:true,noActiveWriter:true,requestId:job.requestId,threadId:job.threadId,priorTurnId:raw.latestTurn.id,reference:'synthetic-reference',approvedPrompt:++n===1?'first':'changed'})});assert.equal((await f.dispatch()).reason,'approved_instruction_changed_no_send');assert.equal(f.count('sendMessage'),0);
});
test('server preflight denial, changed receipt or begin failure cannot fall back to send',async()=>{
 for(const kind of ['denial','mismatch','begin']){const f=fixture();if(kind==='denial')f.impl.preflight=async()=>{throw Object.assign(Error('denied'),{code:'execution_paused'});};if(kind==='mismatch')f.impl.preflight=async()=>({...clone(f.job),dispatchKey:'different'});if(kind==='begin')f.impl.update=async()=>{throw Error('write outcome unavailable');};await f.dispatch();assert.equal(f.count('sendMessage'),0);assert.equal(f.job.holdsSlot,true);}
});
test('UNKNOWN native send persists uncertain and repeated checks never resend',async()=>{
 const f=fixture();f.impl.sendMessage=async()=>{throw Error('UNKNOWN');};let r=await f.dispatch();assert.equal(r.outcome,'uncertain');assert.equal(f.job.state,'uncertain');assert.equal(f.job.holdsSlot,true);assert.equal(f.count('sendMessage'),1);
 r=await f.dispatch();assert.equal(r.outcome,'stopped');assert.equal(f.count('sendMessage'),1);assert.equal((await f.client.reconcile({jobId:f.job.id})).reason,'confirmed_attempt_required');
});
test('steered, same-turn, incomplete and different-thread admissions remain uncertain',async()=>{
 for(const receipt of [{turnId:'synthetic-new-turn',steered:true},{turnId:'synthetic-prior-turn'},{turnId:'synthetic-new-turn',status:'unknown'},{turnId:'synthetic-new-turn',threadId:'other-thread'},{}]){const f=fixture();f.impl.sendMessage=async()=>receipt;assert.equal((await f.dispatch()).outcome,'uncertain');assert.equal(f.job.holdsSlot,true);assert.equal(f.job.state,'uncertain');}
});
test('lost bind response is recovered by queue read, never by another send or bind',async()=>{
 const f=fixture(),update=f.impl.update;f.impl.update=async a=>{const r=await update(a);if(a.action==='bind')throw Error('response lost');return r;};const r=await f.dispatch();assert.equal(r.outcome,'assigned');assert.equal(r.receiptRecovered,true);assert.equal(f.count('sendMessage'),1);assert.equal(f.calls.filter(c=>c.name==='update'&&c.args.action==='bind').length,1);
});
test('unpersisted bind is held uncertain, and unreadable queue never prompts blind recovery',async()=>{
 const f=fixture(),update=f.impl.update;f.impl.update=async a=>{if(a.action==='bind')throw Error('not persisted');return update(a);};assert.equal((await f.dispatch()).outcome,'uncertain');assert.equal(f.job.state,'uncertain');
 const g=fixture();g.impl.sendMessage=async()=>{g.impl.listJobs=async()=>{throw Error('offline');};throw Error('UNKNOWN');};const r=await g.dispatch();assert.equal(r.reason,'queue_read_unavailable');assert.equal(g.count('sendMessage'),1);assert.equal(g.job.holdsSlot,true);
});
test('two concurrent clients make no duplicate native call',async()=>{
 const f=fixture();const other=createDotSessionDispatchClient(f.dependencies);await Promise.all([f.dispatch(),other.dispatchNext({requestId:f.job.requestId,claimEventId:'synthetic-other-claim'})]);assert.equal(f.count('sendMessage'),1);
});
test('admission and terminal status without scope review never complete a request',async()=>{
 const f=fixture({reviewCompletion:async()=>null});await f.dispatch();assert.equal((await f.client.reconcile({jobId:f.job.id})).reason,'turn_not_terminal');f.terminal();assert.equal((await f.client.reconcile({jobId:f.job.id})).reason,'scoped_completion_review_required');assert.equal(f.job.holdsSlot,true);
});
test('completion requires same turn, result item, no writer and no pending checks',async()=>{
 for(const field of ['requestId','threadId','turnId','resultItemId','noActiveWriter','pendingChecks']){const f=fixture();const normal=f.dependencies.reviewCompletion;const client=createDotSessionDispatchClient({...f.dependencies,reviewCompletion:async input=>({...await normal(input),[field]:field==='noActiveWriter'?false:field==='pendingChecks'?['Still unverified']:'other-identity'})});await f.dispatch();f.terminal();assert.equal((await client.reconcile({jobId:f.job.id})).reason,'scoped_completion_review_required');assert.equal(f.job.holdsSlot,true);}
 const f=fixture();await f.dispatch();f.terminal();f.raw.latestTurn.id='other-turn';assert.equal((await f.client.reconcile({jobId:f.job.id})).reason,'different_turn_no_completion');
});
test('verified same-attempt scoped result completes once through existing CAS tool',async()=>{
 const f=fixture();await f.dispatch();f.terminal();const r=await f.client.reconcile({jobId:f.job.id});assert.equal(r.outcome,'completed');assert.equal(f.job.holdsSlot,false);assert.equal(f.job.executionEvidence.terminal,true);assert.equal(f.job.executionEvidence.active,false);assert.match(f.job.executionEvidence.reference,/synthetic-new-turn:synthetic-result$/);const n=f.count('update');await f.client.reconcile({jobId:f.job.id});assert.equal(f.count('update'),n);assert.equal(f.count('sendMessage'),1);
});
test('lost terminal response is read back and never blindly retried',async()=>{
 const f=fixture();await f.dispatch();f.terminal();const update=f.impl.update;f.impl.update=async a=>{const r=await update(a);if(a.action==='complete')throw Error('lost');return r;};const r=await f.client.reconcile({jobId:f.job.id});assert.equal(r.outcome,'completed');assert.equal(r.receiptRecovered,true);assert.equal(f.calls.filter(c=>c.name==='update'&&c.args.action==='complete').length,1);
});
test('unverified completion persistence is not reported as success',async()=>{
 const f=fixture();await f.dispatch();f.terminal();f.impl.update=async()=>{throw Error('not persisted');};const r=await f.client.reconcile({jobId:f.job.id});assert.equal(r.reason,'terminal_write_unconfirmed');assert.equal(f.job.holdsSlot,true);
});
test('slow host review never refreshes the source read timestamp',async()=>{
 let at='2026-01-01T00:00:00Z',recordedTime;const f=fixture({clock:()=>at}),normal=f.dependencies.reviewCompletion;
 const client=createDotSessionDispatchClient({...f.dependencies,reviewCompletion:async input=>{at='2026-01-01T00:06:00Z';return normal(input);}});
 await f.dispatch();f.terminal();f.impl.update=async a=>{recordedTime=a.executionEvidence.observedAt;throw Object.assign(Error('old source evidence'),{code:'stale_attempt_evidence'});};
 const r=await client.reconcile({jobId:f.job.id});assert.equal(recordedTime,'2026-01-01T00:00:00Z');assert.equal(r.reason,'terminal_write_unconfirmed');assert.equal(f.job.holdsSlot,true);
});
