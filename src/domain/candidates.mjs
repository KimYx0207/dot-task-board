import {IntakeError,intakeId,intakeString,normalizeIntakeSubmission} from './intake.mjs';
import {safeText} from './snapshot.mjs';

export const CANDIDATE_SCHEMA='dot-board.candidate/1';
export const candidateStatusLabels=Object.freeze({proposed:'候选建议，待你审核',approved:'已转成需求，待 dot 读取',rejected:'已拒绝'});
const candidateFields=['clientSubmissionId','projectId','contextTaskId','title','reason','expectedOutcome','sourceReferences','dueAt','area','viewedSnapshotRevision','viewedSnapshotImportedAt'];
function candidateExact(value,keys){return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));}
function candidateText(value,max,name,required=false){const text=intakeString(value,max,name,{required});if(safeText(text,max)!==text)throw new IntakeError('invalid_'+name,400,'内容包含不能保存的引用或敏感字段');return text;}
function candidateTime(value,name){
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value))throw new IntakeError('invalid_'+name);
  const normalized=value.includes('.')?value.replace(/\.(\d{1,3})Z$/,(_,fraction)=>'.'+fraction.padEnd(3,'0')+'Z'):value.replace(/Z$/,'.000Z');
  if(!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==normalized)throw new IntakeError('invalid_'+name);
  return value;
}
export function normalizeCandidateProposal(raw){
  if(!candidateExact(raw,candidateFields)||!intakeId(raw.projectId))throw new IntakeError('invalid_candidate');
  const title=candidateText(raw.title,200,'candidate_title',true),reason=candidateText(raw.reason,1600,'candidate_reason',true),expectedOutcome=candidateText(raw.expectedOutcome,1600,'candidate_outcome',true);
  const submission=normalizeIntakeSubmission({...raw,body:title,contextSummary:''},raw.projectId);
  candidateTime(submission.viewedSnapshotImportedAt,'snapshot_time');
  if(!Array.isArray(raw.sourceReferences)||raw.sourceReferences.length<1||raw.sourceReferences.length>8)throw new IntakeError('invalid_candidate_sources');
  const sourceReferences=raw.sourceReferences.map(source=>{
    if(!candidateExact(source,['kind','label','reference'])||typeof source.kind!=='string'||! /^[A-Za-z][A-Za-z0-9_.:-]{0,39}$/.test(source.kind))throw new IntakeError('invalid_candidate_sources');
    return {kind:source.kind,label:candidateText(source.label,120,'source_label',true),reference:candidateText(source.reference,1800,'source_reference',true)};
  });
  if(new Set(sourceReferences.map(source=>JSON.stringify(source))).size!==sourceReferences.length)throw new IntakeError('invalid_candidate_sources');
  return {schemaVersion:CANDIDATE_SCHEMA,clientSubmissionId:submission.clientSubmissionId,projectId:submission.projectId,contextTaskId:submission.contextTaskId,title,reason,expectedOutcome,sourceReferences,dueAt:raw.dueAt==null?null:candidateTime(raw.dueAt,'candidate_due_at'),area:candidateText(raw.area??'',100,'candidate_area'),viewedSnapshotRevision:submission.viewedSnapshotRevision,viewedSnapshotImportedAt:submission.viewedSnapshotImportedAt};
}
export function normalizeCandidateReview(raw){
  if(!candidateExact(raw,['eventId','expectedVersion','decision','note'])||!intakeId(raw.eventId)||!Number.isSafeInteger(raw.expectedVersion)||raw.expectedVersion<1||raw.expectedVersion>=Number.MAX_SAFE_INTEGER||!['approve','reject'].includes(raw.decision))throw new IntakeError('invalid_candidate_review');
  return {eventId:raw.eventId,expectedVersion:raw.expectedVersion,decision:raw.decision,note:candidateText(raw.note??'',1200,'candidate_note')};
}
export function normalizeCandidateQuery(raw={}){
  if(!candidateExact(raw,['projectId','status','clientSubmissionId','cursor']))throw new IntakeError('invalid_candidate_query');
  const value={projectId:raw.projectId??null,status:raw.status??null,clientSubmissionId:raw.clientSubmissionId??null,cursor:raw.cursor??'0'};
  if(value.projectId!==null&&!intakeId(value.projectId)||value.status!==null&&!Object.hasOwn(candidateStatusLabels,value.status)||value.clientSubmissionId!==null&&(!intakeId(value.clientSubmissionId)||value.clientSubmissionId.length<16)||!/^\d{1,15}$/.test(String(value.cursor)))throw new IntakeError('invalid_candidate_query');
  return {...value,cursor:Number(value.cursor)};
}
export function candidateIntakeSubmission(candidate,requestId){
  // Sources remain intact on the durable candidate. They are evidence/context,
  // never authority to execute or to grant permissions through the request.
  const body=[candidate.title,'建议原因：'+candidate.reason,'预期结果：'+candidate.expectedOutcome,...(candidate.area?['领域：'+candidate.area]:[]),...(candidate.dueAt?['截止时间：'+candidate.dueAt]:[]),'候选记录：'+candidate.id,'来源引用保留在候选记录中；本次审核仅创建普通需求，仍待 dot 读取和处理。'].join('\n\n');
  return normalizeIntakeSubmission({clientSubmissionId:'candidate:'+requestId,body,contextTaskId:candidate.contextTaskId,viewedSnapshotRevision:candidate.viewedSnapshotRevision,viewedSnapshotImportedAt:candidate.viewedSnapshotImportedAt,contextSummary:'候选记录 '+candidate.id+'；来源仅作上下文，审核不表示受理、入队或执行。'},candidate.projectId);
}
export function candidateCapabilities(intake,storageAvailable){return {schemaVersion:CANDIDATE_SCHEMA,storageAvailable,canPropose:Boolean(storageAvailable&&intake.canSubmit),canReview:Boolean(storageAvailable&&intake.canSubmit),createsRequestOnly:true,statusLabels:candidateStatusLabels,maxTitleLength:200,maxReasonLength:1600,maxExpectedOutcomeLength:1600,maxSourceReferences:8};}
