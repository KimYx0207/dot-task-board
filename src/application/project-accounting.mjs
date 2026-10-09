import {safeText,timestamp} from '../domain/snapshot.mjs';
import {executionEvidenceView} from '../domain/execution-evidence.mjs';

export function projectAccountingView(accounting,registry,now=Date.now()){
 if(!accounting)return null;
 const ids=[...new Set([...registry.map(p=>p.id),...accounting.totals.map(row=>row.project_id)])];
 return ids.map(projectId=>{
  const row=accounting.totals.find(item=>item.project_id===projectId),registered=Number(row?.registered)||0,completed=Number(row?.completed)||0,removed=Number(row?.removed)||0;
  const running=accounting.currentJobs.filter(job=>job.projectId===projectId).map(job=>({job,activity:executionEvidenceView(job,now)}));
  const changes=accounting.changes.filter(change=>change.project_id===projectId).map(change=>({type:change.action==='enqueue'?'registered':'removed',taskNumber:change.task_number,recordedAt:timestamp(change.created_at)}));
  const changeCount=Number(row?.change_count)||0;
  return {projectId,projectName:safeText(registry.find(project=>project.id===projectId)?.name,100,'项目未记录'),registered,completed,removed,activeRegistered:registered-removed,lastTaskNumber:row?.last_task_number??null,current:running.filter(({activity})=>activity.effectiveState==='running').map(({job,activity})=>({taskNumber:job.taskNumber,jobId:job.id,currentStep:activity.currentStep,evidenceType:activity.evidenceType,lastExecutionObservedAt:activity.lastExecutionObservedAt,evidenceExpiresAt:activity.evidenceExpiresAt})),unverifiedRunning:running.filter(({activity})=>activity.effectiveState==='unknown').map(({job})=>job.taskNumber),scopeChanges:changes,coverage:{scope:'managed_queue',totalsComplete:true,includesCanceled:true,scopeChangesTotal:changeCount,scopeChangesShown:changes.length,scopeChangesOmitted:Math.max(0,changeCount-changes.length),dependencyCoverage:'not_recorded'}};
 });
}
