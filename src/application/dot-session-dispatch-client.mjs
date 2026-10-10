import {bindDotSessionTools} from '../adapters/dot-session-tools.mjs';

const error=(code)=>Object.assign(new Error(code),{code});
const text=value=>typeof value==='string'&&value.trim().length>0;
const sameAttempt=(a,b)=>a?.id===b?.id&&a?.requestId===b?.requestId&&a?.threadId===b?.threadId&&a?.dispatchKey===b?.dispatchKey;
const environment=()=>({type:'existing_thread',id:null});
const retained=job=>text(job?.id)&&text(job.requestId)&&text(job.contextTaskId)&&text(job.threadId)&&job.environmentType==='existing_thread'&&job.environmentId===null;
const stop=(reason,job=null)=>({outcome:'stopped',reason,job,sent:false});

/** Runs only inside an already authorized dot tool session, never in Sites.
 * Host review functions are required capabilities, NOT request fields or defaults.
 * They must verify the actual owner-approved instruction, original writer state
 * and scoped result. This client does not implement/renew authorization policy.
 * Existing queue claim/begin receipts are the durable single-attempt boundary;
 * this is not an implementation of the separate native journal adapter.
 */
export function createDotSessionDispatchClient({nativeTools,reviewContinuation,reviewCompletion,newEventId,clock=()=>new Date().toISOString()}={}){
 for(const fn of [reviewContinuation,reviewCompletion,newEventId])if(typeof fn!=='function')throw error('host_review_dependencies_missing');
 const tools=bindDotSessionTools(nativeTools);
 const timestamp=()=>{const value=clock();if(!text(value)||!Number.isFinite(Date.parse(value)))throw error('invalid_host_clock');return value;};
 const event=()=>{const value=newEventId();if(!text(value)||value.length>100)throw error('invalid_event_id');return value;};
 // The current list implementation caps at 500 without a continuation cursor.
 // A full page cannot establish the candidate set, even without a truncated flag.
 async function jobs(){const data=await tools.listJobs({});if(!Array.isArray(data.jobs)||data.truncated===true||data.jobs.length>=500)throw error('queue_read_incomplete');return data.jobs;}
 async function current(id){return (await jobs()).find(job=>job.id===id)??null;}
 async function context(job,{admission=false}={}){
  if(!retained(job))throw error('verified_existing_thread_required');
  const {request}=await tools.getRequest({requestId:job.requestId});
  if(!request||request.id!==job.requestId||request.projectId!==job.projectId||request.contextTaskId!==job.contextTaskId||request.version!==job.requestVersion)throw error('request_binding_changed');
  if(admission&&request.status!=='accepted')throw error('request_not_accepted');
  const state=await tools.getBinding({taskId:job.contextTaskId}),binding=state.sourceBinding;
  if(!binding?.readAllowed||binding.taskId!==job.contextTaskId||binding.threadId!==job.threadId)throw error('original_binding_unverified');
  // Observation environment may be unknown; the immutable queue retains executor.
  if(binding.environment!==null&&(binding.environment?.type!=='existing_thread'||binding.environment.id!==null))throw error('original_environment_mismatch');
  if(admission){
   const withdrawal=await tools.getWithdrawal({requestId:job.requestId});
   if(withdrawal.requestId!==job.requestId)throw error('withdrawal_read_unverified');
   if(withdrawal.futureAdmissionStopped===true||withdrawal.intent?.state==='withdrawn'||withdrawal.withdrawalIntent?.state==='withdrawn')throw error('request_withdrawn');
   if(withdrawal.futureAdmissionStopped!==false)throw error('withdrawal_state_unknown');
  }
  return request;
 }
 async function read(job){
  const raw=await tools.readThread({threadId:job.threadId,limit:20});
  if(raw.threadId!==job.threadId||!text(raw.latestTurn?.id)||!Array.isArray(raw.items))throw error('thread_read_unverified');
  return raw;
 }
 async function review(job,request,raw){
  const proof=await reviewContinuation({job,request,raw});
  if(!proof||proof.verified!==true||proof.noActiveWriter!==true||proof.requestId!==job.requestId||proof.threadId!==job.threadId||proof.priorTurnId!==raw.latestTurn.id||!['completed','failed','interrupted'].includes(raw.latestTurn.status)||!text(proof.approvedPrompt)||!text(proof.reference))throw error('continuation_review_required');
  return proof;
 }
 async function preflight(job){
  const checked=await tools.preflight({jobId:job.id,expectedVersion:job.version,dispatchKey:job.dispatchKey});
  if(!sameAttempt(checked,job)||checked.version!==job.version||checked.holdsSlot!==true||!['claimed','dispatching'].includes(checked.state))throw error('preflight_receipt_mismatch');
 }
 async function update(job,action,extra={}){
  const result=await tools.update({jobId:job.id,eventId:event(),expectedVersion:job.version,action,dispatchKey:job.dispatchKey,threadId:job.threadId,environment:environment(),summary:action,...extra});
  if(!sameAttempt(result.job,job)||result.job.version!==job.version+1)throw error('write_receipt_unverified');
  return result.job;
 }
 async function uncertain(job,receipt=null){
  // Read before any recovery write. A lost bind response may already be durable.
  let saved;try{saved=await current(job.id);}catch{return {outcome:'uncertain',reason:'queue_read_unavailable',job,sent:null};}
  if(!sameAttempt(saved,job))return {outcome:'uncertain',reason:'attempt_changed',job:saved,sent:null};
  if(receipt&&['assigned','running'].includes(saved.state)&&saved.turnId===receipt.turnId)return {outcome:'assigned',job:saved,sent:true,receiptRecovered:true};
  if(saved.state==='uncertain')return {outcome:'uncertain',job:saved,sent:null};
  if(saved.holdsSlot&&['claimed','dispatching','assigned','running'].includes(saved.state)){
   try{saved=await update(saved,'uncertain',{summary:'Native send or receipt persistence is unverified; retain this attempt without resending'});}catch{return {outcome:'uncertain',reason:'uncertain_write_unconfirmed',job:saved,sent:null};}
  }
  return {outcome:'uncertain',job:saved,sent:null};
 }
 return Object.freeze({
  async dispatchNext({requestId,claimEventId}={}){
   if(!text(requestId)||!text(claimEventId))return stop('request_and_claim_event_required');
   let job;
   try{
    const queue=await jobs(),queued=queue.filter(j=>j.state==='queued'&&!j.holdsSlot);
    // claim_next_dispatch has no request selector. Do not deliberately claim a
    // different request; a concurrent unexpected claim is retained without send.
    if(queued.length!==1||queued[0].requestId!==requestId)return stop('single_selected_queued_request_required');
    const selected=queued[0];
    const request=await context(selected,{admission:true}),raw=await read(selected);
    const initial=await review(selected,request,raw);
    const claimed=await tools.claim({eventId:claimEventId});
    if(claimed.replayed===true)return stop('claim_replayed_no_send',claimed.job??null);
    if(claimed.replayed!==false)return stop('claim_receipt_unverified_no_send',claimed.job??null);
    job=claimed.job;
    if(!job)return stop('no_claimable_request');
    if(job.id!==selected.id||job.requestId!==requestId||job.threadId!==selected.threadId||job.contextTaskId!==selected.contextTaskId||!retained(job)||job.state!=='claimed'||job.holdsSlot!==true||!text(job.dispatchKey))return stop('unexpected_claim_no_send',job);
    await preflight(job);
    const latestRequest=await context(job,{admission:true}),latestRead=await read(job);
    if(latestRead.latestTurn.id!==raw.latestTurn.id)return stop('original_turn_changed_no_send',job);
    const final=await review(job,latestRequest,latestRead);
    if(final.approvedPrompt!==initial.approvedPrompt)return stop('approved_instruction_changed_no_send',job);
    job=await update(job,'begin',{summary:'Existing authorized queue attempt persisted before original-thread send'});
    await preflight(job);
    let receipt;
    try{
     receipt=await tools.sendMessage({threadId:job.threadId,prompt:final.approvedPrompt});
     if(!text(receipt.turnId)||receipt.turnId===raw.latestTurn.id||(receipt.threadId&&receipt.threadId!==job.threadId)||receipt.steered===true||['steered','unknown'].includes(receipt.status)||['steered','unknown'].includes(receipt.admissionState))return uncertain(job);
    }catch{return uncertain(job);}
    try{
     job=await update(job,'bind',{threadId:job.threadId,turnId:receipt.turnId,verified:true,summary:'Actual admitted turn bound to the same existing request; execution is not yet verified'});
     if(job.state!=='assigned'||job.turnId!==receipt.turnId)throw error('bind_receipt_mismatch');
     return {outcome:'assigned',job,sent:true};
    }catch{return uncertain(job,receipt);}
   }catch(e){return stop(e.code??'host_operation_failed',job??null);}
  },
  async reconcile({jobId}={}){
   let job;
   try{
    job=await current(jobId);
    if(!job||!retained(job)||!job.turnId||!['assigned','running'].includes(job.state))return stop('confirmed_attempt_required',job);
    const request=await context(job),raw=await read(job),observedAt=timestamp();
    if(raw.latestTurn.id!==job.turnId)return stop('different_turn_no_completion',job);
    if(!['completed','failed','interrupted'].includes(raw.latestTurn.status))return stop('turn_not_terminal',job);
    const proof=await reviewCompletion({job,request,raw});
    const item=raw.items.find(x=>x.id===proof?.resultItemId&&x.turnId===job.turnId&&x.role==='assistant'&&text(x.text));
    if(!proof||proof.verified!==true||proof.noActiveWriter!==true||proof.requestId!==job.requestId||proof.threadId!==job.threadId||proof.turnId!==job.turnId||!item||!['completed','failed'].includes(proof.outcome)||!Array.isArray(proof.completedScope)||!proof.completedScope.length||!proof.completedScope.every(text)||!Array.isArray(proof.pendingChecks)||!proof.pendingChecks.every(text)||(proof.outcome==='completed'&&(raw.latestTurn.status!=='completed'||proof.pendingChecks.length)))return stop('scoped_completion_review_required',job);
    const action=proof.outcome==='completed'?'complete':'fail';
    const extra={turnId:job.turnId,noActiveWriter:true,executionEvidence:{kind:'tool_result',observedAt,source:'cloud_threads.read',reference:`cloud_threads.read:${job.threadId}:${job.turnId}:${item.id}`,step:proof.completedScope.join('; ').slice(0,600),active:false,terminal:true},summary:proof.completedScope.join('; ').slice(0,1200)};
    try{
     const saved=await update(job,action,extra);
     if(saved.state!==proof.outcome||saved.holdsSlot!==false)throw error('terminal_write_unverified');
     return {outcome:proof.outcome,job:saved,sent:false};
    }catch{
     const saved=await current(job.id);
     if(sameAttempt(saved,job)&&saved.turnId===job.turnId&&saved.state===proof.outcome&&saved.holdsSlot===false)return {outcome:proof.outcome,job:saved,sent:false,receiptRecovered:true};
     return stop('terminal_write_unconfirmed',saved??job);
    }
   }catch(e){return stop(e.code??'host_operation_failed',job??null);}
  }
 });
}
