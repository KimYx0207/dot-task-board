import {createWorker} from '../../worker.mjs';
import {createPlatformPublicTransport} from '../adapters/platform-transport.mjs';
import {PROJECT_REQUEST_CREATED} from '../domain/mcp-events.mjs';
import {authenticate,grantsFor} from '../adapters/deployment-adapters.mjs';
const bindingValue=value=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=200;
function siteBinding(env){return bindingValue(env.DOT_BOARD_OWNER_ID)&&bindingValue(env.DOT_BOARD_AUDIENCE)?{ownerId:env.DOT_BOARD_OWNER_ID,audience:env.DOT_BOARD_AUDIENCE}:null;}
function siteGrant(grant,binding){return Boolean(binding&&grant?.active===true&&grant.ownerId===binding.ownerId&&grant.audience===binding.audience&&grant.boardAccess===true);}
// Only server-injected verified adapters may override these default-deny hooks.
export function createCandidateEntry({assets={},authenticate:verify=authenticate,grantsFor:grants=grantsFor,clock=()=>Date.now()}={}) {
 const authorizeEvent=async(details,env)=>{
  const binding=siteBinding(env);if(!binding||details.ownerId!==binding.ownerId)return false;
  const grant=await grants(details.ownerId,env);
  return Boolean(siteGrant(grant,binding)&&details.name===PROJECT_REQUEST_CREATED&&Array.isArray(grant.projectIds)&&grant.projectIds.length>0&&(details.action==='list'||grant.projectIds.includes(details.arguments?.projectId)));
 };
 const worker=createWorker(assets,undefined,{eventTransport:createPlatformPublicTransport(),authorizeEvent,clock:()=>new Date(clock()).toISOString()});
 return {
  async fetch(request,env={},ctx={}) {
   if(env.DOT_BOARD_CANDIDATE_ENABLED!=='true')return Response.json({error:'candidate_disabled'},{status:503});
   const binding=siteBinding(env);if(!binding)return Response.json({error:'owner_binding_unconfigured'},{status:503});
   let identity;try{identity=await verify(request,env);}catch{return Response.json({error:'authentication_unavailable'},{status:503});}
   if(identity?.verified!==true||!bindingValue(identity.ownerId)||!bindingValue(identity.audience)||!Number.isFinite(Date.parse(identity.expiresAt))||Date.parse(identity.expiresAt)<=clock())return Response.json({error:'authentication_required'},{status:401});
   if(identity.ownerId!==binding.ownerId||identity.audience!==binding.audience)return Response.json({error:'board_access_denied'},{status:403});
   let grant;try{grant=await grants(identity.ownerId,env);}catch{return Response.json({error:'authorization_unavailable'},{status:503});}
   if(!siteGrant(grant,binding))return Response.json({error:'board_access_denied'},{status:403});
   const headers=new Headers(request.headers);headers.delete('oai-authenticated-user-id');headers.set('oai-authenticated-user-id',binding.ownerId);
   return worker.fetch(new Request(request,{headers}),env,ctx);
  },
  async scheduled(controller,env={},ctx={}) {
   if(env.DOT_BOARD_CANDIDATE_ENABLED!=='true'||env.DOT_BOARD_EVENTS_ENABLED!=='true'||!siteBinding(env))return {disabled:true};
   const work=worker.scheduled(controller,env);if(ctx.waitUntil)ctx.waitUntil(work);return work;
  }
 };
}
