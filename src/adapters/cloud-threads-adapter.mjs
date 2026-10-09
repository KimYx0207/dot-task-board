// Capability adapter for an AUTHORIZED native host. No HTTP endpoint, token or shell.
export const cloudThreadReadTools=Object.freeze(['cloud_threads.read','cloud_threads.list_threads','cloud_threads.list_environments']);
export const cloudThreadWriteTools=Object.freeze(['cloud_threads.create','cloud_threads.send_message']);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const same=(a,b)=>a?.type===b?.type&&(a?.id??null)===(b?.id??null);
export function cloudToolData(result){if(result?.isError)fail('provider_error','Native tool reported failure');if(!result?.structuredContent)fail('unsupported_tool_result','Structured native tool result required');return result.structuredContent;}
/**
 * provider: {read:{read,list_threads,list_environments},write:{create,send_message}};
 * only fixed methods below are called. Inject bound current-session tools, never a URL.
 * loadAuthorization reads trusted server-side owner/request policy, NOT task text.
 * journal.reserve is durable atomic insert-if-absent across hosts. reserve returns
 * {acquired,record}; record stores operation, request, environment, optional receipt.
 * journal.save must persist before returning. No production in-memory default.
 * decodeObservation is a trusted schema-specific decoder of read results; it must
 * establish thread, turn, environment, source timestamp and terminal result proof.
 */
export function createCloudThreadsAdapter({ownerId,provider,loadAuthorization,preflight,journal,decodeObservation}){
 for(const dep of [loadAuthorization,preflight,decodeObservation,journal?.reserve,journal?.save])if(typeof dep!=='function')fail('host_not_configured','Trusted policy, preflight, decoder and durable journal are required');
 if(!ownerId)fail('owner_required','Authenticated owner required');
 async function read(name,args){if(!['read','list_threads','list_environments'].includes(name)||typeof provider?.read?.[name]!=='function')fail('read_capability_missing','Native read capability unavailable');return cloudToolData(await provider.read[name](args));}
 async function write(name,args){if(!['create','send_message'].includes(name)||typeof provider?.write?.[name]!=='function')fail('write_capability_missing','Native write capability unavailable');return cloudToolData(await provider.write[name](args));}
 async function policy(input,phase){
  const p=await loadAuthorization({ownerId,requestId:input.requestId});
  if(!p||p.ownerId!==ownerId||p.requestId!==input.requestId||!same(p.environment,input.environment)||(phase==='observe'?p.readAllowed!==true:p.paused||p.canceled||p.executionAllowed!==true))fail('execution_denied','Owner, task or environment authorization denied');
  if(input.environment?.type==='existing_thread'&&(input.environment.id!=null||!input.threadId||p.existingThreadVerified!==true||(phase!=='observe'&&p.environmentConstraintsSatisfied!==true)))fail('retained_binding_denied','Verified original thread and satisfied explicit environment constraints are required');
  if((p.threadId??null)!==(input.threadId??null))fail('binding_conflict','Original thread mapping must be preserved');
  const result=await preflight({ownerId,requestId:input.requestId,operationId:input.operationId,environment:input.environment,threadId:input.threadId??null,phase});
  if(result?.allowed!==true)fail('preflight_denied',result?.reason??'Final execution guard denied');
  return p;
 }
 async function environmentStatus(environment){
  if(environment?.type==='existing_thread')return {available:null,connectionStatus:'unknown',reason:'Platform retains the original executor; use authorized continuation preflight'};
  if(environment?.type==='native_cloud')return {available:false,reason:'cloud_threads cannot provision a native subagent; a separate authorized native host is required'};
  let cursor=null;do{const d=await read('list_environments',cursor?{cursor}:{});
   if(environment?.type==='computer'){const e=d.environments?.find(x=>x.environmentId===environment.id);if(e)return {available:e.status==='connected'&&e.is_authorized_for_tasks===true,reason:e.status};}
   if(environment?.type==='coding_environment'&&d.codingEnvironments?.some(x=>x.id===environment.id))return {available:true};
   cursor=d.nextCursor??null;
  }while(cursor);return {available:false,reason:'Original authorized environment is unavailable'};
 }
 async function observe(input){await policy(input,'observe');if(!input.threadId)fail('binding_required','An existing thread is required');const raw=await read('read',{threadId:input.threadId,limit:20});const o=await decodeObservation(raw,{...input,ownerId});
  if(!o||o.threadId!==input.threadId||!same(o.environment,input.environment)||(input.turnId&&o.turnId!==input.turnId))fail('unverified_observation','Native result does not verify the original binding');return o;
 }
 async function reconcile(input,record){
  // No matching operation ID lookup exists in the native API. A list cannot prove
  // creation absence. An unknown create remains uncertain, never silently retried.
  if(record?.receipt?.threadId)return observe({...input,threadId:record.receipt.threadId,turnId:record.receipt.turnId});
  if(input.threadId)return observe(input);
  await read('list_threads',{limit:50});
  return {uncertain:true,requiresReconciliation:true};
 }
 async function preflightContinuation(input){
  if(input.environment?.type!=='existing_thread'||!input.threadId)fail('retained_binding_denied','A verified original thread is required');
  const p=await policy(input,'before_reservation');
  if(p.allowFollowup!==true)fail('followup_denied','Original continuation is not authorized');
  if(p.connectionStatus==='offline')fail('environment_waiting','Original executor is known offline; wait without switching');
  const observation=await observe(input);
  if(observation.active!==false||observation.terminal!==true)fail('writer_active','Original thread has not verified absence of active writers');
  return {continuationAllowed:true,connectionStatus:p.connectionStatus==='connected'?'connected':'unknown',turnId:observation.turnId};
 }
 async function dispatch(input,mode){
  if(mode==='create'&&input.environment?.type==='existing_thread')fail('creation_denied','Platform-retained bindings cannot create a task');
  let p=await policy(input,'before_reservation');
  if(mode==='create'&&(p.threadId||p.allowCreate!==true))fail('creation_denied','New task creation is not authorized');
  if(mode==='followup'&&(!input.threadId||p.allowFollowup!==true))fail('followup_denied','Original thread continuation is not authorized');
  let priorTurnId=null;
  if(input.environment?.type==='existing_thread')priorTurnId=(await preflightContinuation(input)).turnId;
  else {
   if((await environmentStatus(input.environment)).available!==true)fail('environment_waiting','Original environment unavailable; wait without switching');
   if(mode==='followup'){const existing=await observe(input);if(existing.active!==false||existing.terminal!==true)fail('writer_active','Original thread has not verified an idle terminal turn');priorTurnId=existing.turnId;}
  }
  const key={ownerId,operationId:input.operationId,requestId:input.requestId,threadId:input.threadId??null,environment:input.environment,mode};
  if(!input.operationId)fail('operation_required','A durable dispatch operation is required');
  const reserved=await journal.reserve(key);
  if(!reserved.acquired){if(JSON.stringify(reserved.record?.key)!==JSON.stringify(key))fail('operation_conflict','Operation was reused with different binding');await reconcile(input,reserved.record);fail('dispatch_uncertain','Existing intent must be reconciled; never repeat native write');}
  // Recheck mutable pause/cancel/resource grants immediately before invoking tool.
  p=await policy(input,'before_write');
  if(mode==='followup'&&input.environment?.type==='existing_thread'){
   // Read narrows the race window; the platform provides no idle-only/CAS send.
   const finalObservation=await observe(input);
   if(finalObservation.turnId!==priorTurnId||finalObservation.active!==false||finalObservation.terminal!==true)fail('writer_active','Original turn changed before dispatch; reconcile without sending');
   p=await policy(input,'before_write');
   if(p.connectionStatus==='offline')fail('environment_waiting','Original executor became offline');
  }
  if(typeof p.approvedPrompt!=='string'||!p.approvedPrompt.trim()||(mode==='create'&&typeof p.title!=='string'))fail('approved_prompt_required','Trusted approved prompt, and a title for creation, are required');
  const args=mode==='followup'?{threadId:input.threadId,prompt:p.approvedPrompt}:{title:p.title,prompt:p.approvedPrompt,...(input.environment.type==='computer'?{environmentId:input.environment.id}:{environmentConfigId:input.environment.id})};
  try{
   const r=await write(mode==='create'?'create':'send_message',args);
   const threadId=mode==='followup'?input.threadId:r.threadId;
   if(mode==='followup'&&(r.turnId===priorTurnId||r.steered===true||['steered','unknown'].includes(r.status)||['steered','unknown'].includes(r.admissionState)))fail('dispatch_uncertain','Followup may have steered an existing turn; reconcile without resending');
   if(!threadId||!r.turnId||(r.threadId&&r.threadId!==threadId))fail('unverified_receipt','Native admission receipt is incomplete');
   // Admission is NOT evidence that execution started or finished.
   const receipt={threadId,turnId:r.turnId,environment:input.environment,started:false};
   await journal.save(key,{state:'admitted',receipt});return receipt;
  }catch(error){
   // Includes timeout AND persistence failure after the external side effect.
   await journal.save(key,{state:'uncertain'}).catch(()=>{});
   await reconcile(input,null).catch(()=>{});
   fail('dispatch_uncertain','Native result is ambiguous; retain reservation and reconcile original operation');
  }
 }
 return Object.freeze({environmentStatus,preflightContinuation,create:input=>dispatch(input,'create'),followup:input=>dispatch(input,'followup'),observe,reconcile});
}

// Exact names from the authorized tool catalog, not a generic tool-name proxy.
// This function does not grant capabilities; the native platform supplies them.
export function bindNativeCloudThreadTools(nativeTools){
 const names={read:{read:'mcp__codex_apps__cloud_threads_read',list_threads:'mcp__codex_apps__cloud_threads_list_threads',list_environments:'mcp__codex_apps__cloud_threads_list_environments'},write:{create:'mcp__codex_apps__cloud_threads_create',send_message:'mcp__codex_apps__cloud_threads_send_message'}};
 const provider={};for(const [group,entries]of Object.entries(names)){provider[group]={};for(const [name,key]of Object.entries(entries)){if(typeof nativeTools?.[key]==='function')provider[group][name]=args=>nativeTools[key](args);}Object.freeze(provider[group]);}return Object.freeze(provider);
}
