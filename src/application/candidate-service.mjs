import {IntakeError,intakeId,intakeDigest} from '../domain/intake.mjs';
import {normalizeCandidateProposal,normalizeCandidateReview,normalizeCandidateQuery,candidateIntakeSubmission} from '../domain/candidates.mjs';

export function createCandidateService({store,requests,readBoard,capabilities,clock=()=>new Date().toISOString(),newId=()=>crypto.randomUUID()}){
  function ownerScope(owner){if(typeof owner!=='string'||!owner||owner!==owner.trim()||owner.length>200||/[\u0000-\u001f\u007f]/.test(owner))throw new IntakeError('authentication_required',401);if(!store||!capabilities.storageAvailable)throw new IntakeError('candidates_unavailable',503,'候选建议存储尚未接入');}
  async function current(owner,id){if(!intakeId(id))throw new IntakeError('candidate_not_found',404);const row=await store.get(owner,id);if(!row)throw new IntakeError('candidate_not_found',404,'候选建议不存在');return row;}
  async function receipt(owner,row){const candidate=row.candidate;if(!candidate.requestId)return {candidate};const saved=await requests.get(candidate.requestId,owner);return {candidate,request:saved.request};}
  async function context(value){const board=await readBoard();if(board?.status!==200)throw new IntakeError('board_unavailable',503,'暂时无法核对项目状态，请保留内容后重试');if(!board.body.projectSummaries.some(project=>project.id===value.projectId))throw new IntakeError('unknown_project',404,'项目尚未接入需求通道');if(value.contextTaskId&&!board.body.tasks.some(task=>task.id===value.contextTaskId&&task.projectId===value.projectId))throw new IntakeError('task_project_mismatch',409,'关联任务已不在当前项目快照，请核对后重试');return value.viewedSnapshotRevision!==board.body.snapshotRevision;}
  async function replay(owner,id,event,digest){const existing=await store.findReview(owner,event.eventId);if(!existing)return null;if(existing.candidate.id!==id||existing.reviewDigest!==digest)throw new IntakeError('candidate_event_conflict',409,'同一审核标识对应不同内容');return {...await receipt(owner,await current(owner,id)),replayed:true};}
  return {
    capabilities,
    async list(owner,query={}){ownerScope(owner);return store.list(owner,normalizeCandidateQuery(query));},
    async get(owner,id){ownerScope(owner);return receipt(owner,await current(owner,id));},
    async propose(owner,raw){
      ownerScope(owner);const value=normalizeCandidateProposal(raw),digest=await intakeDigest(value),existing=await store.findSubmission(owner,value.clientSubmissionId);
      if(existing){if(existing.payloadDigest!==digest)throw new IntakeError('idempotency_conflict',409,'同一提交标识对应不同候选内容');return {...await receipt(owner,existing),replayed:true};}
      if(!capabilities.canPropose)throw new IntakeError('intake_not_ready',503,'候选建议接收尚未启用');
      const contextStale=await context(value);return store.create({...value,id:newId(),ownerId:owner,payloadDigest:digest,contextStale,createdAt:clock()});
    },
    async review(owner,id,raw){
      ownerScope(owner);const value=normalizeCandidateReview(raw);await current(owner,id);const digest=await intakeDigest({candidateId:id,...value});const prior=await replay(owner,id,value,digest);if(prior)return prior;
      const row=await current(owner,id),candidate=row.candidate;
      // An identical review can commit between the event lookup and this read.
      if(candidate.review?.eventId===value.eventId&&row.reviewDigest===digest)return {...await receipt(owner,row),replayed:true};
      if(candidate.version!==value.expectedVersion)throw new IntakeError('candidate_version_conflict',409,'候选建议已更新，请重新读取');
      if(candidate.status!=='proposed')throw new IntakeError('candidate_already_reviewed',409,'候选建议已审核，请核对已有结果');
      if(!capabilities.canReview)throw new IntakeError('intake_not_ready',503,'候选建议审核尚未启用');
      let request=null;
      if(value.decision==='approve'){
        const contextStale=await context(candidate),requestId=newId(),submission=candidateIntakeSubmission(candidate,requestId);
        request={...submission,id:requestId,ownerId:owner,payloadDigest:await intakeDigest(submission),contextStale,createdAt:clock()};
      }
      try{const result=await store.review(owner,id,value,digest,clock(),request);return {...await receipt(owner,result),replayed:result.replayed};}
      catch(error){const recovered=await replay(owner,id,value,digest);if(recovered)return recovered;throw error;}
    }
  };
}
