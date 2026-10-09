CREATE TABLE `dispatch_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_version` integer NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`state` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`environment_type` text NOT NULL,
	`environment_id` text,
	`root_job_id` text NOT NULL,
	`continuation_of` text,
	`thread_id` text,
	`turn_id` text,
	`dispatch_key` text,
	`dispatch_attempt` integer DEFAULT 0 NOT NULL,
	`holds_slot` integer DEFAULT 0 NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`reconciliation_evidence` text DEFAULT '' NOT NULL,
	`evidence_links` text DEFAULT '[]' NOT NULL,
	`execution_observed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `intake_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dispatch_request_identity` ON `dispatch_jobs` (`owner_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `dispatch_queue_order` ON `dispatch_jobs` (`owner_id`,`state`,`priority`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `dispatch_one_thread_writer` ON `dispatch_jobs` (`owner_id`,`thread_id`) WHERE "dispatch_jobs"."holds_slot"=1 AND "dispatch_jobs"."thread_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `dispatch_operations` (
	`owner_id` text NOT NULL,
	`event_id` text NOT NULL,
	`job_id` text,
	`payload_digest` text NOT NULL,
	`action` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `event_id`)
);
--> statement-breakpoint
CREATE TABLE `mcp_event_outbox` (
	`subscription_id` text NOT NULL,
	`event_id` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text NOT NULL,
	`lease_token` text,
	`lease_until` text,
	`last_reason` text,
	`delivered_at` text,
	PRIMARY KEY(`subscription_id`, `event_id`),
	FOREIGN KEY (`subscription_id`) REFERENCES `mcp_event_subscriptions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `mcp_events`(`event_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "mcp_event_outbox_state" CHECK("mcp_event_outbox"."state" IN ('pending','retry','delivering','delivered','failed','canceled'))
);
--> statement-breakpoint
CREATE INDEX `mcp_event_outbox_due` ON `mcp_event_outbox` (`state`,`next_attempt_at`,`lease_until`);--> statement-breakpoint
CREATE TABLE `mcp_event_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`arguments_json` text NOT NULL,
	`project_id` text NOT NULL,
	`callback_url` text NOT NULL,
	`signing_secret` text NOT NULL,
	`previous_secret` text,
	`previous_secret_until` text,
	`expires_at` text NOT NULL,
	`verified_until` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`start_sequence` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "mcp_event_subscriptions_active" CHECK("mcp_event_subscriptions"."active" IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_event_subscriptions_identity` ON `mcp_event_subscriptions` (`owner_id`,`callback_url`,`name`,`arguments_json`);--> statement-breakpoint
CREATE INDEX `mcp_event_subscriptions_match` ON `mcp_event_subscriptions` (`owner_id`,`name`,`project_id`,`active`,`expires_at`);--> statement-breakpoint
CREATE TABLE `mcp_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`arguments_json` text NOT NULL,
	`project_id` text NOT NULL,
	`data_json` text NOT NULL,
	`occurred_at` text NOT NULL,
	`event_digest` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_events_event_id` ON `mcp_events` (`event_id`);