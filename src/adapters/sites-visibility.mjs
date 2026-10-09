import {readEnvironmentSnapshot} from './snapshot.mjs';
import {readEnvironmentProjectRegistry} from './project-registry.mjs';
import {intakeId,intakeProjectForName} from '../domain/intake.mjs';
export function applySitesVisibility(env){
 const raw=env.DOT_BOARD_HIDDEN_PROJECT_IDS;
 if(!raw)return env;
 let ids;try{ids=JSON.parse(raw);}catch{throw new Error('invalid_visibility_configuration');}
 if(!Array.isArray(ids)||ids.length>200||ids.some(id=>!intakeId(id)))throw new Error('invalid_visibility_configuration');
 if(!ids.length)return env;
 const hidden=new Set(ids),registry=readEnvironmentProjectRegistry(env),snapshot=readEnvironmentSnapshot(env);
 if(registry.status!=='configured'||!snapshot)return env;
 const visibleName=name=>!hidden.has(intakeProjectForName(registry.records,name)?.id);
 const tasks=snapshot.tasks.filter(task=>visibleName(task.project)),taskIds=new Set(tasks.map(task=>task.id));
 const agents=(snapshot.agents??[]).map(agent=>({...agent,taskIds:(agent.taskIds??[]).filter(id=>taskIds.has(id)),projectNames:(agent.projectNames??[]).filter(visibleName)})).filter(agent=>agent.kind==='coordinator'||agent.taskIds.length||agent.projectNames.length);
 return {...env,DOT_BOARD_PROJECT_REGISTRY:JSON.stringify(registry.records.filter(project=>!hidden.has(project.id))),DOT_BOARD_SNAPSHOT:JSON.stringify({...snapshot,tasks,agents})};
}
