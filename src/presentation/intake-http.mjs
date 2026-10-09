import {IntakeError,intakeId} from '../domain/intake.mjs';
export async function readIntakeJson(request,{maxBytes=32768}={}) {
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))throw new IntakeError('unsupported_media_type',415,'请使用 JSON 提交');
  const length=Number(request.headers.get('content-length'));if(length>maxBytes)throw new IntakeError('request_too_large',413,'提交内容过大');
  const reader=request.body?.getReader();if(!reader)throw new IntakeError('invalid_json');let size=0,chunks=[];
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes){await reader.cancel();throw new IntakeError('request_too_large',413,'提交内容过大');}chunks.push(part.value);}
  const bytes=new Uint8Array(size);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new IntakeError('invalid_json',400,'提交内容无法读取');}
}
function intakeCursor(url){const raw=url.searchParams.get('cursor')??'0';if(!/^\d{1,15}$/.test(raw))throw new IntakeError('invalid_cursor');return Number(raw);}
export async function handleIntakeRequest(request,{service,capabilities,headers={}}) {
  const url=new URL(request.url),path=url.pathname;
  if(!path.startsWith('/api/intake/')&&!path.startsWith('/api/projects/')&&!path.startsWith('/api/requests/'))return null;
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...headers,'content-type':'application/json; charset=utf-8'}});
  try{
    if(path==='/api/intake/capabilities'&&['GET','HEAD'].includes(request.method))return json(capabilities);
    const ownerId=request.headers.get('oai-authenticated-user-id');
    if(!ownerId||ownerId.length>200)throw new IntakeError('authentication_required',401,'请先登录后再查看或提交需求');
    if(request.method==='POST'&&request.headers.get('origin')!==url.origin)throw new IntakeError('origin_rejected',403,'请从当前看板页面提交');
    if(path==='/api/intake/inbox'&&request.method==='GET'){
      const response=json(await service.inbox(ownerId,url.searchParams.get('cursor')));
      response.headers.set('cache-control','private, no-store');
      return response;
    }
    let match;
    if((match=path.match(/^\/api\/projects\/([^/]+)\/requests$/))){const projectId=intakeId(match[1]);if(!projectId)throw new IntakeError('unknown_project',404);if(request.method==='GET')return json(await service.list(projectId,ownerId,intakeCursor(url)));if(request.method==='POST'){const result=await service.submit(projectId,ownerId,await readIntakeJson(request));return json(result,result.replayed?200:201);}}
    else if((match=path.match(/^\/api\/requests\/([^/]+)$/))&&request.method==='GET'){const id=intakeId(match[1]);if(!id)throw new IntakeError('request_not_found',404);return json(await service.get(id,ownerId));}
    return json({error:'method_not_allowed',message:'此接口不支持该操作'},405);
  }catch(error){return json({error:error instanceof IntakeError?error.code:'storage_unavailable',message:error instanceof IntakeError?error.message:'保存服务暂时不可用，请保留草稿后重试'},error instanceof IntakeError?error.status:503);}
}
