ALTER TABLE `account_intake_entries` ADD `flow_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `account_intake_entries` ADD `core_completed_at` text;--> statement-breakpoint
ALTER TABLE `account_intake_entries` ADD `evidence_completed_at` text;--> statement-breakpoint
INSERT OR IGNORE INTO account_intake_entries (owner_id, first_seen_at, first_shown_at, flow_version)
SELECT user_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, 1 FROM (
  SELECT owner_id AS user_id FROM cases
  UNION SELECT user_id FROM password_accounts
  UNION SELECT user_id FROM auth_sessions
  UNION SELECT user_id FROM analytics_users
) WHERE trim(user_id) <> '';
