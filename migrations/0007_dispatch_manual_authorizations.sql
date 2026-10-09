CREATE TABLE dispatch_manual_authorizations (
 owner_id TEXT NOT NULL,
 request_id TEXT NOT NULL REFERENCES intake_requests(id),
 project_id TEXT NOT NULL,
 task_id TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason)>0 AND length(reason)<=1200),
 PRIMARY KEY(owner_id,request_id),
 FOREIGN KEY(owner_id,task_id) REFERENCES dispatch_task_bindings(owner_id,task_id)
);
--> statement-breakpoint
CREATE INDEX dispatch_manual_authorizations_expiry ON dispatch_manual_authorizations(owner_id,expires_at);
--> statement-breakpoint
CREATE TRIGGER dispatch_manual_authorizations_immutable BEFORE UPDATE ON dispatch_manual_authorizations BEGIN SELECT RAISE(ABORT,'manual_authorization_immutable'); END;
