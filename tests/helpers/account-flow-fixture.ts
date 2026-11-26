import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { createEmptyCase, type CaseState } from '../../lib/model.ts';
import { applyIntakeStep, type IntakeAnswers } from '../../lib/intake.ts';

export const AT = '2026-11-26T12:00:00.000Z';
export const CORE_ANSWERS: IntakeAnswers = { fullName: 'Alex Applicant', phone: '', helpFor: 'myself', visaType: 'eb1a', birthCountry: 'IN', birthCountryOther: '', citizenships: ['CA'], field: '', role: '', criteria: [], criteriaUnsure: false, majorAward: '', notes: '' };
export function coreCase() {
  let state = createEmptyCase();
  for (const step of ['basics', 'visa', 'birth', 'citizenships'] as const) state = applyIntakeStep(state, step, CORE_ANSWERS);
  return state;
}
export function flowFixture(beforeMigration?: (db: DatabaseSync) => void) {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of ['0000_same_leopardon.sql', '0005_fresh_wild_pack.sql']) sqlite.exec(readFileSync(new URL(`../../drizzle/${migration}`, import.meta.url), 'utf8'));
  // Only identity columns are relevant to migration grandfathering in this fixture.
  sqlite.exec('CREATE TABLE password_accounts (user_id TEXT); CREATE TABLE auth_sessions (user_id TEXT); CREATE TABLE analytics_users (user_id TEXT);');
  beforeMigration?.(sqlite);
  sqlite.exec(readFileSync(new URL('../../drizzle/0009_tough_nico_minoru.sql', import.meta.url), 'utf8'));
  const statement = (sql: string, args: SQLInputValue[] = []) => ({
    bind(...values: SQLInputValue[]) { return statement(sql, values); },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
  });
  const db = { prepare: statement } as unknown as D1Database;
  const saveCase = (owner: string, state: CaseState = createEmptyCase()) => {
    sqlite.prepare('INSERT INTO cases (owner_id, case_id, revision, state_json, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET state_json=excluded.state_json, case_id=excluded.case_id, revision=excluded.revision, updated_at=excluded.updated_at').run(owner, state.id, state.revision, JSON.stringify(state), AT);
    return state;
  };
  return { sqlite, db, saveCase };
}
