import {intakeDigest, intakeId} from './intake.mjs';

export const MCP_EVENTS_PROTOCOL = '2026-07-28';
export const PROJECT_REQUEST_CREATED = 'project_request.created';
export const EVENT_LIMITS = Object.freeze({defaultTtlMs:86400000,maxTtlMs:86400000,verificationMs:300000,rotationMs:300000,requestTimeoutMs:10000,leaseMs:30000,maxAttempts:5,maxDrain:50});
export const projectRequestEventDefinition = Object.freeze({
  name:PROJECT_REQUEST_CREATED,
  description:'A project request was durably saved for the connected account. Contains identifiers only; use the authenticated request read tool to retrieve its contents.',
  delivery:['webhook'],
  inputSchema:{type:'object',properties:{projectId:{type:'string',minLength:1,maxLength:100}},required:['projectId'],additionalProperties:false},
  payloadSchema:{type:'object',properties:{requestId:{type:'string'},projectId:{type:'string'},version:{type:'integer',minimum:1}},required:['requestId','projectId','version'],additionalProperties:false}
});

export class McpEventsError extends Error {
  constructor(code,status=400,rpcCode=-32602,reason) {
    super(code); this.name='McpEventsError'; this.code=code; this.status=status; this.rpcCode=rpcCode;
    if(reason)this.data={reason};
  }
}
export function canonicalJson(value) {
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  return JSON.stringify(canonical(value));
}
function exactObject(value,keys) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw new McpEventsError('invalid_event_parameters');
}
export function requireEventOwner(ownerId) {
  if(typeof ownerId!=='string'||!ownerId.trim()||ownerId.length>256||/[\u0000-\u001f\u007f]/.test(ownerId))throw new McpEventsError('authentication_required',401,-32012);
  return ownerId;
}
export function normalizeEventArguments(value) {
  exactObject(value,['projectId']);
  if(!intakeId(value.projectId))throw new McpEventsError('invalid_event_arguments');
  return {projectId:value.projectId};
}

// These are syntax checks only. DNS/address checks are mandatory at every connection.
export function validateCallbackUrl(value) {
  let url;
  try { if(typeof value!=='string'||value.length>2048)throw Error(); url=new URL(value); } catch { throw new McpEventsError('invalid_callback_url'); }
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.hash||(url.port&&url.port!=='443')||host.endsWith('.')||host.startsWith('[')||/^[\d.]+$/.test(host)||!host.includes('.')||!host.split('.').every(part=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))||/(?:^|\.)(?:localhost|local|internal|invalid|test|onion)$/.test(host))throw new McpEventsError('invalid_callback_url');
  return url.href;
}

// Conservative IPv4-only connection policy. All IPv6 addresses fail closed.
export function isPublicCallbackAddress(address) {
  if(typeof address!=='string'||!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address))return false;
  const bytes=address.split('.').map(Number);
  if(bytes.some((n,i)=>n>255||String(n)!==address.split('.')[i]))return false;
  const [a,b,c]=bytes;
  return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===0||b===168||(b===88&&c===99)))||(a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113));
}

export function decodeWebhookSecret(secret) {
  if(typeof secret!=='string'||!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret))throw new McpEventsError('invalid_signing_secret');
  const encoded=secret.slice(6); let decoded;
  try { decoded=atob(encoded); } catch { throw new McpEventsError('invalid_signing_secret'); }
  if(decoded.length<24||decoded.length>64||btoa(decoded).replace(/=+$/,'')!==encoded.replace(/=+$/,''))throw new McpEventsError('invalid_signing_secret');
  return Uint8Array.from(decoded,c=>c.charCodeAt(0));
}
const utf8=new TextEncoder();
const toBase64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
async function signingKey(secret) {return crypto.subtle.importKey('raw',decodeWebhookSecret(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function signStandardWebhook(secret,id,timestamp,body) {
  const digest=await crypto.subtle.sign('HMAC',await signingKey(secret),utf8.encode(`${id}.${timestamp}.${body}`));
  return 'v1,'+toBase64(digest);
}
export async function verifyStandardWebhook({secret,id,timestamp,signature,body,nowMs=Date.now(),toleranceSeconds=300}) {
  if(typeof id!=='string'||!id||typeof timestamp!=='string'||!/^\d{1,13}$/.test(timestamp)||typeof signature!=='string'||signature.length>1024||typeof body!=='string'||Math.abs(Math.floor(nowMs/1000)-Number(timestamp))>toleranceSeconds)return false;
  let key; try {key=await signingKey(secret);} catch {return false;}
  for(const item of signature.split(' ')) {
    if(!/^v1,[A-Za-z0-9+/]+={0,2}$/.test(item))continue;
    try {if(await crypto.subtle.verify('HMAC',key,Uint8Array.from(atob(item.slice(3)),c=>c.charCodeAt(0)),utf8.encode(`${id}.${timestamp}.${body}`)))return true;} catch { /* Invalid signatures never expose inputs. */ }
  }
  return false;
}

// WebCrypto verifies a MAC of the echo, avoiding an early-exit string comparison.
export async function matchesChallenge(expected,received) {
  if(typeof received!=='string'||received.length>256)return false;
  const key=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
  const mac=await crypto.subtle.sign('HMAC',key,utf8.encode(expected));
  return crypto.subtle.verify('HMAC',key,mac,utf8.encode(received));
}
export function normalizeSubscription(params,{unsubscribe=false}={}) {
  exactObject(params,unsubscribe?['name','arguments','delivery']:['name','arguments','delivery','ttlMs','cursor','maxAgeMs']);
  if(params.name!==PROJECT_REQUEST_CREATED)throw new McpEventsError('event_not_found',404,-32011);
  const args=normalizeEventArguments(params.arguments);
  exactObject(params.delivery,unsubscribe?['mode','url']:['mode','url','secret']);
  if(params.delivery.mode!=='webhook')throw new McpEventsError('unsupported_delivery',400,-32014);
  const url=validateCallbackUrl(params.delivery.url);
  if(unsubscribe)return {name:params.name,arguments:args,url};
  decodeWebhookSecret(params.delivery.secret);
  if(params.cursor!==undefined&&params.cursor!==null)throw new McpEventsError('replay_not_supported',400,-32014);
  if(params.maxAgeMs!==undefined&&(!Number.isSafeInteger(params.maxAgeMs)||params.maxAgeMs<0))throw new McpEventsError('invalid_max_age');
  if(params.ttlMs!==undefined&&params.ttlMs!==null&&(!Number.isSafeInteger(params.ttlMs)||params.ttlMs<=0))throw new McpEventsError('invalid_subscription_ttl');
  const ttlMs=params.ttlMs==null?EVENT_LIMITS.defaultTtlMs:Math.min(params.ttlMs,EVENT_LIMITS.maxTtlMs);
  return {name:params.name,arguments:args,url,secret:params.delivery.secret,ttlMs};
}
export async function subscriptionIdentity(ownerId,value) {
  return 'sub_'+await intakeDigest({ownerId:requireEventOwner(ownerId),name:value.name,arguments:value.arguments,url:value.url});
}
export async function normalizeMcpEvent(raw) {
  exactObject(raw,['eventId','ownerId','name','arguments','data','createdAt']);
  requireEventOwner(raw.ownerId);
  if(typeof raw.eventId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(raw.eventId)||raw.name!==PROJECT_REQUEST_CREATED)throw new McpEventsError('invalid_event');
  const args=normalizeEventArguments(raw.arguments);
  exactObject(raw.data,['requestId','projectId','version']);
  if(!intakeId(raw.data.requestId)||raw.data.projectId!==args.projectId||!Number.isSafeInteger(raw.data.version)||raw.data.version<1)throw new McpEventsError('invalid_event_data');
  if(typeof raw.createdAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw.createdAt)||!Number.isFinite(Date.parse(raw.createdAt)))throw new McpEventsError('invalid_event_timestamp');
  const value={eventId:raw.eventId,ownerId:raw.ownerId,name:raw.name,arguments:args,data:{requestId:raw.data.requestId,projectId:raw.data.projectId,version:raw.data.version},createdAt:new Date(raw.createdAt).toISOString()};
  return {...value,digest:await intakeDigest(value)};
}
