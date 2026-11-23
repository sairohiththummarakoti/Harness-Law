import { applyAction, CRITERIA, type CaseState } from './model.ts';
import { VISA_IDS, type VisaType } from './intake-catalog.ts';
import { isBirthCountryCode, isCitizenshipCode } from './countries.ts';

export type IntakeStep = 'basics' | 'visa' | 'birth' | 'citizenships' | 'background' | 'criteria' | 'review';
export interface IntakeAnswers {
  fullName: string; phone: string; helpFor: 'myself' | 'employees' | '';
  visaType: VisaType | ''; birthCountry: string; birthCountryOther: string; citizenships: string[];
  field: string; role: string; criteria: string[]; criteriaUnsure: boolean;
  majorAward: 'yes' | 'no' | 'unsure' | ''; notes: string;
}
export interface CaseIntake { version: 1; step: IntakeStep; answers: IntakeAnswers; completedAt?: string }

export const INTAKE_STEP_FIELDS: Record<IntakeStep, readonly (keyof IntakeAnswers)[]> = {
  basics: ['fullName', 'phone', 'helpFor'], visa: ['visaType'], birth: ['birthCountry', 'birthCountryOther'],
  citizenships: ['citizenships'], background: ['field', 'role'],
  criteria: ['criteria', 'criteriaUnsure', 'majorAward'], review: ['notes'],
};

export function getIntakeSteps(visaType: IntakeAnswers['visaType']): IntakeStep[] {
  const steps: IntakeStep[] = ['basics', 'visa', 'birth', 'citizenships', 'background'];
  if (visaType === 'eb1a') steps.push('criteria');
  return [...steps, 'review'];
}

export function intakeAnswersFromCase(state: CaseState, initialName = ''): IntakeAnswers {
  if (state.intake) return structuredClone(state.intake.answers);
  return {
    fullName: state.profile.fullName || initialName, phone: state.profile.phone, helpFor: '', visaType: '',
    birthCountry: '', birthCountryOther: '', citizenships: [],
    field: state.professional.field, role: state.professional.role,
    criteria: [], criteriaUnsure: false, majorAward: '', notes: '',
  };
}

/** Merge only the displayed question; another tab's other answers stay authoritative. */
export function mergeIntakeStepAnswers(current: IntakeAnswers, saved: IntakeAnswers, step: IntakeStep): IntakeAnswers {
  const next = structuredClone(current);
  for (const key of INTAKE_STEP_FIELDS[step]) {
    // Every assignment retains the key's existing type; the indexed union is only for iteration.
    Object.assign(next, { [key]: structuredClone(saved[key]) });
  }
  if (step === 'visa' && next.visaType !== 'eb1a') {
    next.criteria = []; next.criteriaUnsure = false; next.majorAward = '';
  }
  if (step === 'birth' && next.birthCountry !== 'OTHER') next.birthCountryOther = '';
  return next;
}

function required(value: string, label: string, max = 500): string | null {
  if (!value.trim()) return `Enter ${label} to continue.`;
  if (value.length > max) return `Keep ${label} to ${max} characters or fewer.`;
  return null;
}

/** Used by both UI transitions and persistence validation; these are intake checks, not legal findings. */
export function intakeStepError(answers: IntakeAnswers, step: IntakeStep): string | null {
  switch (step) {
    case 'basics':
      return required(answers.fullName, 'your full name')
        || (answers.phone.length > 100 ? 'Keep your phone number to 100 characters or fewer.' : null)
        || (!['myself', 'employees'].includes(answers.helpFor) ? 'Choose who needs immigration help.' : null);
    case 'visa': return VISA_IDS.includes(answers.visaType as VisaType) ? null : 'Choose a visa or immigration process to continue.';
    case 'birth':
      return !isBirthCountryCode(answers.birthCountry) ? 'Choose your country of birth.'
        : answers.birthCountry === 'OTHER' ? required(answers.birthCountryOther, 'your country or territory of birth', 200) : null;
    case 'citizenships':
      if (!answers.citizenships.length) return 'Select your citizenship or choose stateless / no citizenship.';
      if (answers.citizenships.length > 20) return 'Select up to 20 citizenships.';
      if (answers.citizenships.some(code => !isCitizenshipCode(code))) return 'Choose citizenships from the list.';
      if (new Set(answers.citizenships).size !== answers.citizenships.length) return 'Each citizenship can be selected only once.';
      if (answers.citizenships.includes('STATELESS') && answers.citizenships.length > 1) return 'Choose either citizenships or stateless / no citizenship.';
      return null;
    case 'background': return required(answers.field, 'your professional field') || required(answers.role, 'your current or most recent role');
    case 'criteria':
      if (answers.visaType !== 'eb1a') return 'The EB-1A experience question is only used for EB-1A intake.';
      if (!['yes', 'no', 'unsure'].includes(answers.majorAward)) return 'Answer the major internationally recognized award question.';
      if (answers.criteria.length > 10 || answers.criteria.some(id => !CRITERIA.some(criterion => criterion.id === id))) return 'Choose criteria from the list.';
      if (new Set(answers.criteria).size !== answers.criteria.length) return 'Each criterion can be selected only once.';
      if (answers.criteriaUnsure && answers.criteria.length > 0) return 'Select the criteria you want to explore, or choose that you are not sure yet.';
      if (!answers.criteria.length && !answers.criteriaUnsure && answers.majorAward !== 'yes') return 'Select criteria you want to explore, or choose that you are not sure yet.';
      return null;
    case 'review': return answers.notes.length <= 3000 ? null : 'Keep your notes to 3000 characters or fewer.';
  }
}

export function intakeCompletionError(answers: IntakeAnswers): string | null {
  for (const step of getIntakeSteps(answers.visaType)) {
    const error = intakeStepError(answers, step);
    if (error) return error;
  }
  return null;
}

/** The caller saves this result against the revision it loaded. Never overwrites unrelated case content. */
export function applyIntakeStep(state: CaseState, step: IntakeStep, answers: IntakeAnswers): CaseState {
  if (state.mode === 'sample') throw new Error('Sign in to save a personal intake.');
  const current = intakeAnswersFromCase(state);
  const previousSteps = getIntakeSteps(current.visaType);
  const currentStep = state.intake?.step ?? 'basics';
  const stepIndex = previousSteps.indexOf(step);
  if (stepIndex < 0 || stepIndex > previousSteps.indexOf(currentStep)) throw new Error('Complete the earlier intake questions first.');
  const merged = mergeIntakeStepAnswers(current, answers, step);
  for (const key of INTAKE_STEP_FIELDS[step]) {
    if (typeof merged[key] === 'string') Object.assign(merged, { [key]: (merged[key] as string).trim() });
  }
  const error = step === 'review' ? intakeCompletionError(merged) : intakeStepError(merged, step);
  if (error) throw new Error(error);
  const steps = getIntakeSteps(merged.visaType);
  const nextStep = steps[Math.min(steps.indexOf(step) + 1, steps.length - 1)];
  let next = structuredClone(state);
  next.intake = { version: 1, step: nextStep, answers: merged };
  if (step === 'review') {
    const profileChanged = merged.fullName !== next.profile.fullName || merged.phone !== next.profile.phone;
    if (profileChanged) next = applyAction(next, { type: 'profile', patch: { fullName: merged.fullName, phone: merged.phone, confirmed: false } });
    if (merged.field !== next.professional.field || merged.role !== next.professional.role) {
      next = applyAction(next, { type: 'professional', patch: { field: merged.field, role: merged.role } });
    }
    // A first intake can choose a starting point for an empty preparation workspace.
    // Existing selections remain authoritative, and choosing a criterion never assesses it.
    if (merged.visaType === 'eb1a' && !state.intake?.completedAt && state.criteria.length === 0) {
      for (const criterion of merged.criteria) next = applyAction(next, { type: 'toggle_criterion', criterion });
    }
    next.intake = { version: 1, step: 'review', answers: merged, completedAt: new Date().toISOString() };
  }
  next.updatedAt = new Date().toISOString();
  return next;
}
