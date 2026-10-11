import {IntakeError} from '../domain/intake.mjs';
import {CANDIDATE_SCHEMA} from '../domain/candidates.mjs';

function candidateStoredRow(row){
  if(!row)return null;
  const candidate={schemaVersion:CANDIDATE_SCHEMA,id:row.id,clientSubmissionId:row.client_submission_id,projectId:row.project_id,contextTaskId:row.context_task_id,title:row.title,reason:row.reason,expectedOutcome:row.expected_outcome,sourceReferences:JSON.parse(row.source_references),dueAt:row.due_at,area:row.area,viewedSnapshotRevision:row.viewed_snapshot_revision,viewedSnapshotImportedAt:row.viewed_snapshot_imported_at,contextStale:Boolean(row.context_stale),status:row.status,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at,review:row.review_event_id?{eventId:row.review_event_id,decision:row.status==='approved'?'approve':'reject',note:row.review_note,reviewedAt:row.updated_at}:null,requestId:row.request_id};
  return {candidate,payloadDigest:row.payload_digest,reviewDigest:row.review_digest};
}
export function createD1CandidateStore(db,{eventStore=null}={}){
  if(!db?.prepare||!db?.batch)return null;
  const get=async(owner,id)=>candidateStoredRow(await db.prepare('SELECT * FROM task_candidates WHERE owner_id=? AND id=?').bind(owner,id).first());
  const findSubmission=async(owner,key)=>candidateStoredRow(await db.prepare('SELECT * FROM task_candidates WHERE owner_id=? AND client_submission_id=?').bind(owner,key).first());
  const findReview=async(owner,eventId)=>candidateStoredRow(await db.prepare('SELECT * FROM task_candidates WHERE owner_id=? AND review_event_id=?').bind(owner,eventId).first());
  return {
    async available(){try{await db.prepare('SELECT id,owner_id,client_submission_id,project_id,context_task_id,title,reason,expected_outcome,source_references,due_at,area,viewed_snapshot_revision,viewed_snapshot_imported_at,payload_digest,context_stale,status,version,created_at,updated_at,review_event_id,review_digest,review_note,request_id FROM task_candidates LIMIT 0').all();return true;}catch{return false;}},get,findSubmission,findReview,
    async create(value){
      const q=value,result=await db.prepare("INSERT INTO task_candidates (id,owner_id,client_submission_id,project_id,context_task_id,title,reason,expected_outcome,source_references,due_at,area,viewed_snapshot_revision,viewed_snapshot_imported_at,payload_digest,context_stale,status,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'proposed',1,?,?) ON CONFLICT(owner_id,client_submission_id) DO NOTHING").bind(q.id,q.ownerId,q.clientSubmissionId,q.projectId,q.contextTaskId,q.title,q.reason,q.expectedOutcome,JSON.stringify(q.sourceReferences),q.dueAt,q.area,q.viewedSnapshotRevision,q.viewedSnapshotImportedAt,q.payloadDigest,q.contextStale?1:0,q.createdAt,q.createdAt).run();
      const saved=await findSubmission(q.ownerId,q.clientSubmissionId);if(!saved)throw new IntakeError('candidates_unavailable',503);if(saved.payloadDigest!==q.payloadDigest)throw new IntakeError('idempotency_conflict',409);return {candidate:saved.candidate,replayed:result.meta?.changes!==1};
    },
    async list(owner,{projectId=null,status=null,clientSubmissionId=null,cursor=0}={}){
      const result=await db.prepare('SELECT rowid AS sequence,* FROM task_candidates WHERE owner_id=? AND (? IS NULL OR project_id=?) AND (? IS NULL OR status=?) AND (? IS NULL OR client_submission_id=?) AND rowid>? ORDER BY rowid LIMIT 26').bind(owner,projectId,projectId,status,status,clientSubmissionId,clientSubmissionId,cursor).all();
      const rows=result.results.slice(0,25);return {candidates:rows.map(row=>candidateStoredRow(row).candidate),nextCursor:result.results.length>25?String(rows.at(-1).sequence):null};
    },
    async review(owner,id,event,digest,now,request){
      const statements=[];
      if(event.decision==='approve'){
        const q=request;
        // D1 batch is one transaction. A request is inserted only while the
        // exact candidate version is still proposed, then linked in that same
        // transaction. Optional Events reference that exact inserted request;
        // any receipt/event/outbox/link failure rolls back every statement.
        // Deliberately no dispatch job, authorization or queue writes.
        statements.push(db.prepare("INSERT INTO intake_requests (id,owner_id,project_id,client_submission_id,payload_digest,body,context_task_id,viewed_snapshot_revision,viewed_snapshot_imported_at,context_summary,context_stale,status,created_at,updated_at,version,linked_task_ids,latest_summary) SELECT ?,?,?,?,?,?,?,?,?,?,?,'received',?,?,1,'[]','' FROM task_candidates WHERE owner_id=? AND id=? AND status='proposed' AND version=?").bind(q.id,owner,q.projectId,q.clientSubmissionId,q.payloadDigest,q.body,q.contextTaskId,q.viewedSnapshotRevision,q.viewedSnapshotImportedAt,q.contextSummary,q.contextStale?1:0,q.createdAt,q.createdAt,owner,id,event.expectedVersion));
        statements.push(db.prepare("INSERT INTO intake_events (id,request_id,version,event_digest,status,summary,created_at,linked_task_ids,evidence_links) SELECT ?,id,1,?,'received','已保存，待 dot 读取',?,'[]','[]' FROM intake_requests WHERE id=? AND owner_id=?").bind(q.id+':received',q.payloadDigest,q.createdAt,q.id,owner));
        if(eventStore)statements.push(...await eventStore.intakeCreatedStatements({...q,ownerId:owner}));
      }
      statements.push(db.prepare("UPDATE task_candidates SET status=?,version=version+1,review_event_id=?,review_digest=?,review_note=?,request_id=?,updated_at=? WHERE owner_id=? AND id=? AND status='proposed' AND version=?").bind(event.decision==='approve'?'approved':'rejected',event.eventId,digest,event.note,request?.id??null,now,owner,id,event.expectedVersion));
      const result=await db.batch(statements),saved=await get(owner,id);
      if(!saved)throw new IntakeError('candidate_not_found',404);
      if(saved.candidate.review?.eventId===event.eventId&&saved.reviewDigest===digest)return {...saved,replayed:result.at(-1).meta?.changes!==1};
      throw new IntakeError('candidate_version_conflict',409,'候选建议已更新，请重新读取');
    }
  };
}
