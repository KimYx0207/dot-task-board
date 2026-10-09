import {intakeDigest,intakeId} from '../domain/intake.mjs';
import {ManualTaskStatusError,manualTaskOwner,normalizeManualTaskStatus} from '../domain/manual-task-status.mjs';

const manualTaskControlScope=`((c.scope='project' AND c.target_id=?) OR (c.scope='task' AND (c.target_id IN (?,?) OR c.target_id IN (SELECT root_job_id FROM dispatch_jobs WHERE owner_id=? AND id=?) OR c.target_id IN (SELECT context_task_id FROM dispatch_jobs WHERE owner_id=? AND id=?))))`;
const manualTaskControlArgs=(owner,context)=>[context.projectId,context.taskId,context.controlTargetId,owner,context.controlTargetId,owner,context.controlTargetId];
function manualTaskStoreContext(context,taskId){
  if(!context||context.taskId!==taskId||!intakeId(context.projectId)||!intakeId(context.controlTargetId)||!['active','deferred','paused','canceled'].includes(context.registryState))throw new ManualTaskStatusError('manual_status_context_unavailable',503);
}
export function createD1ManualTaskStatusStore(db){
  const manualTaskRequireDb=()=>{if(!db?.prepare||!db?.batch)throw new ManualTaskStatusError('manual_status_storage_unavailable',503);};
  const manualTaskFindEvent=async(owner,eventId)=>{manualTaskRequireDb();manualTaskOwner(owner);return db.prepare('SELECT * FROM task_manual_status_events WHERE owner_id=? AND event_id=?').bind(owner,eventId).first();};
  const manualTaskGet=async(owner,taskId)=>{manualTaskRequireDb();manualTaskOwner(owner);return db.prepare('SELECT * FROM task_manual_status_events WHERE owner_id=? AND task_id=? ORDER BY version DESC LIMIT 1').bind(owner,taskId).first();};
  const manualTaskControls=async(owner,context)=>{
    manualTaskRequireDb();manualTaskOwner(owner);manualTaskStoreContext(context,context.taskId);
    const rows=(await db.prepare(`SELECT state,version,reason,updated_at FROM dispatch_controls c WHERE c.owner_id=? AND ${manualTaskControlScope}`).bind(owner,...manualTaskControlArgs(owner,context)).all()).results;
    const priority={active:0,deferred:1,paused:2,canceled:3};
    const registry={state:context.registryState,version:0,reason:context.policyReason??(context.registryState==='active'?'':'项目执行配置：'+context.registryState),updated_at:null};
    const strongest=[...rows,registry].sort((a,b)=>priority[b.state]-priority[a.state]||(Date.parse(b.updated_at)||0)-(Date.parse(a.updated_at)||0))[0];
    return {state:strongest.state,version:strongest.version,reason:strongest.reason};
  };
  return {
    async available(){try{manualTaskRequireDb();await db.prepare('SELECT owner_id,event_id,task_id,payload_digest,version,state,reason,updated_at FROM task_manual_status_events LIMIT 0').all();await db.prepare('SELECT owner_id,scope,target_id,state,version,reason,updated_at FROM dispatch_controls LIMIT 0').all();await db.prepare('SELECT owner_id,id,root_job_id,context_task_id FROM dispatch_jobs LIMIT 0').all();return true;}catch{return false;}},
    get:manualTaskGet,
    executionControl:manualTaskControls,
    async listForTasks(owner,taskIds){
      manualTaskRequireDb();manualTaskOwner(owner);
      if(!Array.isArray(taskIds)||taskIds.length>200||taskIds.some(id=>!intakeId(id)))throw new ManualTaskStatusError('invalid_manual_task_scope');
      const result=[];
      for(let offset=0;offset<taskIds.length;offset+=80){const ids=taskIds.slice(offset,offset+80);const rows=await db.prepare(`SELECT m.* FROM task_manual_status_events m WHERE m.owner_id=? AND m.task_id IN (${ids.map(()=>'?').join(',')}) AND m.version=(SELECT MAX(latest.version) FROM task_manual_status_events latest WHERE latest.owner_id=m.owner_id AND latest.task_id=m.task_id)`).bind(owner,...ids).all();result.push(...rows.results);}
      return result;
    },
    async set(owner,input,context,now){
      manualTaskRequireDb();manualTaskOwner(owner);
      const value=normalizeManualTaskStatus(input);manualTaskStoreContext(context,value.taskId);
      const nowMs=Date.parse(now);if(!Number.isFinite(nowMs))throw new ManualTaskStatusError('invalid_server_clock',503);const updatedAt=new Date(nowMs).toISOString();
      const digest=await intakeDigest(value),prior=await manualTaskFindEvent(owner,value.eventId);
      const duplicate=async row=>{if(row.task_id!==value.taskId||row.payload_digest!==digest)throw new ManualTaskStatusError('manual_status_event_conflict',409);return {row:await manualTaskGet(owner,value.taskId),duplicate:true};};
      if(prior)return duplicate(prior);
      const insert=db.prepare(`INSERT INTO task_manual_status_events(owner_id,event_id,task_id,payload_digest,version,state,reason,updated_at)
        SELECT ?,?,?,?,?,?,?,?
        WHERE ?=COALESCE((SELECT MAX(version) FROM task_manual_status_events WHERE owner_id=? AND task_id=?),0)
        AND (?<>'canceled' OR ?='canceled') AND (?<>'paused' OR ? IN ('paused','canceled'))
        AND NOT EXISTS(SELECT 1 FROM dispatch_controls c WHERE c.owner_id=? AND ${manualTaskControlScope} AND ((c.state='canceled' AND ?<>'canceled') OR (c.state='paused' AND ? NOT IN ('paused','canceled'))))
        ON CONFLICT(owner_id,event_id) DO NOTHING`).bind(owner,value.eventId,value.taskId,digest,value.expectedVersion+1,value.state,value.reason,updatedAt,value.expectedVersion,owner,value.taskId,context.registryState,value.state,context.registryState,value.state,owner,...manualTaskControlArgs(owner,context),value.state,value.state);
      const gate={paused:'paused',canceled:'canceled',completed:'deferred'}[value.state];
      const statements=[insert];
      if(gate)statements.push(db.prepare(`INSERT INTO dispatch_controls(owner_id,scope,target_id,state,version,reason,updated_at)
        SELECT ?,'task',?,?,1,?,? FROM task_manual_status_events m
        WHERE m.owner_id=? AND m.event_id=? AND m.payload_digest=? AND m.version=? AND changes()=1
        ON CONFLICT(owner_id,scope,target_id) DO UPDATE SET state=excluded.state,version=dispatch_controls.version+1,reason=excluded.reason,updated_at=excluded.updated_at`).bind(owner,context.controlTargetId,gate,value.reason||'Owner manual task status: '+value.state,updatedAt,owner,value.eventId,digest,value.expectedVersion+1));
      const results=await db.batch(statements),saved=await manualTaskFindEvent(owner,value.eventId);
      if(saved){if(saved.payload_digest!==digest||saved.task_id!==value.taskId)throw new ManualTaskStatusError('manual_status_event_conflict',409);return {row:await manualTaskGet(owner,value.taskId),duplicate:results[0]?.meta?.changes!==1};}
      if(results[0]?.meta?.changes!==0)throw new ManualTaskStatusError('manual_status_write_unverified',503);
      const control=await manualTaskControls(owner,context);
      if(control.state==='canceled'&&value.state!=='canceled'||control.state==='paused'&&!['paused','canceled'].includes(value.state))throw new ManualTaskStatusError('execution_control_locked',409);
      throw new ManualTaskStatusError('manual_status_version_conflict',409);
    }
  };
}
