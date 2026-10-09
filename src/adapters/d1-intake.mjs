import {IntakeError,intakeId} from '../domain/intake.mjs';
function intakeRow(row) {
  if(!row)return null;
  return {schemaVersion:'dot-board.request/1',id:row.id,projectId:row.project_id,clientSubmissionId:row.client_submission_id,body:row.body,contextTaskId:row.context_task_id,viewedSnapshotRevision:row.viewed_snapshot_revision,viewedSnapshotImportedAt:row.viewed_snapshot_imported_at,contextSummary:row.context_summary,contextStale:Boolean(row.context_stale),status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,version:row.version,linkedTaskIds:JSON.parse(row.linked_task_ids),latestSummary:row.latest_summary};
}
function intakeEventRow(row) {return {id:row.id,status:row.status,summary:row.summary,createdAt:row.created_at,linkedTaskIds:JSON.parse(row.linked_task_ids),evidenceLinks:JSON.parse(row.evidence_links),version:row.version};}
function intakeInboxEncodeCursor(value){return btoa(JSON.stringify(value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function intakeInboxDecodeCursor(value){
  if(value===null||value===undefined)return null;
  const invalid=()=>{throw new IntakeError('invalid_inbox_cursor',400,'分页标识无效，请从第一页重试');};
  if(typeof value!=='string'||!value||value.length>400||!/^[A-Za-z0-9_-]+$/.test(value))invalid();
  let decoded;try{decoded=JSON.parse(atob(value.replace(/-/g,'+').replace(/_/g,'/')));}catch{invalid();}
  if(!decoded||typeof decoded!=='object'||Array.isArray(decoded)||Object.keys(decoded).length!==3||!Object.keys(decoded).every(key=>['v','createdAt','id'].includes(key))||decoded.v!==1||!intakeId(decoded.id)||typeof decoded.createdAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(decoded.createdAt))invalid();
  const at=Date.parse(decoded.createdAt),normalized=decoded.createdAt.includes('.')?decoded.createdAt.replace(/\.(\d{1,3})Z$/,(_,fraction)=>'.'+fraction.padEnd(3,'0')+'Z'):decoded.createdAt.replace(/Z$/,'.000Z');
  if(!Number.isFinite(at)||new Date(at).toISOString()!==normalized||intakeInboxEncodeCursor(decoded)!==value)invalid();
  return decoded;
}
export function createD1IntakeStore(db,{eventStore=null,guardDispatchOwnership=false}={}) {
  if(!db?.prepare||!db?.batch)return null;
  return {
    async available(){try{await db.prepare('SELECT id FROM intake_requests LIMIT 0').all();await db.prepare('SELECT id FROM intake_events LIMIT 0').all();return true;}catch{return false;}},
    async findSubmission(ownerId,clientSubmissionId){const row=await db.prepare('SELECT * FROM intake_requests WHERE owner_id=? AND client_submission_id=?').bind(ownerId,clientSubmissionId).first();return row?{request:intakeRow(row),payloadDigest:row.payload_digest}:null;},
    async create(value) {
      const q=value;
      const eventStatements=eventStore?await eventStore.intakeCreatedStatements(q):[];
      const results=await db.batch([
        db.prepare('INSERT INTO intake_requests (id,owner_id,project_id,client_submission_id,payload_digest,body,context_task_id,viewed_snapshot_revision,viewed_snapshot_imported_at,context_summary,context_stale,status,created_at,updated_at,version,linked_task_ids,latest_summary) VALUES (?,?,?,?,?,?,?,?,?,?,?,\'received\',?,?,1,\'[]\',\'\') ON CONFLICT(owner_id,client_submission_id) DO NOTHING').bind(q.id,q.ownerId,q.projectId,q.clientSubmissionId,q.payloadDigest,q.body,q.contextTaskId,q.viewedSnapshotRevision,q.viewedSnapshotImportedAt,q.contextSummary,q.contextStale?1:0,q.createdAt,q.createdAt),
        db.prepare('INSERT INTO intake_events (id,request_id,version,event_digest,status,summary,created_at,linked_task_ids,evidence_links) SELECT ?,id,1,?,\'received\',\'已保存，待 dot 读取\',?,\'[]\',\'[]\' FROM intake_requests WHERE id=?').bind(q.id+':received',q.payloadDigest,q.createdAt,q.id),
        ...eventStatements,
        db.prepare('SELECT * FROM intake_requests WHERE owner_id=? AND client_submission_id=?').bind(q.ownerId,q.clientSubmissionId)
      ]);
      const row=results.at(-1).results[0];
      if(!row)throw new IntakeError('storage_unavailable',503,'保存暂时不可用，请保留草稿后重试');
      if(row.payload_digest!==q.payloadDigest)throw new IntakeError('idempotency_conflict',409,'同一提交标识对应不同内容，请先核对已保存的需求');
      return {request:intakeRow(row),replayed:row.id!==q.id};
    },
    async list({ownerId,projectId,cursor=0,limit=25}) {
      const out=await db.prepare('SELECT rowid AS sequence,* FROM intake_requests WHERE owner_id=? AND project_id=? AND rowid>? ORDER BY rowid LIMIT ?').bind(ownerId,projectId,cursor,limit+1).all();
      const rows=out.results.slice(0,limit);return {requests:rows.map(intakeRow),nextCursor:out.results.length>limit?String(rows.at(-1).sequence):null};
    },
    async inbox({ownerId,limit=50,cursor=null}) {
      if(typeof ownerId!=='string'||!ownerId||ownerId!==ownerId.trim()||ownerId.length>200||/[\u0000-\u001f\u007f]/.test(ownerId))throw new IntakeError('authentication_required',401,'请先登录后读取待处理需求');
      if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw new IntakeError('invalid_inbox_limit',400,'待处理需求最多读取 50 条');
      const after=intakeInboxDecodeCursor(cursor);
      // Both reads share one database snapshot. No acknowledgement or state
      // change occurs when a request is listed or counted here.
      const [counts,rows]=await db.batch([
        db.prepare("SELECT COUNT(*) AS pending_count,COALESCE(SUM(status='received'),0) AS unread_count FROM intake_requests WHERE owner_id=? AND status IN ('received','read','accepted','needs_confirmation')").bind(ownerId),
        db.prepare("SELECT id,project_id,body,status,created_at,updated_at,context_task_id,version FROM intake_requests WHERE owner_id=? AND status IN ('received','read','accepted','needs_confirmation') AND (? IS NULL OR julianday(created_at)<julianday(?) OR (julianday(created_at)=julianday(?) AND id<?)) ORDER BY julianday(created_at) DESC,id DESC LIMIT ?").bind(ownerId,after?.createdAt??null,after?.createdAt??null,after?.createdAt??null,after?.id??null,limit+1)
      ]);
      const selected=rows.results.slice(0,limit),truncated=rows.results.length>limit;
      const requests=selected.map(row=>({id:row.id,projectId:row.project_id,body:row.body,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,contextTaskId:row.context_task_id,version:row.version}));
      const pendingCount=Number(counts.results[0].pending_count),unreadCount=Number(counts.results[0].unread_count);
      const last=selected.at(-1),nextCursor=truncated?intakeInboxEncodeCursor({v:1,createdAt:last.created_at,id:last.id}):null;
      return {requests,unreadCount,pendingCount,truncated,limit,nextCursor};
    },
    async get(id,ownerId=null) {
      const row=ownerId===null?await db.prepare('SELECT * FROM intake_requests WHERE id=?').bind(id).first():await db.prepare('SELECT * FROM intake_requests WHERE id=? AND owner_id=?').bind(id,ownerId).first();
      if(!row)return null;
      const events=await db.prepare('SELECT * FROM (SELECT * FROM intake_events WHERE request_id=? ORDER BY version DESC LIMIT 100) ORDER BY version').bind(id).all();return {request:intakeRow(row),events:events.results.map(intakeEventRow),eventsTruncated:row.version>events.results.length};
    },
    async existingEvent(eventId) {return db.prepare('SELECT request_id,event_digest FROM intake_events WHERE id=?').bind(eventId).first();},
    async append(id,event,digest,now) {
      const next=event.expectedVersion+1;
      const results=await db.batch([
        db.prepare('UPDATE intake_requests SET status=?,updated_at=?,version=?,linked_task_ids=?,latest_summary=? WHERE id=? AND version=?'+(guardDispatchOwnership?' AND NOT EXISTS (SELECT 1 FROM dispatch_jobs WHERE dispatch_jobs.request_id=intake_requests.id)':'')).bind(event.status,now,next,JSON.stringify(event.linkedTaskIds),event.summary,id,event.expectedVersion),
        db.prepare('INSERT INTO intake_events (id,request_id,version,event_digest,status,summary,created_at,linked_task_ids,evidence_links) SELECT ?,id,?,?,?,?,?,?,? FROM intake_requests WHERE id=? AND version=? AND changes()=1').bind(event.eventId,next,digest,event.status,event.summary,now,JSON.stringify(event.linkedTaskIds),JSON.stringify(event.evidenceLinks),id,next)
      ]);
      if(results[0].meta.changes!==1)throw new IntakeError('version_conflict',409,'状态已更新，请重读后再操作');
      return this.get(id);
    }
  };
}
