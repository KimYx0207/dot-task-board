import {IntakeError,intakeId,intakeProjectRegistry,intakeProjectForName} from './intake.mjs';
import {safeText} from './snapshot.mjs';

export const MANUAL_TASK_STATES=Object.freeze(['queued','running','blocked','paused','completed','canceled']);
export class ManualTaskStatusError extends IntakeError {
  constructor(code,status=400){super(code,status,code);this.name='ManualTaskStatusError';}
}
export function manualTaskOwner(owner){
  if(typeof owner!=='string'||!owner||owner.length>200||owner!==owner.trim()||/[\u0000-\u001f\u007f]/.test(owner))throw new ManualTaskStatusError('authentication_required',401);
  return owner;
}
export function normalizeManualTaskStatus(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['taskId','expectedVersion','eventId','state','reason'].includes(key))||!intakeId(input.taskId)||!intakeId(input.eventId)||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0||input.expectedVersion>=Number.MAX_SAFE_INTEGER||!MANUAL_TASK_STATES.includes(input.state))throw new ManualTaskStatusError('invalid_manual_task_status');
  const reason=input.reason??'';
  if(typeof reason!=='string'||safeText(reason,1200)!==reason)throw new ManualTaskStatusError('invalid_manual_status_reason');
  return {taskId:input.taskId,expectedVersion:input.expectedVersion,eventId:input.eventId,state:input.state,reason};
}
export function manualTaskContext(snapshot,registry,taskId){
  if(!intakeId(taskId))throw new ManualTaskStatusError('invalid_manual_task_id');
  if(!snapshot||!Array.isArray(snapshot.tasks)||snapshot.tasks.length>200)throw new ManualTaskStatusError('manual_status_context_unavailable',503);
  const tasks=snapshot.tasks.filter(task=>task?.id===taskId);
  if(tasks.length!==1)throw new ManualTaskStatusError('task_not_found',404);
  const task=tasks[0],records=intakeProjectRegistry(registry),project=task.projectId?records.find(row=>row.id===task.projectId):intakeProjectForName(records,task.project);
  if(!project)throw new ManualTaskStatusError('manual_status_project_unmapped',503);
  const controlTargetId=taskId.startsWith('dispatch:')?taskId.slice('dispatch:'.length):taskId;
  if(!intakeId(controlTargetId))throw new ManualTaskStatusError('invalid_manual_task_id');
  let registryState=project.executionState??'active',policyReason=registryState==='active'?'':'项目执行配置：'+registryState;
  if(task.state==='canceled'||task.state==='paused'&&registryState!=='canceled'){
    registryState=task.state;policyReason='任务快照标记为：'+task.state;
  }
  return {taskId,projectId:project.id,controlTargetId,registryState,policyReason};
}
export function manualTaskStatusView(row){return row?{version:row.version,state:row.state,reason:row.reason,updatedAt:row.updated_at,source:'owner_manual'}:null;}
