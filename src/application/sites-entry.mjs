import {readEnvironmentProjectRegistry} from '../adapters/project-registry.mjs';
import {createSitesOpenAIEventTransport} from '../adapters/sites-openai-event-transport.mjs';
import {PROJECT_REQUEST_CREATED} from '../domain/mcp-events.mjs';
import {intakeId} from '../domain/intake.mjs';
import {createSitesTaskRequirements} from './sites-task-requirements.mjs';
import {sitesIdentitySetupResponse} from './sites-setup-identity.mjs';
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
function sitesRequestNotificationProjects(env){
 const raw=env.DOT_BOARD_REQUEST_NOTIFICATION_PROJECT_IDS;
 if(raw===undefined||raw==='')return [];
 if(typeof raw!=='string'||new TextEncoder().encode(raw).byteLength>32768)return null;
 try{
  const ids=JSON.parse(raw);
  if(!Array.isArray(ids)||ids.length>200||ids.some(id=>!intakeId(id))||new Set(ids).size!==ids.length)return null;
  return ids;
 }catch{return null;}
}
// Project scope only: this is not transport, storage, subscription or delivery
// readiness or execution permission. The deployment allowlist only relaxes the
// deferred notification gate; existing active-project semantics stay unchanged.
function sitesEventProjectScope(projectId,env){
 const registry=readEnvironmentProjectRegistry(env);
 if(registry.status!=='configured')return {allowed:false,reason:registry.status==='absent'?'project_registry_absent':'project_registry_invalid'};
 if(env.DOT_BOARD_HIDDEN_PROJECT_IDS==='')return {allowed:false,reason:'empty_hidden_configuration'};
 let hidden;try{hidden=JSON.parse(env.DOT_BOARD_HIDDEN_PROJECT_IDS??'[]');}catch{return {allowed:false,reason:'invalid_hidden_configuration'};}
 if(!Array.isArray(hidden))return {allowed:false,reason:'invalid_hidden_configuration'};
 if(hidden.includes(projectId))return {allowed:false,reason:'project_hidden'};
 const project=registry.records.find(project=>project.id===projectId);
 if(!project)return {allowed:false,reason:'project_not_found'};
 if(project.acceptNewRequests===false)return {allowed:false,reason:'project_requests_closed'};
 if(project.executionState==='paused')return {allowed:false,reason:'project_paused'};
 if(project.executionState==='deferred'){
  const notifications=sitesRequestNotificationProjects(env);
  if(notifications===null)return {allowed:false,reason:'invalid_notification_configuration'};
  return notifications.includes(projectId)?{allowed:true,reason:'project_notification_allowed'}:{allowed:false,reason:'project_deferred'};
 }
 if(project.executionState==='canceled')return {allowed:false,reason:'project_canceled'};
 return {allowed:true,reason:'project_scope_allowed'};
}
export function sitesProjectEventScopeFor({ownerId,projectId},env){
 // An optional owner-only enrichment, never a new project enumeration surface.
 // No owner IDs, hidden lists or raw configuration leave this adapter.
 if(!ownerId||env.DOT_BOARD_INGRESS!=='sites-owner-private-v1'||env.DOT_BOARD_INTAKE_MCP_ENABLED!=='true'||ownerId!==env.DOT_BOARD_OWNER_ID)return null;
 return sitesEventProjectScope(projectId,env);
}
export function sitesEventAuthorized(details,env){
 if(env.DOT_BOARD_INGRESS!=='sites-owner-private-v1'||env.DOT_BOARD_INTAKE_MCP_ENABLED!=='true'||details.ownerId!==env.DOT_BOARD_OWNER_ID||details.name!==PROJECT_REQUEST_CREATED)return false;
 // Revocation is owner-scoped by deterministic subscription identity. Hiding or
 // stopping a project must never prevent its owner from withdrawing delivery.
 if(details.action==='unsubscribe')return true;
 if(details.action==='list')return readEnvironmentProjectRegistry(env).status==='configured';
 return sitesEventProjectScope(details.arguments?.projectId,env).allowed;
}
// Only for the existing owner-private Sites deployment. Sites dispatch validates
// sign-in/OAuth and supplies the per-site identity; this is NOT a generic public
// Worker authentication adapter. Never expose this entry behind an untrusted proxy.
export function createSitesPrivateEntry(assets={}){
 const worker=createWorker(assets,undefined,{projectQueueProjection:false,eventDeliveryMode:'sites-direct',ownerScopedEventUnsubscribe:true,projectEventScopeFor:sitesProjectEventScopeFor,eventScopeReadyFor:env=>readEnvironmentProjectRegistry(env).records.some(project=>sitesEventProjectScope(project.id,env).allowed),eventDiscoveryEnabledFor:env=>env.DOT_BOARD_INTAKE_MCP_ENABLED==='true'&&env.DOT_BOARD_EVENT_BRIDGE_ENABLED!=='true',candidateRequestEvents:true,eventTransportFor:env=>createSitesOpenAIEventTransport(env),authorizeEvent:sitesEventAuthorized,requirementsFor:env=>createSitesTaskRequirements(env),manualStatusFor:env=>createSitesManualTaskStatus(env),manualCheckFor:(env,services)=>createSitesManualCheck(env,services),taskControlsFor:env=>createSitesTaskControls(env),observationsFor:env=>createSitesObservations(env),readObservationSnapshot:async(snapshot,env,owner)=>{const controls=createSitesTaskControls(env),controlled=controls?await controls.overlay(owner,snapshot):snapshot,observations=createSitesObservations(env);const observed=observations?await observations.overlay(owner,controlled):controlled,manual=createSitesManualTaskStatus(env);const displayed=manual?await manual.overlay(owner,observed):observed;return createSitesTaskRequirements(env).overlay(owner,displayed);}});
 return {async fetch(request,env={},ctx={}){
  const setupPath=new URL(request.url).pathname;
  if(setupPath==='/setup'||setupPath==='/api/setup/identity')return sitesIdentitySetupResponse(request,env);
  if(env.DOT_BOARD_INGRESS!=='sites-owner-private-v1'||typeof env.DOT_BOARD_OWNER_ID!=='string'||!env.DOT_BOARD_OWNER_ID||!env.DOT_BOARD_AUDIENCE)return Response.json({error:'owner_binding_unconfigured'},{status:503});
  // The stable Sites user ID is audience-bound to this Site. The configured
  // origin additionally rejects accidental use at a different deployment.
  const url=new URL(request.url);if(url.origin!==env.DOT_BOARD_AUDIENCE)return Response.json({error:'audience_rejected'},{status:403});
  const owner=request.headers.get('oai-authenticated-user-id');
  if(!owner)return Response.json({error:'authentication_required'},{status:401});
  if(owner!==env.DOT_BOARD_OWNER_ID)return Response.json({error:'board_access_denied'},{status:403});
  try{env=applySitesVisibility(env);}catch{return Response.json({error:'invalid_visibility_configuration'},{status:503});}
  if(env.DOT_BOARD_EVENTS_ENABLED==='true'&&env.DOT_BOARD_EVENT_BRIDGE_ENABLED==='true')return Response.json({error:'event_delivery_mode_conflict'},{status:503});
  // The legacy observation relay remains a separate mode behind the original
  // owner boundary. It never shares this direct request-event transport.
  if(url.pathname==='/mcp'&&request.method==='POST'&&env.DOT_BOARD_EVENT_BRIDGE_ENABLED==='true'){
   const bridge=createSitesEventBridge({env}),outbox=createD1BoardObservationOutbox(env.DB);
   if(bridge.configured&&await outbox.available()){
    let message;try{message=await readIntakeJson(request.clone());}catch{}
    if(['server/discover','events/list','events/subscribe','events/unsubscribe'].includes(message?.method))return handleIntakeMcp(request,{mcpEnabled:env.DOT_BOARD_INTAKE_MCP_ENABLED==='true',events:bridge,eventsEnabled:true});
   }
  }
  // Discovery is separate from transport readiness. Trusted deployment policy is
  // required before subscribe/challenge/delivery, including verification-cache hits.
  // No policy is inferred from an offered callback, hostname or feature toggle.
  const response=await worker.fetch(request,env,ctx);
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
 },async scheduled(){return {disabled:true,reason:'no_sites_retry_trigger_configured'};}};
}
