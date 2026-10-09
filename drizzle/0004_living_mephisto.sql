CREATE TABLE `board_observation_events` (
	`owner_id` text NOT NULL,
	`task_id` text NOT NULL,
	`event_id` text NOT NULL,
	`payload_digest` text NOT NULL,
	`version` integer NOT NULL,
	`source_observed_at` text NOT NULL,
	`source_observed_ms` integer NOT NULL,
	`observation_json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `event_id`),
	CONSTRAINT "board_observation_digest" CHECK(length("board_observation_events"."payload_digest")=64),
	CONSTRAINT "board_observation_version" CHECK("board_observation_events"."version">=1),
	CONSTRAINT "board_observation_json" CHECK(json_valid("board_observation_events"."observation_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `board_observation_task_version` ON `board_observation_events` (`owner_id`,`task_id`,`version`);--> statement-breakpoint
CREATE INDEX `board_observation_task_latest` ON `board_observation_events` (`owner_id`,`task_id`,`version`);
--> statement-breakpoint
CREATE TRIGGER board_observation_no_update BEFORE UPDATE ON board_observation_events BEGIN SELECT RAISE(ABORT,'board_observation_append_only'); END;
--> statement-breakpoint
CREATE TRIGGER board_observation_no_delete BEFORE DELETE ON board_observation_events BEGIN SELECT RAISE(ABORT,'board_observation_append_only'); END;
