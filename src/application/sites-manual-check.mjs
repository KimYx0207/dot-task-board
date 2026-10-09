import {IntakeError,intakeId,intakeProjectForName} from '../domain/intake.mjs';
import {readObservationBindings} from '../adapters/observation-bindings.mjs';
import {readEnvironmentProjectRegistry} from '../adapters/project-registry.mjs';
import {createD1DispatchQueue} from '../adapters/d1-dispatch-queue.mjs';
export function createSitesManualCheck(env,{requests,dispatch,clock=()=>new Date().toISOString()}={}){
 if(!dispatch)return null;const store=createD1DispatchQueue(env.DB);
 return {
 async authorizeContinuation(owner,input){
  if(owner!==env.DOT_BOARD_OWNER_ID)throw new IntakeError('board_access_denied',403);
  if(!input||Object.keys(input).some(k=>!['requestId','expectedRequestVersion','taskId','threadId','sourceReference','reason','expiresAt'].includes(k))||!intakeId(input.requestId)||!intakeId(input.taskId)||!Number.isSafeInteger(input.expectedRequestVersion)||input.expectedRequestVersion<1||typeof input.sourceReference!=='string'||input.sourceReference.length<8||input.sourceReference.length>500||typeof input.reason!=='string'||input.reason.length<8||input.reason.length>500)throw new IntakeError('invalid_continuation_authorization');
  const now=clock(),expires=Date.parse(input.expiresAt);if(!Number.isFinite(expires)||expires<=Date.parse(now)||expires>Date.parse(now)+3600000)throw new IntakeError('invalid_manual_check_expiry');
  const {request}=await requests.get(input.requestId,owner);
  if(request.status!=='accepted'||request.version!==input.expectedRequestVersion||request.contextTaskId!==input.taskId)throw new IntakeError('request_not_dispatchable',409);
  const {snapshot}=await requests.boardSnapshot(owner),task=snapshot.tasks.find(t=>t.id===input.taskId);
  if(!task||['paused','canceled'].includes(task.state))throw new IntakeError('task_execution_paused',409);
  const registry=readEnvironmentProjectRegistry(env),project=registry.status==='configured'?intakeProjectForName(registry.records,task.project):null;
  if(!project||project.id!==request.projectId||!['active','deferred'].includes(project.executionState??'active'))throw new IntakeError('project_execution_paused',409);
  for(const [scope,id] of [['project',project.id],['task',task.id],['task','dq-'+request.id]]){const control=await store.control(owner,scope,id);if(['paused','canceled'].includes(control?.state))throw new IntakeError('task_execution_paused',409);}
  const binding=readObservationBindings(env).find(b=>b.taskId===task.id);
  if(!binding?.readAllowed||!binding.threadId||binding.threadId!==input.threadId)throw new IntakeError('original_thread_unverified',409);
  await dispatch.registerBinding(owner,{taskId:task.id,projectId:project.id,threadId:binding.threadId,environment:{type:'existing_thread',id:null},verified:true,evidence:input.sourceReference});
  const authorization=await store.authorizeManualRequest(owner,{requestId:request.id,projectId:project.id,taskId:task.id,expiresAt:input.expiresAt,reason:input.reason},now);
  return {requestId:request.id,authorization,threadId:binding.threadId,environment:{type:'existing_thread',id:null},projectActivated:false,automaticExecution:false};
 },
 async prepare(owner,input){
  if(owner!==env.DOT_BOARD_OWNER_ID)throw new IntakeError('board_access_denied',403);
  if(!input||Object.keys(input).some(k=>!['taskId','clientSubmissionId','viewedSnapshotRevision','threadId','sourceReference','body','reason','expiresAt'].includes(k))||!intakeId(input.taskId)||!intakeId(input.clientSubmissionId)||input.clientSubmissionId.length<16||input.clientSubmissionId.length>80||typeof input.body!=='string'||input.body.length<20||input.body.length>3000||typeof input.reason!=='string'||input.reason.length<8||input.reason.length>500||typeof input.sourceReference!=='string'||input.sourceReference.length<8||input.sourceReference.length>500)throw new IntakeError('invalid_manual_check');
  const now=clock(),expires=Date.parse(input.expiresAt);if(!Number.isFinite(expires)||expires<=Date.parse(now)||expires>Date.parse(now)+3600000)throw new IntakeError('invalid_manual_check_expiry');
  const {snapshot}=await requests.boardSnapshot(owner),task=snapshot.tasks.find(t=>t.id===input.taskId);
  if(!task||['paused','canceled'].includes(task.state))throw new IntakeError('task_execution_paused',409);
  const registry=readEnvironmentProjectRegistry(env),project=registry.status==='configured'?intakeProjectForName(registry.records,task.project):null;
  if(!project||!['active','deferred'].includes(project.executionState??'active'))throw new IntakeError('project_execution_paused',409);
  if(!await store.allowed(owner,{id:'manual-preparation',projectId:project.id,contextTaskId:task.id,rootJobId:null},now))throw new IntakeError('task_execution_paused',409);
  const binding=readObservationBindings(env).find(b=>b.taskId===task.id);
  if(!binding?.readAllowed||!binding.threadId||binding.threadId!==input.threadId)throw new IntakeError('original_thread_unverified',409);
  const body='[Owner-authorized manual read-only check]\n'+input.body+'\nConstraints: read-only verification only. No deployment, billing, credential, configuration or project changes. No new task thread. Report concrete evidence and whether all child/background work is finished.';
  const submitted=await requests.submit(project.id,owner,{clientSubmissionId:input.clientSubmissionId,contextTaskId:task.id,viewedSnapshotRevision:input.viewedSnapshotRevision,viewedSnapshotImportedAt:snapshot.importedAt,contextSummary:'Read-only check on the verified original task thread',body});
  let request=submitted.request;
  if(request.status==='received')request=(await requests.append(request.id,{eventId:input.clientSubmissionId+':read',expectedVersion:request.version,status:'read',summary:'Owner-approved manual check scope read before queue admission'},owner)).request;
  if(request.status==='read')request=(await requests.append(request.id,{eventId:input.clientSubmissionId+':accept',expectedVersion:request.version,status:'accepted',summary:input.reason},owner)).request;
  if(request.status!=='accepted'&&!await store.byRequest(owner,request.id))throw new IntakeError('request_not_dispatchable',409);
  await dispatch.registerBinding(owner,{taskId:task.id,projectId:project.id,threadId:binding.threadId,environment:{type:'existing_thread',id:null},verified:true,evidence:input.sourceReference});
  const authorization=await store.authorizeManualRequest(owner,{requestId:request.id,projectId:project.id,taskId:task.id,expiresAt:input.expiresAt,reason:input.reason},now);
  return {request,authorization,threadId:binding.threadId,environment:{type:'existing_thread',id:null},manualStartRequired:true,automaticExecution:false,projectActivated:false};
 }};
}
