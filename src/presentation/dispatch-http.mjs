import {IntakeError} from '../domain/intake.mjs';
import {readIntakeJson} from './intake-http.mjs';
export async function handleDispatchRequest(request,{dispatch,headers={}}){
 const url=new URL(request.url);if(!url.pathname.startsWith('/api/dispatch/'))return null;
 const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...headers,'content-type':'application/json; charset=utf-8'}});
 try{
  const owner=request.headers.get('oai-authenticated-user-id');if(!owner||owner.length>200)throw new IntakeError('authentication_required',401,'请先登录');
  if(url.pathname==='/api/dispatch/queue'&&request.method==='GET')return json(dispatch?await dispatch.view(owner):{enabled:false,reason:'dispatch_disabled',jobs:[],coverage:{scope:'managed_queue',total:0,truncated:false}});
  if(url.pathname==='/api/dispatch/reorder'&&request.method==='POST'){
   if(request.headers.get('origin')!==url.origin)throw new IntakeError('origin_rejected',403,'请从当前看板调整队列');
   if(!dispatch)throw new IntakeError('dispatch_disabled',403,'当前没有可写的执行队列');
   return json(await dispatch.reorder(owner,await readIntakeJson(request,{maxBytes:131072})));
  }
  return json({error:'method_not_allowed',message:'此接口不支持该操作'},405);
 }catch(error){return json({error:error instanceof IntakeError?error.code:'queue_unavailable',message:error instanceof IntakeError?error.message:'队列暂时不可用；请保留原顺序并重试'},error instanceof IntakeError?error.status:503);}
}
