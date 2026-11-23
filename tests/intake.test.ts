import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyCase, createSampleCase } from '../lib/model.ts';
import { applyIntakeStep, getIntakeSteps, intakeAnswersFromCase, mergeIntakeStepAnswers, type IntakeAnswers } from '../lib/intake.ts';
import { COUNTRIES, countryName } from '../lib/countries.ts';
import { caseSchema } from '../lib/validation.ts';
import { getOnboardingRoute } from '../lib/onboarding.ts';

function answers(visaType: IntakeAnswers['visaType'] = 'eb1a'): IntakeAnswers {
  return { fullName: 'Alex Applicant', phone: '+1 555 010 1234', helpFor: 'myself', visaType,
    birthCountry: 'IN', birthCountryOther: '', citizenships: ['CA', 'GB'], field: 'Science', role: 'Researcher',
    criteria: visaType === 'eb1a' ? ['C04','C06'] : [], criteriaUnsure: false, majorAward: visaType === 'eb1a' ? 'no' : '', notes: 'My background.' };
}

function throughReview(input = answers(), original = createEmptyCase()) {
  let state = original;
  for (const step of getIntakeSteps(input.visaType)) {
    state = applyIntakeStep(state, step, input);
    assert.equal(caseSchema.safeParse(state).success, true, `schema accepts ${step}`);
    state = JSON.parse(JSON.stringify(state));
  }
  return state;
}

test('intake saves and resumes each question, retaining multiple citizenships', () => {
  const original = createEmptyCase();
  const completed = throughReview(answers(), original);
  assert.deepEqual(completed.intake?.answers, answers());
  assert.ok(completed.intake?.completedAt);
  assert.equal(completed.intake?.step, 'review');
  assert.equal(completed.profile.fullName, 'Alex Applicant');
  assert.equal(completed.professional.field, 'Science');
  assert.equal(completed.profile.country, '');
  assert.equal(completed.profile.confirmed, false);
  assert.equal(completed.consent, false);
  assert.deepEqual(completed.criteria, ['C04','C06']);
  assert.deepEqual(completed.runs, original.runs);
  assert.deepEqual(completed.forms, original.forms);
  assert.equal(original.intake, undefined);
});

test('every non-EB-1A visa reaches a saved summary without asking EB-1A criteria', () => {
  for (const visaType of ['o1','eb2niw','e1','e2','l1','eb1b','eb1c','tn','h1b','k1','marriage','family','perm','consular','other','unsure'] as const) {
    const state = throughReview(answers(visaType));
    assert.equal(getIntakeSteps(visaType).includes('criteria'), false);
    assert.equal(state.intake?.answers.visaType, visaType);
    assert.deepEqual(state.intake?.answers.criteria, []);
    assert.equal(state.intake?.answers.majorAward, '');
  }
});

test('changing visa clears EB-1A-only answers and completion but preserves later general answers', () => {
  const completed = throughReview();
  const changed = applyIntakeStep(completed, 'visa', { ...answers(), visaType: 'e1' });
  assert.equal(changed.intake?.completedAt, undefined);
  assert.equal(changed.intake?.step, 'birth');
  assert.equal(changed.intake?.answers.majorAward, '');
  assert.deepEqual(changed.intake?.answers.criteria, []);
  assert.deepEqual(changed.intake?.answers.citizenships, ['CA','GB']);
  assert.equal(caseSchema.safeParse(changed).success, true);
  assert.throws(() => applyIntakeStep(changed, 'criteria', answers()), /earlier/);
  const backToEb1a = applyIntakeStep(changed, 'visa', answers());
  assert.equal(backToEb1a.intake?.answers.majorAward, '');
  assert.deepEqual(backToEb1a.intake?.answers.criteria, []);
});

test('self-reported criteria, uncertain experience, and major award are distinct intake paths', () => {
  const unsure = throughReview({ ...answers(), criteria: [], criteriaUnsure: true, majorAward: 'unsure' });
  assert.equal(unsure.intake?.answers.criteriaUnsure, true);
  const award = throughReview({ ...answers(), criteria: [], majorAward: 'yes' });
  assert.equal(award.intake?.answers.majorAward, 'yes');
  assert.deepEqual(award.criteria, []);
  const missing = { ...answers(), criteria: [] };
  assert.throws(() => throughReview(missing), /Select criteria/);
  assert.throws(() => throughReview({ ...answers(), criteriaUnsure: true }), /Select the criteria/);
  assert.throws(() => throughReview({ ...answers(), majorAward: '' }), /award question/);
});

test('step updates preserve concurrent answers and review never applies a stale full draft', () => {
  let state = throughReview();
  state.intake!.answers.birthCountry = 'NZ';
  state.intake!.answers.field = 'Remote field';
  const stale = { ...answers(), fullName: 'Changed name', field: 'Old field', birthCountry: 'AU' };
  state = applyIntakeStep(state, 'basics', stale);
  assert.equal(state.intake?.answers.fullName, 'Changed name');
  assert.equal(state.intake?.answers.field, 'Remote field');
  assert.equal(state.intake?.answers.birthCountry, 'NZ');
  // Resume through the already saved answers, then complete against the latest base.
  for (const step of ['visa','birth','citizenships','background','criteria'] as const) state = applyIntakeStep(state, step, intakeAnswersFromCase(state));
  const complete = applyIntakeStep(state, 'review', stale);
  assert.equal(complete.profile.fullName, 'Changed name');
  assert.equal(complete.professional.field, 'Remote field');
  assert.equal(complete.intake?.answers.birthCountry, 'NZ');
});

test('existing evidence, chosen criteria, legacy onboarding and residence survive intake completion', () => {
  const state = createSampleCase(); state.mode = 'personal';
  state.onboarding = { version: 1, step: 4, goal: 'review', completedAt: '2026-11-22T00:00:00.000Z' };
  const input = { ...answers(), fullName: state.profile.fullName, phone: state.profile.phone, field: state.professional.field, role: state.professional.role };
  const completed = throughReview(input, state);
  for (const key of ['documents','criteria','facts','runs','composition','onboarding','forms','profile','professional','consent','lastPage'] as const) assert.deepEqual(completed[key], state[key], key);
  const changed = throughReview({ ...input, fullName: 'Updated name' }, state);
  assert.equal(changed.profile.confirmed, false);
  assert.equal(changed.profile.country, 'Canada');
  assert.equal(changed.consent, state.consent);
  assert.deepEqual(changed.documents, state.documents);
  assert.equal(changed.runs.C08.result?.stale, true);
});

test('country picker includes all ISO codes plus Kosovo and supports historical birthplace and stateless answers', () => {
  assert.equal(COUNTRIES.length, 250);
  assert.equal(new Set(COUNTRIES.map(country => country.code)).size, 250);
  assert.equal(countryName('XK'), 'Kosovo');
  assert.equal(countryName('KR'), 'South Korea');
  const state = throughReview({ ...answers('unsure'), birthCountry: 'OTHER', birthCountryOther: 'Historical place of birth', citizenships: ['STATELESS'] });
  assert.equal(state.intake?.answers.birthCountryOther, 'Historical place of birth');
  assert.throws(() => throughReview({ ...answers(), birthCountry: 'OTHER' }), /country or territory of birth/);
  assert.throws(() => throughReview({ ...answers(), citizenships: ['STATELESS','CA'] }), /either/);
  assert.throws(() => throughReview({ ...answers(), citizenships: ['CA','CA'] }), /only once/);
});

test('strict persistence rejects impossible completion, invalid selections and branch contamination', () => {
  const completed = throughReview();
  const mutations: Array<(copy: typeof completed) => void> = [
    copy => { copy.intake!.answers.citizenships = ['ZZ']; },
    copy => { copy.intake!.answers.citizenships = ['CA','CA']; },
    copy => { copy.intake!.answers.citizenships = ['STATELESS','CA']; },
    copy => { copy.intake!.answers.birthCountry = ''; },
    copy => { copy.intake!.answers.criteria = ['C11']; },
    copy => { copy.intake!.answers.criteria = ['C04','C04']; },
    copy => { copy.intake!.answers.criteriaUnsure = true; },
    copy => { copy.intake!.answers.visaType = 'e1'; },
    copy => { copy.intake!.answers.notes = 'x'.repeat(3001); },
    copy => { copy.intake!.step = 'basics'; },
  ];
  for (const mutate of mutations) { const copy = structuredClone(completed); mutate(copy); assert.equal(caseSchema.safeParse(copy).success, false); }
  assert.throws(() => applyIntakeStep(createEmptyCase(), 'review', answers()), /earlier/);
  assert.throws(() => applyIntakeStep(createSampleCase(), 'basics', answers()), /personal intake/);
});

test('merging a selected step copies array values without discarding other local answers', () => {
  const current = answers();
  const saved = { ...answers(), fullName: 'Saved name', citizenships: ['FR'], notes: 'Saved notes' };
  const merged = mergeIntakeStepAnswers(current, saved, 'citizenships');
  assert.equal(merged.fullName, current.fullName);
  assert.equal(merged.notes, current.notes);
  assert.deepEqual(merged.citizenships, ['FR']);
  merged.citizenships.push('CA');
  assert.deepEqual(saved.citizenships, ['FR']);
});

test('intake routing resumes incomplete answers without overriding sample or legacy completed cases', () => {
  const legacy = createEmptyCase();
  legacy.onboarding = { version: 1, step: 4, goal: 'evidence', completedAt: '2026-11-22T00:00:00.000Z' };
  assert.equal(getOnboardingRoute(legacy), 'workspace');
  const started = applyIntakeStep(legacy, 'basics', answers());
  assert.equal(getOnboardingRoute(started), 'setup');
  const completed = throughReview(answers(), legacy);
  assert.equal(getOnboardingRoute(completed), 'workspace');
  const editing = applyIntakeStep(completed, 'visa', answers('e1'));
  assert.equal(getOnboardingRoute(editing), 'setup');
  const sample = createSampleCase(); sample.intake = editing.intake;
  assert.equal(getOnboardingRoute(sample), 'workspace');
  assert.throws(() => applyIntakeStep(editing, 'review', answers('e1')), /earlier/);
  assert.throws(() => applyIntakeStep(editing, 'criteria', answers()), /earlier/);
});
