import {intakeDigest,intakeId,intakeProjectRegistry,intakeProjectForName} from '../domain/intake.mjs';
import {BOARD_OBSERVATION_STATES,BoardObservationError,boardObsExactKeys,normalizeBoardObservation,observationOwner,observationTimestamp,observationTask,observationBinding,verifyObservationBinding,observationControl} from '../domain/board-observation.mjs';

const boardObsMetadataKey=Symbol('owner-private-board-observation-overlay');
export function boardObservationMetadata(snapshot){return snapshot?.[boardObsMetadataKey]??null;}
// Each inherited field retains its actual source. A newer base import can
// supersede some old fields without discarding a later fresh observation.
function boardObsFreshMaterialization(stored,task,binding,now){
  if(!boardObsExactKeys(stored,['input','effectiveChanges','effectiveSources','effectiveAcceptance'],['input','effectiveChanges','effectiveSources','effectiveAcceptance']))throw new BoardObservationError('invalid_stored_observation');
  const input=normalizeBoardObservation(stored.input,now);
  verifyObservationBinding(input.source,binding);
  const effectiveChanges={},effectiveSources={};
  if(!boardObsExactKeys(stored.effectiveChanges,['state','stage','observation','blocker','nextAction','evidence'])||!boardObsExactKeys(stored.effectiveSources,Object.keys(stored.effectiveChanges),Object.keys(stored.effectiveChanges)))throw new BoardObservationError('invalid_stored_observation');
  for(const [field,value] of Object.entries(stored.effectiveChanges)){
    const sourceInput={...input,source:stored.effectiveSources[field],changes:{observation:'Field source verification'}};delete sourceInput.acceptance;
    const source=normalizeBoardObservation(sourceInput,now).source;
    verifyObservationBinding(source,binding);
    if(task.observedAt&&observationTimestamp(source.observedAt)<=observationTimestamp(task.observedAt))continue;
    effectiveChanges[field]=value;effectiveSources[field]=source;
  }
  const effectiveAcceptance=effectiveChanges.state==='completed'?stored.effectiveAcceptance:null;
  if(Object.keys(effectiveChanges).length){
    const validation={...input,changes:{...effectiveChanges,observation:effectiveChanges.observation??'Field validation'}};
    delete validation.acceptance;
    if(effectiveAcceptance)validation.acceptance=effectiveAcceptance.proof;
    normalizeBoardObservation(validation,now);
  }
  return {input,effectiveChanges,effectiveSources,effectiveAcceptance};
}
export function createBoardObservationService({store,clock=()=>new Date().toISOString()}={}){
  const boardObsRequireStore=()=>{if(!store)throw new BoardObservationError('observation_storage_unavailable',503);};
  return {
    async available(){return Boolean(store&&await store.available());},
    async record(owner,input,baseSnapshot,bindings,registry){
      observationOwner(owner);boardObsRequireStore();
      const value=normalizeBoardObservation(input,observationTimestamp(clock()));
      const task=observationTask(baseSnapshot,value.taskId),binding=observationBinding(bindings,value.taskId);
      verifyObservationBinding(value.source,binding);
      const control=observationControl(task,registry); // Validate control configuration; never mutate it.
      const digest=await intakeDigest(value),existing=await store.findEvent(owner,value.eventId);
      if(existing){
        if(existing.taskId!==value.taskId||existing.digest!==digest)throw new BoardObservationError('observation_event_conflict',409);
        const {digest:ignored,...receipt}=existing;return {...receipt,duplicate:true};
      }
      if(task.observedAt&&observationTimestamp(value.source.observedAt)<=observationTimestamp(task.observedAt))throw new BoardObservationError('stale_base_observation',409);
      const current=await store.state(owner,value.taskId);
      if((current?.version??0)!==value.expectedVersion){
        const concurrent=await store.findEvent(owner,value.eventId);
        if(concurrent&&concurrent.taskId===value.taskId&&concurrent.digest===digest){const {digest:ignored,...receipt}=concurrent;return {...receipt,duplicate:true};}
        throw new BoardObservationError('observation_version_conflict',409);
      }
      let inherited={effectiveChanges:{},effectiveSources:{},effectiveAcceptance:null};
      if(current)try{inherited=boardObsFreshMaterialization(current.observation,task,binding,observationTimestamp(clock()));}catch(error){if(!(error instanceof BoardObservationError))throw error;}
      const effectiveChanges={...inherited.effectiveChanges,...value.changes};
      const effectiveSources={...inherited.effectiveSources,...Object.fromEntries(Object.keys(value.changes).map(field=>[field,value.source]))};
      if(!effectiveChanges.state&&!BOARD_OBSERVATION_STATES.includes(task.state)){
        effectiveChanges.state='unknown';effectiveSources.state=value.source;
      }
      let effectiveAcceptance=inherited.effectiveAcceptance;
      if(value.changes.state==='completed')effectiveAcceptance={proof:value.acceptance,source:value.source};
      else if(value.changes.state)effectiveAcceptance=null;
      if(effectiveChanges.state==='completed'){
        if(Object.hasOwn(value.changes,'evidence')&&value.changes.state!=='completed')throw new BoardObservationError('completion_proof_change_requires_acceptance',409);
        if(!effectiveAcceptance||!effectiveChanges.evidence?.length)throw new BoardObservationError('completion_requires_acceptance',409);
      }
      let eventContext=null;
      if(store.observationOutboxEnabled){
        const projectId=intakeProjectForName(intakeProjectRegistry(registry),task.project)?.id;
        if(!projectId)throw new BoardObservationError('observation_event_project_unmapped',409);
        eventContext={projectId,status:control??effectiveChanges.state??task.state};
      }
      return store.append(owner,value,digest,{input:value,effectiveChanges,effectiveSources,effectiveAcceptance},eventContext);
    },
    async state(owner,taskId){
      observationOwner(owner);boardObsRequireStore();
      if(!intakeId(taskId))throw new BoardObservationError('invalid_observation_task');
      const current=await store.state(owner,taskId);
      return current??{taskId,version:0,observation:null};
    },
    async overlay(owner,baseSnapshot,bindings,registry){
      observationOwner(owner);boardObsRequireStore();
      if(!baseSnapshot||!Array.isArray(baseSnapshot.tasks)||baseSnapshot.tasks.length>200)throw new BoardObservationError('board_unavailable',503);
      const current=await store.latestForTasks(owner,baseSnapshot.tasks.map(task=>task.id));
      const records=new Map(current.map(row=>[row.taskId,row]));
      const applied=[];
      const tasks=baseSnapshot.tasks.map(task=>{
        const row=records.get(task.id);if(!row)return task;
        let value;
        try{
          // Revalidate persisted payloads against current mappings and time. A
          // removed/disabled/remapped binding never releases old private data.
          observationTask(baseSnapshot,task.id);
          value=boardObsFreshMaterialization(row.observation,task,observationBinding(bindings,task.id),observationTimestamp(clock()));
          if(task.observedAt&&observationTimestamp(value.input.source.observedAt)<=observationTimestamp(task.observedAt))return task;
        }catch(error){if(error instanceof BoardObservationError)return task;throw error;}
        const control=observationControl(task,registry);
        const result={...task,...value.effectiveChanges,observedAt:value.input.source.observedAt};
        if(!value.effectiveChanges.state&&!BOARD_OBSERVATION_STATES.includes(task.state))result.state='unknown';
        if(control)result.state=control;
        if(value.effectiveChanges.state==='completed'&&value.effectiveAcceptance)result.verification={...task.verification,businessAcceptance:{state:'passed',note:'本次业务完成范围及证据已核验，待核验项为零。',observedAt:value.effectiveAcceptance.source.observedAt}};
        else if(value.effectiveChanges.state&&task.verification?.businessAcceptance?.state==='passed')result.verification={...task.verification,businessAcceptance:{state:'pending',note:'最新任务状态尚未满足全部业务完成验收。',observedAt:value.effectiveSources.state.observedAt}};
        applied.push(value.input.source.observedAt);return result;
      });
      if(!applied.length)return baseSnapshot;
      const result={...baseSnapshot,tasks};
      Object.defineProperty(result,boardObsMetadataKey,{value:Object.freeze({taskCount:applied.length,latestObservedAt:applied.reduce((a,b)=>Date.parse(a)>Date.parse(b)?a:b),scope:'selected_task_observations',agentRecordsUpdated:false}),enumerable:true});
      return result;
    }
  };
}
