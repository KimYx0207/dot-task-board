import {canonicalJson, McpEventsError, normalizeMcpEvent, PROJECT_REQUEST_CREATED} from '../domain/mcp-events.mjs';

function subscription(row) {
  return row?{id:row.id,ownerId:row.owner_id,name:row.name,arguments:JSON.parse(row.arguments_json),url:row.callback_url,secret:row.signing_secret,previousSecret:row.previous_secret,previousSecretUntil:row.previous_secret_until,expiresAt:row.expires_at,verifiedUntil:row.verified_until,active:Boolean(row.active),createdAt:row.created_at}:null;
}
export function createD1McpEventsStore(db) {
  if(!db?.prepare||!db?.batch)return null;
  const store={
    async available() {
      try {for(const name of ['mcp_event_subscriptions','mcp_events','mcp_event_outbox'])await db.prepare(`SELECT * FROM ${name} LIMIT 0`).all();return true;} catch {return false;}
    },
    async getSubscription(id,ownerId) {
      return subscription(await db.prepare('SELECT * FROM mcp_event_subscriptions WHERE id=? AND owner_id=?').bind(id,ownerId).first());
    },
    async getVerification(ownerId,url,secret,now) {
      return (await db.prepare('SELECT verified_until FROM mcp_event_subscriptions WHERE owner_id=? AND callback_url=? AND signing_secret=? AND active=1 AND expires_at>? AND verified_until>? ORDER BY verified_until DESC LIMIT 1').bind(ownerId,url,secret,now,now).first())?.verified_until??null;
    },
    async saveSubscription(q) {
      await db.batch([
        db.prepare("UPDATE mcp_event_outbox SET state='canceled',last_reason='subscription_lapsed',lease_token=NULL,lease_until=NULL WHERE subscription_id=? AND state IN ('pending','retry','delivering') AND EXISTS (SELECT 1 FROM mcp_event_subscriptions s WHERE s.id=? AND (s.active=0 OR s.expires_at<=?))").bind(q.id,q.id,q.now),
        db.prepare(`INSERT INTO mcp_event_subscriptions (id,owner_id,name,arguments_json,project_id,callback_url,signing_secret,previous_secret,previous_secret_until,expires_at,verified_until,active,start_sequence,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,NULL,NULL,?,?,1,(SELECT COALESCE(MAX(sequence),0) FROM mcp_events),?,?)
          ON CONFLICT(id) DO UPDATE SET
          previous_secret=CASE WHEN signing_secret<>excluded.signing_secret AND active=1 AND expires_at>excluded.updated_at THEN signing_secret WHEN previous_secret_until>excluded.updated_at THEN previous_secret ELSE NULL END,
          previous_secret_until=CASE WHEN signing_secret<>excluded.signing_secret AND active=1 AND expires_at>excluded.updated_at THEN ? WHEN previous_secret_until>excluded.updated_at THEN previous_secret_until ELSE NULL END,
          signing_secret=excluded.signing_secret,expires_at=excluded.expires_at,verified_until=excluded.verified_until,
          start_sequence=CASE WHEN active=1 AND expires_at>excluded.updated_at THEN start_sequence ELSE excluded.start_sequence END,
          active=1,updated_at=excluded.updated_at`).bind(q.id,q.ownerId,q.name,canonicalJson(q.arguments),q.arguments.projectId,q.url,q.secret,q.expiresAt,q.verifiedUntil,q.now,q.now,q.rotationUntil)
      ]);
    },
    async revoke(ownerId,id,now,reason='unsubscribed') {
      await db.batch([
        db.prepare('UPDATE mcp_event_subscriptions SET active=0,updated_at=?,previous_secret=NULL,previous_secret_until=NULL WHERE id=? AND owner_id=?').bind(now,id,ownerId),
        db.prepare("UPDATE mcp_event_outbox SET state='canceled',last_reason=?,lease_token=NULL,lease_until=NULL WHERE subscription_id=? AND state IN ('pending','retry','delivering') AND EXISTS (SELECT 1 FROM mcp_event_subscriptions WHERE id=? AND owner_id=? AND active=0)").bind(reason,id,id,ownerId)
      ]);
    },
    async enqueueStatements(raw,{requireIntakeRequest=false,now=raw.createdAt}={}) {
      const q=await normalizeMcpEvent(raw);
      if(!Number.isFinite(Date.parse(now)))throw new McpEventsError('invalid_event_timestamp');
      const queuedAt=new Date(now).toISOString();
      const guard=requireIntakeRequest?'EXISTS (SELECT 1 FROM intake_requests WHERE id=? AND owner_id=? AND project_id=?)':'1';
      const values=[q.eventId,q.ownerId,q.name,canonicalJson(q.arguments),q.arguments.projectId,canonicalJson(q.data),q.createdAt,q.digest];
      if(requireIntakeRequest)values.push(q.data.requestId,q.ownerId,q.arguments.projectId);
      const outboxValues=[queuedAt,q.eventId,q.digest,queuedAt];
      if(requireIntakeRequest)outboxValues.push(q.data.requestId,q.ownerId,q.arguments.projectId);
      return [
        // A conflicting immutable ID raises NOT NULL and rolls the entire intake batch back.
        db.prepare(`INSERT INTO mcp_events (event_id,owner_id,name,arguments_json,project_id,data_json,occurred_at,event_digest) SELECT ?,?,?,?,?,?,?,? WHERE ${guard}
          ON CONFLICT(event_id) DO UPDATE SET event_digest=CASE WHEN mcp_events.event_digest=excluded.event_digest THEN mcp_events.event_digest ELSE NULL END`).bind(...values),
        db.prepare(`INSERT INTO mcp_event_outbox (subscription_id,event_id,state,attempts,next_attempt_at)
          SELECT s.id,e.event_id,'pending',0,? FROM mcp_events e JOIN mcp_event_subscriptions s
          ON s.owner_id=e.owner_id AND s.name=e.name AND s.arguments_json=e.arguments_json
          WHERE e.event_id=? AND e.event_digest=? AND s.active=1 AND s.expires_at>? AND e.sequence>s.start_sequence AND ${guard}
          ON CONFLICT(subscription_id,event_id) DO NOTHING`).bind(...outboxValues)
      ];
    },
    async intakeCreatedStatements(q) {
      return store.enqueueStatements({eventId:q.id+':created:v1',ownerId:q.ownerId,name:PROJECT_REQUEST_CREATED,arguments:{projectId:q.projectId},data:{requestId:q.id,projectId:q.projectId,version:1},createdAt:q.createdAt},{requireIntakeRequest:true});
    },
    async enqueue(raw) {
      const q=await normalizeMcpEvent(raw);
      try {await db.batch(await store.enqueueStatements(raw));}
      catch(error) {
        const existing=await db.prepare('SELECT event_digest FROM mcp_events WHERE event_id=?').bind(q.eventId).first();
        if(existing&&existing.event_digest!==q.digest)throw new McpEventsError('event_id_conflict',409,-32602);
        throw error;
      }
      return {eventId:q.eventId};
    },
    async maintain(now,maxAttempts) {
      await db.batch([
        db.prepare("UPDATE mcp_event_outbox SET state='canceled',last_reason='subscription_expired',lease_token=NULL,lease_until=NULL WHERE state IN ('pending','retry','delivering') AND subscription_id IN (SELECT id FROM mcp_event_subscriptions WHERE expires_at<=? OR active=0)").bind(now),
        db.prepare('UPDATE mcp_event_subscriptions SET active=0,updated_at=? WHERE active=1 AND expires_at<=?').bind(now,now),
        db.prepare('UPDATE mcp_event_subscriptions SET previous_secret=NULL,previous_secret_until=NULL WHERE previous_secret_until<=?').bind(now),
        db.prepare("UPDATE mcp_event_outbox SET state='failed',last_reason='attempts_exhausted',lease_token=NULL,lease_until=NULL WHERE attempts>=? AND (state IN ('pending','retry') OR (state='delivering' AND lease_until<=?))").bind(maxAttempts,now)
      ]);
    },
    async due(now,limit,maxAttempts) {
      const result=await db.prepare("SELECT subscription_id,event_id FROM mcp_event_outbox WHERE attempts<? AND ((state IN ('pending','retry') AND next_attempt_at<=?) OR (state='delivering' AND lease_until<=?)) ORDER BY next_attempt_at,event_id,subscription_id LIMIT ?").bind(maxAttempts,now,now,limit).all();
      return result.results.map(row=>({subscriptionId:row.subscription_id,eventId:row.event_id}));
    },
    async claim(q) {
      const changed=await db.prepare("UPDATE mcp_event_outbox SET state='delivering',attempts=attempts+1,lease_token=?,lease_until=? WHERE subscription_id=? AND event_id=? AND attempts<? AND ((state IN ('pending','retry') AND next_attempt_at<=?) OR (state='delivering' AND lease_until<=?))").bind(q.token,q.leaseUntil,q.subscriptionId,q.eventId,q.maxAttempts,q.now,q.now).run();
      if(changed.meta.changes!==1)return null;
      const row=await db.prepare('SELECT o.attempts,e.owner_id,e.name,e.data_json,e.occurred_at FROM mcp_event_outbox o JOIN mcp_events e ON e.event_id=o.event_id WHERE o.subscription_id=? AND o.event_id=? AND o.lease_token=?').bind(q.subscriptionId,q.eventId,q.token).first();
      return row?{...q,attempts:row.attempts,ownerId:row.owner_id,event:{eventId:q.eventId,name:row.name,timestamp:row.occurred_at,data:JSON.parse(row.data_json),cursor:null}}:null;
    },
    async finish(q) {
      const result=await db.prepare("UPDATE mcp_event_outbox SET state=?,next_attempt_at=?,last_reason=?,delivered_at=?,lease_token=NULL,lease_until=NULL WHERE subscription_id=? AND event_id=? AND state='delivering' AND lease_token=?").bind(q.state,q.nextAttemptAt,q.reason??null,q.state==='delivered'?q.now:null,q.subscriptionId,q.eventId,q.token).run();
      return result.meta.changes===1;
    }
  };
  return store;
}
