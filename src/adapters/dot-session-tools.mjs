// Fixed current-session capabilities. No URL, credentials, DB access or tool proxy.
const names=Object.freeze({
 listJobs:'mcp__codex_apps__dot_list_dispatch_jobs',
 getRequest:'mcp__codex_apps__dot_get_project_request',
 getBinding:'mcp__codex_apps__dot_get_task_observation_state',
 getWithdrawal:'mcp__codex_apps__dot_get_request_withdrawal_state',
 claim:'mcp__codex_apps__dot_claim_next_dispatch',
 preflight:'mcp__codex_apps__dot_preflight_dispatch_execution',
 update:'mcp__codex_apps__dot_update_dispatch_execution',
 readThread:'mcp__codex_apps__cloud_threads_read',
 sendMessage:'mcp__codex_apps__cloud_threads_send_message'
});
export const dotSessionToolNames=names;
export function bindDotSessionTools(nativeTools){
 const bound={};
 for(const [name,key] of Object.entries(names)){
  if(typeof nativeTools?.[key]!=='function')throw Object.assign(new Error(`Current-session capability missing: ${key}`),{code:'session_capability_missing'});
  bound[name]=async args=>{
   const result=await nativeTools[key](args);
   if(result?.isError||!result?.structuredContent||typeof result.structuredContent!=='object'||Array.isArray(result.structuredContent))throw Object.assign(new Error(`Unverified tool result: ${key}`),{code:'unverified_tool_result'});
   return result.structuredContent;
  };
 }
 return Object.freeze(bound);
}
