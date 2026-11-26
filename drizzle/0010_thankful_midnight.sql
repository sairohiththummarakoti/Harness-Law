CREATE TABLE `cloud_drive_authorizations` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`provider` text NOT NULL,
	`browser_hash` text NOT NULL,
	`verifier_ciphertext` text NOT NULL,
	`return_to` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cloud_drive_authorization_expiry` ON `cloud_drive_authorizations` (`expires_at`);--> statement-breakpoint
CREATE TABLE `cloud_drive_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`provider` text NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`scope` text DEFAULT 'whole_drive' NOT NULL,
	`root_id` text NOT NULL,
	`root_name` text NOT NULL,
	`drive_id` text,
	`account_id` text NOT NULL,
	`account_label` text NOT NULL,
	`token_ciphertext` text NOT NULL,
	`token_expires_at` integer NOT NULL,
	`status` text NOT NULL,
	`case_id` text,
	`evidence_folder_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cloud_drive_owner_status` ON `cloud_drive_connections` (`owner_id`,`status`);
--> statement-breakpoint
-- Retire legacy plaintext credentials; imported evidence and connection labels remain.
CREATE TABLE IF NOT EXISTS connected_drives (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider TEXT NOT NULL,
 display_name TEXT, scope TEXT NOT NULL, folder_name TEXT,
 status TEXT NOT NULL DEFAULT 'reconnect_required', access_token TEXT,
 refresh_token TEXT, token_expires_at INTEGER, created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
--> statement-breakpoint
UPDATE connected_drives SET access_token = NULL, refresh_token = NULL,
 token_expires_at = NULL, status = 'reconnect_required';
