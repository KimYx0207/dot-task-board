import {applySitesVisibility} from '../adapters/sites-visibility.mjs';
import {createSitesManualTaskStatus} from './sites-manual-task-status.mjs';
import {readObservationBindings} from '../adapters/observation-bindings.mjs';
import {readEnvironmentSnapshot} from '../adapters/snapshot.mjs';
import {createD1DispatchQueue} from '../adapters/d1-dispatch-queue.mjs';
import {createSitesManualCheck} from './sites-manual-check.mjs';
import {createSitesEventBridge} from '../adapters/sites-event-bridge.mjs';
import {createD1BoardObservationOutbox} from '../adapters/d1-board-observation-outbox.mjs';
import {handleIntakeMcp} from '../presentation/intake-mcp.mjs';
import {readIntakeJson} from '../presentation/intake-http.mjs';
import {createSitesTaskControls} from './sites-task-controls.mjs';
import {createSitesObservations} from './sites-observations.mjs';
import {createWorker} from '../../worker.mjs';
// Only for the existing owner-private Sites deployment. Sites dispatch validates
// sign-in/OAuth and supplies the per-site identity; this is NOT a generic public
// Worker authentication adapter. Never expose this entry behind an untrusted proxy.
export function createSitesPrivateEntry(assets={}){
 const worker=createWorker(assets,undefined,{projectQueueProjection:false,manualStatusFor:env=>createSitesManualTaskStatus(env),manualCheckFor:(env,services)=>createSitesManualCheck(env,services),taskControlsFor:env=>createSitesTaskControls(env),observationsFor:env=>createSitesObservations(env),readObservationSnapshot:async(snapshot,env,owner)=>{const controls=createSitesTaskControls(env),controlled=controls?await controls.overlay(owner,snapshot):snapshot,observations=createSitesObservations(env);const observed=observations?await observations.overlay(owner,controlled):controlled,manual=createSitesManualTaskStatus(env);return manual?manual.overlay(owner,observed):observed;}});
 return {async fetch(request,env={},ctx={}){
  if(env.DOT_BOARD_INGRESS!=='sites-owner-private-v1'||typeof env.DOT_BOARD_OWNER_ID!=='string'||!env.DOT_BOARD_OWNER_ID||!env.DOT_BOARD_AUDIENCE)return Response.json({error:'owner_binding_unconfigured'},{status:503});
  // The stable Sites user ID is audience-bound to this Site. The configured
  // origin additionally rejects accidental use at a different deployment.
  const url=new URL(request.url);if(url.origin!==env.DOT_BOARD_AUDIENCE)return Response.json({error:'audience_rejected'},{status:403});
  const owner=request.headers.get('oai-authenticated-user-id');
  if(!owner)return Response.json({error:'authentication_required'},{status:401});
  if(owner!==env.DOT_BOARD_OWNER_ID)return Response.json({error:'board_access_denied'},{status:403});
  try{env=applySitesVisibility(env);}catch{return Response.json({error:'invalid_visibility_configuration'},{status:503});}
  // Event control stays behind the original Sites owner boundary. Only the
  // independent relay has callback egress; no callback secret is returned here.
  if(url.pathname==='/mcp'&&request.method==='POST'&&env.DOT_BOARD_EVENT_BRIDGE_ENABLED==='true'){
   const bridge=createSitesEventBridge({env}),outbox=createD1BoardObservationOutbox(env.DB);
   if(bridge.configured&&await outbox.available()){
    let message;try{message=await readIntakeJson(request.clone());}catch{}
    if(['server/discover','events/list','events/subscribe','events/unsubscribe'].includes(message?.method))return handleIntakeMcp(request,{mcpEnabled:env.DOT_BOARD_INTAKE_MCP_ENABLED==='true',events:bridge,eventsEnabled:true});
   }
  }
  // This platform has not supplied an attested public callback egress contract.
  // Environment toggles cannot enable events or install an execution provider.
  const response=await worker.fetch(request,{...env,DOT_BOARD_EVENTS_ENABLED:'false'},ctx);
  if(url.pathname==='/api/dispatch/queue'&&response.ok){
   const value=await response.json();
   const bindings=readObservationBindings(env),snapshot=readEnvironmentSnapshot(env),store=createD1DispatchQueue(env.DB);
   const hiddenProjects=new Set(JSON.parse(env.DOT_BOARD_HIDDEN_PROJECT_IDS??'[]'));
   value.jobs=await Promise.all(value.jobs.filter(job=>!hiddenProjects.has(job.projectId)).map(async job=>{
    if(job.projectId==='validation')return {...job,projectName:'历史验收记录（非业务项目）'};
    const original=await store.get(owner,job.id),binding=bindings.find(b=>b.taskId===original?.contextTaskId),task=snapshot?.tasks?.find(t=>t.id===original?.contextTaskId);
    const verified=Boolean(binding?.readAllowed&&binding.threadId===original?.threadId&&task?.project===job.projectName);
    const displayTitle=job.title?.startsWith('[Owner-authorized manual read-only check]')?job.title.replace(/^\[Owner-authorized manual read-only check\]\s*/,'').replace(/^沿原任务只读核验\s*/,'只读核验：'):job.title;
    return {...job,displayTitle,...(verified?{originalTaskContext:{taskId:task.id}}:{})};
   }));
   value.projectTotals=value.projectTotals?.filter(project=>!hiddenProjects.has(project.projectId)).map(project=>project.projectId==='validation'?{...project,projectName:'历史验收记录（非业务项目）'}:project);
   return Response.json(value,{status:response.status,headers:response.headers});
  }
  return response;
 },async scheduled(){return {disabled:true,reason:'events_not_verified_on_sites'};}};
}
