import {safeText,safeLink} from './snapshot.mjs';
import {IntakeError,intakeId,intakeProjectRegistry,intakeProjectForName} from './intake.mjs';

export class BoardObservationError extends IntakeError {
  constructor(code,status=400){super(code,status,code);this.name='BoardObservationError';}
}
export const BOARD_OBSERVATION_STATES=Object.freeze(['unknown','partial','blocked','paused','completed','canceled']);
const boardObsFields=Object.freeze({stage:100,observation:600,blocker:400,nextAction:400});
const boardObsIsObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const boardObsOwn=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
export const boardObsExactKeys=(value,keys,required=[])=>boardObsIsObject(value)&&Object.keys(value).every(key=>keys.includes(key))&&required.every(key=>boardObsOwn(value,key));
const boardObsFail=(code,status=400)=>{throw new BoardObservationError(code,status);};
const boardObsIdentifier=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(value);
export function observationOwner(owner){
  if(typeof owner!=='string'||!owner||owner!==owner.trim()||owner.length>300||/[\u0000-\u001f\u007f]/.test(owner))boardObsFail('authentication_required',401);
  return owner;
}
// Date.parse alone accepts nonexistent dates such as 2026-02-30. Round-trip
// validation rejects those while retaining source precision in the journal.
export function observationTimestamp(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))return null;
  const ms=Date.parse(value);if(!Number.isFinite(ms))return null;
  const normalized=value.includes('.')?value.replace(/\.(\d{1,3})Z$/,(_,n)=>'.'+n.padEnd(3,'0')+'Z'):value.replace(/Z$/,'.000Z');
  return new Date(ms).toISOString()===normalized?ms:null;
}
export function observationEnvironment(value){
  if(value===null)return null;
  if(!boardObsExactKeys(value,['type','id'],['type','id'])||!boardObsIdentifier(value.type)||(value.id!==null&&!boardObsIdentifier(value.id)))boardObsFail('invalid_source_environment');
  return {type:value.type,id:value.id};
}
export function environmentsEqual(left,right){
  return left===null||right===null?left===right:left.type===right.type&&left.id===right.id;
}
function boardObsSafeString(value,max,{required=false}={}){
  if(typeof value!=='string'||safeText(value,max)!==value||(required&&!value))boardObsFail('unsafe_observation_text');
  return value;
}
function boardObsProofList(value,name){
  if(!Array.isArray(value)||value.length>20)boardObsFail('invalid_'+name);
  return value.map(item=>boardObsSafeString(item,300,{required:true}));
}
function boardObsContainsPrivateReference(text,source){
  const tokens=[source.threadId,source.turnId,source.itemId,source.environment?.id].filter(Boolean);
  // Source identifiers are only allowed in the owner-private source object.
  const variants=[text];
  for(let count=0;count<3;count++){try{const decoded=decodeURIComponent(variants.at(-1));if(decoded===variants.at(-1))break;variants.push(decoded);}catch{break;}}
  return tokens.some(token=>variants.some(value=>new RegExp('(^|[^a-zA-Z0-9])'+token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'($|[^a-zA-Z0-9])').test(value)));
}
export function normalizeBoardObservation(input,now){
  if(!boardObsExactKeys(input,['taskId','eventId','expectedVersion','source','changes','acceptance'],['taskId','eventId','expectedVersion','source','changes']))boardObsFail('invalid_observation');
  if(!intakeId(input.taskId)||!intakeId(input.eventId)||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0)boardObsFail('invalid_observation');
  if(!boardObsExactKeys(input.source,['threadId','environment','turnId','itemId','observedAt'],['threadId','environment','turnId','itemId','observedAt']))boardObsFail('invalid_observation_source');
  const source=input.source;
  if(![source.threadId,source.turnId,source.itemId].every(boardObsIdentifier))boardObsFail('invalid_observation_source');
  const observedMs=observationTimestamp(source.observedAt);
  if(observedMs===null)boardObsFail('invalid_source_timestamp');
  if(!Number.isFinite(now))boardObsFail('invalid_server_clock',503);
  if(observedMs>now)boardObsFail('future_source_timestamp',409);
  const normalizedSource={threadId:source.threadId,environment:observationEnvironment(source.environment),turnId:source.turnId,itemId:source.itemId,observedAt:source.observedAt};
  if(!boardObsExactKeys(input.changes,['state',...Object.keys(boardObsFields),'evidence'],['observation']))boardObsFail('invalid_observation_changes');
  const changes={};
  if(boardObsOwn(input.changes,'state')){
    if(!BOARD_OBSERVATION_STATES.includes(input.changes.state))boardObsFail('invalid_observation_state');
    changes.state=input.changes.state;
  }
  for(const [key,max] of Object.entries(boardObsFields))if(boardObsOwn(input.changes,key))changes[key]=boardObsSafeString(input.changes[key],max,{required:key==='observation'});
  if(boardObsOwn(input.changes,'evidence')){
    if(!Array.isArray(input.changes.evidence)||input.changes.evidence.length>8)boardObsFail('invalid_observation_evidence');
    changes.evidence=input.changes.evidence.map(row=>{
      if(!boardObsExactKeys(row,['label','url'],['label','url'])||typeof row.url!=='string'||!row.url.startsWith('https://')||safeLink(row.url)!==row.url)boardObsFail('invalid_observation_evidence');
      return {label:boardObsSafeString(row.label,70,{required:true}),url:row.url};
    });
  }
  let acceptance;
  if(boardObsOwn(input,'acceptance')){
    if(!boardObsExactKeys(input.acceptance,['verified','checkedScope','pendingChecks','noActiveWriter'],['verified','checkedScope','pendingChecks','noActiveWriter'])||typeof input.acceptance.verified!=='boolean'||typeof input.acceptance.noActiveWriter!=='boolean')boardObsFail('invalid_observation_acceptance');
    acceptance={verified:input.acceptance.verified,checkedScope:boardObsProofList(input.acceptance.checkedScope,'checked_scope'),pendingChecks:boardObsProofList(input.acceptance.pendingChecks,'pending_checks'),noActiveWriter:input.acceptance.noActiveWriter};
  }
  if(changes.state==='completed'&&!(acceptance?.verified===true&&acceptance.noActiveWriter===true&&acceptance.checkedScope.length>0&&acceptance.pendingChecks.length===0&&changes.evidence?.length>0))boardObsFail('completion_requires_acceptance',409);
  if(boardObsContainsPrivateReference(JSON.stringify(changes),normalizedSource))boardObsFail('private_source_reference_in_changes');
  const value={taskId:input.taskId,eventId:input.eventId,expectedVersion:input.expectedVersion,source:normalizedSource,changes,...(acceptance?{acceptance}:{})};
  if(new TextEncoder().encode(JSON.stringify(value)).byteLength>16384)boardObsFail('observation_too_large',413);
  return value;
}
export function observationTask(baseSnapshot,taskId){
  if(!baseSnapshot||!Array.isArray(baseSnapshot.tasks)||baseSnapshot.tasks.length>200)boardObsFail('board_unavailable',503);
  const matching=baseSnapshot.tasks.filter(task=>task?.id===taskId);
  if(matching.length!==1)boardObsFail('unknown_observation_task',404);
  const task=matching[0];
  if(task.observedAt!==null&&task.observedAt!==undefined&&observationTimestamp(task.observedAt)===null)boardObsFail('invalid_base_observation_time',503);
  return task;
}
export function observationBinding(bindings,taskId){
  if(!Array.isArray(bindings)||bindings.length>200)boardObsFail('observation_binding_unconfigured',503);
  const matching=bindings.filter(binding=>binding?.taskId===taskId);
  if(matching.length!==1||matching[0].readAllowed!==true)boardObsFail('observation_read_not_allowed',403);
  const binding=matching[0];
  if(!boardObsIdentifier(binding.threadId)||!boardObsOwn(binding,'environment'))boardObsFail('invalid_observation_binding',503);
  let environment;
  try{environment=observationEnvironment(binding.environment);}catch{boardObsFail('invalid_observation_binding',503);}
  return {taskId,threadId:binding.threadId,environment,readAllowed:true};
}
export function verifyObservationBinding(source,binding){
  if(source.threadId!==binding.threadId||!environmentsEqual(source.environment,binding.environment))boardObsFail('observation_binding_mismatch',409);
}
export function observationControl(task,registry){
  const records=intakeProjectRegistry(registry??[]),project=intakeProjectForName(records,task.project);
  if(task.state==='canceled'||project?.executionState==='canceled')return 'canceled';
  if(task.state==='paused'||project?.executionState==='paused')return 'paused';
  return null;
}
