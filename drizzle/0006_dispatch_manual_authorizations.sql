CREATE TABLE `dispatch_manual_authorizations` (
	`owner_id` text NOT NULL,
	`request_id` text NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`reason` text NOT NULL,
	PRIMARY KEY(`owner_id`, `request_id`),
	FOREIGN KEY (`request_id`) REFERENCES `intake_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`task_id`) REFERENCES `dispatch_task_bindings`(`owner_id`,`task_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dispatch_manual_authorization_reason" CHECK(length("dispatch_manual_authorizations"."reason")>0 AND length("dispatch_manual_authorizations"."reason")<=1200)
);
--> statement-breakpoint
CREATE INDEX `dispatch_manual_authorizations_expiry` ON `dispatch_manual_authorizations` (`owner_id`,`expires_at`);
--> statement-breakpoint
CREATE TRIGGER dispatch_manual_authorizations_immutable BEFORE UPDATE ON dispatch_manual_authorizations BEGIN SELECT RAISE(ABORT,'manual_authorization_immutable'); END;
