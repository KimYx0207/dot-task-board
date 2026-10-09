/** Source-backed reconciliation. Admission/inProgress alone never marks complete.
 * Uses normal versioned service writes; never frees a slot on disconnect or lag.
 * A caller may dispatch the next item only after this returns released:true.
 */
export async function reconcileNativeDispatch({service,ownerId,job,adapter,supportsTerminalFailureEvidence=false,newId=()=>crypto.randomUUID()}){
 if(job.ownerId!==ownerId||!job.threadId||!job.turnId||!['assigned','running','uncertain'].includes(job.state))return {job,released:false};
 const environment={type:job.environmentType,id:job.environmentId};
 const observation=await adapter.observe({requestId:job.requestId,operationId:job.dispatchKey,threadId:job.threadId,turnId:job.turnId,environment});
 if(!observation.executionEvidence||(!observation.businessCompleted&&!observation.businessFailed))return {job,released:false,observation};
 // Uncertain queue binding needs explicit reconciliation before a final result.
 if(job.state==='uncertain')return {job,released:false,requiresReconciliation:true,observation};
 const evidence=observation.executionEvidence;
 if(evidence.terminal!==true||evidence.active!==false||evidence.kind!=='tool_result'||!evidence.reference||!evidence.source)return {job,released:false};
 // Failure is deliberately left held until the service's fail path persists
 // terminal executionEvidence. Baseline release silently drops evidence on fail.
 if(observation.businessFailed&&!supportsTerminalFailureEvidence)return {job,released:false,requiresFailureEvidenceSupport:true,observation};
 const r=await service.update(ownerId,{jobId:job.id,eventId:newId(),expectedVersion:job.version,action:observation.businessFailed?'fail':'complete',dispatchKey:job.dispatchKey,threadId:job.threadId,turnId:job.turnId,environment,noActiveWriter:true,executionEvidence:evidence,summary:observation.completedScope.join('; ').slice(0,1200)});
 return {...r,released:r.job.holdsSlot===false&&['completed','failed'].includes(r.job.state),observation};
}

// Bridges the guards service's job-returning write preflight to adapter policy.
// Observation uses a separate read grant so pause/cancel cannot hide a result.
export function createNativeHostPreflight({service,loadCurrentJob,authorizeRead}){
 return async input=>{
  const job=await loadCurrentJob(input.ownerId,input.requestId);
  if(!job||job.ownerId!==input.ownerId||job.requestId!==input.requestId||job.dispatchKey!==input.operationId||job.threadId!==(input.threadId??null)||job.environmentType!==input.environment.type||(job.environmentId??null)!==(input.environment.id??null))return {allowed:false,reason:'Current dispatch binding changed'};
  if(input.phase==='observe')return {allowed:typeof authorizeRead==='function'&&await authorizeRead(input.ownerId,job)===true};
  if(typeof service?.preflight!=='function')return {allowed:false,reason:'Final resource guard unavailable'};
  await service.preflight(input.ownerId,job);return {allowed:true};
 };
}
