CREATE TABLE `integration_case_chunks` (
	`case_id` text NOT NULL,
	`revision` integer NOT NULL,
	`chunk_index` integer NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`case_id`, `revision`, `chunk_index`),
	FOREIGN KEY (`case_id`) REFERENCES `integration_cases`(`case_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `integration_cases` (
	`case_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`commit_token` text NOT NULL,
	`next_job_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_cases_owner_id_unique` ON `integration_cases` (`owner_id`);--> statement-breakpoint
CREATE INDEX `integration_cases_next_job` ON `integration_cases` (`next_job_at`);
