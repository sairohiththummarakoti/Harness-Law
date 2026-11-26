CREATE TABLE `admin_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_email` text NOT NULL,
	`target_id` text NOT NULL,
	`target_email` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_audit_created` ON `admin_audit` (`created_at`);--> statement-breakpoint
CREATE TABLE `admin_members` (
	`user_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `admin_owner` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `analytics_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`kind` text NOT NULL,
	`page` text NOT NULL,
	`country` text,
	`region` text,
	`city` text,
	`device` text NOT NULL,
	`browser` text NOT NULL,
	`referrer` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analytics_events_created` ON `analytics_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `analytics_events_user_created` ON `analytics_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `analytics_events_kind_created` ON `analytics_events` (`kind`,`created_at`);--> statement-breakpoint
CREATE TABLE `analytics_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `analytics_users` (
	`user_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL,
	`last_country` text,
	`last_region` text,
	`last_city` text
);
--> statement-breakpoint
CREATE INDEX `analytics_users_last_seen` ON `analytics_users` (`last_seen`);--> statement-breakpoint
CREATE INDEX `analytics_users_first_seen` ON `analytics_users` (`first_seen`);