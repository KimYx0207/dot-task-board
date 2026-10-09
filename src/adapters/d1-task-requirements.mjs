import {intakeDigest,intakeId} from '../domain/intake.mjs';
import {TaskRequirementsError,normalizeTaskRequirements,taskRequirementNotes} from '../domain/task-requirements.mjs';

export function createD1TaskRequirementsStore(db){
 const requireDB=()=>{if(!db?.prepare)throw new TaskRequirementsError('requirements_storage_unavailable',503);};
 const get=async(owner,taskId)=>{requireDB();return db.prepare('SELECT * FROM task_requirement_events WHERE owner_id=? AND task_id=? ORDER BY version DESC LIMIT 1').bind(owner,taskId).first();};
 const event=async(owner,eventId)=>{requireDB();return db.prepare('SELECT * FROM task_requirement_events WHERE owner_id=? AND event_id=?').bind(owner,eventId).first();};
 return {
  async available(){try{requireDB();await db.prepare('SELECT owner_id,event_id,task_id,payload_digest,version,fields_json,updated_at FROM task_requirement_events LIMIT 0').all();return true;}catch{return false;}},get,
  async listForTasks(owner,taskIds){
   requireDB();if(!Array.isArray(taskIds)||taskIds.length>200||taskIds.some(id=>!intakeId(id)))throw new TaskRequirementsError('invalid_requirement_scope');const out=[];
   for(let at=0;at<taskIds.length;at+=80){const ids=taskIds.slice(at,at+80);const rows=await db.prepare(`SELECT r.* FROM task_requirement_events r WHERE r.owner_id=? AND r.task_id IN (${ids.map(()=>'?').join(',')}) AND r.version=(SELECT MAX(latest.version) FROM task_requirement_events latest WHERE latest.owner_id=r.owner_id AND latest.task_id=r.task_id)`).bind(owner,...ids).all();out.push(...rows.results);}return out;
  },
  async set(owner,input,now){
   requireDB();const value=normalizeTaskRequirements(input),digest=await intakeDigest(value),prior=await event(owner,value.eventId);
   const replay=async row=>{if(row.task_id!==value.taskId||row.payload_digest!==digest)throw new TaskRequirementsError('requirements_event_conflict',409);return {row:await get(owner,value.taskId),duplicate:true};};
   if(prior)return replay(prior);
   const current=await get(owner,value.taskId);if((current?.version??0)!==value.expectedVersion){const concurrent=await event(owner,value.eventId);if(concurrent)return replay(concurrent);throw new TaskRequirementsError('requirements_version_conflict',409);}
   const notes=taskRequirementNotes(current);for(const [field,text] of Object.entries(value.changes))notes[field]={value:text,sourceReferences:[...value.sourceReferences]};
   if(!Number.isFinite(Date.parse(now)))throw new TaskRequirementsError('invalid_server_clock',503);
   const result=await db.prepare(`INSERT INTO task_requirement_events(owner_id,event_id,task_id,payload_digest,version,fields_json,updated_at)
     SELECT ?,?,?,?,?,?,? WHERE ?=COALESCE((SELECT MAX(version) FROM task_requirement_events WHERE owner_id=? AND task_id=?),0)
     ON CONFLICT(owner_id,event_id) DO NOTHING`).bind(owner,value.eventId,value.taskId,digest,value.expectedVersion+1,JSON.stringify(notes),new Date(now).toISOString(),value.expectedVersion,owner,value.taskId).run();
   const saved=await event(owner,value.eventId);
   if(saved){if(saved.task_id!==value.taskId||saved.payload_digest!==digest)throw new TaskRequirementsError('requirements_event_conflict',409);return {row:await get(owner,value.taskId),duplicate:result.meta?.changes!==1};}
   if(result.meta?.changes!==0)throw new TaskRequirementsError('requirements_write_unverified',503);
   throw new TaskRequirementsError('requirements_version_conflict',409);
  }
 };
}
