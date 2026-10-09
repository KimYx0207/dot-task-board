import {TaskRequirementsError,normalizeTaskRequirements,taskRequirementsContext,taskRequirementsView,taskRequirementNotes} from '../domain/task-requirements.mjs';

export function createTaskRequirementsService({store,ownerId,readSnapshot,clock=()=>new Date().toISOString()}={}){
 const requireOwner=owner=>{if(typeof owner!=='string'||!owner||owner!==owner.trim()||owner.length>200)throw new TaskRequirementsError('authentication_required',401);if(typeof ownerId!=='string'||!ownerId)throw new TaskRequirementsError('owner_binding_unconfigured',503);if(owner!==ownerId)throw new TaskRequirementsError('board_access_denied',403);};
 const available=async()=>Boolean(store&&await store.available());
 const requireStore=async()=>{if(!await available())throw new TaskRequirementsError('requirements_storage_unavailable',503);};
 return {available,
  async get(owner,taskId){requireOwner(owner);await requireStore();const task=taskRequirementsContext(await readSnapshot(),taskId);return taskRequirementsView(task,await store.get(owner,taskId));},
  async set(owner,input){requireOwner(owner);await requireStore();const value=normalizeTaskRequirements(input),task=taskRequirementsContext(await readSnapshot(),value.taskId);const result=await store.set(owner,value,clock());return {...taskRequirementsView(task,result.row),duplicate:result.duplicate};},
  async overlay(owner,snapshot){
   requireOwner(owner);if(!snapshot||!Array.isArray(snapshot.tasks)||!await available())return snapshot;
   const current=await readSnapshot();if(!current||!Array.isArray(current.tasks))return snapshot;const allowed=new Set(current.tasks.map(task=>task.id));
   const rows=await store.listForTasks(owner,snapshot.tasks.filter(task=>allowed.has(task.id)).map(task=>task.id));const notes=new Map(rows.map(row=>[row.task_id,taskRequirementNotes(row)]));if(!notes.size)return snapshot;
   return {...snapshot,tasks:snapshot.tasks.map(task=>{const fields=notes.get(task.id);if(!fields)return task;return {...task,...Object.fromEntries(Object.entries(fields).map(([key,note])=>[key,note.value]))};})};
  }
 };
}
