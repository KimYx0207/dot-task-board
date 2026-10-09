import {createD1BoardObservationOutbox} from '../adapters/d1-board-observation-outbox.mjs';
import {createSitesEventBridge,drainSourceObservations} from '../adapters/sites-event-bridge.mjs';
import {createSitesTaskControls} from './sites-task-controls.mjs';
import {IntakeError} from '../domain/intake.mjs';
import {readEnvironmentSnapshot} from '../adapters/snapshot.mjs';
import {readEnvironmentProjectRegistry} from '../adapters/project-registry.mjs';
import {readObservationBindings} from '../adapters/observation-bindings.mjs';
import {createD1BoardObservationStore} from '../adapters/d1-board-observations.mjs';
import {createBoardObservationService} from './board-observation-service.mjs';
export function createSitesObservations(env){
 if(env.DOT_BOARD_OBSERVATIONS_ENABLED!=='true')return null;
 const bridge=createSitesEventBridge({env}),outbox=bridge.configured?createD1BoardObservationOutbox(env.DB):null;
 const store=createD1BoardObservationStore(env.DB,{observationOutbox:outbox}),service=createBoardObservationService({store});
 const context=()=>{const snapshot=readEnvironmentSnapshot(env),bindings=readObservationBindings(env),registry=readEnvironmentProjectRegistry(env);if(!snapshot||registry.status!=='configured')throw new IntakeError('observation_context_unavailable',503);return {snapshot,bindings,registry:registry.records};};
 const ownerRequired=owner=>{if(!owner||owner!==env.DOT_BOARD_OWNER_ID)throw new IntakeError('board_access_denied',403);};
 return {
  async record(owner,input){ownerRequired(owner);const c=context();const controls=createSitesTaskControls(env),snapshot=outbox&&controls?await controls.overlay(owner,c.snapshot):c.snapshot;const receipt=await service.record(owner,input,snapshot,c.bindings,c.registry);if(!outbox)return receipt;let delivery;try{delivery=await drainSourceObservations({ownerId:owner,outbox,bridge,limit:5});}catch{delivery={accepted:0,pending:1};}return {...receipt,eventDelivery:{...delivery,automaticSourceRetry:false}};},
  async state(owner,taskId){ownerRequired(owner);const c=context();if(!c.snapshot.tasks.some(task=>task.id===taskId))throw new IntakeError('task_not_found',404);const binding=c.bindings.find(b=>b.taskId===taskId);return {...await service.state(owner,taskId),sourceBinding:binding?{taskId:binding.taskId,threadId:binding.threadId??null,environment:binding.environment??null,readAllowed:binding.readAllowed===true}:null,canRecord:Boolean(binding?.threadId&&binding.readAllowed===true),automaticMonitoring:false};},
  async overlay(owner,snapshot){ownerRequired(owner);const c=context();return service.overlay(owner,snapshot,c.bindings,c.registry);}
 };
}
