CREATE TABLE `password_accounts` (
  `user_id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `email` text NOT NULL UNIQUE,
  `pending_email` text,
  `password_hash` text NOT NULL,
  `verified_at` integer,
  `terms_accepted_at` integer NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_accounts_pending_email_unique` ON `password_accounts` (`pending_email`) WHERE `pending_email` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `email_challenges` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `purpose` text NOT NULL,
  `expires_at` integer NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_challenges_expiry` ON `email_challenges` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `password_sessions` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `password_sessions_expiry` ON `password_sessions` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `auth_rate_limits` (
  `bucket` text PRIMARY KEY NOT NULL,
  `window_started_at` integer NOT NULL,
  `attempts` integer NOT NULL
);
