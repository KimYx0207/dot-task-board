// Injected host contract. This module has no network, credentials or native-tool implementation.
// The durable begin receipt MUST precede create/followup; ambiguous effects are never retried.
export async function dispatchOne({service,ownerId,eventId,adapter,newId=()=>crypto.randomUUID()}){
 const claimed=await service.claim(ownerId,{eventId});if(!claimed.job||claimed.replayed)return {...claimed,executed:false};let job=claimed.job;
 const environment={type:job.environmentType,id:job.environmentId};
 const change=async(action,extra={})=>{const r=await service.update(ownerId,{jobId:job.id,eventId:newId(),expectedVersion:job.version,action,dispatchKey:job.dispatchKey,threadId:job.threadId,environment,summary:action,...extra});job=r.job;return r;};
 if(!adapter||typeof adapter.environmentStatus!=='function'||typeof adapter.create!=='function'||typeof adapter.followup!=='function'){await change('checkpoint',{noActiveWriter:true,nextState:'blocked',summary:'Host execution adapter is not configured'});return {job,executed:false};}
 let available;try{available=environment.type==='existing_thread'?await adapter.preflightContinuation?.({operationId:job.dispatchKey,threadId:job.threadId,environment,requestId:job.requestId}):await adapter.environmentStatus(environment);}catch{available={available:false};}
 // Unknown connection for a verified original thread is not a fabricated online state.
 if(environment.type==='existing_thread'&&available?.continuationAllowed!==true){
  // A failed original-thread check may mean an active writer or an unreadable
  // executor. No new send is NOT proof that the original writer is absent.
  await change('uncertain',{summary:'Original-thread writer safety is unverified; reservation and resources are retained for read-only reconciliation'});
  return {job,executed:false,requiresReconciliation:true};
 }
 if(environment.type!=='existing_thread'&&available?.available!==true){await change('checkpoint',{noActiveWriter:true,nextState:'blocked',summary:'Original execution environment is unavailable'});return {job,executed:false};}
 try{await service.preflight(ownerId,job);}catch(error){if(!['execution_paused','execution_policy_unavailable'].includes(error.code))throw error;await change('checkpoint',{noActiveWriter:true,nextState:'blocked',summary:'Execution blocked by the current project or task control'});return {job,executed:false};}
 await change('begin',{summary:job.threadId?'Continuation intent saved for the original thread':'Creation intent saved before dispatch'});
 try{
  await service.preflight(ownerId,job);
  const receipt=job.threadId?await adapter.followup({operationId:job.dispatchKey,threadId:job.threadId,environment,requestId:job.requestId}):await adapter.create({operationId:job.dispatchKey,environment,requestId:job.requestId});
  if(!receipt?.threadId||receipt.environment?.type!==environment.type||(receipt.environment?.id??null)!==environment.id||(job.threadId&&receipt.threadId!==job.threadId))throw Error('Unverified execution receipt');
  await change('bind',{threadId:receipt.threadId,turnId:receipt.turnId??null,verified:true,summary:'Verified thread receipt recorded'});
  if(receipt.started===true&&receipt.turnId)await change('running',{threadId:receipt.threadId,turnId:receipt.turnId,verified:true,...(receipt.executionEvidence?{executionEvidence:receipt.executionEvidence}:{}),summary:'Executor confirmed the turn started'});
  return {job,executed:true};
 }catch(error){
  // Even a local persistence error after a successful create is ambiguous. Do not create again.
  if(job.holdsSlot&&['dispatching','assigned','running'].includes(job.state))await change('uncertain',{summary:'Dispatch outcome requires reconciliation; capacity and original binding are retained'});
  return {job,executed:false,requiresReconciliation:true};
 }
}
