export type IntakeEntryDestination = 'intake' | 'workspace';

/**
 * The account marker is separate from editable case data. Even replacing a case,
 * skipping intake, or signing in on a different device cannot restart the prompt.
 * RETURNING identifies the single winning first visit without a read/write race.
 */
export async function claimIntakeEntry(db: D1Database, ownerId: string, now = new Date().toISOString()): Promise<IntakeEntryDestination> {
  if (!ownerId.trim()) throw new Error('A signed-in account is required.');
  const claimed = await db.prepare(`INSERT OR IGNORE INTO account_intake_entries (owner_id, first_seen_at, first_shown_at)
    VALUES (?, ?, CASE WHEN EXISTS (SELECT 1 FROM cases WHERE owner_id = ?) THEN NULL ELSE ? END)
    RETURNING first_shown_at`).bind(ownerId, now, ownerId, now).first<{ first_shown_at: string | null }>();
  return claimed?.first_shown_at ? 'intake' : 'workspace';
}

/** Read-only gate for direct workspace entry; the onboarding route owns the claim. */
export async function needsFirstIntake(db: D1Database, ownerId: string): Promise<boolean> {
  if (!ownerId.trim()) throw new Error('A signed-in account is required.');
  const result = await db.prepare(`SELECT
    EXISTS (SELECT 1 FROM account_intake_entries WHERE owner_id = ?)
    OR EXISTS (SELECT 1 FROM cases WHERE owner_id = ?) AS known_account`).bind(ownerId, ownerId).first<{ known_account: number }>();
  if (!result) throw new Error('Your intake preference could not be loaded.');
  return !result.known_account;
}
