import {IntakeError,intakeId} from '../domain/intake.mjs';
import {readIntakeJson} from './intake-http.mjs';

export async function handleCandidatesRequest(request,{candidates,headers={}}){
  const url=new URL(request.url),path=url.pathname;
  if(path!=='/api/candidates'&&!path.startsWith('/api/candidates/'))return null;
  const json=(body,status=200)=>Response.json(body,{status,headers:{...headers,'cache-control':'private, no-store'}});
  try{
    const owner=request.headers.get('oai-authenticated-user-id');if(!owner||owner.length>200)throw new IntakeError('authentication_required',401,'请先登录后查看候选建议');
    if(request.method==='POST'&&request.headers.get('origin')!==url.origin)throw new IntakeError('origin_rejected',403,'请从当前看板页面审核');
    if(!candidates)throw new IntakeError('candidates_unavailable',503,'候选建议存储尚未接入');
    if(path==='/api/candidates'){
      if(request.method==='GET')return json(await candidates.list(owner,Object.fromEntries(url.searchParams)));
      if(request.method==='POST'){const result=await candidates.propose(owner,await readIntakeJson(request));return json(result,result.replayed?200:201);}
    }
    const match=path.match(/^\/api\/candidates\/([^/]+)(\/review)?$/);
    if(match){if(!intakeId(match[1]))throw new IntakeError('candidate_not_found',404);if(!match[2]&&request.method==='GET')return json(await candidates.get(owner,match[1]));if(match[2]&&request.method==='POST')return json(await candidates.review(owner,match[1],await readIntakeJson(request)));}
    return json({error:'method_not_allowed',message:'此接口不支持该操作'},405);
  }catch(error){return json({error:error instanceof IntakeError?error.code:'candidates_unavailable',message:error instanceof IntakeError?error.message:'候选保存结果暂时无法确认，请保留内容并读取已有记录'},error instanceof IntakeError?error.status:503);}
}
