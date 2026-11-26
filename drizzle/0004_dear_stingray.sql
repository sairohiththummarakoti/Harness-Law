CREATE TABLE `evidence_deletions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`case_id` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`expected_revision` integer NOT NULL,
	`object_keys_json` text NOT NULL,
	`deleted_files` integer NOT NULL,
	`deleted_folders` integer NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `evidence_deletions_pending` ON `evidence_deletions` (`owner_id`,`completed_at`);--> statement-breakpoint
ALTER TABLE `evidence_objects` ADD `deleted_at` text;