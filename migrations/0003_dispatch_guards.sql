-- Dispatch guard schema v1. Expiry is advisory: never reclaim an unknown writer.
ALTER TABLE dispatch_jobs ADD COLUMN resources_json TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE dispatch_jobs ADD COLUMN context_task_id TEXT;
--> statement-breakpoint
CREATE TABLE dispatch_controls (
 owner_id TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('project','task')),
 target_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('active','paused','deferred','canceled')),
 version INTEGER NOT NULL, reason TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,scope,target_id)
);
--> statement-breakpoint
CREATE TABLE dispatch_resource_leases (
 resource_key TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, job_id TEXT NOT NULL,
 dispatch_key TEXT NOT NULL, acquired_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE dispatch_task_bindings (
 owner_id TEXT NOT NULL, task_id TEXT NOT NULL, project_id TEXT NOT NULL,
 thread_id TEXT NOT NULL, environment_type TEXT NOT NULL, environment_id TEXT,
 verified_at TEXT NOT NULL, evidence TEXT NOT NULL, PRIMARY KEY(owner_id,task_id)
);
