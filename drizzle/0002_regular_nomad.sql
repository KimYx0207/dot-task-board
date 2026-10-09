ALTER TABLE `dispatch_jobs` ADD `execution_evidence` text;--> statement-breakpoint
ALTER TABLE `dispatch_jobs` ADD `task_number` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `dispatch_project_task_number` ON `dispatch_jobs` (`owner_id`,`project_id`,`task_number`);