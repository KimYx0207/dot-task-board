import {IntakeError,intakeDigest,normalizeIntakeSubmission,normalizeIntakeEvent} from '../domain/intake.mjs';
import {safeText} from '../domain/snapshot.mjs';
export function createIntakeService({store,readBoard,capabilities,clock=()=>new Date().toISOString(),newId=()=>crypto.randomUUID()}) {
  function requireStore(){if(!store||capabilities.storageAvailable===false)throw new IntakeError('storage_unavailable',503,'需求保存服务尚未接入');}
  async function projectBoard(projectId){const result=await readBoard();if(result.status!==200)throw new IntakeError('board_unavailable',503,'暂时无法核对项目状态，请保留草稿后重试');if(!result.body.projectSummaries.some(p=>p.id===projectId))throw new IntakeError('unknown_project',404,'项目尚未接入需求通道');return result.body;}
  return {
    async boardSnapshot(ownerId){
      if(!ownerId)throw new IntakeError('authentication_required',401,'请先登录后读取看板');
      const result=await readBoard();
      if(result.status!==200)throw new IntakeError('board_unavailable',503,'当前安全看板快照暂不可用');
      return {snapshot:result.body};
    },
    async submit(projectId,ownerId,raw){requireStore();const value=normalizeIntakeSubmission(raw,projectId);const payloadDigest=await intakeDigest(value);const previous=await store.findSubmission(ownerId,value.clientSubmissionId);if(previous){if(previous.payloadDigest!==payloadDigest)throw new IntakeError('idempotency_conflict',409,'同一提交标识对应不同内容，请先核对已保存的需求');return {request:previous.request,replayed:true};}if(!capabilities.canSubmit)throw new IntakeError('intake_not_ready',503,'需求接收尚未启用或连接尚未确认，请先保留草稿');const board=await projectBoard(projectId);if(value.contextTaskId){const task=board.tasks.find(t=>t.id===value.contextTaskId);if(!task||task.projectId!==projectId)throw new IntakeError('task_project_mismatch',409,'关联任务不属于当前项目或已不在当前快照，请核对后重试');}return store.create({...value,id:newId(),ownerId,payloadDigest,contextStale:value.viewedSnapshotRevision!==board.snapshotRevision,createdAt:clock()});},
    async list(projectId,ownerId,cursor){requireStore();await projectBoard(projectId);return store.list({projectId,ownerId,cursor});},
    async inbox(ownerId,cursor=null){
      requireStore();
      if(typeof ownerId!=='string'||!ownerId||ownerId!==ownerId.trim()||ownerId.length>200||/[\u0000-\u001f\u007f]/.test(ownerId))throw new IntakeError('authentication_required',401,'请先登录后读取待处理需求');
      const result=await store.inbox({ownerId,limit:50,cursor});
      // Names are optional registry enrichment; a stale/unavailable board must
      // never hide stored pending feedback from its authenticated owner.
      let projects=[];
      try{const board=await readBoard();if(board?.status===200&&Array.isArray(board.body?.projectSummaries))projects=board.body.projectSummaries;}catch{}
      const names=new Map(projects.filter(project=>typeof project?.id==='string').map(project=>[project.id,safeText(project.canonicalName??project.name,100)]));
      return {...result,requests:result.requests.map(request=>names.get(request.projectId)?{...request,projectName:names.get(request.projectId)}:request)};
    },
    async get(id,ownerId){requireStore();const result=await store.get(id,ownerId);if(!result)throw new IntakeError('request_not_found',404,'需求不存在');return result;},
    async projects(){const result=await readBoard();if(result.status!==200)throw new IntakeError('board_unavailable',503);return {projects:[...new Map(result.body.projectSummaries.filter(p=>p.id).map(({id,name,canonicalName})=>[id,{id,name:canonicalName??name}])).values()]};},
    async append(id,raw,ownerId){
      requireStore();
      if(!ownerId)throw new IntakeError('authentication_required',401);
      const currentOwnedReceipt=async()=>{
        const value=await store.get(id,ownerId);
        if(!value)throw new IntakeError('request_not_found',404,'需求不存在');
        return value;
      };
      const previous=await currentOwnedReceipt();
      const digest=await intakeDigest({requestId:id,...raw});
      const existing=await store.existingEvent(raw?.eventId);
      if(existing){
        if(existing.request_id!==id||existing.event_digest!==digest)throw new IntakeError('event_conflict',409,'同一事件标识对应不同内容');
        // Another identical acknowledgement may have committed after the first read.
        return {...await currentOwnedReceipt(),replayed:true};
      }
      const event=normalizeIntakeEvent(raw,previous.request);
      if(event.expectedVersion!==previous.request.version)throw new IntakeError('version_conflict',409,'状态已更新，请重读后再操作');
      try{
        const saved=await store.append(id,event,digest,clock());
        return {...saved,replayed:false};
      }catch(error){
        const concurrent=await store.existingEvent(event.eventId);
        if(concurrent?.request_id===id&&concurrent.event_digest===digest)return {...await currentOwnedReceipt(),replayed:true};
        throw error;
      }
    }
  };
}
