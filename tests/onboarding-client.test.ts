import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Node's built-in TS runner requires explicit extensions.
import { createEmptyCase } from '../lib/model.ts';
// @ts-ignore Node's built-in TS runner requires explicit extensions.
import { hasUnsavedSetupAnswers, mergeAcceptedSetupAnswers, mergeCurrentStepAnswers, setupAnswersFromCase, setupConflictRows } from '../lib/onboarding-client.ts';

test('accepting latest professional details after Back preserves unsaved names and goal', () => {
  const local = { field: 'Local field', role: 'Local role', goal: 'narrative' as const, fullName: 'Unsaved full name', preferredName: 'Unsaved nickname' };
  const remote = { field: 'Remote field', role: 'Remote role', goal: 'review' as const, fullName: 'Saved name', preferredName: 'Saved nickname' };
  assert.deepEqual(mergeCurrentStepAnswers(local, remote, 1), { ...local, field: remote.field, role: remote.role });
  assert.deepEqual(mergeCurrentStepAnswers(local, remote, 2), { ...local, goal: remote.goal });
  assert.deepEqual(mergeCurrentStepAnswers(local, remote, 3), { ...local, fullName: remote.fullName, preferredName: remote.preferredName });
  assert.equal(local.fullName, 'Unsaved full name');
});

test('completion comparison includes remote work and goal, and accepted retry refreshes the summary', () => {
  const state = createEmptyCase();
  state.professional.field = 'Remote science'; state.professional.role = 'Remote researcher';
  state.onboarding = { version: 1, step: 3, goal: 'review' };
  state.profile.fullName = 'Saved full name'; state.profile.preferredName = 'Saved nickname';
  assert.deepEqual(setupConflictRows(state, 3), [
    { label: 'Field', value: 'Remote science' }, { label: 'Role', value: 'Remote researcher' },
    { label: 'Focus', value: 'Review my draft' }, { label: 'Full name', value: 'Saved full name' },
    { label: 'Preferred name', value: 'Saved nickname' },
  ]);
  const draft = { field: 'Old field', role: 'Old role', goal: 'evidence' as const, fullName: 'Local name', preferredName: 'Local nickname' };
  const saved = setupAnswersFromCase(state);
  assert.deepEqual(mergeAcceptedSetupAnswers(draft, saved, 3, true), saved);
});

test('navigation guard ignores untouched prefills, protects edits and in-flight saves, and clears accepted changes', () => {
  const state = createEmptyCase();
  const baseline = setupAnswersFromCase(state, 'Account name');
  assert.equal(hasUnsavedSetupAnswers({ ...baseline }, baseline), false);
  assert.equal(hasUnsavedSetupAnswers({ ...baseline, fullName: 'Edited name' }, baseline), true);
  assert.equal(hasUnsavedSetupAnswers(baseline, baseline, true), true);
  state.professional.field = 'Science'; state.professional.role = 'Researcher';
  const persisted = setupAnswersFromCase(state, 'Account name');
  assert.equal(hasUnsavedSetupAnswers(persisted, persisted), false);
  const draft = { ...persisted, preferredName: 'Not yet accepted' };
  const afterWorkSave = mergeAcceptedSetupAnswers(draft, persisted, 1);
  assert.equal(hasUnsavedSetupAnswers(afterWorkSave, persisted), true);
  assert.equal(hasUnsavedSetupAnswers(draft, persisted, false, true), false);
});
