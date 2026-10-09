import {queueError,queueId} from '../domain/dispatch-queue.mjs';
import {readExecutionEvidence} from '../domain/execution-evidence.mjs';
const manualDispatchGuard=(alias,now='?')=>`EXISTS (SELECT 1 FROM dispatch_manual_authorizations ma JOIN dispatch_task_bindings mb ON mb.owner_id=ma.owner_id AND mb.task_id=ma.task_id AND mb.project_id=ma.project_id WHERE ma.owner_id=${alias}.owner_id AND ma.request_id=${alias}.request_id AND ma.project_id=${alias}.project_id AND ma.task_id=${alias}.context_task_id AND julianday(ma.expires_at)>julianday(${now}) AND mb.thread_id=${alias}.thread_id AND mb.environment_type=${alias}.environment_type AND mb.environment_id IS ${alias}.environment_id)`;
const controlGuard=(alias,now='?')=>`NOT EXISTS (SELECT 1 FROM dispatch_controls c WHERE c.owner_id=${alias}.owner_id AND c.state<>'active' AND (c.state<>'deferred' OR NOT ${manualDispatchGuard(alias,now)}) AND ((c.scope='project' AND c.target_id=${alias}.project_id) OR (c.scope='task' AND c.target_id IN (${alias}.id,${alias}.root_job_id,${alias}.context_task_id))))`;
const columns={state:'state',priority:'priority',summary:'summary',updatedAt:'updated_at',threadId:'thread_id',turnId:'turn_id',dispatchKey:'dispatch_key',holdsSlot:'holds_slot',executionObservedAt:'execution_observed_at',executionEvidence:'execution_evidence',evidenceLinks:'evidence_links',requestVersion:'request_version',reconciliationEvidence:'reconciliation_evidence'};
export function dispatchRow(r){return r?{id:r.id,ownerId:r.owner_id,projectId:r.project_id,requestId:r.request_id,requestVersion:r.request_version,priority:r.priority,resources:JSON.parse(r.resources_json??'[]'),contextTaskId:r.context_task_id??null,state:r.state,version:r.version,environmentType:r.environment_type,environmentId:r.environment_id,rootJobId:r.root_job_id,continuationOf:r.continuation_of,threadId:r.thread_id,turnId:r.turn_id,dispatchKey:r.dispatch_key,dispatchAttempt:r.dispatch_attempt,holdsSlot:Boolean(r.holds_slot),summary:r.summary,reconciliationEvidence:r.reconciliation_evidence,evidenceLinks:JSON.parse(r.evidence_links),executionObservedAt:r.execution_observed_at,executionEvidence:readExecutionEvidence(r.execution_evidence),taskNumber:r.task_number??null,createdAt:r.created_at,updatedAt:r.updated_at}:null;}
export function createD1DispatchQueue(db){
 if(!db?.prepare||!db?.batch)return null;
 const get=async(owner,id)=>dispatchRow(await db.prepare('SELECT * FROM dispatch_jobs WHERE owner_id=? AND id=?').bind(owner,id).first());
 const operation=async(owner,event)=>db.prepare('SELECT * FROM dispatch_operations WHERE owner_id=? AND event_id=?').bind(owner,event).first();
 const accountingStatements=owner=>[
    db.prepare("SELECT project_id,COUNT(*) AS registered,SUM(state='completed') AS completed,SUM(state='canceled') AS removed,MAX(task_number) AS last_task_number,(SELECT COUNT(*) FROM dispatch_operations o JOIN dispatch_jobs j ON j.id=o.job_id AND j.owner_id=o.owner_id WHERE o.owner_id=q.owner_id AND j.project_id=q.project_id AND o.action IN ('enqueue','cancel')) AS change_count FROM dispatch_jobs q WHERE owner_id=? GROUP BY project_id").bind(owner),
    db.prepare("SELECT * FROM dispatch_jobs WHERE owner_id=? AND state='running' ORDER BY project_id,task_number").bind(owner),
    db.prepare("SELECT j.project_id,j.task_number,o.action,o.created_at FROM dispatch_operations o JOIN dispatch_jobs j ON j.id=o.job_id AND j.owner_id=o.owner_id WHERE o.owner_id=? AND o.action IN ('enqueue','cancel') ORDER BY o.created_at DESC,j.task_number DESC,o.event_id DESC LIMIT 500").bind(owner)
 ];
 const accountingResult=([totals,current,changes])=>({totals:totals.results,currentJobs:current.results.map(dispatchRow),changes:changes.results});
 return {
  get,operation,
  async attemptContext(owner,job){
   const claim=await db.prepare("SELECT rowid AS sequence,created_at FROM dispatch_operations WHERE owner_id=? AND job_id=? AND action='claim' ORDER BY rowid DESC LIMIT 1").bind(owner,job.id).first();
   const bind=await db.prepare("SELECT rowid AS sequence FROM dispatch_operations WHERE owner_id=? AND job_id=? AND action='bind' ORDER BY rowid DESC LIMIT 1").bind(owner,job.id).first();
   const begun=await db.prepare("SELECT rowid AS sequence FROM dispatch_operations WHERE owner_id=? AND job_id=? AND action='begin' ORDER BY rowid DESC LIMIT 1").bind(owner,job.id).first();
   const rows=job.threadId?(await db.prepare('SELECT turn_id FROM dispatch_jobs WHERE owner_id=? AND thread_id=? AND id<>? AND turn_id IS NOT NULL').bind(owner,job.threadId,job.id).all()).results:[];
   const knownPriorTurnIds=rows.map(row=>row.turn_id);
   if(job.turnId&&(!bind||!claim||bind.sequence<claim.sequence))knownPriorTurnIds.push(job.turnId);
   return {attemptStartedAt:claim?.created_at??null,attemptDispatched:claim?Boolean(begun&&begun.sequence>claim.sequence):null,knownPriorTurnIds:[...new Set(knownPriorTurnIds)]};
  },
  async control(owner,scope,target){return db.prepare('SELECT * FROM dispatch_controls WHERE owner_id=? AND scope=? AND target_id=?').bind(owner,scope,target).first();},
  async setControl(owner,scope,target,state,expectedVersion,reason,now){
   const result=await db.prepare('INSERT INTO dispatch_controls(owner_id,scope,target_id,state,version,reason,updated_at) SELECT ?,?,?,?,1,?,? WHERE ?=0 OR EXISTS (SELECT 1 FROM dispatch_controls WHERE owner_id=? AND scope=? AND target_id=? AND version=?) ON CONFLICT(owner_id,scope,target_id) DO UPDATE SET state=excluded.state,version=dispatch_controls.version+1,reason=excluded.reason,updated_at=excluded.updated_at WHERE dispatch_controls.version=?').bind(owner,scope,target,state,reason,now,expectedVersion,owner,scope,target,expectedVersion,expectedVersion).run();
   if(!result.meta.changes)queueError('version_conflict','Read the current control version before changing it');
   return this.control(owner,scope,target);
  },
  async authorizeManualRequest(owner,value,now){
   if(!owner||typeof owner!=='string'||!value||Object.keys(value).some(k=>!['requestId','projectId','taskId','expiresAt','reason'].includes(k)))queueError('invalid_manual_authorization','Exact owner/request/project/task authorization is required',400);
   for(const key of ['requestId','projectId','taskId'])queueId(value[key]);
   const expiry=Date.parse(value.expiresAt),at=Date.parse(now);
   const prior=await db.prepare('SELECT * FROM dispatch_manual_authorizations WHERE owner_id=? AND request_id=?').bind(owner,value.requestId).first();
   if(prior){if(prior.project_id!==value.projectId||prior.task_id!==value.taskId||!Number.isFinite(expiry)||prior.expires_at!==new Date(expiry).toISOString()||prior.reason!==value.reason)queueError('manual_authorization_conflict','An existing authorization cannot change its target or expiry');return prior;}
   if(!Number.isFinite(expiry)||!Number.isFinite(at)||expiry<=at||expiry>at+86400000||typeof value.reason!=='string'||!value.reason.trim()||value.reason.length>1200)queueError('invalid_manual_authorization','A bounded expiry and explicit owner reason are required',400);
   const expiresAt=new Date(expiry).toISOString();
   await db.prepare("INSERT INTO dispatch_manual_authorizations(owner_id,request_id,project_id,task_id,expires_at,reason) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM intake_requests r JOIN dispatch_task_bindings b ON b.owner_id=r.owner_id AND b.task_id=r.context_task_id AND b.project_id=r.project_id WHERE r.id=? AND r.owner_id=? AND r.project_id=? AND r.context_task_id=? AND r.status='accepted') ON CONFLICT(owner_id,request_id) DO NOTHING").bind(owner,value.requestId,value.projectId,value.taskId,expiresAt,value.reason,value.requestId,owner,value.projectId,value.taskId).run();
   const row=await db.prepare('SELECT * FROM dispatch_manual_authorizations WHERE owner_id=? AND request_id=?').bind(owner,value.requestId).first();
   if(!row)queueError('manual_request_unprepared','Owner accepted request and original registered binding are required');
   if(row.project_id!==value.projectId||row.task_id!==value.taskId||row.expires_at!==expiresAt||row.reason!==value.reason)queueError('manual_authorization_conflict','An existing authorization cannot change its target or expiry');
   return row;
  },
  async manualAuthorization(owner,requestId){return db.prepare('SELECT * FROM dispatch_manual_authorizations WHERE owner_id=? AND request_id=?').bind(owner,requestId).first();},
  async manualAuthorizationIds(owner,now,projectIds=null){return (await db.prepare('SELECT ma.request_id FROM dispatch_manual_authorizations ma JOIN dispatch_task_bindings b ON b.owner_id=ma.owner_id AND b.task_id=ma.task_id AND b.project_id=ma.project_id WHERE ma.owner_id=? AND julianday(ma.expires_at)>julianday(?) AND (? IS NULL OR ma.project_id IN (SELECT value FROM json_each(?)))').bind(owner,now,projectIds===null?null:JSON.stringify(projectIds),JSON.stringify(projectIds??[])).all()).results.map(row=>row.request_id);},
  async allowed(owner,job,now=new Date().toISOString()){
   return !(await db.prepare("SELECT 1 FROM dispatch_controls c WHERE c.owner_id=? AND c.state<>'active' AND (c.state<>'deferred' OR NOT EXISTS(SELECT 1 FROM dispatch_manual_authorizations ma JOIN dispatch_task_bindings b ON b.owner_id=ma.owner_id AND b.task_id=ma.task_id AND b.project_id=ma.project_id WHERE ma.owner_id=c.owner_id AND ma.request_id=? AND ma.project_id=? AND ma.task_id=? AND julianday(ma.expires_at)>julianday(?))) AND ((c.scope='project' AND c.target_id=?) OR (c.scope='task' AND c.target_id IN (?,?,?))) LIMIT 1").bind(owner,job.requestId??null,job.projectId,job.contextTaskId??null,now,job.projectId,job.id,job.rootJobId,job.contextTaskId??null).first());
  },
  async leases(owner,id){return (await db.prepare('SELECT * FROM dispatch_resource_leases WHERE owner_id=? AND job_id=?').bind(owner,id).all()).results;},
  async binding(owner,task){return db.prepare('SELECT * FROM dispatch_task_bindings WHERE owner_id=? AND task_id=?').bind(owner,task).first();},
  async registerBinding(owner,value,now){
   await db.prepare('INSERT INTO dispatch_task_bindings VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,task_id) DO NOTHING').bind(owner,value.taskId,value.projectId,value.threadId,value.environment.type,value.environment.id,now,value.evidence).run();
   const row=await this.binding(owner,value.taskId);
   if(row.project_id!==value.projectId||row.thread_id!==value.threadId||row.environment_type!==value.environment.type||row.environment_id!==value.environment.id)queueError('dispatch_binding_conflict','The existing task binding is immutable');
   return row;
  },
  async available(){try{await db.prepare('SELECT id,execution_evidence,task_number,resources_json,context_task_id FROM dispatch_jobs LIMIT 0').all();await db.prepare('SELECT event_id FROM dispatch_operations LIMIT 0').all();await db.prepare('SELECT state FROM dispatch_controls LIMIT 0').all();await db.prepare('SELECT dispatch_key FROM dispatch_resource_leases LIMIT 0').all();await db.prepare('SELECT thread_id FROM dispatch_task_bindings LIMIT 0').all();await db.prepare('SELECT request_id FROM dispatch_manual_authorizations LIMIT 0').all();return true;}catch{return false;}},
  async list(owner){return (await db.prepare('SELECT * FROM dispatch_jobs WHERE owner_id=? ORDER BY holds_slot DESC,priority DESC,created_at,id LIMIT 500').bind(owner).all()).results.map(dispatchRow);},
  async count(owner){return (await db.prepare('SELECT COUNT(*) AS total FROM dispatch_jobs WHERE owner_id=?').bind(owner).first()).total;},
  async projectionInputs(owner,limit=200){
   const bounded=Math.max(0,Math.min(500,Number.isSafeInteger(limit)?limit:200));
   const rows=(await db.prepare('SELECT q.*,substr(r.body,1,160) AS request_body FROM dispatch_jobs q JOIN intake_requests r ON r.id=q.request_id AND r.owner_id=q.owner_id WHERE q.owner_id=? AND q.state<>\'canceled\' ORDER BY q.holds_slot DESC,q.priority DESC,q.created_at,q.id LIMIT ?').bind(owner,bounded).all()).results;
   return {jobs:rows.map(dispatchRow),requests:rows.map(r=>({id:r.request_id,ownerId:r.owner_id,body:r.request_body}))};
  },
  async queueView(owner){
   const [rows,counts,...accounting]=await db.batch([
    db.prepare("SELECT q.*,substr(r.body,1,160) AS request_body FROM dispatch_jobs q JOIN intake_requests r ON r.id=q.request_id AND r.owner_id=q.owner_id WHERE q.owner_id=? AND q.state<>'canceled' ORDER BY q.holds_slot DESC,CASE WHEN q.state='queued' THEN 0 WHEN q.state IN ('blocked','uncertain','failed') THEN 1 ELSE 2 END,q.priority DESC,q.created_at,q.id LIMIT 500").bind(owner),
    db.prepare("SELECT state,COUNT(*) AS count,SUM(holds_slot) AS held FROM dispatch_jobs WHERE owner_id=? AND state<>'canceled' GROUP BY state").bind(owner),
    ...accountingStatements(owner)
   ]);
   return {jobs:rows.results.map(r=>({...dispatchRow(r),title:r.request_body})),counts:counts.results,accounting:accountingResult(accounting)};
  },
  async projectAccounting(owner){return accountingResult(await db.batch(accountingStatements(owner)));},
  async reorder(owner,event,digest,items,now){
   const payload=JSON.stringify(items),count=items.length;
   const results=await db.batch([
    db.prepare(`UPDATE dispatch_jobs SET priority=(SELECT json_array_length(?)-CAST(item.key AS INTEGER) FROM json_each(?) AS item WHERE json_extract(item.value,'$.id')=dispatch_jobs.id),version=version+1,updated_at=?
      WHERE owner_id=? AND state='queued' AND holds_slot=0 AND NOT EXISTS(SELECT 1 FROM dispatch_operations WHERE owner_id=? AND event_id=?)
      AND (SELECT COUNT(*) FROM dispatch_jobs WHERE owner_id=? AND state='queued' AND holds_slot=0)=?
      AND NOT EXISTS(SELECT 1 FROM json_each(?) AS item LEFT JOIN dispatch_jobs q ON q.id=json_extract(item.value,'$.id') AND q.owner_id=? WHERE q.id IS NULL OR q.state<>'queued' OR q.holds_slot<>0 OR q.version<>json_extract(item.value,'$.expectedVersion'))`).bind(payload,payload,now,owner,owner,event,owner,count,payload,owner),
    db.prepare("INSERT INTO dispatch_operations(owner_id,event_id,job_id,payload_digest,action,created_at) SELECT ?,?,NULL,?,'reorder',? WHERE changes()=?").bind(owner,event,digest,now,count)
   ]);
   if(results[0].meta.changes!==count){const prior=await operation(owner,event);if(prior?.payload_digest===digest&&prior.action==='reorder')return {replayed:true};queueError(prior?'event_conflict':'version_conflict','Queue membership or execution changed; reload before reordering');}
   return {replayed:false};
  },
  async byRequest(owner,id){return dispatchRow(await db.prepare('SELECT * FROM dispatch_jobs WHERE owner_id=? AND request_id=?').bind(owner,id).first());},
  async create(q,event,digest){
   const results=await db.batch([
    db.prepare(`INSERT INTO dispatch_jobs (id,owner_id,project_id,request_id,request_version,priority,state,environment_type,environment_id,root_job_id,continuation_of,thread_id,created_at,updated_at,task_number,resources_json,context_task_id) SELECT ?,?,?,?,?,?,'queued',?,?,?,?,?,?,?,(SELECT COALESCE(MAX(task_number),0)+1 FROM dispatch_jobs WHERE owner_id=? AND project_id=?),?,? FROM (SELECT ? AS owner_id,? AS project_id,? AS request_id,? AS context_task_id,? AS thread_id,? AS environment_type,? AS environment_id,? AS id,? AS root_job_id) q WHERE ${controlGuard('q')}${q.manualAuthorizationRequired?' AND '+manualDispatchGuard('q'):''} AND EXISTS (SELECT 1 FROM intake_requests WHERE id=? AND owner_id=? AND project_id=? AND version=? AND status='accepted') ON CONFLICT(owner_id,request_id) DO NOTHING`).bind(q.id,q.ownerId,q.projectId,q.requestId,q.requestVersion,q.priority,q.environmentType,q.environmentId,q.rootJobId,q.continuationOf,q.threadId,q.createdAt,q.createdAt,q.ownerId,q.projectId,JSON.stringify(q.resources),q.contextTaskId,q.ownerId,q.projectId,q.requestId,q.contextTaskId,q.threadId,q.environmentType,q.environmentId,q.id,q.rootJobId,q.createdAt,...(q.manualAuthorizationRequired?[q.createdAt]:[]),q.requestId,q.ownerId,q.projectId,q.requestVersion),
    db.prepare("INSERT INTO dispatch_operations (owner_id,event_id,job_id,payload_digest,action,created_at) SELECT ?,?,?,?,'enqueue',? WHERE changes()=1").bind(q.ownerId,event,q.id,digest,q.createdAt)
   ]);
   if(!results[0].meta.changes)queueError('request_not_dispatchable','Request is not accepted at the expected version or already queued');
   return get(q.ownerId,q.id);
  },
  async claim(owner,event,digest,dispatchKey,capacity,now,allowedProjects=null,manualRequestIds=[]){
   const results=await db.batch([
    db.prepare("INSERT INTO dispatch_operations(owner_id,event_id,job_id,payload_digest,action,created_at) VALUES (?,?,NULL,?,'claim',?) ON CONFLICT(owner_id,event_id) DO NOTHING").bind(owner,event,digest,now),
    db.prepare(`UPDATE dispatch_jobs SET state='claimed',holds_slot=1,version=version+1,dispatch_key=?,dispatch_attempt=dispatch_attempt+1,updated_at=? WHERE id=(SELECT q.id FROM dispatch_jobs q WHERE q.owner_id=? AND q.state='queued' AND q.holds_slot=0 AND ${controlGuard('q')} AND (? IS NULL OR q.project_id IN (SELECT value FROM json_each(?)) OR (q.request_id IN (SELECT value FROM json_each(?)) AND ${manualDispatchGuard('q')})) AND NOT EXISTS (SELECT 1 FROM json_each(q.resources_json) resource JOIN dispatch_resource_leases lease ON lease.resource_key=resource.value) AND EXISTS (SELECT 1 FROM intake_requests r WHERE r.id=q.request_id AND r.owner_id=q.owner_id AND r.version=q.request_version AND r.status IN ('accepted','blocked')) AND (q.thread_id IS NULL OR NOT EXISTS (SELECT 1 FROM dispatch_jobs a WHERE a.owner_id=q.owner_id AND a.thread_id=q.thread_id AND a.holds_slot=1)) ORDER BY q.priority DESC,q.created_at,q.id LIMIT 1) AND changes()=1 AND (SELECT COUNT(*) FROM dispatch_jobs WHERE owner_id=? AND holds_slot=1)<?`).bind(dispatchKey,now,owner,now,allowedProjects===null?null:JSON.stringify(allowedProjects),JSON.stringify(allowedProjects??[]),JSON.stringify(manualRequestIds),now,owner,capacity),
    db.prepare('UPDATE dispatch_operations SET job_id=(SELECT id FROM dispatch_jobs WHERE owner_id=? AND dispatch_key=?) WHERE owner_id=? AND event_id=? AND job_id IS NULL').bind(owner,dispatchKey,owner,event),
    db.prepare('INSERT INTO dispatch_resource_leases SELECT resource.value,q.owner_id,q.id,q.dispatch_key,?,? FROM dispatch_jobs q,json_each(q.resources_json) resource WHERE q.owner_id=? AND q.dispatch_key=? AND q.holds_slot=1 AND EXISTS (SELECT 1 FROM dispatch_operations WHERE owner_id=? AND event_id=? AND job_id=q.id) ON CONFLICT(resource_key) DO NOTHING').bind(now,new Date(Date.parse(now)+300000).toISOString(),owner,dispatchKey,owner,event)
   ]);
   const op=await operation(owner,event);if(op.payload_digest!==digest)queueError('event_conflict','Claim event identity was reused');
   const inserted=results[0]?.meta?.changes;
   if(inserted!==0&&inserted!==1)queueError('claim_receipt_unknown','Claim transaction metadata is unavailable; retain the reservation and reconcile',503);
   return {job:op.job_id?await get(owner,op.job_id):null,replayed:inserted===0};
  },
  async change(owner,id,event,digest,version,changes,action,now,receipt=null,requestGuard=null){
   const entries=Object.entries(changes);if(entries.some(([k])=>!columns[k]))throw Error('Unsupported internal queue field');
   const values=entries.map(([k,v])=>['evidenceLinks','executionEvidence'].includes(k)&&v!==null?JSON.stringify(v):typeof v==='boolean'?Number(v):v);
   const guard=receipt??requestGuard;
   const receiptGuard=guard?' AND EXISTS (SELECT 1 FROM intake_requests WHERE id=? AND owner_id=? AND version=?'+(action==='begin'?" AND status IN ('accepted','blocked')":'')+')':'';
   const statements=[
    db.prepare(`UPDATE dispatch_jobs SET ${entries.map(([k])=>columns[k]+'=?').join(',')},version=version+1 WHERE owner_id=? AND id=? AND version=? AND NOT EXISTS (SELECT 1 FROM dispatch_operations WHERE owner_id=? AND event_id=?)${receiptGuard}${['begin','resume'].includes(action)?' AND '+controlGuard('dispatch_jobs'):''}${requestGuard?.manualAuthorizationRequired?' AND '+manualDispatchGuard('dispatch_jobs'):''}`).bind(...values,owner,id,version,owner,event,...(guard?[guard.requestId,owner,guard.expectedVersion]:[]),...(['begin','resume'].includes(action)?[now]:[]),...(requestGuard?.manualAuthorizationRequired?[now]:[])),
    db.prepare('INSERT INTO dispatch_operations(owner_id,event_id,job_id,payload_digest,action,created_at) SELECT ?,?,?,?,?,? WHERE changes()=1').bind(owner,event,id,digest,action,now)
   ];
   if(receipt)statements.push(
    db.prepare('UPDATE intake_requests SET status=?,updated_at=?,version=version+1,linked_task_ids=?,latest_summary=? WHERE id=? AND owner_id=? AND version=? AND changes()=1 AND EXISTS (SELECT 1 FROM dispatch_operations WHERE owner_id=? AND event_id=? AND job_id=? AND payload_digest=? AND action=?)').bind(receipt.status,now,JSON.stringify(receipt.linkedTaskIds),receipt.summary,receipt.requestId,owner,receipt.expectedVersion,owner,event,id,digest,action),
    db.prepare('INSERT INTO intake_events(id,request_id,version,event_digest,status,summary,created_at,linked_task_ids,evidence_links) SELECT ?,id,version,?,?,?,?,?,? FROM intake_requests WHERE id=? AND owner_id=? AND version=? AND changes()=1').bind(receipt.eventId,receipt.digest,receipt.status,receipt.summary,now,JSON.stringify(receipt.linkedTaskIds),JSON.stringify(receipt.evidenceLinks),receipt.requestId,owner,receipt.expectedVersion+1)
   );
   if(changes.holdsSlot===false)statements.push(db.prepare('DELETE FROM dispatch_resource_leases WHERE owner_id=? AND job_id=? AND EXISTS (SELECT 1 FROM dispatch_operations WHERE owner_id=? AND event_id=? AND job_id=? AND payload_digest=?) AND EXISTS (SELECT 1 FROM dispatch_jobs WHERE owner_id=? AND id=? AND holds_slot=0)').bind(owner,id,owner,event,id,digest,owner,id));
   const results=await db.batch(statements);
   if(!results[0].meta.changes){const op=await operation(owner,event);if(op?.payload_digest===digest&&op.job_id===id)return {job:await get(owner,id),replayed:true};queueError(op?'event_conflict':'version_conflict','Execution state changed; read before retrying');}
   return {job:await get(owner,id),replayed:false};
  }
 };
}
