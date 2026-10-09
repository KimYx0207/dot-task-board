CREATE TABLE `intake_events` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`version` integer NOT NULL,
	`event_digest` text NOT NULL,
	`status` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` text NOT NULL,
	`linked_task_ids` text NOT NULL,
	`evidence_links` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `intake_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intake_events_request_version_unique` ON `intake_events` (`request_id`,`version`);--> statement-breakpoint
CREATE TABLE `intake_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`client_submission_id` text NOT NULL,
	`payload_digest` text NOT NULL,
	`body` text NOT NULL,
	`context_task_id` text,
	`viewed_snapshot_revision` text NOT NULL,
	`viewed_snapshot_imported_at` text NOT NULL,
	`context_summary` text NOT NULL,
	`context_stale` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer NOT NULL,
	`linked_task_ids` text DEFAULT '[]' NOT NULL,
	`latest_summary` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intake_requests_submission_unique` ON `intake_requests` (`owner_id`,`client_submission_id`);--> statement-breakpoint
CREATE INDEX `intake_requests_owner_project` ON `intake_requests` (`owner_id`,`project_id`);