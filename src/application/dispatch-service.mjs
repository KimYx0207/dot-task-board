import {executionState,dispatchResources} from '../domain/dispatch-guards.mjs';
import {executionThreadId} from '../domain/dispatch-queue.mjs';
import {executionEvidenceView} from '../domain/execution-evidence.mjs';
import {projectAccountingView} from './project-accounting.mjs';
import {safeText} from '../domain/snapshot.mjs';
import {intakeDigest,normalizeIntakeEvent} from '../domain/intake.mjs';
import {queueError,queueId,queueVersion,queuePriority,queueTarget,sameEnvironment,transitionDispatch} from '../domain/dispatch-queue.mjs';
export function dispatchCapacity(value=1){const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>32)queueError('invalid_capacity','Experiment capacity must be an integer from 1 to 32',400);return n;}
export function createDispatchService({store,requests,enabled=false,capacity=1,readRegistry=null,clock=()=>new Date().toISOString(),newId=()=>crypto.randomUUID()}){
 const cap=dispatchCapacity(capacity);
 function requireOwner(owner){if(!owner||typeof owner!=='string'||owner.length>200)queueError('authentication_required','Authentication required',401);if(!enabled||!store)queueError('dispatch_disabled','Experimental dispatch is not enabled',403);}
 async function replay(owner,event,digest){const op=await store.operation(owner,event);if(!op)return null;if(op.payload_digest!==digest)queueError('event_conflict','Event ID was reused with different content');return {job:op.job_id?await store.get(owner,op.job_id):null,replayed:true};}
 async function dispatchPolicy(owner){if(!readRegistry)return {active:null,manual:[]};const registry=await readRegistry();if(!Array.isArray(registry))queueError('execution_policy_unavailable','Project execution policy is unavailable',503);const active=registry.filter(p=>executionState(p.executionState)==='active').map(p=>p.id),deferred=registry.filter(p=>executionState(p.executionState)==='deferred').map(p=>p.id);return {active,manual:store.manualAuthorizationIds?await store.manualAuthorizationIds(owner,clock(),deferred):[]};}
 async function preflight(owner,job){const policy=await dispatchPolicy(owner),registryDenied=policy.active!==null&&!policy.active.includes(job.projectId)&&!policy.manual.includes(job.requestId),controlsAllowed=await store.allowed(owner,job,clock());if(registryDenied||!controlsAllowed){const grant=job.holdsSlot&&store.manualAuthorization?await store.manualAuthorization(owner,job.requestId):null;if(grant&&Date.parse(grant.expires_at)<=Date.parse(clock()))queueError('manual_authorization_expired','Single-request authorization expired; retain the claimed reservation for owner reconciliation');queueError('execution_paused','Project or task is paused, deferred, canceled or unregistered');}return policy.active!==null&&!policy.active.includes(job.projectId);}
 const api={
  async preflight(owner,job){requireOwner(owner);const current=await store.get(owner,job.id);if(!current||current.version!==job.version||current.dispatchKey!==job.dispatchKey||!current.holdsSlot||!['claimed','dispatching'].includes(current.state))queueError('version_conflict','Re-read execution intent before dispatch');await preflight(owner,current);const leases=await store.leases(owner,current.id);if(current.resources.some(key=>!leases.some(lease=>lease.resource_key===key&&lease.dispatch_key===current.dispatchKey)))queueError('resource_lease_conflict','Original resource ownership must be reconciled');if(leases.some(lease=>Date.parse(lease.expires_at)<=Date.parse(clock())))queueError('resource_lease_expired','Lease expiry requires original owner reconciliation; do not steal it');return current;},
  async control(owner,input){requireOwner(owner);if(!['project','task'].includes(input.scope)||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0)queueError('invalid_execution_policy','Control scope and expected version are required',400);const target=queueId(input.scope==='task'&&input.targetId?.startsWith('dispatch:')?input.targetId.slice(9):input.targetId),state=executionState(input.state);if(typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>1200)queueError('invalid_execution_policy','A user decision reason is required',400);return store.setControl(owner,input.scope,target,state,input.expectedVersion,input.reason,clock());},
  async registerBinding(owner,input){requireOwner(owner);if(input.verified!==true||typeof input.evidence!=='string'||input.evidence.length<8||input.evidence.length>1200)queueError('unverified_thread','Existing binding requires verified source evidence',400);return store.registerBinding(owner,{taskId:queueId(input.taskId),projectId:queueId(input.projectId),threadId:executionThreadId(input.threadId),environment:queueTarget(input.environment),evidence:input.evidence},clock());},
  async list(owner){requireOwner(owner);return {jobs:await store.list(owner),capacity:cap,capacityScope:'configured_per_owner',automaticExecution:false};},
  async view(owner){
   requireOwner(owner);const data=await store.queueView(owner),projects=(await requests.projects()).projects,now=clock(),accounting=data.accounting,projectTotals=projectAccountingView(accounting,projects,now);
   const counts={heldSlots:0,queued:0,blocked:0,uncertain:0,completed:0,running:0};let total=0;
   for(const row of data.counts){total+=row.count;counts.heldSlots+=Number(row.held)||0;if(Object.hasOwn(counts,row.state))counts[row.state]=row.count;}
   counts.reportedRunning=counts.running;counts.running=projectTotals.reduce((sum,project)=>sum+project.current.length,0);counts.unknownRunning=counts.reportedRunning-counts.running;
   let rank=0;const jobs=data.jobs.map(job=>{
    const activity=executionEvidenceView(job,now);
    const canReorder=job.state==='queued'&&!job.holdsSlot;
    const sameThreadBusy=job.threadId&&data.jobs.some(other=>other.id!==job.id&&other.threadId===job.threadId&&other.holdsSlot);
    const reason=job.state==='uncertain'?'派发结果待核对；执行名额继续保留':job.state==='claimed'?'执行名额已预留；尚未确认实际开工':job.state==='dispatching'?'正在核对派发回执；不会重复创建任务':job.state==='assigned'?'任务已关联；等待实际开工回执':job.state==='running'?(activity.effectiveState==='running'?'有新鲜的实际执行证据':activity.evidenceType?'实际执行证据已过期；当前执行情况待核实':'仅有开工回执；当前执行情况待核实'):canReorder?(sameThreadBusy?'原任务仍占用执行名额；等待安全交接':counts.heldSlots>=cap?'等待空闲执行名额':'可被下一轮调度认领'):safeText(job.summary,300,'状态原因尚未记录');
    return {id:job.id,requestId:job.requestId,projectId:job.projectId,projectName:projects.find(p=>p.id===job.projectId)?.name??'项目未记录',title:safeText(job.title,100,'项目需求'),taskNumber:job.taskNumber,registeredAt:job.createdAt,state:activity.effectiveState,lifecycleState:job.state,...activity,version:job.version,priority:job.priority,holdsSlot:job.holdsSlot,threadBound:Boolean(job.threadId),environmentType:job.environmentType,observedAt:job.updatedAt,lastLifecycleObservedAt:job.executionObservedAt,summary:safeText(job.summary,300),canReorder,queueRank:canReorder?++rank:null,reason};
   });
   return {enabled:true,capacity:cap,capacityScope:'configured_per_owner',automaticExecution:false,coverage:{scope:'managed_queue',total,truncated:total>jobs.length,queuedComplete:jobs.filter(job=>job.canReorder).length===counts.queued},jobs,counts,projectTotals,ordering:'priority_desc_created_asc_id_asc'};
  },
  async reorder(owner,input){
   requireOwner(owner);if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['eventId','items'].includes(k)))queueError('invalid_reorder','Invalid reorder request',400);
   const event=queueId(input.eventId),items=input.items;
   if(!Array.isArray(items)||items.length<1||items.length>500)queueError('invalid_reorder','Provide the complete queued set, from 1 to 500 items',400);
   const ids=new Set();for(const item of items){if(!item||Object.keys(item).some(k=>!['id','expectedVersion'].includes(k)))queueError('invalid_reorder','Invalid queue item',400);queueId(item.id);queueVersion(item.expectedVersion);if(ids.has(item.id))queueError('invalid_reorder','Duplicate queue item',400);ids.add(item.id);}
   const digest=await intakeDigest({action:'reorder',items}),prior=await store.operation(owner,event);
   if(prior){if(prior.payload_digest!==digest||prior.action!=='reorder')queueError('event_conflict','Event identity was reused');return {...await api.view(owner),replayed:true};}
   const result=await store.reorder(owner,event,digest,items,clock());return {...await api.view(owner),...result};
  },
  async enqueue(owner,input){
   requireOwner(owner);const event=queueId(input.eventId),requestId=queueId(input.requestId),version=queueVersion(input.expectedRequestVersion),target=queueTarget(input.environment),priority=queuePriority(input.priority),resources=dispatchResources(input.resources);
   const digest=await intakeDigest({action:'enqueue',...input}),old=await replay(owner,event,digest);if(old)return old;
   const {request}=await requests.get(requestId,owner);if(request.status!=='accepted'||request.version!==version)queueError('request_not_dispatchable','Read and accept the exact request before dispatch');
   const existing=await store.byRequest(owner,requestId);if(existing){if(!sameEnvironment(existing,target))queueError('dispatch_binding_conflict','Existing request cannot change environment');return {job:existing,replayed:true};}
   const manualAuthorizationRequired=await preflight(owner,{requestId,projectId:request.projectId,id:'dq-'+requestId,rootJobId:null,contextTaskId:request.contextTaskId});
   let original=null;
   if(request.contextTaskId){
    if(request.contextTaskId.startsWith('dispatch:'))original=await store.get(owner,request.contextTaskId.slice('dispatch:'.length));
    else {const binding=await store.binding(owner,request.contextTaskId);if(binding)original={projectId:binding.project_id,threadId:binding.thread_id,environmentType:binding.environment_type,environmentId:binding.environment_id};}
    if(!original||original.projectId!==request.projectId||!original.threadId)queueError('original_thread_unverified','Original thread binding is unavailable');
    if(!sameEnvironment(original,target))queueError('dispatch_binding_conflict','Continuation must use the original environment');
   }
   if(target.type==='existing_thread'&&!original?.threadId)queueError('original_thread_unverified','Platform-retained execution requires an already verified original thread');
   const id='dq-'+requestId,q={id,manualAuthorizationRequired,ownerId:owner,projectId:request.projectId,requestId,requestVersion:version,priority,resources:[...new Set([...resources,...(original?.resources??[])])].sort(),contextTaskId:request.contextTaskId??null,environmentType:target.type,environmentId:target.id,rootJobId:original?.rootJobId??id,continuationOf:original?.id??null,threadId:original?.threadId??null,createdAt:clock()};
   try{return {job:await store.create(q,event,digest),replayed:false};}catch(error){const done=await replay(owner,event,digest);if(done)return done;throw error;}
  },
  async claim(owner,input){requireOwner(owner);const event=queueId(input.eventId),digest=await intakeDigest({action:'claim',capacity:cap}),old=await replay(owner,event,digest);if(old)return old;const policy=await dispatchPolicy(owner);return store.claim(owner,event,digest,queueId(newId()),cap,clock(),policy.active,policy.manual);},
  async priority(owner,input){
   requireOwner(owner);const id=queueId(input.jobId),event=queueId(input.eventId),version=queueVersion(input.expectedVersion),priority=queuePriority(input.priority),digest=await intakeDigest({action:'priority',...input});const old=await replay(owner,event,digest);if(old)return old;
   const job=await store.get(owner,id);if(!job)queueError('dispatch_not_found','Queue item not found',404);if(job.version!==version)queueError('version_conflict','Read the current queue version first');
   if(job.holdsSlot||!['queued','blocked'].includes(job.state))queueError('checkpoint_required','Only work that has not started or safely yielded may be reordered');
   return store.change(owner,id,event,digest,version,{priority,updatedAt:clock()},'priority',clock());
  },
  async update(owner,input){
   requireOwner(owner);const id=queueId(input.jobId),event=queueId(input.eventId),version=queueVersion(input.expectedVersion),digest=await intakeDigest(input),old=await replay(owner,event,digest);if(old)return old;
   const job=await store.get(owner,id);if(!job)queueError('dispatch_not_found','Queue item not found',404);if(job.version!==version)queueError('version_conflict','Read the current queue version first');
   const manualAuthorizationRequired=['begin','resume'].includes(input.action)?await preflight(owner,job):false;
   const now=clock(),attempt=store.attemptContext?await store.attemptContext(owner,job):{},changes=transitionDispatch({...job,...attempt},input.action,input,now);
   const status={bind:'assigned',running:'in_progress',uncertain:'blocked',checkpoint:'blocked',offline:'blocked',resume:'accepted',complete:'completed',fail:'blocked',cancel:'canceled'}[input.action];let receipt=null;
   if(status){
    const {request}=await requests.get(job.requestId,owner);if(request.version!==job.requestVersion)queueError('version_conflict','Request and execution versions must be reconciled');
    if(request.status!==status){
     const eventId='dispatch:'+await intakeDigest({owner,event});const fields={eventId,expectedVersion:request.version,status,summary:changes.summary,linkedTaskIds:['dispatch:'+job.id],evidenceLinks:changes.evidenceLinks??[]};
     const normalized=normalizeIntakeEvent(fields,request,{verifiedDispatchResult:input.action==='complete'&&Boolean(changes.executionEvidence)});receipt={...normalized,requestId:request.id,digest:await intakeDigest({requestId:request.id,...fields})};changes.requestVersion=request.version+1;
    }
   }
   return store.change(owner,id,event,digest,version,changes,input.action,now,receipt,{requestId:job.requestId,expectedVersion:job.requestVersion,manualAuthorizationRequired});
  }
 };
 return api;
}
