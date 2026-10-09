-- Additive, owner-private observation journal. No execution or credentials.
CREATE TABLE IF NOT EXISTS board_observation_events (
  owner_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload_digest TEXT NOT NULL CHECK(length(payload_digest)=64),
  version INTEGER NOT NULL CHECK(version>=1),
  source_observed_at TEXT NOT NULL,
  source_observed_ms INTEGER NOT NULL,
  observation_json TEXT NOT NULL CHECK(json_valid(observation_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(owner_id,event_id),
  UNIQUE(owner_id,task_id,version)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS board_observation_task_latest
ON board_observation_events(owner_id,task_id,version DESC);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS board_observation_no_update
BEFORE UPDATE ON board_observation_events BEGIN
  SELECT RAISE(ABORT,'board_observation_append_only');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS board_observation_no_delete
BEFORE DELETE ON board_observation_events BEGIN
  SELECT RAISE(ABORT,'board_observation_append_only');
END;
