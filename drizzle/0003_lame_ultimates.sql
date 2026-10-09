CREATE TABLE `dispatch_controls` (
	`owner_id` text NOT NULL,
	`scope` text NOT NULL,
	`target_id` text NOT NULL,
	`state` text NOT NULL,
	`version` integer NOT NULL,
	`reason` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `scope`, `target_id`),
	CONSTRAINT "dispatch_controls_scope" CHECK("dispatch_controls"."scope" IN ('project','task')),
	CONSTRAINT "dispatch_controls_state" CHECK("dispatch_controls"."state" IN ('active','paused','deferred','canceled'))
);
--> statement-breakpoint
CREATE TABLE `dispatch_resource_leases` (
	`resource_key` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`job_id` text NOT NULL,
	`dispatch_key` text NOT NULL,
	`acquired_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dispatch_task_bindings` (
	`owner_id` text NOT NULL,
	`task_id` text NOT NULL,
	`project_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`environment_type` text NOT NULL,
	`environment_id` text,
	`verified_at` text NOT NULL,
	`evidence` text NOT NULL,
	PRIMARY KEY(`owner_id`, `task_id`)
);
--> statement-breakpoint
CREATE TABLE `native_dispatch_journal` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`binding_json` text NOT NULL,
	`state` text NOT NULL,
	`receipt_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `operation_id`),
	CONSTRAINT "native_dispatch_journal_state" CHECK("native_dispatch_journal"."state" IN ('reserved','admitted','uncertain'))
);
--> statement-breakpoint
ALTER TABLE `dispatch_jobs` ADD `resources_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `dispatch_jobs` ADD `context_task_id` text;