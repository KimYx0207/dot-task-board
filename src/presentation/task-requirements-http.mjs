import {IntakeError} from '../domain/intake.mjs';
import {readIntakeJson} from './intake-http.mjs';
export async function handleTaskRequirementsRequest(request,{requirements,headers={}}){
 const url=new URL(request.url),match=url.pathname.match(/^\/api\/tasks\/([^/]+)\/requirements(\/native-evidence)?$/);if(!match)return null;
 const reply=(body,status=200)=>Response.json(body,{status,headers});
 try{
  const owner=request.headers.get('oai-authenticated-user-id');if(!owner)throw new IntakeError('authentication_required',401);if(!requirements)throw new IntakeError('requirements_unavailable',503);
  const taskId=decodeURIComponent(match[1]);if(request.method==='GET'&&!match[2])return reply(await requirements.get(owner,taskId));
  if(request.method!=='POST')return reply({error:'method_not_allowed'},405);
  if(request.headers.get('origin')!==url.origin)throw new IntakeError('origin_rejected',403);
  const input=await readIntakeJson(request,{maxBytes:8192});if(!input||Object.hasOwn(input,'taskId'))throw new IntakeError('invalid_task_requirements');
  return reply(await requirements[match[2]?'appendNativeEvidence':'set'](owner,{...input,taskId}));
 }catch(error){return reply({error:typeof error?.code==='string'?error.code:'requirements_unavailable'},Number.isInteger(error?.status)?error.status:503);}
}
