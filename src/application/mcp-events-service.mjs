import {EVENT_LIMITS, McpEventsError, PROJECT_REQUEST_CREATED, isPublicCallbackAddress, matchesChallenge, normalizeMcpEvent, normalizeSubscription, projectRequestEventDefinition, requireEventOwner, signStandardWebhook, subscriptionIdentity, validateCallbackUrl} from '../domain/mcp-events.mjs';

const iso=ms=>new Date(ms).toISOString();
const callbackError=(code,reason='connection_refused')=>new McpEventsError(code,502,-32015,reason);
const configured=transport=>transport?.kind==='platform-managed-public-https-v1'&&typeof transport.sendPublicHttps==='function'||(transport?.kind===undefined||transport.kind==='explicit-pinned-https-v1')&&typeof transport?.resolve==='function'&&typeof transport.send==='function';

// No implicit fetch fallback. The platform-managed contract and explicit IP-pinned
// contract are distinct; neither manufactures DNS answers for the other.
async function requestCallback(transport,url,options) {
  if(!configured(transport))throw new McpEventsError('event_transport_disabled',503,-32014);
  const parsed=new URL(validateCallbackUrl(url));
  const {readBody=false,...requestOptions}=options;
  const controller=new AbortController(); let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(callbackError('callback_timeout','timeout'));},EVENT_LIMITS.requestTimeoutMs);});
  try {
    return await Promise.race([timeout,(async()=>{
      const request={url:parsed.href,hostname:parsed.hostname,method:'POST',redirect:'error',responseLimitBytes:1024,signal:controller.signal,...requestOptions};
      let response;
      if(transport.kind==='platform-managed-public-https-v1') {
        response=await transport.sendPublicHttps(request);
      } else {
        const addresses=await transport.resolve(parsed.hostname,{signal:controller.signal});
        if(!Array.isArray(addresses)||!addresses.length||addresses.length>16||addresses.some(address=>!isPublicCallbackAddress(address)))throw callbackError('unsafe_callback_destination');
        response=await transport.send({...request,address:addresses[0]});
      }
      if(!response||!Number.isInteger(response.status)||response.status<100||response.status>599)throw callbackError('invalid_callback_response');
      if(response.redirected||response.status>=300&&response.status<400)throw callbackError('callback_redirect_rejected');
      let text='';
      if(readBody&&response.status>=200&&response.status<300) {
        if(typeof response.body?.getReader!=='function')throw callbackError('callback_verification_failed','challenge_failed');
        const reader=response.body.getReader(),decoder=new TextDecoder();let length=0;
        try {
          while(true) {
            const {done,value}=await reader.read();if(done)break;
            length+=value.byteLength;
            if(length>1024)throw callbackError('callback_verification_failed','challenge_failed');
            text+=decoder.decode(value,{stream:true});
          }
          text+=decoder.decode();
        } finally {await reader.cancel().catch(()=>{});}
      } else {await response.body?.cancel().catch(()=>{});}
      return {status:response.status,text};
    })()]);
  } catch(error) {
    if(error instanceof McpEventsError)throw error;
    const reason=error?.name==='AbortError'||error?.code==='ETIMEDOUT'?'timeout':error?.code==='ERR_TLS_CERT_ALTNAME_INVALID'?'tls_error':'connection_refused';
    throw callbackError('callback_unreachable',reason);
  } finally {clearTimeout(timer);}
}
async function headersFor(subscription,id,body,nowMs) {
  const timestamp=String(Math.floor(nowMs/1000));
  const signatures=[await signStandardWebhook(subscription.secret,id,timestamp,body)];
  if(subscription.previousSecret&&Date.parse(subscription.previousSecretUntil)>nowMs)signatures.push(await signStandardWebhook(subscription.previousSecret,id,timestamp,body));
  return {'Content-Type':'application/json','webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':signatures.join(' '),'X-MCP-Subscription-Id':subscription.id};
}
export function createMcpEventsService({store,transport,clock=()=>new Date().toISOString(),newId=()=>crypto.randomUUID(),authorize=async()=>false}={}) {
  const nowMs=()=>{const time=clock();const value=typeof time==='number'?time:Date.parse(time);if(!Number.isFinite(value))throw new McpEventsError('invalid_clock',503,-32603);return value;};
  function requireStore() {if(!store)throw new McpEventsError('event_storage_unavailable',503,-32603);}
  async function access(ownerId,name,args,action) {
    requireEventOwner(ownerId);
    let allowed;
    try {allowed=await authorize({ownerId,name,arguments:args,action});} catch {throw new McpEventsError('event_authorization_unavailable',503,-32603);}
    if(!allowed)throw new McpEventsError('event_access_denied',403,-32012);
  }
  async function safeStorage(action) {
    try {return await action();} catch(error) {if(error instanceof McpEventsError)throw error;throw new McpEventsError('event_storage_unavailable',503,-32603);}
  }
  return {
    async list(ownerId) {
      await access(ownerId,PROJECT_REQUEST_CREATED,{},'list');
      return {events:[structuredClone(projectRequestEventDefinition)]};
    },
    async subscribe(ownerId,params) {
      requireEventOwner(ownerId);
      const value=normalizeSubscription(params);
      await access(ownerId,value.name,value.arguments,'subscribe');
      requireStore();
      if(!configured(transport))throw new McpEventsError('event_transport_disabled',503,-32014);
      const id=await subscriptionIdentity(ownerId,value),startedAt=nowMs();
      let verifiedUntil=await safeStorage(()=>store.getVerification(ownerId,value.url,value.secret,iso(startedAt)));
      if(!verifiedUntil) {
        const challenge=crypto.randomUUID(),verificationId='verification_'+newId();
        const body=JSON.stringify({type:'verification',challenge});
        const response=await requestCallback(transport,value.url,{headers:await headersFor({...value,id},verificationId,body,startedAt),body,readBody:true});
        if(response.status<200||response.status>=300)throw callbackError('callback_verification_failed',response.status>=500?'http_5xx':'http_4xx');
        let echo;
        try {echo=JSON.parse(response.text).challenge;} catch {throw callbackError('callback_verification_failed','challenge_failed');}
        if(nowMs()-startedAt>EVENT_LIMITS.requestTimeoutMs||!await matchesChallenge(challenge,echo))throw callbackError('callback_verification_failed','challenge_failed');
        verifiedUntil=iso(nowMs()+EVENT_LIMITS.verificationMs);
      }
      // Authorization may have been withdrawn while a callback challenge was pending.
      await access(ownerId,value.name,value.arguments,'subscribe');
      const savedAt=nowMs(),expiresAt=iso(savedAt+value.ttlMs);
      await safeStorage(()=>store.saveSubscription({...value,id,ownerId,expiresAt,verifiedUntil,now:iso(savedAt),rotationUntil:iso(savedAt+EVENT_LIMITS.rotationMs)}));
      return {id,refreshBefore:expiresAt,cursor:null,truncated:false};
    },
    async unsubscribe(ownerId,params) {
      requireEventOwner(ownerId);
      const value=normalizeSubscription(params,{unsubscribe:true});
      await access(ownerId,value.name,value.arguments,'unsubscribe');
      requireStore();
      const id=await subscriptionIdentity(ownerId,value);
      await safeStorage(()=>store.revoke(ownerId,id,iso(nowMs())));
      return {};
    },
    async enqueue(raw) {
      const value=await normalizeMcpEvent(raw);
      await access(value.ownerId,value.name,value.arguments,'enqueue');
      requireStore();
      return safeStorage(()=>store.enqueue(raw));
    },
    async drain({limit=EVENT_LIMITS.maxDrain}={}) {
      if(!Number.isSafeInteger(limit)||limit<1||limit>EVENT_LIMITS.maxDrain)throw new McpEventsError('invalid_drain_limit');
      requireStore();
      const result={processed:0,delivered:0,retried:0,failed:0,canceled:0,disabled:!configured(transport)};
      if(result.disabled)return result;
      const firstNow=iso(nowMs());
      await safeStorage(()=>store.maintain(firstNow,EVENT_LIMITS.maxAttempts));
      const due=await safeStorage(()=>store.due(firstNow,limit,EVENT_LIMITS.maxAttempts));
      for(const item of due) {
        const claimedAt=nowMs();
        const job=await safeStorage(()=>store.claim({...item,now:iso(claimedAt),leaseUntil:iso(claimedAt+EVENT_LIMITS.leaseMs),token:newId(),maxAttempts:EVENT_LIMITS.maxAttempts}));
        if(!job)continue;
        result.processed++;
        const finish=async(state,reason)=>{
          const time=nowMs();
          const nextAttemptAt=iso(time+Math.min(60000,1000*2**(job.attempts-1)));
          await safeStorage(()=>store.finish({...job,state,reason,nextAttemptAt,now:iso(time)}));
          result[state==='delivered'?'delivered':state==='retry'?'retried':state==='canceled'?'canceled':'failed']++;
        };
        const retry=reason=>finish(job.attempts>=EVENT_LIMITS.maxAttempts?'failed':'retry',job.attempts>=EVENT_LIMITS.maxAttempts?'attempts_exhausted':reason);
        let sub=await safeStorage(()=>store.getSubscription(job.subscriptionId,job.ownerId));
        if(!sub?.active||Date.parse(sub.expiresAt)<=nowMs()) {await finish('canceled','subscription_expired');continue;}
        let allowed;
        try {allowed=await authorize({ownerId:sub.ownerId,name:sub.name,arguments:sub.arguments,action:'deliver'});} catch {await retry('authorization_unavailable');continue;}
        if(!allowed) {await safeStorage(()=>store.revoke(sub.ownerId,sub.id,iso(nowMs()),'access_revoked'));result.canceled++;continue;}
        sub=await safeStorage(()=>store.getSubscription(job.subscriptionId,job.ownerId));
        if(!sub?.active||Date.parse(sub.expiresAt)<=nowMs()) {await finish('canceled','subscription_expired');continue;}
        const body=JSON.stringify(job.event);
        if(new TextEncoder().encode(body).length>262144) {await finish('failed','payload_too_large');continue;}
        try {
          const response=await requestCallback(transport,sub.url,{headers:await headersFor(sub,job.eventId,body,nowMs()),body});
          if(response.status>=200&&response.status<300)await finish('delivered');
          else if(response.status===410) {await safeStorage(()=>store.revoke(sub.ownerId,sub.id,iso(nowMs()),'receiver_gone'));result.canceled++;}
          else if(response.status===413)await finish('failed','payload_too_large');
          else if([408,425,429].includes(response.status)||response.status>=500)await retry(response.status>=500?'http_5xx':'http_4xx');
          else await finish('failed','http_4xx');
        } catch(error) {
          if(['unsafe_callback_destination','callback_redirect_rejected'].includes(error.code))await finish('failed',error.code);
          else if(error.code==='event_storage_unavailable')throw error;
          else await retry(error.data?.reason??'connection_refused');
        }
      }
      return result;
    }
  };
}
