import {IntakeError,intakeId} from '../domain/intake.mjs';
import {readEnvironmentSnapshot} from '../adapters/snapshot.mjs';
import {createD1DispatchQueue} from '../adapters/d1-dispatch-queue.mjs';
export function createSitesTaskControls(env){
 const store=createD1DispatchQueue(env.DB);if(!store)return null;
 const taskFor=(owner,id)=>{if(!owner||owner!==env.DOT_BOARD_OWNER_ID)throw new IntakeError('board_access_denied',403);if(!intakeId(id))throw new IntakeError('invalid_task_control');const task=readEnvironmentSnapshot(env)?.tasks?.find(t=>t.id===id);if(!task)throw new IntakeError('task_not_found',404);return task;};
 const view=(task,row)=>({taskId:task.id,version:row?.version??0,state:row?.state??'active',reason:row?.reason??'',updatedAt:row?.updated_at??null,scope:'task',startsOrStopsProcesses:false});
 return {
  async get(owner,taskId){const task=taskFor(owner,taskId);return view(task,await store.control(owner,'task',taskId));},
  async set(owner,input){
   if(!input||Object.keys(input).some(k=>!['taskId','expectedVersion','state','reason'].includes(k))||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0||!['paused','deferred','canceled'].includes(input.state)||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>1200)throw new IntakeError('invalid_task_control');
   const task=taskFor(owner,input.taskId);
   const row=await store.setControl(owner,'task',input.taskId,input.state,input.expectedVersion,input.reason,new Date().toISOString());return view(task,row);
  },
  async overlay(owner,snapshot){
   if(!owner||owner!==env.DOT_BOARD_OWNER_ID)throw new IntakeError('board_access_denied',403);
   if(!snapshot||!Array.isArray(snapshot.tasks))return snapshot;
   const controls=new Map();
   for(let start=0;start<snapshot.tasks.length;start+=80){const ids=snapshot.tasks.slice(start,start+80).map(t=>t.id);const rows=await env.DB.prepare(`SELECT target_id,state FROM dispatch_controls WHERE owner_id=? AND scope='task' AND target_id IN (${ids.map(()=>'?').join(',')})`).bind(owner,...ids).all();for(const row of rows.results)controls.set(row.target_id,row.state);}
   return {...snapshot,tasks:snapshot.tasks.map(task=>{const state=controls.get(task.id);if(task.state==='canceled')return task;if(state==='canceled'||state==='paused')return {...task,state};return task;})};
  }
 };
}
