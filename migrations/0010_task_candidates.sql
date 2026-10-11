CREATE TABLE task_candidates (
 id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL,
 client_submission_id TEXT NOT NULL,
 project_id TEXT NOT NULL,
 context_task_id TEXT,
 title TEXT NOT NULL,
 reason TEXT NOT NULL,
 expected_outcome TEXT NOT NULL,
 source_references TEXT NOT NULL,
 due_at TEXT,
 area TEXT NOT NULL DEFAULT '',
 viewed_snapshot_revision TEXT NOT NULL,
 viewed_snapshot_imported_at TEXT NOT NULL,
 payload_digest TEXT NOT NULL,
 context_stale INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'proposed',
 version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 review_event_id TEXT,
 review_digest TEXT,
 review_note TEXT NOT NULL DEFAULT '',
 request_id TEXT REFERENCES intake_requests(id),
 CONSTRAINT task_candidates_digest CHECK(length(payload_digest)=64),
 CONSTRAINT task_candidates_sources CHECK(json_valid(source_references) AND json_type(source_references)='array'),
 CONSTRAINT task_candidates_state CHECK(
  (status='proposed' AND version=1 AND review_event_id IS NULL AND review_digest IS NULL AND request_id IS NULL)
  OR (status='approved' AND version=2 AND review_event_id IS NOT NULL AND review_digest IS NOT NULL AND length(review_digest)=64 AND request_id IS NOT NULL)
  OR (status='rejected' AND version=2 AND review_event_id IS NOT NULL AND review_digest IS NOT NULL AND length(review_digest)=64 AND request_id IS NULL)
 )
);
--> statement-breakpoint
CREATE UNIQUE INDEX task_candidates_submission ON task_candidates(owner_id,client_submission_id);
--> statement-breakpoint
CREATE UNIQUE INDEX task_candidates_review ON task_candidates(owner_id,review_event_id);
--> statement-breakpoint
CREATE UNIQUE INDEX task_candidates_request ON task_candidates(request_id);
--> statement-breakpoint
CREATE INDEX task_candidates_owner_project ON task_candidates(owner_id,project_id,status);
--> statement-breakpoint
CREATE TRIGGER task_candidates_payload_immutable BEFORE UPDATE ON task_candidates
WHEN NEW.id IS NOT OLD.id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.client_submission_id IS NOT OLD.client_submission_id OR NEW.project_id IS NOT OLD.project_id OR NEW.context_task_id IS NOT OLD.context_task_id OR NEW.title IS NOT OLD.title OR NEW.reason IS NOT OLD.reason OR NEW.expected_outcome IS NOT OLD.expected_outcome OR NEW.source_references IS NOT OLD.source_references OR NEW.due_at IS NOT OLD.due_at OR NEW.area IS NOT OLD.area OR NEW.viewed_snapshot_revision IS NOT OLD.viewed_snapshot_revision OR NEW.viewed_snapshot_imported_at IS NOT OLD.viewed_snapshot_imported_at OR NEW.payload_digest IS NOT OLD.payload_digest OR NEW.context_stale IS NOT OLD.context_stale OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'candidate_payload_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER task_candidates_terminal BEFORE UPDATE ON task_candidates WHEN OLD.status<>'proposed' BEGIN SELECT RAISE(ABORT,'candidate_already_reviewed'); END;
