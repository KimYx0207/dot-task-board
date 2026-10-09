CREATE TABLE task_requirement_events (
 owner_id TEXT NOT NULL,
 event_id TEXT NOT NULL,
 task_id TEXT NOT NULL,
 payload_digest TEXT NOT NULL,
 version INTEGER NOT NULL,
 fields_json TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,event_id),
 CONSTRAINT task_requirements_digest CHECK(length(payload_digest)=64),
 CONSTRAINT task_requirements_version_positive CHECK(version>=1),
 CONSTRAINT task_requirements_json CHECK(json_valid(fields_json))
);
--> statement-breakpoint
CREATE UNIQUE INDEX task_requirements_version ON task_requirement_events(owner_id,task_id,version);
--> statement-breakpoint
CREATE INDEX task_requirements_latest ON task_requirement_events(owner_id,task_id,version);
--> statement-breakpoint
CREATE TRIGGER task_requirements_no_update BEFORE UPDATE ON task_requirement_events BEGIN SELECT RAISE(ABORT,'requirements_append_only'); END;
--> statement-breakpoint
CREATE TRIGGER task_requirements_no_delete BEFORE DELETE ON task_requirement_events BEGIN SELECT RAISE(ABORT,'requirements_append_only'); END;
