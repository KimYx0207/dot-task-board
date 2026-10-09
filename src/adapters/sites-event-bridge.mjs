import {bridgeHeaders,bridgeSecretValid} from './event-bridge-auth.mjs';
import {validateCallbackUrl,McpEventsError} from '../domain/mcp-events.mjs';
// Called only after the original Sites ingress has verified its owner. This file
// contains no credential and never turns arbitrary headers into authenticated IDs.
export function createSitesEventBridge({env={},clock=()=>Date.now(),fetcher=globalThis.fetch}={}){
 const enabled=env.DOT_BOARD_EVENT_BRIDGE_ENABLED==='true';
 let target;try{target=new URL(validateCallbackUrl(env.DOT_BOARD_EVENT_BRIDGE_URL));}catch{}
 const configured=enabled&&target?.pathname==='/bridge'&&!target.search&&bridgeSecretValid(env.DOT_BOARD_EVENT_BRIDGE_SECRET)&&env.DOT_BOARD_OWNER_ID;
 async function call(ownerId,action,params){
  if(!configured)throw new McpEventsError('event_bridge_unconfigured',503,-32603);
  if(ownerId!==env.DOT_BOARD_OWNER_ID)throw new McpEventsError('event_access_denied',403,-32012);
  if(!['events/list','events/subscribe','events/unsubscribe','enqueue'].includes(action))throw new McpEventsError('event_not_found',404,-32601);
  const body=JSON.stringify({action,ownerId,params});if(new TextEncoder().encode(body).length>32768)throw new McpEventsError('event_payload_too_large',400,-32602);
  const headers=await bridgeHeaders({secret:env.DOT_BOARD_EVENT_BRIDGE_SECRET,audience:target.href,body,now:clock()});
  let response;try{response=await fetcher(target.href,{method:'POST',headers,body,redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw new McpEventsError('event_bridge_unreachable',503,-32603);}
  if(response.redirected||response.status>=300&&response.status<400){await response.body?.cancel();throw new McpEventsError('event_bridge_redirect',503,-32603);}
  const reader=response.body?.getReader();let text='',bytes=0;try{if(!reader)throw Error();const decoder=new TextDecoder();while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>16384)throw Error();text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}catch{throw new McpEventsError('event_bridge_invalid_response',503,-32603);}finally{await reader?.cancel().catch(()=>{});}
  let data;try{data=JSON.parse(text);}catch{throw new McpEventsError('event_bridge_invalid_response',503,-32603);}
  if(!response.ok){
   const reasons=['connection_refused','timeout','tls_error','challenge_failed','http_4xx','http_5xx'];
   if(data?.rpcCode===-32015&&reasons.includes(data.data?.reason))throw new McpEventsError('event_callback_failed',502,-32015,data.data.reason);
   if(data?.rpcCode===-32012)throw new McpEventsError('event_access_denied',403,-32012);
   throw new McpEventsError('event_bridge_rejected',503,-32603);
  }
  if(!data||!Object.hasOwn(data,'result'))throw new McpEventsError('event_bridge_invalid_response',503,-32603);
  return data.result;
 }
 return {configured:Boolean(configured),list:owner=>call(owner,'events/list',{}),subscribe:(owner,args)=>call(owner,'events/subscribe',args),unsubscribe:(owner,args)=>call(owner,'events/unsubscribe',args),enqueue:(owner,event)=>call(owner,'enqueue',{eventId:event.eventId,ownerId:owner,name:event.name,arguments:{projectId:event.data.projectId},data:event.data,createdAt:event.timestamp})};
}
// Retains source rows until a positive CF durable-enqueue acknowledgement.
// A failed/no-response hop remains pending. A future invocation can retry; this
// function is not a scheduler and does not promise unattended source recovery.
export async function drainSourceObservations({ownerId,outbox,bridge,limit=20,clock=()=>Date.now()}){
 const result={accepted:0,pending:0};
 for(const row of await outbox.due(ownerId,{limit})){
  const claimed=await outbox.claim(ownerId,row.eventId);if(!claimed)continue;
  try{const ack=await bridge.enqueue(ownerId,claimed.event);if(ack?.eventId!==claimed.event.eventId)throw Error('invalid_ack');await outbox.ack(ownerId,claimed.event.eventId,claimed.leaseToken);result.accepted++;}
  catch{await outbox.retry(ownerId,claimed.event.eventId,claimed.leaseToken,{nextAttemptAt:new Date(clock()+Math.min(60000,1000*2**Math.min(claimed.attempts,6))).toISOString()});result.pending++;}
 }
 return result;
}
