import type { CaseState, OnboardingGoal } from './model';
// @ts-ignore Node's built-in test runner requires an explicit TypeScript extension.
import { getOnboardingNextStep } from './onboarding.ts';

export type SetupStep = 1 | 2 | 3;
export type SetupAnswers = { field: string; role: string; goal: OnboardingGoal | ''; fullName: string; preferredName: string };

export function setupAnswersFromCase(state: CaseState, initialName = ''): SetupAnswers {
  return { field: state.professional.field, role: state.professional.role, goal: state.onboarding?.goal ?? '', fullName: state.profile.fullName || initialName, preferredName: state.profile.preferredName };
}

/** Accepting a conflict for one step must not discard drafts entered on another. */
export function mergeCurrentStepAnswers(current: SetupAnswers, saved: SetupAnswers, step: SetupStep): SetupAnswers {
  if (step === 1) return { ...current, field: saved.field, role: saved.role };
  if (step === 2) return { ...current, goal: saved.goal };
  return { ...current, fullName: saved.fullName, preferredName: saved.preferredName };
}

export function mergeAcceptedSetupAnswers(current: SetupAnswers, saved: SetupAnswers, step: SetupStep, retriedConflict = false): SetupAnswers {
  return {
    ...current, field: saved.field, role: saved.role,
    goal: step >= 2 || retriedConflict ? saved.goal : current.goal,
    ...(step === 3 ? { fullName: saved.fullName, preferredName: saved.preferredName } : {}),
  };
}

export function hasUnsavedSetupAnswers(current: SetupAnswers, saved: SetupAnswers | null, inFlight = false, completed = false): boolean {
  if (completed) return false;
  if (inFlight) return true;
  return !!saved && (Object.keys(current) as (keyof SetupAnswers)[]).some(key => current[key] !== saved[key]);
}

/** Completion is based on all saved setup fields, so show them all before retry. */
export function setupConflictRows(state: CaseState, step: SetupStep): { label: string; value: string }[] {
  const work = [
    { label: 'Field', value: state.professional.field || 'Not added' },
    { label: 'Role', value: state.professional.role || 'Not added' },
  ];
  const focus = { label: 'Focus', value: state.onboarding?.goal ? getOnboardingNextStep(state.onboarding.goal).title : 'Not chosen' };
  if (step === 1) return work;
  if (step === 2) return [focus];
  return [...work, focus,
    { label: 'Full name', value: state.profile.fullName || 'Not added' },
    { label: 'Preferred name', value: state.profile.preferredName || 'Not added' },
  ];
}
