import assert from 'node:assert/strict';
import test from 'node:test';
import { getAccountFlow, completeEvidenceSetup, claimIntakeEntry, needsFirstIntake } from '../lib/intake-entry.ts';
import { createEmptyCase } from '../lib/model.ts';
import { applyIntakeStep } from '../lib/intake.ts';
import { AT, CORE_ANSWERS, coreCase, flowFixture } from './helpers/account-flow-fixture.ts';

test('new accounts must save the first four answers even after returning or creating an empty case', async t => {
  const f = flowFixture(); t.after(() => f.sqlite.close());
  assert.equal(await getAccountFlow(f.db, 'new', AT), 'intake');
  assert.equal(await needsFirstIntake(f.db, 'new'), true);
  assert.equal(await claimIntakeEntry(f.db, 'new'), 'intake');
  let state = f.saveCase('new');
  for (const step of ['basics', 'visa', 'birth'] as const) {
    state = applyIntakeStep(state, step, CORE_ANSWERS); f.saveCase('new', state);
    assert.equal(await getAccountFlow(f.db, 'new'), 'intake', step);
  }
  state = applyIntakeStep(state, 'citizenships', CORE_ANSWERS); f.saveCase('new', state);
  assert.equal(await getAccountFlow(f.db, 'new', AT), 'evidence');
  assert.equal(f.sqlite.prepare('SELECT core_completed_at FROM account_intake_entries WHERE owner_id=?').get('new')?.core_completed_at, AT);
  assert.equal(state.professional.field, '');
  assert.equal(state.intake?.completedAt, undefined);
});

test('concurrent new visits share one enrollment and cannot bypass required answers', async t => {
  const f = flowFixture(); t.after(() => f.sqlite.close());
  const outcomes = await Promise.all(Array.from({length: 8}, () => getAccountFlow(f.db, 'same', AT)));
  assert.deepEqual(outcomes, Array(8).fill('intake'));
  assert.equal(f.sqlite.prepare('SELECT count(*) AS total FROM account_intake_entries').get()?.total, 1);
});

test('evidence may be skipped only after required answers and stays handled across resets and later edits', async t => {
  const f = flowFixture(); t.after(() => f.sqlite.close());
  await getAccountFlow(f.db, 'new', AT);
  await assert.rejects(() => completeEvidenceSetup(f.db, 'new'), /first four/);
  f.saveCase('new', coreCase());
  await completeEvidenceSetup(f.db, 'new', AT);
  assert.equal(await getAccountFlow(f.db, 'new'), 'workspace');
  await completeEvidenceSetup(f.db, 'new');
  f.saveCase('new', createEmptyCase());
  assert.equal(await getAccountFlow(f.db, 'new'), 'workspace');
  f.sqlite.prepare('DELETE FROM cases WHERE owner_id=?').run('new');
  assert.equal(await getAccountFlow(f.db, 'new'), 'workspace');
  assert.equal(await getAccountFlow(f.db, 'another'), 'intake');
});

test('invalid saved answers or completion flags cannot advance a newly enrolled account', async t => {
  const f = flowFixture(); t.after(() => f.sqlite.close());
  await getAccountFlow(f.db, 'new', AT);
  const state = coreCase();
  state.intake!.answers.birthCountry = '';
  state.intake!.completedAt = AT;
  f.saveCase('new', state);
  assert.equal(await getAccountFlow(f.db, 'new'), 'intake');
  const sample = coreCase(); sample.mode = 'sample'; f.saveCase('new', sample);
  assert.equal(await getAccountFlow(f.db, 'new'), 'intake');
  f.sqlite.prepare('UPDATE cases SET state_json=? WHERE owner_id=?').run('{invalid', 'new');
  assert.equal(await getAccountFlow(f.db, 'new'), 'intake');
});

test('old intake markers and existing cases remain grandfathered without changing their answers', async t => {
  const f = flowFixture(db => db.prepare('INSERT INTO account_intake_entries (owner_id,first_seen_at,first_shown_at) VALUES(?,?,?)').run('visited', AT, AT));
  t.after(() => f.sqlite.close());
  assert.equal(await getAccountFlow(f.db, 'visited'), 'workspace');
  const original = f.saveCase('existing');
  assert.equal(await getAccountFlow(f.db, 'existing'), 'workspace');
  assert.equal(f.sqlite.prepare('SELECT state_json FROM cases WHERE owner_id=?').get('existing')?.state_json, JSON.stringify(original));
  assert.equal(f.sqlite.prepare('SELECT flow_version FROM account_intake_entries WHERE owner_id=?').get('existing')?.flow_version, 1);
});

test('migration preserves access for existing identities even without a saved case or intake marker', async t => {
  const f = flowFixture(db => {
    db.prepare('INSERT INTO password_accounts(user_id) VALUES(?)').run('password-existing');
    db.prepare('INSERT INTO auth_sessions(user_id) VALUES(?)').run('oauth-existing');
    db.prepare('INSERT INTO analytics_users(user_id) VALUES(?)').run('chatgpt-existing');
  });
  t.after(() => f.sqlite.close());
  for (const owner of ['password-existing', 'oauth-existing', 'chatgpt-existing']) assert.equal(await getAccountFlow(f.db, owner), 'workspace');
  assert.equal(await getAccountFlow(f.db, 'new'), 'intake');
});

test('storage failures and invalid accounts fail closed without inventing progress', async () => {
  const failed = { prepare() { throw new Error('Storage unavailable'); } } as unknown as D1Database;
  await assert.rejects(() => getAccountFlow(failed, 'new'), /Storage unavailable/);
  await assert.rejects(() => getAccountFlow(failed, ''), /signed-in account/);
});
