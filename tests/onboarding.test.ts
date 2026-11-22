import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Node's built-in TS runner requires explicit extensions.
import { createEmptyCase, createSampleCase } from '../lib/model.ts';
// @ts-ignore Node's built-in TS runner requires explicit extensions.
import { applyOnboardingStep, getOnboardingNextStep, getOnboardingRoute, hasExistingPreparation, ONBOARDING_GOALS } from '../lib/onboarding.ts';
// @ts-ignore Node's built-in TS runner requires explicit extensions.
import { caseSchema } from '../lib/validation.ts';

test('cases without onboarding metadata remain schema-compatible and empty revisions can begin setup', () => {
  const state = createEmptyCase();
  state.revision = 20;
  state.lastPage = 'evidence';
  assert.equal(caseSchema.safeParse(state).success, true);
  assert.equal(caseSchema.safeParse(createSampleCase()).success, true);
  assert.equal(getOnboardingRoute(state), 'setup');
  assert.equal(hasExistingPreparation(state), false);
  state.profile.email = 'applicant@example.com';
  state.onboarding = { version: 1, step: 1 };
  assert.equal(getOnboardingRoute(state), 'setup');
  assert.equal(applyOnboardingStep(state, 1, { field: 'Science', role: 'Researcher' }).profile.email, 'applicant@example.com');
});

test('legacy preparation routes to workspace and cannot be silently replaced by setup', () => {
  const fixtures = [
    (state: ReturnType<typeof createEmptyCase>) => { state.profile.email = 'applicant@example.com'; },
    (state: ReturnType<typeof createEmptyCase>) => { state.professional.achievements = 'Existing account of my work'; },
    (state: ReturnType<typeof createEmptyCase>) => { state.criteria = ['C08']; },
    (state: ReturnType<typeof createEmptyCase>) => { state.forms.country = 'Canada'; },
    (state: ReturnType<typeof createEmptyCase>) => { state.runs.C08.questions = ['Existing review question']; },
    (state: ReturnType<typeof createEmptyCase>) => { state.name = 'My existing preparation'; },
  ];
  for (const prepare of fixtures) {
    const state = createEmptyCase(); prepare(state);
    const before = structuredClone(state);
    assert.equal(getOnboardingRoute(state), 'workspace');
    assert.throws(() => applyOnboardingStep(state, 1, { field: 'Science', role: 'Researcher' }), /existing preparation/);
    assert.deepEqual(state, before);
  }
  assert.equal(getOnboardingRoute(createSampleCase()), 'workspace');
});

test('accepted setup steps resume after serialization and back changes keep later accepted answers', () => {
  let state = applyOnboardingStep(createEmptyCase(), 1, { field: '  Science  ', role: 'Researcher' });
  assert.equal(state.professional.field, 'Science');
  assert.equal(state.onboarding?.step, 2);
  state = JSON.parse(JSON.stringify(state));
  state = applyOnboardingStep(state, 2, { goal: 'narrative' });
  state = applyOnboardingStep(state, 1, { field: 'Medical research', role: 'Principal researcher' });
  assert.equal(state.onboarding?.step, 3);
  assert.equal(state.onboarding?.goal, 'narrative');
  assert.equal(getOnboardingRoute(state), 'setup');
  assert.equal(caseSchema.safeParse(state).success, true);
});

test('setup applies only entered fields and never confirms facts, consents, reviews, or official forms', () => {
  const original = createEmptyCase();
  let state = applyOnboardingStep(original, 1, { field: 'Engineering', role: 'Engineer' });
  state = applyOnboardingStep(state, 2, { goal: 'evidence' });
  state = applyOnboardingStep(state, 3, { fullName: '  Alex Chen ', preferredName: ' Alex ' });
  assert.equal(state.profile.fullName, 'Alex Chen');
  assert.equal(state.profile.preferredName, 'Alex');
  assert.equal(state.profile.confirmed, false);
  assert.equal(state.consent, false);
  assert.deepEqual(state.forms, original.forms);
  assert.deepEqual(state.runs, original.runs);
  assert.deepEqual(state.documents, []);
  assert.deepEqual(state.facts, []);
  assert.equal(state.composition, null);
  assert.equal(state.onboarding?.step, 4);
  assert.ok(state.onboarding?.completedAt);
  assert.equal(getOnboardingRoute(state), 'workspace');
  assert.equal(caseSchema.safeParse(state).success, true);
  assert.equal(original.professional.field, '');
  assert.equal(original.onboarding, undefined);
  assert.throws(() => applyOnboardingStep(state, 1, { field: 'Other', role: 'Other' }), /existing preparation/);
});

test('changing a preparation goal preserves every existing source, draft, review and profile', () => {
  const state = createSampleCase();
  state.mode = 'personal';
  state.onboarding = { version: 1, step: 3, goal: 'evidence' };
  const before = structuredClone(state);
  const next = applyOnboardingStep(state, 2, { goal: 'review' });
  for (const key of ['id', 'revision', 'profile', 'professional', 'documents', 'facts', 'runs', 'composition', 'forms', 'activities', 'criteria'] as const) {
    assert.deepEqual(next[key], before[key]);
  }
  assert.deepEqual(state, before);
});

test('revisiting accepted professional details preserves reviews unless those details actually change', () => {
  const state = createSampleCase();
  state.mode = 'personal';
  state.onboarding = { version: 1, step: 3, goal: 'narrative' };
  const unchanged = applyOnboardingStep(state, 1, { field: state.professional.field, role: state.professional.role });
  assert.deepEqual(unchanged.runs, state.runs);
  const changed = applyOnboardingStep(state, 1, { field: 'Updated field', role: state.professional.role });
  assert.deepEqual(changed.documents, state.documents);
  assert.equal(changed.runs.C08.result!.stale, true);
  assert.equal(changed.runs.C08.result!.claims[0].reviewStatus, 'unreviewed');
  assert.equal(changed.runs.C08.result!.claims[0].text, state.runs.C08.result!.claims[0].text);
});

test('each preparation goal maps to a useful workspace destination and visible next action', () => {
  const expected = { evidence: 'evidence', narrative: 'criteria', review: 'review' };
  for (const goal of ONBOARDING_GOALS) {
    let state = applyOnboardingStep(createEmptyCase(), 1, { field: 'Arts', role: 'Artist' });
    state = applyOnboardingStep(state, 2, { goal: goal.id });
    state = applyOnboardingStep(state, 3, { fullName: 'Alex Example' });
    assert.equal(state.lastPage, expected[goal.id]);
    assert.equal(getOnboardingNextStep(goal.id).page, expected[goal.id]);
    assert.ok(getOnboardingNextStep(goal.id).action.length > 0);
  }
});

test('malformed setup metadata is rejected by strict persistence validation', () => {
  const state = createEmptyCase();
  const bad = [
    { version: 2, step: 1 }, { version: 1, step: 0 }, { version: 1, step: 1, goal: 'approval' },
    { version: 1, step: 3 }, { version: 1, step: 4, goal: 'review' },
    { version: 1, step: 2, goal: 'review', completedAt: new Date().toISOString() },
    { version: 1, step: 4, goal: 'review', completedAt: 'yesterday' },
    { version: 1, step: 1, confirmed: true },
  ];
  for (const onboarding of bad) assert.equal(caseSchema.safeParse({ ...state, onboarding }).success, false);
  assert.equal(caseSchema.safeParse({ ...state, onboarding: { version: 1, step: 1 } }).success, true);
});

test('setup cannot skip required steps or accept empty or overlong professional details', () => {
  const state = createEmptyCase();
  assert.throws(() => applyOnboardingStep(state, 2, { goal: 'review' }), /earlier/);
  assert.throws(() => applyOnboardingStep(state, 1, { field: ' ', role: 'Engineer' }), /professional field/);
  assert.throws(() => applyOnboardingStep(state, 1, { field: 'Science', role: 'x'.repeat(501) }), /500/);
  const pending = applyOnboardingStep(applyOnboardingStep(state, 1, { field: 'Science', role: 'Researcher' }), 2, { goal: 'review' });
  assert.throws(() => applyOnboardingStep(pending, 3, { fullName: ' ' }), /full name/);
});
