// @ts-ignore Node's built-in test runner requires an explicit TypeScript extension.
import { applyAction, type CaseState, type OnboardingGoal } from './model.ts';

export type { OnboardingGoal } from './model';

export const ONBOARDING_GOALS: ReadonlyArray<{
  id: OnboardingGoal; title: string; description: string; page: string; action: string;
}> = [
  { id: 'evidence', title: 'Organize my evidence', description: 'Bring your documents together and connect them to the criteria you choose.', page: 'evidence', action: 'Open evidence library' },
  { id: 'narrative', title: 'Develop my narrative', description: 'Choose relevant criteria, then write your achievements in your own words.', page: 'criteria', action: 'Choose your criteria' },
  { id: 'review', title: 'Review my draft', description: 'See the open items to address before relying on a working draft.', page: 'review', action: 'Open final review' },
];

export function getOnboardingNextStep(goal?: OnboardingGoal) {
  return ONBOARDING_GOALS.find(item => item.id === goal) ?? ONBOARDING_GOALS[0];
}

/** Old cases have no setup marker. Any entered preparation data makes them established. */
export function hasExistingPreparation(state: CaseState): boolean {
  return state.mode === 'sample'
    || state.name !== 'My EB-1A preparation'
    || Object.values(state.profile).some(value => typeof value === 'boolean' ? value : value.trim().length > 0)
    || Object.values(state.professional).some(value => value.trim().length > 0)
    || state.criteria.length > 0 || state.documents.length > 0 || state.facts.length > 0
    || !!state.composition || !!state.compositionHistory?.length
    || state.activities.length > 0 || state.consent
    || Object.values(state.runs).some(run => run.status !== 'idle' || run.generation > 0 || !!run.result || run.history.length > 0 || run.questions.length > 0 || !!run.error || run.stage !== 'Not started')
    || state.forms.reviewed || state.forms.templateStatus !== 'unverified'
    || [state.forms.fullName, state.forms.address, state.forms.country, state.forms.intendedWork].some(value => value.trim().length > 0);
}

export function getOnboardingRoute(state: CaseState): 'setup' | 'workspace' {
  if (state.mode === 'sample' || state.onboarding?.completedAt || state.onboarding?.step === 4) return 'workspace';
  if (!state.onboarding && hasExistingPreparation(state)) return 'workspace';
  return 'setup';
}

export interface OnboardingAnswers {
  field?: string; role?: string; goal?: OnboardingGoal; fullName?: string; preferredName?: string;
}

function answer(value: string | undefined, label: string, required = true): string {
  const trimmed = value?.trim() ?? '';
  if (required && !trimmed) throw new Error(`Enter ${label} to continue.`);
  if (trimmed.length > 500) throw new Error(`Keep ${label} to 500 characters or fewer.`);
  return trimmed;
}

/** Pure update: callers still must save using the revision they successfully loaded. */
export function applyOnboardingStep(state: CaseState, step: 1 | 2 | 3, answers: OnboardingAnswers): CaseState {
  if (getOnboardingRoute(state) !== 'setup') throw new Error('Your existing preparation is ready in the workspace.');
  const currentStep = state.onboarding?.step ?? 1;
  if (step > currentStep) throw new Error('Complete the earlier setup step first.');
  let next = structuredClone(state);
  if (step === 1) {
    const field = answer(answers.field, 'your professional field');
    const role = answer(answers.role, 'your role');
    if (field !== state.professional.field || role !== state.professional.role) {
      next = applyAction(next, { type: 'professional', patch: { field, role } });
    }
  }
  if (step === 2 && !ONBOARDING_GOALS.some(goal => goal.id === answers.goal)) throw new Error('Choose a preparation goal to continue.');
  next.onboarding = {
    version: 1,
    step: Math.max(currentStep, step + 1) as 2 | 3 | 4,
    ...(state.onboarding?.goal ? { goal: state.onboarding.goal } : {}),
    ...(step === 2 ? { goal: answers.goal } : {}),
  };
  if (step === 3) {
    if (!next.onboarding.goal || !next.professional.field.trim() || !next.professional.role.trim()) throw new Error('Complete your professional details and preparation goal first.');
    const fullName = answer(answers.fullName, 'your full name');
    const preferredName = answer(answers.preferredName, 'your preferred name', false);
    if (fullName !== state.profile.fullName || preferredName !== state.profile.preferredName) {
      next = applyAction(next, { type: 'profile', patch: { fullName, preferredName, confirmed: false } });
    }
    next.onboarding = { ...next.onboarding!, step: 4, completedAt: new Date().toISOString() };
    next.lastPage = getOnboardingNextStep(next.onboarding.goal).page;
  }
  next.updatedAt = new Date().toISOString();
  return next;
}
