import test from 'node:test';
import assert from 'node:assert/strict';
import { planEvidenceUpload } from '../lib/evidence-upload-plan.ts';

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
