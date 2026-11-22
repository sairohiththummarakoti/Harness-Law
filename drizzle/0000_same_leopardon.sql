CREATE TABLE `cases` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`state_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `evidence_objects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`case_id` text NOT NULL,
	`object_key` text NOT NULL,
	`metadata_json` text NOT NULL,
	`created_at` text NOT NULL
);
