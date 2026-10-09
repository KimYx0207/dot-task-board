import {ManualTaskStatusError,manualTaskOwner,normalizeManualTaskStatus,manualTaskContext,manualTaskStatusView} from '../domain/manual-task-status.mjs';

export function createManualTaskStatusService({store,ownerId,readSnapshot,readRegistry=async()=>[],clock=()=>new Date().toISOString()}={}){
  const manualTaskRequireOwner=owner=>{manualTaskOwner(owner);if(typeof ownerId!=='string'||!ownerId)throw new ManualTaskStatusError('owner_binding_unconfigured',503);if(owner!==ownerId)throw new ManualTaskStatusError('board_access_denied',403);};
  const manualTaskAvailable=async()=>Boolean(store&&await store.available());
  const manualTaskRequireStore=async()=>{if(!await manualTaskAvailable())throw new ManualTaskStatusError('manual_status_storage_unavailable',503);};
  const manualTaskReadContext=async taskId=>manualTaskContext(await readSnapshot(),await readRegistry(),taskId);
  const manualTaskView=async(owner,taskId,context,row)=>({taskId,...(manualTaskStatusView(row)??{version:0,state:null,reason:'',updatedAt:null,source:'owner_manual'}),executionControl:await store.executionControl(owner,context)});
  return {
    available:manualTaskAvailable,
    async get(owner,taskId){manualTaskRequireOwner(owner);await manualTaskRequireStore();const context=await manualTaskReadContext(taskId);return manualTaskView(owner,taskId,context,await store.get(owner,taskId));},
    async set(owner,input){manualTaskRequireOwner(owner);await manualTaskRequireStore();const value=normalizeManualTaskStatus(input),context=await manualTaskReadContext(value.taskId);const result=await store.set(owner,value,context,clock());return {...await manualTaskView(owner,value.taskId,context,result.row),duplicate:result.duplicate};},
    async overlay(owner,snapshot){
      manualTaskRequireOwner(owner);
      if(!snapshot||!Array.isArray(snapshot.tasks)||!await manualTaskAvailable())return snapshot;
      const current=await readSnapshot();if(!current||!Array.isArray(current.tasks))return snapshot;
      const allowed=new Set(current.tasks.map(task=>task.id)),ids=snapshot.tasks.filter(task=>allowed.has(task.id)).map(task=>task.id);
      const states=new Map((await store.listForTasks(owner,ids)).map(row=>[row.task_id,manualTaskStatusView(row)]));
      if(!states.size)return snapshot;
      return {...snapshot,tasks:snapshot.tasks.map(task=>states.has(task.id)?{...task,manualStatus:states.get(task.id)}:task)};
    }
  };
}
