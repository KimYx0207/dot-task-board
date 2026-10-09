ALTER TABLE dispatch_jobs ADD COLUMN execution_evidence text;
--> statement-breakpoint
ALTER TABLE dispatch_jobs ADD COLUMN task_number integer;
--> statement-breakpoint
-- Historical records, including canceled jobs, retain their creation-order slot.
UPDATE dispatch_jobs SET task_number=(SELECT numbered.task_number FROM (SELECT id,ROW_NUMBER() OVER(PARTITION BY owner_id,project_id ORDER BY created_at,id) AS task_number FROM dispatch_jobs) AS numbered WHERE numbered.id=dispatch_jobs.id);
--> statement-breakpoint
CREATE UNIQUE INDEX dispatch_project_task_number ON dispatch_jobs(owner_id,project_id,task_number);
