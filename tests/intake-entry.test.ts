import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import test from 'node:test';
import { claimIntakeEntry, needsFirstIntake } from '../lib/intake-entry.ts';
import { createEmptyCase } from '../lib/model.ts';

const AT = '2026-11-26T12:00:00.000Z';
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of ['0000_same_leopardon.sql', '0005_fresh_wild_pack.sql']) sqlite.exec(readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), 'utf8'));
  const statement = (sql: string, args: SQLInputValue[] = []) => ({
    bind(...values: SQLInputValue[]) { return statement(sql, values); },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
  });
  const db = { prepare: statement } as unknown as D1Database;
  const addCase = (owner: string, patch: object = {}) => {
    const state = { ...createEmptyCase(), ...patch };
    sqlite.prepare('INSERT INTO cases (owner_id, case_id, revision, state_json, updated_at) VALUES (?, ?, ?, ?, ?)').run(owner, state.id, state.revision, JSON.stringify(state), AT);
    return state;
  };
  return { sqlite, db, addCase };
}

test('a genuinely new account sees intake only once, even before saving a first answer', async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  assert.equal(await needsFirstIntake(f.db, 'new-account'), true);
  assert.equal(await claimIntakeEntry(f.db, 'new-account', AT), 'intake');
  assert.equal(await needsFirstIntake(f.db, 'new-account'), false);
  assert.equal(await claimIntakeEntry(f.db, 'new-account', '2026-11-27T12:00:00.000Z'), 'workspace');
  assert.deepEqual({ ...f.sqlite.prepare('SELECT * FROM account_intake_entries WHERE owner_id = ?').get('new-account') }, { owner_id: 'new-account', first_seen_at: AT, first_shown_at: AT });
  assert.equal(f.sqlite.prepare('SELECT count(*) AS total FROM cases').get()?.total, 0);
});

test('concurrent first visits claim exactly one intake presentation', async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const outcomes = await Promise.all(Array.from({ length: 8 }, () => claimIntakeEntry(f.db, 'same-account', AT)));
  assert.equal(outcomes.filter(result => result === 'intake').length, 1);
  assert.equal(outcomes.filter(result => result === 'workspace').length, 7);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS total FROM account_intake_entries').get()?.total, 1);
});

test('existing empty, incomplete, completed and legacy cases bypass automatic intake without changing their answers', async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const cases = [
    {},
    { intake: { version: 1, step: 'visa', answers: { fullName: 'Existing applicant' } } },
    { intake: { version: 1, completedAt: AT, step: 'review', answers: { fullName: 'Completed applicant' } } },
    { onboarding: { version: 1, step: 4, completedAt: AT, goal: 'evidence' } },
  ];
  for (const [index, patch] of cases.entries()) {
    const owner = `existing-${index}`, state = f.addCase(owner, patch);
    assert.equal(await needsFirstIntake(f.db, owner), false);
    assert.equal(await claimIntakeEntry(f.db, owner, AT), 'workspace');
    assert.equal(f.sqlite.prepare('SELECT first_shown_at FROM account_intake_entries WHERE owner_id = ?').get(owner)?.first_shown_at, null);
    assert.equal(f.sqlite.prepare('SELECT state_json FROM cases WHERE owner_id = ?').get(owner)?.state_json, JSON.stringify(state));
  }
});

test('skipping, deleting or resetting case data never clears the account entry marker', async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  await claimIntakeEntry(f.db, 'returning', AT);
  f.addCase('returning');
  f.sqlite.prepare('DELETE FROM cases WHERE owner_id = ?').run('returning');
  assert.equal(await needsFirstIntake(f.db, 'returning'), false);
  f.addCase('returning', { id: 'replacement-case' });
  assert.equal(await claimIntakeEntry(f.db, 'returning', AT), 'workspace');
  assert.equal(await needsFirstIntake(f.db, 'another-account'), true);
});

test('storage failures propagate instead of being mistaken for a new or visited account', async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const failed = { prepare() { throw new Error('Storage unavailable'); } } as unknown as D1Database;
  await assert.rejects(() => needsFirstIntake(failed, 'new-account'), /Storage unavailable/);
  await assert.rejects(() => claimIntakeEntry(failed, 'new-account'), /Storage unavailable/);
  assert.equal(await needsFirstIntake(f.db, 'new-account'), true);
  assert.equal(await claimIntakeEntry(f.db, 'new-account', AT), 'intake');
  await assert.rejects(() => claimIntakeEntry(f.db, ''), /signed-in account/);
});
