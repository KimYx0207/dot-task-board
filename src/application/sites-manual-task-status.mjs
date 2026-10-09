import {readEnvironmentSnapshot} from '../adapters/snapshot.mjs';
import {readEnvironmentProjectRegistry} from '../adapters/project-registry.mjs';
import {createD1ManualTaskStatusStore} from '../adapters/d1-manual-task-status.mjs';
import {ManualTaskStatusError} from '../domain/manual-task-status.mjs';
import {createManualTaskStatusService} from './manual-task-status-service.mjs';

export function createSitesManualTaskStatus(env,{clock=()=>new Date().toISOString()}={}){
  return createManualTaskStatusService({store:createD1ManualTaskStatusStore(env.DB),ownerId:env.DOT_BOARD_OWNER_ID,clock,
    readSnapshot:()=>readEnvironmentSnapshot(env),
    readRegistry:()=>{const registry=readEnvironmentProjectRegistry(env);if(registry.status!=='configured')throw new ManualTaskStatusError('manual_status_context_unavailable',503);return registry.records;}
  });
}
