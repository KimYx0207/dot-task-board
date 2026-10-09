CREATE TABLE `board_observation_outbox` (
	`owner_id` text NOT NULL,
	`event_id` text NOT NULL,
	`observation_event_id` text NOT NULL,
	`observation_digest` text NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`status` text NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text NOT NULL,
	`lease_token` text,
	`lease_until` text,
	`delivered_at` text,
	PRIMARY KEY(`owner_id`, `event_id`),
	FOREIGN KEY (`owner_id`,`observation_event_id`) REFERENCES `board_observation_events`(`owner_id`,`event_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "board_observation_outbox_digest" CHECK(length("board_observation_outbox"."observation_digest")=64),
	CONSTRAINT "board_observation_outbox_status" CHECK("board_observation_outbox"."status" IN ('unknown','partial','blocked','paused','completed','canceled')),
	CONSTRAINT "board_observation_outbox_state" CHECK("board_observation_outbox"."state" IN ('pending','delivering','delivered')),
	CONSTRAINT "board_observation_outbox_attempts" CHECK("board_observation_outbox"."attempts">=0),
	CONSTRAINT "board_observation_outbox_lease" CHECK(("board_observation_outbox"."state"='delivering' AND "board_observation_outbox"."lease_token" IS NOT NULL AND "board_observation_outbox"."lease_until" IS NOT NULL) OR ("board_observation_outbox"."state"<>'delivering' AND "board_observation_outbox"."lease_token" IS NULL AND "board_observation_outbox"."lease_until" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `board_observation_outbox_observation` ON `board_observation_outbox` (`owner_id`,`observation_event_id`);--> statement-breakpoint
CREATE INDEX `board_observation_outbox_due` ON `board_observation_outbox` (`owner_id`,`state`,`next_attempt_at`,`lease_until`);
--> statement-breakpoint
-- Keep the event immutable while allowing owner-scoped delivery bookkeeping.
CREATE TRIGGER IF NOT EXISTS board_observation_outbox_immutable
BEFORE UPDATE OF owner_id,event_id,observation_event_id,observation_digest,project_id,task_id,status,occurred_at,created_at
ON board_observation_outbox BEGIN
  SELECT RAISE(ABORT,'board_observation_outbox_event_immutable');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS board_observation_outbox_no_delete
BEFORE DELETE ON board_observation_outbox BEGIN
  SELECT RAISE(ABORT,'board_observation_outbox_append_only');
END;
