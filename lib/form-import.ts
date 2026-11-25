/** Conservative, schema-scoped matching. Imported text is applicant input, never evidence. */
import { ALL_IMPORT_FIELD_LABELS } from './form-import-catalog.ts';
export type ImportValue = string | string[] | boolean;
export interface ImportField {
  key: string;
  label: string;
  aliases?: string[];
  kind?: 'text' | 'textarea' | 'choice' | 'multi' | 'boolean';
  maxLength?: number;
  options?: { value: string; label: string; aliases?: string[] }[];
  maxItems?: number;
}
export interface ImportSuggestion { key: string; value: ImportValue; excerpt: string; selected: boolean; error?: string }
const forbidden = new Set(['__proto__', 'prototype', 'constructor', 'accountEmail', 'accountId', 'userId', 'password', 'consent', 'confirmed', 'reviewed', 'reviewStatus', 'supportStatus', 'citations', 'associations', 'locked', 'templateStatus']);
const canonical = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const knownFieldLabels = new Set(ALL_IMPORT_FIELD_LABELS.map(canonical));
const applicantHeadings = new Set(['contact', 'contact information', 'personal details', 'personal information', 'applicant details', 'applicant information', 'applicant contact information']);
const referenceHeadings = new Set(['reference', 'references', 'professional references', 'personal references', 'referee', 'referees', 'recommenders', 'recommendation contacts']);
const sectionHeadings = new Set(['education', 'skills', 'technical skills', 'languages', ...referenceHeadings, ...applicantHeadings, 'professional summary', 'summary', 'objective', 'publications', 'awards', 'awards and honors', 'work experience', 'professional experience', 'research experience', 'experience', 'employment history', 'certifications', 'projects', 'volunteering', 'interests']);
const genericName = /\b(engineer|scientist|researcher|director|manager|professor|developer|consultant|analyst|designer|architect|summary|experience|professional|profile|contact|curriculum|vitae|resume|résumé|cover|letter|statement|application|intake|fictional|sample)\b/i;
const nameLike = (value: string) => !genericName.test(value) && !sectionHeadings.has(canonical(value)) && /^[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){1,4}$/u.test(value);
const safeFields = (fields: ImportField[]) => fields.filter(field => !forbidden.has(field.key));
const matchingLine = (line: string) => line.trim().replace(/^#{1,6}\s*/, '').replace(/^[-*]\s+/, '').replace(/^(\*\*|__)(.+?)\1(?=\s|[:=]|$)/, '$2');
export const isEmptyImportValue = (value: unknown): boolean => value === undefined || value === null || typeof value === 'string' && !value.trim() || Array.isArray(value) && value.length === 0;

export function validateImportValue(field: ImportField, input: unknown): { value?: ImportValue; error?: string } {
  const invalid = (message: string) => ({ error: `${field.label}: ${message}` });
  if (forbidden.has(field.key)) return invalid('this field cannot be imported.');
  if (field.kind === 'boolean') {
    if (typeof input === 'boolean') return { value: input };
    if (typeof input !== 'string') return invalid('choose Yes or No.');
    const value = canonical(input);
    if (['yes', 'true'].includes(value)) return { value: true };
    if (['no', 'false'].includes(value)) return { value: false };
    return invalid('choose Yes or No.');
  }
  if (field.kind === 'choice' || field.kind === 'multi') {
    const values = field.kind === 'multi' ? Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[,;\n|]+/) : [] : [input];
    if (!values.length) return invalid('choose a value from the available options.');
    const normalized: string[] = [];
    for (const raw of values) {
      if (typeof raw !== 'string' || !raw.trim()) return invalid('choose a value from the available options.');
      const key = canonical(raw);
      const option = field.options?.find(item => [item.value, item.label, ...(item.aliases ?? [])].some(alias => canonical(alias) === key));
      if (!option) return invalid(`“${raw.slice(0, 100)}” is not an available choice.`);
      if (!normalized.includes(option.value)) normalized.push(option.value);
    }
    if (normalized.length > (field.maxItems ?? 20)) return invalid(`choose no more than ${field.maxItems ?? 20} options.`);
    if (normalized.includes('STATELESS') && normalized.length > 1) return invalid('choose citizenships or stateless, not both.');
    return { value: field.kind === 'multi' ? normalized : normalized[0] };
  }
  if (typeof input !== 'string') return invalid('enter text.');
  const value = input.trim();
  if (!value) return invalid('enter a value before applying.');
  if (value.length > (field.maxLength ?? 500)) return invalid(`use ${field.maxLength ?? 500} characters or fewer.`);
  if (field.key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return invalid('enter a valid contact email address.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return invalid('remove unreadable control characters.');
  return { value };
}

/** Only exact, labeled answers/section titles are matched. No legal conclusions are inferred. */
export function suggestImportFields(text: string, fields: ImportField[], current: Record<string, unknown>, options: { manualOnly?: boolean } = {}): ImportSuggestion[] {
  if (options.manualOnly) return [];
  const available = safeFields(fields);
  const aliases = new Map<string, ImportField>();
  for (const field of available) for (const alias of [field.key, field.label, ...(field.aliases ?? [])]) aliases.set(canonical(alias), field);
  const candidates = new Map<string, { value: string; excerpt: string }[]>();
  const uncertainHeader = new Set<string>();
  let active: { field: ImportField; title: string; lines: string[] } | undefined;
  let inReferences = false;
  const add = (field: ImportField, value: string, excerpt: string) => {
    if (!value.trim()) return;
    const entries = candidates.get(field.key) ?? [];
    entries.push({ value: value.trim(), excerpt: excerpt.slice(0, 900) });
    candidates.set(field.key, entries);
  };
  const flush = () => {
    if (active) add(active.field, active.lines.join('\n'), `${active.title}\n${active.lines.join('\n')}`);
    active = undefined;
  };
  for (const original of text.slice(0, 200_000).split(/\r?\n/)) {
    const line = matchingLine(original);
    const heading = canonical(line);
    const boundary = canonical(line.match(/^([^:=\t]+)[:=\t]/)?.[1] ?? line);
    if (referenceHeadings.has(boundary)) { flush(); inReferences = true; continue; }
    // Contacts following a referee heading belong to someone else. Resume matching
    // only after an explicit applicant-details heading; all text stays assignable manually.
    if (inReferences && !applicantHeadings.has(heading)) continue;
    if (applicantHeadings.has(heading)) { flush(); inReferences = false; continue; }
    const label = line.match(/^([^:=\t]{1,150})\s*[:=\t]\s*(.*)$/);
    const field = aliases.get(canonical(label ? label[1] : line));
    if (field) {
      flush();
      const value = label?.[2]?.trim() ?? '';
      if (field.kind === 'textarea' || !value) active = { field, title: label?.[1] ?? line, lines: value ? [value] : [] };
      else add(field, value, original);
    } else if (knownFieldLabels.has(canonical(label ? label[1] : line)) || sectionHeadings.has(heading)) {
      flush();
    } else if (active && line) {
      active.lines.push(original.trim());
      if (active.field.kind !== 'textarea') flush();
    }
  }
  flush();
  // Recognize unambiguous CV contact/header conventions without interpreting achievements.
  const headerLines: string[] = [];
  for (const original of text.slice(0, 200_000).split(/\r?\n/)) {
    const line = matchingLine(original);
    if (!line) continue;
    const heading = canonical(line.match(/^([^:=\t]+)[:=\t]/)?.[1] ?? line);
    // Bare contact heuristics never search a resume body or third-party section.
    if (sectionHeadings.has(heading) && !applicantHeadings.has(heading)) break;
    if (!applicantHeadings.has(heading)) headerLines.push(line);
    if (headerLines.length >= 15) break;
  }
  for (const key of ['email', 'phone', 'fullName']) {
    const field = available.find(item => item.key === key);
    if (!field || candidates.has(key)) continue;
    if (key === 'email') {
      // Explicit unknown labels/prose may describe other people. A header fallback
      // accepts only a bare email segment, never an address embedded in that text.
      const matches = [...new Set(headerLines.flatMap(line => line.split(/[|•·]/)).map(line => line.trim()).filter(line => /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(line)))];
      if (matches.length === 1) add(field, matches[0], headerLines.find(line => line.includes(matches[0]))!);
    } else if (key === 'phone') {
      const matches = [...new Set(headerLines.flatMap(line => line.split(/[|•·]/)).map(line => line.trim()).filter(line => {
        const digits = line.match(/\d/g)?.length ?? 0;
        const dateRange = /^\d{4}\s*[-–—]\s*(?:\d{4}|present|current)$/i.test(line);
        const contactShape = line.startsWith('+') || /^\(\d{2,4}\)/.test(line) || /^\d{3}[-. ]\d{3}[-. ]\d{4}(?:\s|$)/.test(line);
        return !dateRange && contactShape && /^\+?[\d(][\d\s().-]{6,25}(?:\s*(?:ext\.?|x)\s*\d{1,6})?$/i.test(line) && digits >= (line.startsWith('+') ? 7 : 10);
      }))];
      if (matches.length === 1) add(field, matches[0], headerLines.find(line => line.includes(matches[0]))!);
    } else {
      const title = headerLines.findIndex(line => /^(curriculum vitae|résumé|resume|cv)$/i.test(line));
      const candidate = title === 0 ? headerLines[1] : title === 1 ? headerLines[0] : undefined;
      if (candidate && nameLike(candidate)) add(field, candidate, headerLines.slice(0, 3).join('\n'));
      else {
        const first = headerLines[0] ?? '';
        const adjacentContact = headerLines.slice(1, 3).some(line => /[^\s@]+@[^\s@]+\.[^\s@]+/.test(line));
        if (adjacentContact && !aliases.has(canonical(first)) && nameLike(first)) {
          add(field, first, headerLines.slice(0, 3).join('\n'));
          uncertainHeader.add(field.key); // A header candidate always needs an explicit selection.
        }
      }
    }
  }
  return available.flatMap(field => {
    const entries = candidates.get(field.key);
    if (!entries?.length) return [];
    // Contradictory repeated answers are left for explicit manual assignment.
    if (entries.some(entry => entry.value !== entries[0].value)) return [];
    if (['null', 'undefined', 'n a', 'not provided', 'not specified'].includes(canonical(entries[0].value))) return [];
    const checked = validateImportValue(field, entries[0].value);
    return [{ key: field.key, value: checked.value ?? entries[0].value, excerpt: entries[0].excerpt,
      selected: !checked.error && !uncertainHeader.has(field.key) && isEmptyImportValue(current[field.key]), ...(checked.error ? { error: checked.error } : {}) }];
  });
}

/** Whitelists current-form fields and validates the complete selection atomically. */
export function buildImportPatch(fields: ImportField[], suggestions: ImportSuggestion[], current: Record<string, unknown>): { patch: Record<string, ImportValue>; errors: Record<string, string> } {
  const patch: Record<string, ImportValue> = {};
  const errors: Record<string, string> = {};
  for (const suggestion of suggestions) {
    if (!suggestion.selected) continue;
    const field = safeFields(fields).find(item => item.key === suggestion.key);
    if (!field) { errors[suggestion.key] = 'This field is not available on the current form.'; continue; }
    const validated = validateImportValue(field, suggestion.value);
    if (validated.error || validated.value === undefined) errors[field.key] = validated.error ?? 'Enter a valid value.';
    else patch[field.key] = validated.value;
  }
  const next = { ...current, ...patch };
  if ('birthCountryOther' in patch && next.birthCountry !== 'OTHER') errors.birthCountryOther = 'Choose another / historical country before entering its name.';
  if ('criteria' in patch && 'criteriaUnsure' in patch && next.criteriaUnsure === true && Array.isArray(next.criteria) && next.criteria.length) errors.criteria = 'Choose criteria or select that you are unsure, not both.';
  return { patch: Object.keys(errors).length ? {} : patch, errors };
}
