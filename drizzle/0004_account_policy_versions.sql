ALTER TABLE `password_accounts` ADD COLUMN `terms_version` text NOT NULL DEFAULT 'unspecified';
--> statement-breakpoint
ALTER TABLE `password_accounts` ADD COLUMN `privacy_version` text NOT NULL DEFAULT 'unspecified';
