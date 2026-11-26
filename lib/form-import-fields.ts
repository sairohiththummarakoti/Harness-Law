import type { IntakeAnswers, IntakeStep } from './intake.ts';
import { buildImportPatch, type ImportValue } from './form-import.ts';
import { intakeImportFields } from './form-import-catalog.ts';
export * from './form-import-catalog.ts';

/** Mirrors manual choice normalization without saving any other intake step. */
export function applyIntakeImportPatch(current: IntakeAnswers, step: IntakeStep, proposed: Record<string, ImportValue>): IntakeAnswers {
  const fields = intakeImportFields(step);
  const { patch, errors } = buildImportPatch(fields, Object.entries(proposed).map(([key, value]) => ({ key, value, selected: true, excerpt: '' })), { ...current });
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  const next = { ...current, ...patch } as IntakeAnswers;
  if (step === 'visa' && next.visaType !== 'eb1a') { next.criteria = []; next.criteriaUnsure = false; next.majorAward = ''; }
  if (step === 'birth' && next.birthCountry !== 'OTHER') next.birthCountryOther = '';
  if (step === 'criteria') {
    if ('criteria' in patch && next.criteria.length) next.criteriaUnsure = false;
    if (patch.criteriaUnsure === true) next.criteria = [];
  }
  return next;
}
