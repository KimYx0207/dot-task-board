import {BoardObservationError,observationOwner,observationTimestamp} from '../domain/board-observation.mjs';

function boardObsStoredRow(row){
  if(!row)return null;
  return {taskId:row.task_id,eventId:row.event_id,version:row.version,createdAt:row.created_at,observation:JSON.parse(row.observation_json)};
}
export function createD1BoardObservationStore(db,{clock=()=>new Date().toISOString(),maxEventsPerTask=1000,observationOutbox=null}={}){
  if(!Number.isSafeInteger(maxEventsPerTask)||maxEventsPerTask<1||maxEventsPerTask>10000)throw new BoardObservationError('invalid_observation_capacity',503);
  if(observationOutbox&&(!db?.batch||observationOutbox.isBoundTo?.(db)!==true))throw new BoardObservationError('observation_outbox_database_mismatch',503);
  const boardObsRequireDb=()=>{if(!db?.prepare)throw new BoardObservationError('observation_storage_unavailable',503);};
  const boardObsFindEvent=async(owner,eventId)=>{
    boardObsRequireDb();observationOwner(owner);
    const row=await db.prepare('SELECT * FROM board_observation_events WHERE owner_id=? AND event_id=?').bind(owner,eventId).first();
    return row?{...boardObsStoredRow(row),digest:row.payload_digest}:null;
  };
  const boardObsLatest=async(owner,taskId)=>{
    boardObsRequireDb();observationOwner(owner);
    return boardObsStoredRow(await db.prepare('SELECT * FROM board_observation_events WHERE owner_id=? AND task_id=? ORDER BY version DESC LIMIT 1').bind(owner,taskId).first());
  };
  const boardObsReceipt=(stored,digest,taskId)=>{
    if(stored.digest!==digest||stored.taskId!==taskId)throw new BoardObservationError('observation_event_conflict',409);
    const {digest:ignored,...receipt}=stored;return {...receipt,duplicate:true};
  };
  return {
    observationOutboxEnabled:Boolean(observationOutbox),
    async available(){try{boardObsRequireDb();await db.prepare('SELECT owner_id,task_id,event_id,payload_digest,version,source_observed_at,source_observed_ms,observation_json,created_at FROM board_observation_events LIMIT 0').all();return observationOutbox?await observationOutbox.available():true;}catch{return false;}},
    findEvent:boardObsFindEvent,
    state:boardObsLatest,
    async latestForTasks(owner,taskIds){
      boardObsRequireDb();observationOwner(owner);
      if(!Array.isArray(taskIds)||taskIds.length>200)throw new BoardObservationError('invalid_observation_task_scope');
      if(!taskIds.length)return [];
      const output=[];
      // Keep each query below common D1 parameter limits, even at 200 tasks.
      for(let offset=0;offset<taskIds.length;offset+=80){
        const selected=taskIds.slice(offset,offset+80),placeholders=selected.map(()=>'?').join(',');
        const rows=await db.prepare(`SELECT e.* FROM board_observation_events e WHERE e.owner_id=? AND e.task_id IN (${placeholders}) AND e.version=(SELECT MAX(current.version) FROM board_observation_events current WHERE current.owner_id=e.owner_id AND current.task_id=e.task_id)`).bind(owner,...selected).all();
        output.push(...rows.results.map(boardObsStoredRow));
      }
      return output;
    },
    async append(owner,value,digest,materialization,eventContext=null){
      boardObsRequireDb();observationOwner(owner);
      const existing=await boardObsFindEvent(owner,value.eventId);
      if(existing)return boardObsReceipt(existing,digest,value.taskId);
      const now=clock(),observedMs=observationTimestamp(value.source.observedAt);
      if(observationTimestamp(now)===null||observedMs===null)throw new BoardObservationError('invalid_observation_timestamp',503);
      // This single SQL statement is the linearization point. SQLite/D1 acquires
      // the write lock before evaluating all predicates; no read/then-write CAS.
      // A racing same-version observation can never produce a second event.
      const insertObservation=db.prepare(`INSERT INTO board_observation_events
        (owner_id,task_id,event_id,payload_digest,version,source_observed_at,source_observed_ms,observation_json,created_at)
        SELECT ?,?,?,?,?,?,?,?,?
        WHERE ?=COALESCE((SELECT MAX(version) FROM board_observation_events WHERE owner_id=? AND task_id=?),0)
        AND ?< ?
        AND NOT EXISTS (SELECT 1 FROM board_observation_events WHERE owner_id=? AND task_id=? AND source_observed_ms>=?)
        ON CONFLICT(owner_id,event_id) DO NOTHING`).bind(
          owner,value.taskId,value.eventId,digest,value.expectedVersion+1,value.source.observedAt,observedMs,JSON.stringify(materialization),now,
          value.expectedVersion,owner,value.taskId,value.expectedVersion,maxEventsPerTask,owner,value.taskId,observedMs
        );
      // Explicit opt-in only. D1 batch transactions roll back the observation
      // if its durable relay event cannot be appended in the same commit.
      const result=observationOutbox?(await db.batch([insertObservation,await observationOutbox.appendStatement(owner,value,digest,eventContext,now)]))[0]:await insertObservation.run();
      const saved=await boardObsFindEvent(owner,value.eventId);
      if(saved){
        const receipt=boardObsReceipt(saved,digest,value.taskId);
        return {...receipt,duplicate:result?.meta?.changes!==1};
      }
      if(result?.meta?.changes!==0)throw new BoardObservationError('observation_write_unverified',503);
      const current=await boardObsLatest(owner,value.taskId);
      if((current?.version??0)>=maxEventsPerTask)throw new BoardObservationError('observation_journal_full',409);
      if((current?.version??0)!==value.expectedVersion)throw new BoardObservationError('observation_version_conflict',409);
      if(current&&Date.parse(current.observation.input.source.observedAt)>=observedMs)throw new BoardObservationError('stale_source_observation',409);
      throw new BoardObservationError('observation_write_unverified',503);
    }
  };
}
