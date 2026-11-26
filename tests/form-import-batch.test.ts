import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceSourceLabel, mergeImportSources } from '../lib/form-import-batch.ts';
import { analyzeImportFields, suggestImportFields } from '../lib/form-import.ts';
import type { ImportField } from '../lib/form-import.ts';

const fields: ImportField[] = [
  { key: 'fullName', label: 'Full name' },
  { key: 'email', label: 'Email' },
  { key: 'summary', label: 'Summary', kind: 'textarea', maxLength: 2000 },
];

test('combines independent fields from multiple files and retains each source name', () => {
  const result = mergeImportSources([
    { fileName: 'Profile.txt', text: 'Full name: Maya Chen' },
    { fileName: 'Contact.txt', text: 'Email: maya@example.test' },
  ], fields, {});
  assert.deepEqual(result.suggestions.map(item => item.key), ['fullName', 'email']);
  assert.equal(result.suggestions.every(item => item.selected), true);
  assert.match(result.suggestions[1].excerpt, /Contact.txt/);
  assert.deepEqual(result.conflicts, []);
});

test('different answers require explicit source selection instead of picking first or last', () => {
  const result = mergeImportSources([
    { fileName: 'First.txt', text: 'Full name: Maya Chen\nEmail: first@example.test' },
    { fileName: 'Second.txt', text: 'Full name: Maya Chen\nEmail: second@example.test' },
  ], fields, {});
  assert.deepEqual(result.suggestions.map(item => item.key), ['fullName']);
  assert.equal(result.conflicts[0].key, 'email');
  assert.deepEqual(result.conflicts[0].candidates.map(item => item.fileName), ['First.txt', 'Second.txt']);
  assert.match(result.suggestions[0].excerpt, /First.txt/);
  assert.match(result.suggestions[0].excerpt, /Second.txt/);
});

test('existing values remain unchecked and manual-only files never create automatic suggestions', () => {
  const result = mergeImportSources([
    { fileName: 'Profile.txt', text: 'Full name: Maya Chen' },
    { fileName: 'Ambiguous.csv', text: 'Email: other@example.test', manualOnly: true },
  ], fields, { fullName: 'Existing name' });
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].selected, false);
  assert.deepEqual(result.conflicts, []);
});

test('text from a following document cannot become an answer to an unfinished label', () => {
  const result = mergeImportSources([
    { fileName: 'First.txt', text: 'Full name:\nSummary:' },
    { fileName: 'Second.txt', text: 'Maya Chen\nExperience\nAn unrelated paragraph.' },
  ], fields, {});
  assert.deepEqual(result.suggestions, []);
});

test('uncertain header matches stay unchecked even if another source repeats the name', () => {
  const result = mergeImportSources([
    { fileName: 'Labeled.txt', text: 'Full name: Maya Chen' },
    { fileName: 'Header.txt', text: 'Maya Chen\nmaya@example.test' },
  ], fields, {});
  assert.equal(result.suggestions.find(item => item.key === 'fullName')?.selected, false);
});

test('a contradictory field within one source cannot be auto-selected by another source', () => {
  const result = mergeImportSources([
    { fileName: 'Conflicting.txt', text: 'Email: first@example.test\nEmail: second@example.test' },
    { fileName: 'Repeating.txt', text: 'Email: first@example.test' },
  ], fields, {});
  assert.deepEqual(result.suggestions, []);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].key, 'email');
  assert.deepEqual(result.conflicts[0].candidates.map(candidate => candidate.value), ['first@example.test', 'second@example.test', 'first@example.test']);
});

test('single-file matching still omits contradictory fields while analysis retains their candidates', () => {
  const text = 'Email: first@example.test\nEmail: second@example.test';
  assert.deepEqual(suggestImportFields(text, fields, {}), []);
  const analysis = analyzeImportFields(text, fields, {});
  assert.equal(analysis.ambiguities[0].key, 'email');
  assert.equal(analysis.ambiguities[0].candidates.every(candidate => !candidate.selected), true);
});

test('duplicate basenames keep their complete folder paths in conflict choices and excerpts', () => {
  const folders = [{ id: 'old', name: 'Old', parentId: null }, { id: 'current', name: 'Current', parentId: null }];
  const old = evidenceSourceLabel({ name: 'CV.pdf', folderId: 'old' }, folders);
  const current = evidenceSourceLabel({ name: 'CV.pdf', folderId: 'current' }, folders);
  assert.equal(old, 'All files / Old / CV.pdf');
  assert.equal(current, 'All files / Current / CV.pdf');
  const result = mergeImportSources([
    { fileName: old, text: 'Full name: Maya Chen\nEmail: old@example.test' },
    { fileName: current, text: 'Full name: Maya Chen\nEmail: current@example.test' },
  ], fields, {});
  assert.deepEqual(result.conflicts[0].candidates.map(candidate => candidate.fileName), [old, current]);
  assert.ok(result.suggestions[0].excerpt.includes(old));
  assert.ok(result.suggestions[0].excerpt.includes(current));
});
