import {IntakeError} from '../domain/intake.mjs';
import {readIntakeJson} from './intake-http.mjs';
export async function handleObservationRequest(request,{observations,headers={}}){
 const url=new URL(request.url);if(!url.pathname.startsWith('/api/observations/'))return null;
 const reply=(body,status=200)=>Response.json(body,{status,headers});
 try{
  const owner=request.headers.get('oai-authenticated-user-id');if(!owner)throw new IntakeError('authentication_required',401);
  if(!observations)throw new IntakeError('observations_disabled',503);
  if(url.pathname==='/api/observations/events'&&request.method==='POST'){
   if(request.headers.get('origin')!==url.origin)throw new IntakeError('origin_rejected',403);
   return reply(await observations.record(owner,await readIntakeJson(request,{maxBytes:16384})),201);
  }
  const match=url.pathname.match(/^\/api\/observations\/tasks\/([^/]+)$/);
  if(match&&request.method==='GET')return reply(await observations.state(owner,decodeURIComponent(match[1])));
  return reply({error:'method_not_allowed'},405);
 }catch(error){return reply({error:typeof error?.code==='string'?error.code:'observations_unavailable'},Number.isInteger(error?.status)?error.status:503);}
}
