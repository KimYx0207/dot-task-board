import {safeLink,safeText} from './snapshot.mjs';
export const INTAKE_SCHEMA = 'dot-board.request/1';
export const intakeStatusLabels = Object.freeze({received:'已保存，待 dot 读取',read:'dot 已读',accepted:'已受理',needs_confirmation:'待你确认',declined:'未受理',assigned:'已分派',in_progress:'推进中',blocked:'受阻',completed:'已完成',canceled:'已取消'});
export class IntakeError extends Error {
  constructor(code,status=400,message='请求暂时无法处理') { super(message);this.name='IntakeError';this.code=code;this.status=status; }
}
export function intakeId(value) {return typeof value==='string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(value) ? value : null;}
export function intakeString(value,max,name,{required=false}={}) {
  if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new IntakeError('invalid_'+name,400,'输入格式不正确');
  const result=value.trim();if(required&&!result)throw new IntakeError('invalid_'+name,400,'请先输入需求');return result;
}
export async function intakeDigest(value) {
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  const bytes=new TextEncoder().encode(JSON.stringify(canonical(value)));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function intakeProjectRegistry(raw) {
  if(raw===undefined||raw===null)return [];
  if(!Array.isArray(raw)||raw.length>200)throw new IntakeError('invalid_project_registry',503,'项目配置暂不可用');
  const ids=new Set(),names=new Set();
  return raw.map(row=>{
    const id=intakeId(row?.id),name=typeof row?.name==='string'?row.name.trim():'';
    const aliases=Array.isArray(row?.aliases)?row.aliases:[];
    if(!id||safeText(id,100)!==id||!name||name.length>100||aliases.length>20||aliases.some(x=>typeof x!=='string'||!x.trim()||x.length>100)||ids.has(id))throw new IntakeError('invalid_project_registry',503,'项目配置暂不可用');
    ids.add(id);for(const label of [name,...aliases]){if(names.has(label))throw new IntakeError('invalid_project_registry',503,'项目名称存在歧义');names.add(label);}
    if(row.acceptNewRequests!==undefined&&typeof row.acceptNewRequests!=='boolean')throw new IntakeError('invalid_project_registry',503,'项目配置暂不可用');
    if(row.executionState!==undefined&&!['active','paused','deferred','canceled'].includes(row.executionState))throw new IntakeError('invalid_project_registry',503,'项目执行配置暂不可用');
    return {id,name,aliases,...(row.acceptNewRequests!==undefined?{acceptNewRequests:row.acceptNewRequests}:{}),...(row.executionState!==undefined?{executionState:row.executionState}:{})};
  });
}
export function intakeProjectForName(registry,name) {return registry.find(p=>p.name===name||p.aliases.includes(name))??null;}
export function normalizeIntakeSubmission(raw,projectId) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new IntakeError('invalid_request');
  const clientSubmissionId=intakeId(raw.clientSubmissionId);
  if(!clientSubmissionId||clientSubmissionId.length<16)throw new IntakeError('invalid_submission_id',400,'提交标识无效，请保留草稿并刷新');
  if(typeof raw.body==='string'&&raw.body.length>6000)throw new IntakeError('body_too_long',413,'需求最多 6000 字');
  const body=intakeString(raw.body,6000,'body',{required:true});
  const contextTaskId=raw.contextTaskId==null?null:intakeId(raw.contextTaskId);
  if(raw.contextTaskId!=null&&!contextTaskId)throw new IntakeError('invalid_task_context');
  const viewedSnapshotRevision=intakeString(raw.viewedSnapshotRevision,80,'snapshot_revision',{required:true});
  if(!/^sha256:[a-f0-9]{64}$/.test(viewedSnapshotRevision))throw new IntakeError('invalid_snapshot_revision');
  const viewedSnapshotImportedAt=intakeString(raw.viewedSnapshotImportedAt,30,'snapshot_time',{required:true});
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(viewedSnapshotImportedAt)||!Number.isFinite(Date.parse(viewedSnapshotImportedAt)))throw new IntakeError('invalid_snapshot_time');
  const contextSummary=intakeString(raw.contextSummary??'',1500,'context_summary');
  return {schemaVersion:INTAKE_SCHEMA,projectId,clientSubmissionId,body,contextTaskId,viewedSnapshotRevision,viewedSnapshotImportedAt,contextSummary};
}
const intakeTransitions=Object.freeze({received:['read'],read:['accepted','needs_confirmation','declined','canceled'],needs_confirmation:['accepted','declined','canceled'],accepted:['assigned','in_progress','completed','blocked','needs_confirmation','canceled'],assigned:['in_progress','blocked','needs_confirmation','canceled'],in_progress:['completed','blocked','needs_confirmation','canceled'],blocked:['accepted','assigned','in_progress','needs_confirmation','canceled'],declined:[],completed:[],canceled:[]});
export function normalizeIntakeEvent(raw,current,{verifiedDispatchResult=false}={}) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new IntakeError('invalid_event');
  const eventId=intakeId(raw.eventId),status=raw.status;
  if(!eventId||!Number.isInteger(raw.expectedVersion)||raw.expectedVersion<1)throw new IntakeError('invalid_event');
  // A verified terminal dispatch result may arrive before any live progress observation.
  const terminalAssignedResult=verifiedDispatchResult&&current.status==='assigned'&&status==='completed';
  if(!Object.hasOwn(intakeStatusLabels,status)||(!intakeTransitions[current.status]?.includes(status)&&!terminalAssignedResult))throw new IntakeError('invalid_transition',409,'状态转换无效');
  const summary=intakeString(raw.summary??'',1200,'summary',{required:status!=='read'});
  const linkedTaskIds=raw.linkedTaskIds??current.linkedTaskIds??[];
  if(!Array.isArray(linkedTaskIds)||linkedTaskIds.length>20||linkedTaskIds.some(x=>!intakeId(x))||new Set(linkedTaskIds).size!==linkedTaskIds.length)throw new IntakeError('invalid_linked_tasks');
  const evidenceLinks=raw.evidenceLinks??[];
  if(!Array.isArray(evidenceLinks)||evidenceLinks.length>8)throw new IntakeError('invalid_evidence');
  for(const link of evidenceLinks){let url;try{url=new URL(link.url);}catch{throw new IntakeError('invalid_evidence');}if(url.protocol!=='https:'||!safeLink(link.url)||typeof link.label!=='string'||link.label.length>80)throw new IntakeError('invalid_evidence');}
  if(['assigned','in_progress'].includes(status)&&!linkedTaskIds.length)throw new IntakeError('assignment_requires_task',400,'分派需要真实任务标识');
  if(status==='completed'&&!evidenceLinks.length&&!verifiedDispatchResult)throw new IntakeError('completion_requires_evidence',400,'完成需要结果证据');
  return {eventId,status,summary,linkedTaskIds,evidenceLinks,expectedVersion:raw.expectedVersion};
}
export function intakeCapabilities(env={},storageAvailable=false) {
  const readerVerified=env.DOT_BOARD_INTAKE_READER_VERIFIED==='true',writerVerified=env.DOT_BOARD_INTAKE_WRITER_VERIFIED==='true';
  const configured=env.DOT_BOARD_INTAKE_ENABLED==='true',bridgeEnabled=env.DOT_BOARD_INTAKE_MCP_ENABLED==='true';
  const connectionVerified=env.DOT_BOARD_INTAKE_CONNECTION_VERIFIED==='true';
  const canSubmit=configured&&storageAvailable&&bridgeEnabled&&connectionVerified;
  const minutes=Number(env.DOT_BOARD_INTAKE_POLL_MINUTES);
  return {bridge:'sites_mcp',bridgeEnabled,connectionVerified,canSubmit,enabled:canSubmit&&readerVerified&&writerVerified,storageAvailable,readerVerified,writerVerified,deliveryMode:'poll',pollIntervalMinutes:Number.isInteger(minutes)&&minutes>=1&&minutes<=1440?minutes:null,statusLabels:intakeStatusLabels,maxBodyLength:6000};
}
