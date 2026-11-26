import test from 'node:test';
import assert from 'node:assert/strict';
import { planEvidenceUpload, planNamedEvidenceUpload, sameUploadSelection } from '../lib/evidence-upload-plan.ts';

const file = (name: string, path = '', size = 100) => ({ name, size, webkitRelativePath: path });
test('directory uploads preserve nested paths and reuse folders without changing existing records', () => {
  const existing = [{ id: 'root', name: 'Career', parentId: null }, { id: 'awards', name: 'Awards', parentId: 'root' }];
  const before = structuredClone(existing);
  let next = 0;
  const plan = planEvidenceUpload([file('one.pdf', 'awards/2026/one.pdf'), file('two.txt', 'awards/2026/two.txt')], existing, 'root', 0, true, () => `new-${++next}`);
  assert.deepEqual(plan.folders, [{ id: 'new-1', name: '2026', parentId: 'awards' }]);
  assert.deepEqual(plan.entries.map(entry => entry.folderId), ['new-1', 'new-1']);
  assert.deepEqual(existing, before);
});
test('unsupported, empty and oversized files are reported without creating empty trees', () => {
  const plan = planEvidenceUpload([file('desktop.ini', 'Docs/desktop.ini'), file('empty.pdf', 'Docs/empty.pdf', 0), file('large.pdf', 'Docs/large.pdf', 21 * 1024 * 1024)], [], null, 0, true);
  assert.equal(plan.skipped.length, 3); assert.equal(plan.entries.length, 0); assert.deepEqual(plan.folders, []);
});
test('invalid paths, missing destinations and library limits fail before mutation', () => {
  for (const path of ['../a.pdf', '/a.pdf', 'Docs//a.pdf', 'Docs/b.pdf', '', 'Docs\\a.pdf']) assert.throws(() => planEvidenceUpload([file('a.pdf', path)], [], null, 0, true));
  assert.throws(() => planEvidenceUpload([file('a.pdf')], [], 'missing', 0, false), /no longer exists/);
  assert.throws(() => planEvidenceUpload([file('a.pdf')], [], null, 200, false), /200-file/);
  const folders = Array.from({ length: 200 }, (_, i) => ({ id: `${i}`, name: `Folder ${i}`, parentId: null }));
  assert.throws(() => planEvidenceUpload([file('a.pdf', 'Another/a.pdf')], folders, null, 0, true), /200 folders/);
  assert.equal(folders.length, 200);
});
test('plain file selection uses the chosen destination and never recreates relative folders', () => {
  const plan = planEvidenceUpload([file('a.pdf', 'Ignored/a.pdf')], [{ id: 'target', name: 'Target', parentId: null }], 'target', 0, false);
  assert.equal(plan.entries[0].folderId, 'target'); assert.equal(plan.folders.length, 0);
});

test('a named device location replaces the selected root and preserves only its nested contents', () => {
  const files = [file('one.pdf', 'Research/one.pdf'), file('two.txt', 'Research/Published/two.txt')];
  let id = 0;
  const plan = planNamedEvidenceUpload(files, [], 0, 'My research', true, null, () => `folder-${++id}`);
  assert.deepEqual(plan.folders, [
    { id: 'folder-1', name: 'My research', parentId: null, origin: 'upload' },
    { id: 'folder-2', name: 'Published', parentId: 'folder-1' },
  ]);
  assert.deepEqual(plan.entries.map(entry => entry.folderId), ['folder-1', 'folder-2']);
  assert.equal(plan.entries[0].file, files[0]);
  const sameName = planNamedEvidenceUpload([file('one.pdf', 'Research/one.pdf')], [], 0, 'Research', true);
  assert.equal(sameName.folders.length, 1);
});

test('named upload retries reuse the destination and existing descendants without counting confirmed files again', () => {
  const first = file('one.pdf', 'Research/Published/one.pdf');
  const second = file('two.pdf', 'Research/Published/two.pdf');
  let id = 0;
  const initial = planNamedEvidenceUpload([first, second], [], 198, 'Research', true, null, () => `folder-${++id}`);
  const retry = planNamedEvidenceUpload([second], initial.folders, 199, 'Research', true, initial.folder.id);
  assert.deepEqual(retry.folders, []); assert.equal(retry.entries.length, 1);
  assert.equal(retry.entries[0].folderId, initial.entries[1].folderId);
  assert.equal(retry.entries[0].file, second);
  assert.equal(sameUploadSelection([first, second], [first, second]), true);
  assert.equal(sameUploadSelection([first, { ...second }], [first, second]), false);
  assert.equal(sameUploadSelection([second], [first, second]), false);
});

test('named uploads reject invalid selections, collisions and excess folders before any destination is created', () => {
  const existing = [{ id: 'root', name: 'Research', parentId: null, origin: 'upload' as const }];
  const before = structuredClone(existing);
  assert.throws(() => planNamedEvidenceUpload([file('a.pdf')], existing, 0, 'research', false), /already exists/);
  assert.throws(() => planNamedEvidenceUpload([file('desktop.ini')], existing, 0, 'Other', false), /supported/);
  assert.throws(() => planNamedEvidenceUpload([], existing, 0, 'Other', false), /supported/);
  assert.throws(() => planNamedEvidenceUpload([file('a.pdf')], existing, 0, '../Other', false), /slashes/);
  assert.throws(() => planNamedEvidenceUpload([file('a.pdf')], existing, 0, 'Renamed', false, 'root'), /changed/);
  const full = Array.from({ length: 200 }, (_, i) => ({ id: `full-${i}`, name: `Folder ${i}`, parentId: null }));
  assert.throws(() => planNamedEvidenceUpload([file('a.pdf')], full, 0, 'Another', false), /200 folders/);
  assert.deepEqual(existing, before);
});

test('stripping a directory root never accepts traversal, malformed paths, or mixed source folders', () => {
  for (const path of ['../a.pdf', '/a.pdf', 'Docs//a.pdf', 'Docs/b.pdf', '', 'Docs\\a.pdf', './a.pdf']) {
    assert.throws(() => planNamedEvidenceUpload([file('a.pdf', path)], [], 0, 'Safe', true));
  }
  assert.throws(() => planNamedEvidenceUpload([file('a.pdf', 'First/a.pdf'), file('b.pdf', 'Second/b.pdf')], [], 0, 'Safe', true), /one folder/);
});
