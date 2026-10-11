import {McpEventsError,validateCallbackUrl} from '../domain/mcp-events.mjs';

// This is a deployment-policy record, NOT runtime attestation. Only the trusted
// operator may populate it after checking the cited private evidence. Neither a
// callback challenge nor a request's delivery.url can add origins to this policy.
// Keep live policy, callback paths/query strings and evidence outside public source.
const sitesEventPolicyError=reason=>new McpEventsError('sites_event_transport_not_ready',503,-32014,reason);
const sitesEvidence=value=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=500&&!/[\u0000-\u001f\u007f]/.test(value);
function sitesExactOrigin(value){
 const url=new URL(validateCallbackUrl(value));
 if(value!==url.origin)throw sitesEventPolicyError('callback_policy_invalid');
 return url;
}
function sitesEventPolicy(env){
 if(env.DOT_BOARD_EVENTS_ENABLED!=='true')throw sitesEventPolicyError('direct_events_disabled');
 let policy;
 if(!env.DOT_BOARD_SITES_EVENT_POLICY)throw sitesEventPolicyError('callback_policy_missing');
 try{policy=JSON.parse(env.DOT_BOARD_SITES_EVENT_POLICY);}catch{throw sitesEventPolicyError('callback_policy_invalid');}
 if(policy?.schema!=='sites-openai-event-policy/1'||policy.deploymentAudience!==env.DOT_BOARD_AUDIENCE)throw sitesEventPolicyError('deployment_policy_mismatch');
 const runtime=policy.runtime;
 if(runtime?.kind!=='cloudflare-workers-global-fetch'||!sitesEvidence(runtime.evidenceRef))throw sitesEventPolicyError('runtime_contract_missing');
 const routing=runtime.routing;
 if(!routing||!sitesEvidence(routing.evidenceRef)||routing.evidenceScope!=='complete-outbound-chain')throw sitesEventPolicyError('runtime_contract_missing');
 // Hostname suffixes cannot establish effective routing: a different custom
 // hostname can enter this zone through SaaS or an outbound Worker. This stage
 // supports only independently verified strictly-public routing for the ENTIRE
 // effective path through the final connection, including platform overrides.
 if(routing.kind!=='strict-public')throw sitesEventPolicyError('runtime_contract_unsupported');
 if(!Array.isArray(policy.callbackOrigins)||policy.callbackOrigins.length<1||policy.callbackOrigins.length>16)throw sitesEventPolicyError('callback_origins_missing');
 const origins=policy.callbackOrigins.map(item=>{
  if(item?.provider!=='openai'||!sitesEvidence(item.nativeSubscriptionEvidenceRef)||!sitesEvidence(item.providerOwnershipEvidenceRef))throw sitesEventPolicyError('callback_origin_unverified');
  let url;try{url=sitesExactOrigin(item.origin);}catch{throw sitesEventPolicyError('callback_policy_invalid');}
  if(url.hostname.includes('xn--')||url.origin===policy.deploymentAudience)throw sitesEventPolicyError('callback_origin_rejected');
  return url.origin;
 });
 if(new Set(origins).size!==origins.length)throw sitesEventPolicyError('callback_policy_invalid');
 return {origins};
}
export function createSitesOpenAIEventTransport(env={}){
 function assertCallback(value){
  // Called before cache lookup and again for every actual connection.
  const url=new URL(validateCallbackUrl(value));let policy;
  try{policy=sitesEventPolicy(env);}catch(error){if(error instanceof McpEventsError)error.data={...error.data,offeredCallbackOrigin:url.origin};throw error;}
  if(url.hostname.includes('xn--')||!policy.origins.includes(url.origin)){const error=sitesEventPolicyError('callback_origin_not_approved');error.data.offeredCallbackOrigin=url.origin;throw error;}
  return url;
 }
 return Object.freeze({
  kind:'platform-managed-public-https-v1',
  readiness(){try{sitesEventPolicy(env);return {ready:true,reason:null};}catch(error){return {ready:false,reason:error instanceof McpEventsError?error.data?.reason:'callback_policy_invalid'};}},
  validateCallback(value){assertCallback(value);},
  async sendPublicHttps(q){
   const url=assertCallback(q?.url);
   const allowed=['url','hostname','method','redirect','responseLimitBytes','signal','headers','body'];
   if(!q||Object.keys(q).some(key=>!allowed.includes(key))||q.hostname!==url.hostname||q.method!=='POST'||q.redirect!=='error'||q.responseLimitBytes!==1024||!(q.signal instanceof AbortSignal))throw new McpEventsError('unsafe_callback_destination',502,-32015);
   if(typeof q.body!=='string'||new TextEncoder().encode(q.body).length>262144)throw new McpEventsError('invalid_callback_payload',502,-32015);
   const headers=new Headers(q.headers),names=['content-type','webhook-id','webhook-timestamp','webhook-signature','x-mcp-subscription-id'];
   if([...headers.keys()].some(key=>!names.includes(key))||names.some(key=>!headers.get(key))||headers.get('content-type')!=='application/json')throw new McpEventsError('unsafe_callback_destination',502,-32015);
   // Never accept a fetcher, cf.resolveOverride, Host, credentials or options.
   // DNS/public-address enforcement is the independently verified platform's
   // connection-time contract; this adapter does not pretend to pin an address.
   const response=await globalThis.fetch(url.href,{method:'POST',headers:new Headers(names.map(key=>[key,headers.get(key)])),body:q.body,redirect:'error',signal:q.signal});
   if(response.redirected||response.status>=300&&response.status<400){await response.body?.cancel().catch(()=>{});throw new McpEventsError('callback_redirect_rejected',502,-32015);}
   return response;
  }
 });
}
