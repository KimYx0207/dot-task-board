import {readEnvironmentSnapshot} from '../adapters/snapshot.mjs';
import {createD1TaskRequirementsStore} from '../adapters/d1-task-requirements.mjs';
import {createTaskRequirementsService} from './task-requirements-service.mjs';
export function createSitesTaskRequirements(env,{clock=()=>new Date().toISOString()}={}){
 return createTaskRequirementsService({store:createD1TaskRequirementsStore(env.DB),ownerId:env.DOT_BOARD_OWNER_ID,readSnapshot:()=>readEnvironmentSnapshot(env),clock});
}
