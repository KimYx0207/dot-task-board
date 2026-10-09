import {IntakeError} from './intake.mjs';
import {safeText,safeLink,timestamp} from './snapshot.mjs';

// Expiry concerns the evidence of activity, never the dispatch reservation.
export const executionEvidenceTtlMs=Object.freeze({tool_result:300000,progress_output:300000,active_process:60000});
const evidenceKeys=new Set(['kind','observedAt','source','step','reference','active','terminal']);
function evidenceError(message){throw new IntakeError('invalid_execution_evidence',400,message);}
export function normalizeExecutionEvidence(value,now,previous=null){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!evidenceKeys.has(k)))evidenceError('A typed execution observation is required');
 if(!Object.hasOwn(executionEvidenceTtlMs,value.kind)||!timestamp(value.observedAt))evidenceError('Unsupported evidence kind or invalid source observation time');
 if(!Number.isFinite(Date.parse(now))||Date.parse(value.observedAt)>Date.parse(now))evidenceError('Execution evidence cannot come from the future');
 if(previous&&Date.parse(value.observedAt)<=Date.parse(previous.observedAt))evidenceError('A new observation must be later than the persisted observation');
 for(const [key,max] of [['source',160],['step',600],['reference',1800]])if(typeof value[key]!=='string'||!value[key].trim()||value[key].length>max)evidenceError('Evidence source, concrete step and reference are required');
 if(value.active!==undefined&&typeof value.active!=='boolean')evidenceError('Active acknowledgement must be boolean');
 if(value.terminal!==undefined&&typeof value.terminal!=='boolean')evidenceError('Terminal acknowledgement must be boolean');
 if(value.kind==='active_process'&&value.active!==true)evidenceError('An active process needs a positive executor acknowledgement');
 return {kind:value.kind,observedAt:value.observedAt,source:value.source.trim(),step:value.step.trim(),reference:value.reference.trim(),...(value.active===undefined?{}:{active:value.active}),...(value.terminal===undefined?{}:{terminal:value.terminal})};
}
export function readExecutionEvidence(value){
 try{
  const evidence=typeof value==='string'?JSON.parse(value):value;
  // Validate stored fields without changing their original timestamp or extending TTL.
  return normalizeExecutionEvidence(evidence,evidence?.observedAt);
 }catch{return null;}
}
export function executionEvidenceView(job,now=Date.now()){
 const evidence=readExecutionEvidence(job.executionEvidence),instant=typeof now==='number'?now:Date.parse(now);
 const observedAt=evidence?.observedAt??null,age=instant-Date.parse(observedAt),ttl=evidence?executionEvidenceTtlMs[evidence.kind]:null;
 const fresh=Boolean(evidence&&Number.isFinite(age)&&age>=0&&age<ttl&&evidence.active!==false);
 const effectiveState=job.state==='running'?(fresh?'running':'unknown'):job.state;
 // Raw source identifiers may include private thread IDs or local paths. Only a
 // validated HTTPS evidence URL is public; never echo an opaque reference.
 const credentialShape=/(?:gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|\bsk-[a-z0-9_-]{16,}|(?:access[_-]?token|api[_-]?key|authorization|password|secret)\s*[=:])/i;
 const publicText=(value,max)=>typeof value==='string'&&!credentialShape.test(value)?safeText(value,max)||null:null;
 const safeReference=evidence&&!credentialShape.test(evidence.reference)?safeLink(evidence.reference):null;
 const reference=safeReference?.startsWith('https://')&&!new URL(safeReference).hash?safeReference:null;
 return {effectiveState,lastExecutionObservedAt:observedAt,lastEffectiveAction:evidence?publicText(evidence.step,600):null,currentStep:effectiveState==='running'&&evidence?publicText(evidence.step,600):null,evidenceType:evidence?.kind??null,evidenceSource:evidence?publicText(evidence.source,160):null,evidenceReference:reference,evidenceFresh:fresh,evidenceExpiresAt:evidence?new Date(Date.parse(observedAt)+ttl).toISOString():null,evidenceTtlMs:ttl};
}
