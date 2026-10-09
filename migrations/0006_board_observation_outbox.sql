-- Candidate only. Observation commit and this relay outbox are one D1 batch.
-- No callback URLs, credentials, source identities, or free-text task content.
CREATE TABLE IF NOT EXISTS board_observation_outbox (
  owner_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  observation_event_id TEXT NOT NULL,
  observation_digest TEXT NOT NULL CHECK(length(observation_digest)=64),
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('unknown','partial','blocked','paused','completed','canceled')),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','delivering','delivered')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
  next_attempt_at TEXT NOT NULL,
  lease_token TEXT,
  lease_until TEXT,
  delivered_at TEXT,
  PRIMARY KEY(owner_id,event_id),
  UNIQUE(owner_id,observation_event_id),
  FOREIGN KEY(owner_id,observation_event_id) REFERENCES board_observation_events(owner_id,event_id),
  CHECK((state='delivering' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR (state<>'delivering' AND lease_token IS NULL AND lease_until IS NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS board_observation_outbox_due
ON board_observation_outbox(owner_id,state,next_attempt_at,lease_until);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS board_observation_outbox_immutable
BEFORE UPDATE OF owner_id,event_id,observation_event_id,observation_digest,project_id,task_id,status,occurred_at,created_at
ON board_observation_outbox BEGIN
  SELECT RAISE(ABORT,'board_observation_outbox_event_immutable');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS board_observation_outbox_no_delete
BEFORE DELETE ON board_observation_outbox BEGIN
  SELECT RAISE(ABORT,'board_observation_outbox_append_only');
END;
