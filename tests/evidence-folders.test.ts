import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createEmptyCase, createSampleCase, type CaseState } from '../lib/model.ts';
import { caseSchema, validUploadName } from '../lib/validation.ts';
import { folderIntegrityError, folderPath } from '../lib/evidence-folders.ts';

function createFolder(state: CaseState, id: string, name: string, parentId: string | null = null) {
  return applyAction(state, { type: 'folder_create', folder: { id, name, parentId } });
}

test('legacy cases remain at root and nested folder organization survives persistence', () => {
  const legacy = createSampleCase();
  assert.equal(legacy.folders, undefined);
  assert.ok(caseSchema.safeParse(legacy).success);
  let state = createFolder(legacy, 'career', 'Career');
  state = createFolder(state, 'letters', 'Letters', 'career');
  state = applyAction(state, { type: 'document_move', sourceId: state.documents[0].id, folderId: 'letters' });
  const restored = caseSchema.parse(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.documents[0].folderId, 'letters');
  assert.equal(folderPath(restored.folders!, 'letters'), 'All files / Career / Letters');
  assert.equal(legacy.documents[0].folderId, undefined);
});

test('folder actions reject cycles, missing parents, duplicate identities and sibling names atomically', () => {
  let state = createFolder(createEmptyCase(), 'a', 'Awards');
  state = createFolder(state, 'b', 'Letters', 'a');
  const before = structuredClone(state);
  assert.throws(() => applyAction(state, { type: 'folder_move', folderId: 'a', parentId: 'b' }), /inside itself/);
  assert.throws(() => applyAction(state, { type: 'folder_move', folderId: 'a', parentId: 'a' }), /inside itself/);
  assert.throws(() => createFolder(state, 'x', 'Other', 'missing'), /no longer exists/);
  assert.throws(() => createFolder(state, 'a', 'Other'), /unique identity/);
  assert.throws(() => createFolder(state, 'c', 'AWARDS'), /already exists/);
  assert.throws(() => createFolder(state, 'c', '..'), /without slashes/);
  assert.throws(() => createFolder(state, 'c', 'A/B'), /without slashes/);
  assert.throws(() => createFolder(state, 'c', '   '), /Enter a folder name/);
  assert.deepEqual(state, before);
  assert.doesNotThrow(() => createFolder(state, 'c', 'Awards', 'b'));
});

test('strict persistence rejects folder cycles, orphan references, invalid names and oversized trees', () => {
  const base = createSampleCase();
  for (const folders of [
    [{ id: 'a', name: 'A', parentId: 'a' }],
    [{ id: 'a', name: 'A', parentId: 'b' }, { id: 'b', name: 'B', parentId: 'a' }],
    [{ id: 'a', name: 'A', parentId: 'missing' }],
    [{ id: 'a', name: 'A', parentId: null }, { id: 'b', name: 'a', parentId: null }],
    [{ id: 'a', name: ' padded ', parentId: null }],
    [{ id: 'a', name: 'x'.repeat(81), parentId: null }],
    Array.from({ length: 201 }, (_, i) => ({ id: `f${i}`, name: `Folder ${i}`, parentId: null })),
  ]) assert.equal(caseSchema.safeParse({ ...base, folders }).success, false);
  assert.equal(caseSchema.safeParse({ ...base, documents: base.documents.map((document, index) => index ? document : { ...document, folderId: 'missing' }) }).success, false);
});

test('moving and renaming folders preserves source versions, claims, reviews and composed drafts', () => {
  let state = applyAction(createSampleCase(), { type: 'compose', criteria: ['C04', 'C05', 'C08'] });
  state = createFolder(state, 'career', 'Career');
  state = createFolder(state, 'letters', 'Letters');
  const source = structuredClone(state.documents[0]);
  const runs = structuredClone(state.runs), composition = structuredClone(state.composition), facts = structuredClone(state.facts);
  state = applyAction(state, { type: 'document_move', sourceId: source.id, folderId: 'letters' });
  state = applyAction(state, { type: 'folder_move', folderId: 'letters', parentId: 'career' });
  state = applyAction(state, { type: 'folder_rename', folderId: 'career', name: '  Professional record  ' });
  assert.deepEqual(state.runs, runs); assert.deepEqual(state.composition, composition); assert.deepEqual(state.facts, facts);
  assert.deepEqual(state.documents[0], { ...source, folderId: 'letters' });
  assert.equal(folderPath(state.folders!, 'letters'), 'All files / Professional record / Letters');
  assert.throws(() => applyAction(state, { type: 'document_move', sourceId: source.id, folderId: 'missing' }), /no longer exists/);
});

test('only empty folders can be removed and replacing a source keeps its folder', () => {
  let state = createFolder(createSampleCase(), 'a', 'A');
  state = createFolder(state, 'b', 'B', 'a');
  const source = state.documents[0];
  state = applyAction(state, { type: 'document_move', sourceId: source.id, folderId: 'b' });
  assert.throws(() => applyAction(state, { type: 'folder_remove', folderId: 'a' }), /Move the files/);
  assert.throws(() => applyAction(state, { type: 'folder_remove', folderId: 'b' }), /Move the files/);
  state = applyAction(state, { type: 'replace_document', sourceId: source.id, document: { ...source, id: 'replacement', name: 'Replacement.pdf' } });
  assert.equal(state.documents[0].folderId, 'b');
  assert.equal(state.documents[0].id, source.id);
  assert.equal(state.documents[0].version, source.version + 1);
  state = applyAction(state, { type: 'replace_document', sourceId: source.id, document: { ...source, id: 'replacement-root', folderId: null, name: 'Root replacement.pdf' } });
  assert.equal(state.documents[0].folderId, null);
  assert.equal(state.documents[0].id, source.id);
  assert.equal(state.documents[0].version, source.version + 2);
  state = applyAction(state, { type: 'folder_remove', folderId: 'b' });
  state = applyAction(state, { type: 'folder_remove', folderId: 'a' });
  assert.equal(folderIntegrityError(state), null); assert.deepEqual(state.folders, []);
});

test('retained upload names support form-import formats without allowing executable formats', () => {
  for (const extension of ['pdf', 'docx', 'txt', 'md', 'markdown', 'csv', 'json', 'jpg', 'jpeg', 'png']) assert.equal(validUploadName(`Document.${extension}`), true);
  for (const name of ['script.js', 'document.html', 'payload.exe', 'file.json.exe', 'x\0.txt']) assert.equal(validUploadName(name), false);
});
