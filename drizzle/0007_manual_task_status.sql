CREATE TABLE `task_manual_status_events` (
	`owner_id` text NOT NULL,
	`event_id` text NOT NULL,
	`task_id` text NOT NULL,
	`payload_digest` text NOT NULL,
	`version` integer NOT NULL,
	`state` text NOT NULL,
	`reason` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `event_id`),
	CONSTRAINT "task_manual_status_digest" CHECK(length("task_manual_status_events"."payload_digest")=64),
	CONSTRAINT "task_manual_status_version_positive" CHECK("task_manual_status_events"."version">=1),
	CONSTRAINT "task_manual_status_state" CHECK("task_manual_status_events"."state" IN ('queued','running','blocked','paused','completed','canceled')),
	CONSTRAINT "task_manual_status_reason" CHECK(length("task_manual_status_events"."reason")<=1200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_manual_status_version` ON `task_manual_status_events` (`owner_id`,`task_id`,`version`);--> statement-breakpoint
CREATE INDEX `task_manual_status_latest` ON `task_manual_status_events` (`owner_id`,`task_id`,`version`);
--> statement-breakpoint
CREATE TRIGGER task_manual_status_no_update BEFORE UPDATE ON task_manual_status_events BEGIN SELECT RAISE(ABORT,'manual_status_append_only'); END;
--> statement-breakpoint
CREATE TRIGGER task_manual_status_no_delete BEFORE DELETE ON task_manual_status_events BEGIN SELECT RAISE(ABORT,'manual_status_append_only'); END;
