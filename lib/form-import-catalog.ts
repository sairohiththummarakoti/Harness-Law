import { BIRTH_COUNTRIES, CITIZENSHIP_OPTIONS, COUNTRIES } from './countries.ts';
import { CRITERIA } from './model.ts';
import { VISA_OPTIONS } from './intake-catalog.ts';
import { INTAKE_STEP_FIELDS, type IntakeStep } from './intake.ts';
import type { ImportField } from './form-import.ts';

const text = (key: string, label: string, aliases: string[] = [], maxLength = 500): ImportField => ({ key, label, aliases, maxLength });
const area = (key: string, label: string, aliases: string[] = [], maxLength = 50_000): ImportField => ({ ...text(key, label, aliases, maxLength), kind: 'textarea' });
const countryOptions = (countries: readonly {code: string; name: string}[], codeValue = true) => countries.map(country => ({ value: codeValue ? country.code : country.name, label: country.name, aliases: [country.code, ...(country.code === 'US' ? ['USA', 'United States of America'] : country.code === 'GB' ? ['UK', 'Great Britain'] : country.code === 'STATELESS' ? ['Stateless', 'No citizenship'] : country.code === 'OTHER' ? ['Other', 'Another country'] : [])] }));
const fullName = text('fullName', 'Full legal name', ['Full name', 'Applicant name', 'Name']);
const phone = text('phone', 'Phone number', ['Phone', 'Telephone', 'Mobile', 'Contact number']);
const field = text('field', 'Professional field', ['Field', 'Field of expertise', 'Area of expertise']);
const role = text('role', 'Current role', ['Role', 'Job title', 'Current or most recent role', 'Current or recent role', 'Occupation']);
const address = area('address', 'Mailing address', ['Address', 'Postal address']);
const country: ImportField = { key: 'country', label: 'Country of residence', aliases: ['Residence country'], kind: 'choice', options: countryOptions(COUNTRIES, false) };
const intendedWork = area('intendedWork', 'Intended work in the United States', ['Intended work', 'Proposed work', 'Proposed endeavor']);
export const PROFILE_IMPORT_FIELDS: ImportField[] = [fullName, text('preferredName', 'Preferred name'), text('email', 'Contact email address', ['Email', 'Email address', 'Contact email']), phone, country, area('priorNames', 'Prior names', ['Previous names', 'Former names']), address];
export const PROFESSIONAL_IMPORT_FIELDS: ImportField[] = [field, role, text('organization', 'Organization', ['Employer', 'Company', 'Institution']), area('timeline', 'Employment and research timeline', ['Timeline', 'Experience', 'Work experience', 'Employment history', 'Professional experience', 'Research experience']), area('achievements', 'Key accomplishments', ['Achievements', 'Accomplishments', 'Awards and honors', 'Publications']), intendedWork];
export const WORKSHEET_IMPORT_FIELDS: ImportField[] = [fullName, country, address, intendedWork];
export const CASE_NAME_IMPORT_FIELDS: ImportField[] = [text('name', 'Case name', ['Case title'])];
export const DRAFT_IMPORT_FIELDS: ImportField[] = [area('text', 'Your draft text', ['Draft text', 'Applicant statement', 'Statement', 'Paragraph', 'Draft', 'Section text', 'Edit paragraph'])];
export const factImportFields = (label: string): ImportField[] => [area('value', 'Corrected value', [label, 'Fact value']), area('reason', 'Reason for correction', ['Correction reason'])];
const intakeFields: ImportField[] = [
  fullName, { ...phone, maxLength: 100 }, { key: 'helpFor', label: 'Immigration help for', aliases: ['Help for', 'I need immigration help for'], kind: 'choice', options: [{ value: 'myself', label: 'Myself or my family', aliases: ['Myself', 'My family'] }, { value: 'employees', label: 'My employees', aliases: ['Employees'] }] },
  { key: 'visaType', label: 'Visa interest', aliases: ['Visa type', 'Visa', 'Immigration process'], kind: 'choice', options: VISA_OPTIONS.map(option => ({ value: option.id, label: option.label, aliases: option.id === 'unsure' ? ['Not sure', 'Unsure'] : [] })) },
  { key: 'birthCountry', label: 'Country of birth', aliases: ['Birth country'], kind: 'choice', options: countryOptions(BIRTH_COUNTRIES) },
  text('birthCountryOther', 'Country or territory as recorded at birth', ['Other birth country', 'Historical birth country'], 200),
  { key: 'citizenships', label: 'Citizenships', aliases: ['Citizenship', 'Country of citizenship', 'Countries of citizenship'], kind: 'multi', maxItems: 20, options: countryOptions(CITIZENSHIP_OPTIONS) }, field, role,
  { key: 'criteria', label: 'EB-1A criteria', aliases: ['Selected criteria', 'Criteria to explore', 'Criteria'], kind: 'multi', maxItems: 10, options: CRITERIA.map(criterion => ({ value: criterion.id, label: criterion.title, aliases: [criterion.shortTitle] })) },
  { key: 'criteriaUnsure', label: 'Unsure which criteria apply', aliases: ['Criteria unsure', 'I am not sure which criteria apply yet'], kind: 'boolean' },
  { key: 'majorAward', label: 'Major internationally recognized award', aliases: ['Major international award', 'Major award', 'Have you received a major internationally recognized award'], kind: 'choice', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'unsure', label: 'Not sure', aliases: ['Unsure', 'Not sure yet'] }] },
  area('notes', 'Additional context', ['Notes', 'Additional notes', 'Additional information', 'Anything else we should know'], 3000),
];
export function intakeImportFields(step: IntakeStep): ImportField[] {
  return intakeFields.filter(field => (INTAKE_STEP_FIELDS[step] as readonly string[]).includes(field.key));
}

/** Every known field can end a text block, even when it is not editable on this form. */
export const ALL_IMPORT_FIELD_LABELS: readonly string[] = [...new Set([
  ...PROFILE_IMPORT_FIELDS, ...PROFESSIONAL_IMPORT_FIELDS, ...WORKSHEET_IMPORT_FIELDS,
  ...CASE_NAME_IMPORT_FIELDS, ...DRAFT_IMPORT_FIELDS, ...factImportFields(''), ...intakeFields,
].flatMap(field => [field.key, field.label, ...(field.aliases ?? [])]).filter(Boolean))];
