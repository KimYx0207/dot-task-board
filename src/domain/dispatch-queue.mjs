import {IntakeError,intakeId,intakeString} from './intake.mjs';
import {safeLink,timestamp} from './snapshot.mjs';
import {normalizeExecutionEvidence} from './execution-evidence.mjs';
export const dispatchStates=Object.freeze(['queued','claimed','dispatching','assigned','running','blocked','uncertain','completed','failed','canceled']);
export function queueError(code,message,status=409){throw new IntakeError(code,status,message);}
export function queueId(value){const id=intakeId(value);if(!id)queueError('invalid_dispatch_id','Invalid queue identity',400);return id;}
export function executionThreadId(value){
  if(typeof value==='string'&&value.length<=320&&/^\/root(?:\/[a-zA-Z0-9_]+)+$/.test(value))return value;
  return queueId(value);
}
export function queueVersion(value){if(!Number.isSafeInteger(value)||value<1)queueError('invalid_dispatch_version','Expected version is required',400);return value;}
export function queuePriority(value=0){if(!Number.isSafeInteger(value)||value<0||value>10000)queueError('invalid_priority','Priority must be between 0 and 10000',400);return value;}
export function queueTarget(value){
  if(!value||!['native_cloud','coding_environment','computer','existing_thread'].includes(value.type))queueError('invalid_environment','A verified execution environment is required',400);
  const retained=value.type==='existing_thread';
  const id=value.type==='native_cloud'||retained?null:queueId(value.id);
  if(retained&&value.id!=null)queueError('invalid_environment','Existing-thread binding has no literal environment identifier',400);
  if(value.type==='native_cloud'&&value.id!=null)queueError('invalid_environment','Native cloud does not use a computer identifier',400);
  return {type:value.type,id};
}
export function sameEnvironment(job,target){const t=queueTarget(target);return job.environmentType===t.type&&job.environmentId===t.id;}
export function validateDispatchBinding(job,input,{requireThread=true}={}){
  if(input.dispatchKey!==job.dispatchKey||!sameEnvironment(job,input.environment))queueError('dispatch_binding_conflict','Execution identity or environment changed');
  if(requireThread&&(!job.threadId||input.threadId!==job.threadId))queueError('dispatch_binding_conflict','Original thread identity is required');
  if(job.threadId&&input.threadId!==job.threadId)queueError('dispatch_binding_conflict','Follow-up cannot change the original thread');
}
export function safeCheckpoint(job,input){
  validateDispatchBinding(job,input,{requireThread:Boolean(job.threadId)});
  if(input.noActiveWriter!==true)queueError('checkpoint_required','Executor acknowledgement that no writer remains is required');
}
export function resultEvidence(value){
  if(!Array.isArray(value)||!value.length||value.length>8)queueError('result_evidence_required','Completion requires result evidence',400);
  return value.map(x=>{if(!x||typeof x.label!=='string'||x.label.length>80||!safeLink(x.url)||!x.url.startsWith('https://'))queueError('invalid_result_evidence','Result evidence must be a safe HTTPS link',400);return {label:x.label,url:x.url};});
}
function currentAttemptTime(job,value,now){
 if(!timestamp(job.attemptStartedAt)||!timestamp(value)||Date.parse(value)<Date.parse(job.attemptStartedAt)||Date.parse(value)>Date.parse(now)||Date.parse(now)-Date.parse(value)>300000)queueError('stale_attempt_evidence','Fresh evidence from the current immutable claim is required');
}
function admissionReceipt(job,input,now){
 const e=input.admissionEvidence;
 if(!e||typeof e!=='object'||Array.isArray(e)||Object.keys(e).some(k=>!['requestId','dispatchKey','threadId','turnId','observedAt','source','reference'].includes(k))||e.requestId!==job.requestId||e.dispatchKey!==job.dispatchKey||e.threadId!==job.threadId||e.turnId!==input.turnId||!e.turnId)queueError('admission_evidence_required','Match the actual admitted turn to this request and dispatch, not an earlier result');
 currentAttemptTime(job,e.observedAt,now);
 for(const [key,max] of [['source',160],['reference',600]])if(typeof e[key]!=='string'||e[key].trim().length<8||e[key].length>max)queueError('admission_evidence_required','Concrete admission source and reference are required');
 return JSON.stringify({kind:'verified_admission',...e,attemptStartedAt:job.attemptStartedAt});
}
export function transitionDispatch(job,action,input,now){
  const summary=intakeString(input.summary??'',1200,'dispatch_summary',{required:true});
  const changes={summary,updatedAt:now};
  if(action==='begin'){
    if(job.state!=='claimed')queueError('invalid_dispatch_transition','Only a claimed intent can begin');
    validateDispatchBinding(job,input,{requireThread:Boolean(job.threadId)});return {...changes,state:'dispatching'};
  }
  if(action==='bind'){
    if(!['dispatching','uncertain'].includes(job.state))queueError('invalid_dispatch_transition','No outstanding dispatch to bind');
    validateDispatchBinding(job,input,{requireThread:false});
    const threadId=executionThreadId(input.threadId);if(job.threadId&&job.threadId!==threadId)queueError('dispatch_binding_conflict','Original thread is immutable');
    if(input.verified!==true)queueError('unverified_thread','Actual thread receipt is required');
    if(input.turnId&&(job.knownPriorTurnIds??[]).includes(input.turnId))queueError('old_turn_receipt','A previously bound turn cannot establish a new dispatch');
    if(job.state==='uncertain'&&job.threadId)changes.reconciliationEvidence=admissionReceipt(job,input,now);
    return {...changes,state:'assigned',threadId,turnId:input.turnId==null?null:queueId(input.turnId),executionEvidence:null,executionObservedAt:input.turnId?now:job.executionObservedAt};
  }
  if(action==='running'){
    if(job.state!=='assigned')queueError('invalid_dispatch_transition','Running requires an assigned thread');
    validateDispatchBinding(job,input);if(input.verified!==true||!input.turnId)queueError('unverified_execution','Actual running turn evidence is required');
    if(job.turnId&&input.turnId!==job.turnId)queueError('dispatch_binding_conflict','Running receipt belongs to a different turn');
    return {...changes,state:'running',turnId:queueId(input.turnId),executionObservedAt:now,...(input.executionEvidence?{executionEvidence:normalizeExecutionEvidence(input.executionEvidence,now,job.executionEvidence)}:{})};
  }
  if(action==='observe'){
    if(job.state!=='running')queueError('invalid_dispatch_transition','Activity evidence requires a running lifecycle');
    validateDispatchBinding(job,input);
    if(input.turnId!==job.turnId)queueError('dispatch_binding_conflict','Observation belongs to a different turn');
    return {...changes,executionEvidence:normalizeExecutionEvidence(input.executionEvidence,now,job.executionEvidence)};
  }
  if(action==='uncertain'){
    if(!job.holdsSlot||!['claimed','dispatching','assigned','running'].includes(job.state))queueError('invalid_dispatch_transition','No potentially active dispatch');
    validateDispatchBinding(job,input,{requireThread:Boolean(job.threadId)});return {...changes,state:'uncertain'};
  }
  if(action==='checkpoint'){
    if(!job.holdsSlot||!['claimed','dispatching','assigned','running','uncertain'].includes(job.state))queueError('invalid_dispatch_transition','No active reservation to checkpoint');
    safeCheckpoint(job,input);
    if(job.threadId&&['uncertain','dispatching'].includes(job.state)&&(job.state==='dispatching'||job.attemptDispatched!==false))queueError('uncertain_requires_admission','No platform late-admission fence is configured; resolve the actual admitted turn without releasing this reservation');
    if(job.state==='uncertain'||job.state==='dispatching'&&!job.threadId){
      if(job.threadId){
        if(input.reconciliation!=='confirmed_no_active_writer')queueError('reconciliation_required','Verify the original thread has no active writer');
        const evidence=normalizeExecutionEvidence(input.executionEvidence,now,job.executionEvidence);currentAttemptTime(job,evidence.observedAt,now);
        if(evidence.kind!=='tool_result'||evidence.active!==false||evidence.terminal!==true||!input.turnId)queueError('reconciliation_required','Pre-dispatch reconciliation needs the actual terminal thread read');
        const detail=intakeString(input.reconciliationEvidence??'',1200,'reconciliation_evidence',{required:true});if(detail.length<8)queueError('reconciliation_required','Persist the original-thread read evidence');
        changes.executionEvidence=evidence;changes.reconciliationEvidence=JSON.stringify({kind:'pre_dispatch_terminal_read',attemptStartedAt:job.attemptStartedAt,dispatchKey:job.dispatchKey,threadId:job.threadId,turnId:queueId(input.turnId),detail,evidence});
      }
      else {
        if(input.reconciliation!=='confirmed_no_thread_created'||input.verifiedAbsent!==true)queueError('reconciliation_required','No active writer does not prove no thread was created; bind the existing thread or verify its absence');
        changes.reconciliationEvidence=intakeString(input.reconciliationEvidence??'',1200,'reconciliation_evidence',{required:true});
        if(changes.reconciliationEvidence.length<8)queueError('reconciliation_required','Persist the verified absence evidence before allowing a new creation');
      }
    }
    if(!['queued','blocked'].includes(input.nextState))queueError('invalid_dispatch_transition','Checkpoint can yield or block');
    return {...changes,state:input.nextState,holdsSlot:false,dispatchKey:null,executionObservedAt:job.threadId?now:job.executionObservedAt};
  }
  if(action==='offline'){
    if(job.state!=='queued'||job.holdsSlot)queueError('checkpoint_required','An active execution cannot be released merely because it is offline');
    return {...changes,state:'blocked'};
  }
  if(action==='resume'){
    if(!['blocked','failed'].includes(job.state)||job.holdsSlot)queueError('checkpoint_required','Reconcile active work before resuming');
    if(input.environmentAvailable!==true||!sameEnvironment(job,input.environment))queueError('environment_unavailable','Verify the original environment before resuming');
    return {...changes,state:'queued'};
  }
  if(['complete','fail'].includes(action)){
    if(!['assigned','running'].includes(job.state))queueError('invalid_dispatch_transition','No confirmed execution to finish');
    safeCheckpoint(job,input);if(input.turnId!==job.turnId)queueError('dispatch_binding_conflict','Result belongs to a different turn');
    let terminalEvidence;
    if(job.threadId&&!input.executionEvidence)queueError('result_evidence_required','Original-thread completion requires an actual terminal tool receipt',400);
    if(input.executionEvidence){
      terminalEvidence=normalizeExecutionEvidence(input.executionEvidence,now,job.executionEvidence);
      currentAttemptTime(job,terminalEvidence.observedAt,now);
      if(job.threadId&&terminalEvidence.kind!=='tool_result')queueError('result_evidence_required','A terminal tool result is required',400);
      if(terminalEvidence.kind==='active_process'||terminalEvidence.active!==false||terminalEvidence.terminal!==true)queueError('result_evidence_required','Finishing requires an explicitly terminal result with no active execution',400);
    }
    const evidenceLinks=action==='complete'?(input.evidenceLinks?.length?resultEvidence(input.evidenceLinks):terminalEvidence?[]:resultEvidence(input.evidenceLinks)):[];
    return {...changes,state:action==='complete'?'completed':'failed',holdsSlot:false,executionObservedAt:now,evidenceLinks,...(terminalEvidence?{executionEvidence:terminalEvidence}:{})};
  }
  if(action==='cancel'){
    if(job.holdsSlot||!['queued','blocked','failed'].includes(job.state))queueError('checkpoint_required','Running work cannot be killed through the queue');
    return {...changes,state:'canceled'};
  }
  queueError('invalid_dispatch_action','Unknown execution action',400);
}
