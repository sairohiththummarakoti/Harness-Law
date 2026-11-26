import { requiredIntakeError } from './intake.ts';
import { intakeSchema } from './validation.ts';

export type AccountFlow = 'intake' | 'evidence' | 'workspace';
export type IntakeEntryDestination = 'intake' | 'workspace';

type FlowRow = { flow_version: number; core_completed_at: string | null; evidence_completed_at: string | null; state_json: string | null };

/** Check saved answers, never a client-supplied completion marker. */
function savedCoreIsComplete(serialized: string | null): boolean {
  if (!serialized) return false;
  try {
    const state = JSON.parse(serialized);
    if (state.mode !== 'personal') return false;
    const parsed = intakeSchema.safeParse(state.intake);
    return parsed.success && !requiredIntakeError(parsed.data.answers)
      && ['background', 'criteria', 'review'].includes(parsed.data.step);
  } catch { return false; }
}

/**
 * New accounts resume the required introduction, then the evidence invitation.
 * Migration-era accounts retain their workspace access. This claim must happen
 * before initialCase creates a case, so an empty case cannot bypass the flow.
 */
export async function getAccountFlow(db: D1Database, ownerId: string, now = new Date().toISOString()): Promise<AccountFlow> {
  if (!ownerId.trim()) throw new Error('A signed-in account is required.');
  await db.prepare(`INSERT OR IGNORE INTO account_intake_entries
    (owner_id, first_seen_at, first_shown_at, flow_version)
    VALUES (?, ?, CASE WHEN EXISTS (SELECT 1 FROM cases WHERE owner_id = ?) THEN NULL ELSE ? END,
      CASE WHEN EXISTS (SELECT 1 FROM cases WHERE owner_id = ?) THEN 1 ELSE 2 END)
    RETURNING owner_id`).bind(ownerId, now, ownerId, now, ownerId).first();
  const row = await db.prepare(`SELECT entry.flow_version, entry.core_completed_at, entry.evidence_completed_at, cases.state_json
    FROM account_intake_entries AS entry LEFT JOIN cases ON cases.owner_id = entry.owner_id
    WHERE entry.owner_id = ?`).bind(ownerId).first<FlowRow>();
  if (!row) throw new Error('Your setup progress could not be loaded.');
  if (row.flow_version < 2 || row.evidence_completed_at) return 'workspace';
  if (row.core_completed_at) return 'evidence';
  if (!savedCoreIsComplete(row.state_json)) return 'intake';
  // Derive completion from the accepted case. A retry after a case save or an
  // interrupted marker update remains safe and never discards saved answers.
  await db.prepare(`UPDATE account_intake_entries SET core_completed_at = COALESCE(core_completed_at, ?)
    WHERE owner_id = ? RETURNING owner_id`).bind(now, ownerId).first();
  return 'evidence';
}

/** Both Continue and Add later finish only the optional evidence invitation. */
export async function completeEvidenceSetup(db: D1Database, ownerId: string, now = new Date().toISOString()): Promise<void> {
  const flow = await getAccountFlow(db, ownerId, now);
  if (flow === 'intake') throw new Error('Complete the first four intake steps before continuing.');
  if (flow === 'workspace') return;
  const updated = await db.prepare(`UPDATE account_intake_entries
    SET evidence_completed_at = COALESCE(evidence_completed_at, ?)
    WHERE owner_id = ? AND core_completed_at IS NOT NULL RETURNING owner_id`).bind(now, ownerId).first();
  if (!updated) throw new Error('Your evidence setup progress could not be saved.');
}

/** Compatibility helpers for callers using the older intake-only gate. */
export async function claimIntakeEntry(db: D1Database, ownerId: string, now = new Date().toISOString()): Promise<IntakeEntryDestination> {
  return await getAccountFlow(db, ownerId, now) === 'intake' ? 'intake' : 'workspace';
}
export async function needsFirstIntake(db: D1Database, ownerId: string): Promise<boolean> {
  return await getAccountFlow(db, ownerId) === 'intake';
}
