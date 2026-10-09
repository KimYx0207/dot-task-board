CREATE TABLE task_manual_status_events (
 owner_id TEXT NOT NULL,
 event_id TEXT NOT NULL,
 task_id TEXT NOT NULL,
 payload_digest TEXT NOT NULL CHECK(length(payload_digest)=64),
 version INTEGER NOT NULL CHECK(version>=1),
 state TEXT NOT NULL CHECK(state IN ('queued','running','blocked','paused','completed','canceled')),
 reason TEXT NOT NULL CHECK(length(reason)<=1200),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,event_id),
 UNIQUE(owner_id,task_id,version)
);
--> statement-breakpoint
CREATE INDEX task_manual_status_latest ON task_manual_status_events(owner_id,task_id,version DESC);
--> statement-breakpoint
CREATE TRIGGER task_manual_status_no_update BEFORE UPDATE ON task_manual_status_events BEGIN SELECT RAISE(ABORT,'manual_status_append_only'); END;
--> statement-breakpoint
CREATE TRIGGER task_manual_status_no_delete BEFORE DELETE ON task_manual_status_events BEGIN SELECT RAISE(ABORT,'manual_status_append_only'); END;
