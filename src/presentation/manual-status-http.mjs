import {IntakeError} from '../domain/intake.mjs';
import {readIntakeJson} from './intake-http.mjs';
export async function handleManualStatusRequest(request,{manualStatus,headers={}}){
 const url=new URL(request.url),match=url.pathname.match(/^\/api\/tasks\/([^/]+)\/status$/);
 if(!match)return null;
 const reply=(body,status=200)=>Response.json(body,{status,headers});
 try{
  const owner=request.headers.get('oai-authenticated-user-id');
  if(!owner)throw new IntakeError('authentication_required',401);
  if(!manualStatus)throw new IntakeError('manual_status_unavailable',503);
  const taskId=decodeURIComponent(match[1]);
  if(request.method==='GET')return reply(await manualStatus.get(owner,taskId));
  if(request.method!=='POST')return reply({error:'method_not_allowed'},405);
  if(request.headers.get('origin')!==url.origin)throw new IntakeError('origin_rejected',403);
  const input=await readIntakeJson(request,{maxBytes:4096});
  if(!input||Object.hasOwn(input,'taskId'))throw new IntakeError('invalid_manual_status');
  return reply(await manualStatus.set(owner,{...input,taskId}));
 }catch(error){return reply({error:typeof error?.code==='string'?error.code:'manual_status_unavailable'},Number.isInteger(error?.status)?error.status:503);}
}
