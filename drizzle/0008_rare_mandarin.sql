CREATE TABLE `uscis_source_snapshots` (
	`source_id` text PRIMARY KEY NOT NULL,
	`snapshot_json` text NOT NULL,
	`checked_at` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL
);
