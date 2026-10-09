import {IntakeError,intakeId} from './intake.mjs';
import {safeText} from './snapshot.mjs';

export class TaskRequirementsError extends IntakeError {constructor(code,status=400){super(code,status,code);this.name='TaskRequirementsError';}}
const requirementFields=['goal','acceptanceCriteria'];
const requirementObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const requirementExact=(value,keys)=>requirementObject(value)&&Object.keys(value).every(key=>keys.includes(key));
export function normalizeTaskRequirements(input){
 if(!requirementExact(input,['taskId','eventId','expectedVersion','changes','sourceReferences'])||!intakeId(input.taskId)||!intakeId(input.eventId)||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0||input.expectedVersion>=Number.MAX_SAFE_INTEGER)throw new TaskRequirementsError('invalid_task_requirements');
 if(!requirementExact(input.changes,requirementFields)||!Object.keys(input.changes).length)throw new TaskRequirementsError('invalid_requirement_fields');
 for(const value of Object.values(input.changes))if(typeof value!=='string'||safeText(value,400)!==value)throw new TaskRequirementsError('invalid_requirement_text');
 const refs=input.sourceReferences;
 if(!Array.isArray(refs)||refs.length<1||refs.length>5||new Set(refs).size!==refs.length||refs.some(value=>typeof value!=='string'||!value.trim()||value!==value.trim()||safeText(value,200)!==value))throw new TaskRequirementsError('invalid_requirement_sources');
 return {taskId:input.taskId,eventId:input.eventId,expectedVersion:input.expectedVersion,changes:{...input.changes},sourceReferences:[...refs]};
}
export function taskRequirementsContext(snapshot,taskId){
 if(!intakeId(taskId))throw new TaskRequirementsError('invalid_task_id');
 if(!snapshot||!Array.isArray(snapshot.tasks)||snapshot.tasks.length>200)throw new TaskRequirementsError('requirements_context_unavailable',503);
 const tasks=snapshot.tasks.filter(task=>task.id===taskId);if(tasks.length!==1)throw new TaskRequirementsError('task_not_found',404);return tasks[0];
}
export function taskRequirementNotes(row){
 if(!row)return {};
 let notes;try{notes=JSON.parse(row.fields_json);}catch{throw new TaskRequirementsError('requirements_record_invalid',503);}
 if(!requirementExact(notes,requirementFields))throw new TaskRequirementsError('requirements_record_invalid',503);
 for(const [field,note] of Object.entries(notes)){
  if(!requirementExact(note,['value','sourceReferences']))throw new TaskRequirementsError('requirements_record_invalid',503);
  normalizeTaskRequirements({taskId:row.task_id,eventId:row.event_id,expectedVersion:row.version-1,changes:{[field]:note.value},sourceReferences:note.sourceReferences});
 }
 return notes;
}
export function taskRequirementsView(task,row){
 const notes=taskRequirementNotes(row),sourceReferences={};for(const field of requirementFields)sourceReferences[field]=notes[field]?.sourceReferences??[];
 return {taskId:task.id,version:row?.version??0,goal:notes.goal?.value??safeText(task.goal,400),acceptanceCriteria:notes.acceptanceCriteria?.value??safeText(task.acceptanceCriteria,400),sourceReferences,updatedAt:row?.updated_at??null,source:row?'owner_recorded_requirement':'task_snapshot',grantsExecution:false};
}
