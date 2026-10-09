import {intakeDigest,intakeId} from '../domain/intake.mjs';
import {BOARD_OBSERVATION_STATES,BoardObservationError,boardObsExactKeys,observationOwner,observationTimestamp} from '../domain/board-observation.mjs';

export const BOARD_OBSERVATION_OUTBOX_EVENT_NAME='board.task_observed';
function boardObsOutboxEventId(value){
  if(typeof value!=='string'||!/^board-observed:[a-f0-9]{64}$/.test(value))throw new BoardObservationError('invalid_observation_outbox_event');
  return value;
}
function boardObsOutboxToken(value){
  if(typeof value!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(value))throw new BoardObservationError('invalid_observation_outbox_lease');
  return value;
}
function boardObsOutboxEnvelope(row){
  return {eventId:row.event_id,name:BOARD_OBSERVATION_OUTBOX_EVENT_NAME,timestamp:row.occurred_at,data:{projectId:row.project_id,taskId:row.task_id,status:row.status},cursor:null};
}
export function createD1BoardObservationOutbox(db,{clock=()=>new Date().toISOString(),newId=()=>crypto.randomUUID(),leaseMs=30000}={}){
  if(!Number.isSafeInteger(leaseMs)||leaseMs<1000||leaseMs>300000)throw new BoardObservationError('invalid_observation_outbox_lease',503);
  const boardObsOutboxRequireDb=()=>{if(!db?.prepare||!db?.batch)throw new BoardObservationError('observation_outbox_storage_unavailable',503);};
  const boardObsOutboxNow=()=>{const value=clock(),ms=observationTimestamp(value);if(ms===null)throw new BoardObservationError('invalid_server_clock',503);return {now:new Date(ms).toISOString(),ms};};
  return {
    isBoundTo(value){return value===db;},
    async available(){try{boardObsOutboxRequireDb();await db.prepare('SELECT owner_id,event_id,observation_event_id,observation_digest,project_id,task_id,status,occurred_at,created_at,state,attempts,next_attempt_at,lease_token,lease_until,delivered_at FROM board_observation_outbox LIMIT 0').all();return true;}catch{return false;}},
    // Internal statement capability. It must run immediately after the journal
    // CAS INSERT in the same db.batch, never as a standalone enqueue operation.
    async appendStatement(owner,value,digest,context,createdAt){
      boardObsOutboxRequireDb();observationOwner(owner);
      if(!boardObsExactKeys(context,['projectId','status'],['projectId','status'])||!intakeId(context.projectId)||!BOARD_OBSERVATION_STATES.includes(context.status))throw new BoardObservationError('invalid_observation_outbox_context',409);
      if(!intakeId(value.taskId)||!intakeId(value.eventId)||!/^[a-f0-9]{64}$/.test(digest)||observationTimestamp(value.source?.observedAt)===null||observationTimestamp(createdAt)===null)throw new BoardObservationError('invalid_observation_outbox_record',503);
      const eventId='board-observed:'+await intakeDigest({ownerId:owner,observationEventId:value.eventId});
      // changes() is the immediately preceding journal INSERT's result. A
      // losing CAS/replay cannot enqueue. A uniqueness/storage failure aborts
      // the batch, leaving neither a new observation nor a missing event.
      return db.prepare(`INSERT INTO board_observation_outbox
        (owner_id,event_id,observation_event_id,observation_digest,project_id,task_id,status,occurred_at,created_at,state,attempts,next_attempt_at)
        SELECT ?,?,?,?,?,?,?,?,?,'pending',0,? FROM board_observation_events observation
        WHERE observation.owner_id=? AND observation.event_id=? AND observation.payload_digest=? AND observation.version=? AND changes()=1`).bind(
          owner,eventId,value.eventId,digest,context.projectId,value.taskId,context.status,value.source.observedAt,createdAt,createdAt,
          owner,value.eventId,digest,value.expectedVersion+1
        );
    },
    async due(owner,{limit=25}={}){
      boardObsOutboxRequireDb();observationOwner(owner);
      if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new BoardObservationError('invalid_observation_outbox_limit');
      const {now}=boardObsOutboxNow();
      const rows=await db.prepare("SELECT event_id FROM board_observation_outbox WHERE owner_id=? AND ((state='pending' AND next_attempt_at<=?) OR (state='delivering' AND lease_until<=?)) ORDER BY next_attempt_at,event_id LIMIT ?").bind(owner,now,now,limit).all();
      return rows.results.map(row=>({eventId:row.event_id}));
    },
    async get(owner,eventId){
      boardObsOutboxRequireDb();observationOwner(owner);boardObsOutboxEventId(eventId);
      const row=await db.prepare('SELECT * FROM board_observation_outbox WHERE owner_id=? AND event_id=?').bind(owner,eventId).first();
      return row?{event:boardObsOutboxEnvelope(row),state:row.state,attempts:row.attempts,nextAttemptAt:row.next_attempt_at,leaseUntil:row.lease_until,deliveredAt:row.delivered_at}:null;
    },
    async claim(owner,eventId){
      boardObsOutboxRequireDb();observationOwner(owner);boardObsOutboxEventId(eventId);
      const {now,ms}=boardObsOutboxNow(),leaseToken=boardObsOutboxToken(newId()),leaseUntil=new Date(ms+leaseMs).toISOString();
      const changed=await db.prepare("UPDATE board_observation_outbox SET state='delivering',attempts=attempts+1,lease_token=?,lease_until=? WHERE owner_id=? AND event_id=? AND ((state='pending' AND next_attempt_at<=?) OR (state='delivering' AND lease_until<=?))").bind(leaseToken,leaseUntil,owner,eventId,now,now).run();
      if(changed?.meta?.changes===0)return null;
      if(changed?.meta?.changes!==1)throw new BoardObservationError('observation_outbox_claim_unverified',503);
      const row=await db.prepare("SELECT * FROM board_observation_outbox WHERE owner_id=? AND event_id=? AND state='delivering' AND lease_token=?").bind(owner,eventId,leaseToken).first();
      if(!row)throw new BoardObservationError('observation_outbox_claim_unverified',503);
      return {event:boardObsOutboxEnvelope(row),leaseToken,leaseUntil,attempts:row.attempts};
    },
    async ack(owner,eventId,leaseToken){
      boardObsOutboxRequireDb();observationOwner(owner);boardObsOutboxEventId(eventId);boardObsOutboxToken(leaseToken);
      const {now}=boardObsOutboxNow();
      const result=await db.prepare("UPDATE board_observation_outbox SET state='delivered',delivered_at=?,lease_token=NULL,lease_until=NULL WHERE owner_id=? AND event_id=? AND state='delivering' AND lease_token=? AND lease_until>?").bind(now,owner,eventId,leaseToken,now).run();
      if(![0,1].includes(result?.meta?.changes))throw new BoardObservationError('observation_outbox_ack_unverified',503);
      return result.meta.changes===1;
    },
    async retry(owner,eventId,leaseToken,{nextAttemptAt}={}){
      boardObsOutboxRequireDb();observationOwner(owner);boardObsOutboxEventId(eventId);boardObsOutboxToken(leaseToken);
      const {now,ms}=boardObsOutboxNow(),retryMs=observationTimestamp(nextAttemptAt);
      if(retryMs===null||retryMs<ms||retryMs>ms+86400000)throw new BoardObservationError('invalid_observation_outbox_retry');
      const result=await db.prepare("UPDATE board_observation_outbox SET state='pending',next_attempt_at=?,lease_token=NULL,lease_until=NULL WHERE owner_id=? AND event_id=? AND state='delivering' AND lease_token=? AND lease_until>?").bind(new Date(retryMs).toISOString(),owner,eventId,leaseToken,now).run();
      if(![0,1].includes(result?.meta?.changes))throw new BoardObservationError('observation_outbox_retry_unverified',503);
      return result.meta.changes===1;
    }
  };
}
