import {MCP_EVENTS_PROTOCOL,McpEventsError,validateCallbackUrl} from '../domain/mcp-events.mjs';

const eventMetaObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const eventMetaKey=/^(?:[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\/)?(?:[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?)?$/;
const eventProtocolVersions=['2025-03-26','2025-06-18',MCP_EVENTS_PROTOCOL];
const eventLogLevels=['debug','info','notice','warning','error','critical','alert','emergency'];
const eventOptionalStrings=(value,keys)=>keys.every(key=>!Object.hasOwn(value,key)||typeof value[key]==='string');
function eventClientInfoValid(info){
 if(!eventMetaObject(info)||typeof info.name!=='string'||typeof info.version!=='string'||!eventOptionalStrings(info,['title','description','websiteUrl']))return false;
 return !Object.hasOwn(info,'icons')||Array.isArray(info.icons)&&info.icons.every(icon=>eventMetaObject(icon)&&typeof icon.src==='string'&&eventOptionalStrings(icon,['mimeType'])&&(!Object.hasOwn(icon,'sizes')||Array.isArray(icon.sizes)&&icon.sizes.every(size=>typeof size==='string'))&&(!Object.hasOwn(icon,'theme')||['light','dark'].includes(icon.theme)));
}
function eventClientCapabilitiesValid(value){
 if(!eventMetaObject(value))return false;
 for(const key of ['roots','sampling','elicitation','experimental','extensions'])if(Object.hasOwn(value,key)&&!eventMetaObject(value[key]))return false;
 for(const [key,fields] of [['sampling',['context','tools']],['elicitation',['form','url']]])if(value[key]&&fields.some(field=>Object.hasOwn(value[key],field)&&!eventMetaObject(value[key][field])))return false;
 for(const key of ['experimental','extensions'])if(value[key]&&Object.entries(value[key]).some(([name,settings])=>!eventMetaObject(settings)||key==='extensions'&&(!name.includes('/')||!eventMetaKey.test(name))))return false;
 return true;
}
// Request metadata is protocol context, never event arguments or authorization.
// Preserve existing metadata-free callers; validate supplied standard metadata
// and remove it before the service's unchanged strict business-field validation.
export function mcpEventRequestParams(params,protocol){
 if(!eventMetaObject(params))throw new McpEventsError('invalid_event_parameters');
 if(!Object.hasOwn(params,'_meta'))return params;
 const meta=params._meta;
 if(!eventMetaObject(meta)||Object.keys(meta).some(key=>!eventMetaKey.test(key))||typeof meta['io.modelcontextprotocol/protocolVersion']!=='string'||!eventClientCapabilitiesValid(meta['io.modelcontextprotocol/clientCapabilities'])||Object.hasOwn(meta,'io.modelcontextprotocol/clientInfo')&&!eventClientInfoValid(meta['io.modelcontextprotocol/clientInfo'])||Object.hasOwn(meta,'progressToken')&&!(typeof meta.progressToken==='string'||typeof meta.progressToken==='number'&&Number.isFinite(meta.progressToken))||Object.hasOwn(meta,'io.modelcontextprotocol/logLevel')&&!eventLogLevels.includes(meta['io.modelcontextprotocol/logLevel']))throw new McpEventsError('invalid_event_metadata');
 const version=meta['io.modelcontextprotocol/protocolVersion'];
 if(!eventProtocolVersions.includes(version))throw new McpEventsError('unsupported_event_protocol_version',400,-32022);
 if(protocol&&version!==protocol)throw new McpEventsError('event_protocol_header_mismatch',400,-32020);
 const {_meta,...business}=params;
 return business;
}

// Reconstruct from fixed strings and numeric categories. Never serialize an
// exception, its message/stack, arbitrary data, or a provider-supplied origin.
const eventFailureCategories=new Set([
 'invalid_event_parameters','invalid_event_metadata','unsupported_event_protocol_version','event_protocol_header_mismatch',
 'authentication_required','invalid_event_arguments','invalid_callback_url','invalid_signing_secret','event_not_found','unsupported_delivery','replay_not_supported','invalid_max_age','invalid_subscription_ttl',
 'event_transport_disabled','sites_event_transport_not_ready','event_storage_unavailable','event_authorization_unavailable','event_access_denied','invalid_clock',
 'callback_timeout','unsafe_callback_destination','invalid_callback_response','callback_redirect_rejected','callback_verification_failed','callback_unreachable','invalid_callback_payload',
 'event_bridge_unconfigured','event_payload_too_large','event_bridge_unreachable','event_bridge_redirect','event_bridge_invalid_response','event_callback_failed','event_bridge_rejected'
]);
const eventFailureReasons=new Set(['direct_events_disabled','callback_policy_missing','callback_policy_invalid','deployment_policy_mismatch','runtime_contract_missing','runtime_contract_unsupported','callback_origins_missing','callback_origin_unverified','callback_origin_rejected','callback_origin_not_approved','connection_refused','timeout','tls_error','challenge_failed','http_4xx','http_5xx']);
function eventOfferedOrigin(params){
 try{
  const value=params?.delivery?.url;
  if(typeof value!=='string'||value.trim()!==value||/[\u0000-\u0020\u007f\\]/.test(value))return null;
  const url=new URL(validateCallbackUrl(value));
  return url.hostname.length<=253?url.origin:null;
 }catch{return null;}
}
export function mcpEventFailure(error,params){
 let status=503,code=-32603,message='event_unavailable',reason;
 try{
  if(error instanceof McpEventsError){
   const category=error.code;
   if(eventFailureCategories.has(category)){
    message=category;
    const httpStatus=error.status,rpcCode=error.rpcCode;
    if([400,401,403,404,409,502,503].includes(httpStatus))status=httpStatus;
    if([-32601,-32602,-32603,-32011,-32012,-32014,-32015,-32020,-32022].includes(rpcCode))code=rpcCode;
    const detail=error.data?.reason;
    if(eventFailureReasons.has(detail))reason=detail;
   }
  }
 }catch{/* Host/provider exception getters cannot expose data or break rejection. */}
 const offeredCallbackOrigin=eventOfferedOrigin(params),data={...(reason?{reason}:{}),...(offeredCallbackOrigin?{offeredCallbackOrigin}:{})};
 const failure={code,message,...(Object.keys(data).length?{data}:{})};
 try{console.warn('mcp_event_rejected',JSON.stringify(failure));}catch{/* Diagnostics must not change the response or gates. */}
 return {status,error:failure};
}
