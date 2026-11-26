import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import test from 'node:test';
import { createEvidenceObjectCatalog, createEvidenceRepository } from '../lib/evidence-d1.ts';
import { applyAction, createEmptyCase, type CaseState } from '../lib/model.ts';
import { handleEvidenceDelete, type EvidenceDeletionJob, type EvidenceObjectRow, type EvidenceStorageDependencies } from '../lib/evidence-storage.ts';

const OWNER = 'test-owner', CASE = 'test-case', AT = '2026-11-26T12:00:00.000Z';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of ['0000_same_leopardon.sql', '0004_dear_stingray.sql']) sqlite.exec(readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), 'utf8'));
  const tracker = { failAt: -1 };
  type Statement = { bind(...args: SQLInputValue[]): Statement; first(): Promise<unknown>; run(): Promise<unknown>; all(): Promise<unknown> };
  const statement = (sql: string, args: SQLInputValue[] = []): Statement => ({
    bind(...bound) { return statement(sql, bound); },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async run() { const result = sqlite.prepare(sql).run(...args); return { success: true, meta: { changes: Number(result.changes) } }; },
    async all() { return { success: true, results: sqlite.prepare(sql).all(...args) }; },
  });
  const db = {
    prepare: statement,
    async batch(statements: Statement[]) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const [index, query] of statements.entries()) {
          if (index === tracker.failAt) throw new Error('Injected D1 transaction failure');
          results.push(await query.run());
        }
        sqlite.exec('COMMIT'); return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } as unknown as D1Database;
  const adapter = createEvidenceRepository(db), repository = adapter.repository, deletions = adapter.deletions!;
  const state = createEmptyCase(); state.id = CASE; state.consent = true;
  sqlite.prepare('INSERT INTO cases (owner_id, case_id, revision, state_json, updated_at) VALUES (?, ?, ?, ?, ?)').run(OWNER, CASE, 0, JSON.stringify(state), AT);
  return { sqlite, tracker, repository, deletions, state, catalog: createEvidenceObjectCatalog(db) };
}

function object(id: string, replacement: string | null = null): EvidenceObjectRow {
  return { id, ownerId: OWNER, caseId: CASE, objectKey: `quarantine/${OWNER}/${id}`, createdAt: AT, metadata: { id, objectId: id, name: `${id}.txt`, bytes: 3, kind: 'TXT', version: 1, status: 'needs_attention', language: 'Not extracted', pages: 0, excerpt: '', associations: [], exhibit: '', uploadedAt: AT, sample: false, previousVersions: [], contentHash: 'a'.repeat(64), uploadReplacementSourceId: replacement } };
}

async function seedSource(f: ReturnType<typeof fixture>) {
  const original = object('original'); assert.ok(await f.repository.registerObject(original, 0));
  const { contentHash: _hash, uploadReplacementSourceId: _replacement, ...document } = original.metadata;
  const state = applyAction(f.state, { type: 'add_document', document }); state.revision = 1;
  assert.equal(await f.repository.saveCase(OWNER, CASE, 0, state), true);
  return { original, state };
}

function deletion(state: CaseState): { job: EvidenceDeletionJob; next: CaseState } {
  const target = { kind: 'file' as const, id: 'original' };
  const job: EvidenceDeletionJob = { id: 'deletion-job', ownerId: OWNER, caseId: CASE, target, expectedRevision: state.revision, objectKeys: ['quarantine/test-owner/original'], deletedFiles: 1, deletedFolders: 0, createdAt: AT, completedAt: null };
  const next = applyAction(state, { type: 'delete_evidence', target }); next.revision = state.revision + 1;
  return { job, next };
}

test('D1 deletion snapshots late registered replacements in the transaction and blocks later reservations', async t => {
  const f = fixture(); t.after(() => f.sqlite.close()); const { original, state } = await seedSource(f);
  const initial = await f.deletions.sourceObjects(OWNER, CASE, ['original'], ['original']); assert.equal(initial.length, 1);
  const late = object('late-replacement', 'original'); assert.ok(await f.repository.registerObject(late, 1));
  // A different account's similar metadata must never enter the deletion job.
  const foreign = { ...object('foreign', 'original'), ownerId: 'other', caseId: 'other-case' };
  f.sqlite.prepare('INSERT INTO evidence_objects (id, owner_id, case_id, object_key, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(foreign.id, foreign.ownerId, foreign.caseId, foreign.objectKey, JSON.stringify(foreign.metadata), AT);
  const { job, next } = deletion(state);
  assert.equal(await f.deletions.commit(job, ['original'], initial.map(row => row.id), next), true);
  const saved = await f.deletions.readJob(OWNER, CASE, job.id);
  assert.deepEqual(saved?.objectKeys.sort(), [original.objectKey, late.objectKey].sort());
  assert.ok((await f.repository.readObject(OWNER, CASE, late.id))?.deletedAt);
  assert.equal(f.sqlite.prepare('SELECT deleted_at FROM evidence_objects WHERE id = ?').get('foreign')?.deleted_at, null);
  assert.equal(await f.repository.registerObject(object('after-deletion', 'original'), 1), null);
  assert.equal(await f.repository.registerObject(object('after-deletion', 'original'), 2), null);
  assert.ok((await f.repository.registerObject(late, 1))?.deletedAt, 'old reservations still return tombstones for safe retry');
  assert.ok(await f.repository.registerObject(object('new-independent-upload'), 2));
});

test('D1 stale revision and failed transaction cannot partially tombstone files or reserve jobs', async t => {
  const f = fixture(); t.after(() => f.sqlite.close()); const { state } = await seedSource(f); const { job, next } = deletion(state);
  f.tracker.failAt = 2;
  await assert.rejects(() => f.deletions.commit(job, ['original'], ['original'], next));
  assert.equal(await f.deletions.readJob(OWNER, CASE, job.id), null); assert.equal((await f.repository.readCase(OWNER))?.revision, 1);
  assert.equal((await f.repository.readObject(OWNER, CASE, 'original'))?.deletedAt, null);
  f.tracker.failAt = -1; const changed = { ...state, revision: 2, name: 'Concurrent edit' }; await f.repository.saveCase(OWNER, CASE, 1, changed);
  assert.equal(await f.deletions.commit(job, ['original'], ['original'], next), false);
  assert.equal(await f.deletions.readJob(OWNER, CASE, job.id), null); assert.equal((await f.repository.readObject(OWNER, CASE, 'original'))?.deletedAt, null);
});

test('DELETE handler cleans the committed D1 key list, including objects absent from its preflight query', async t => {
  const f = fixture(); t.after(() => f.sqlite.close()); const { original } = await seedSource(f);
  const blobs = new Set([original.objectKey]), late = object('registered-after-query', 'original');
  const deps: EvidenceStorageDependencies = {
    getUser: async () => ({ userId: OWNER }), repository: f.repository,
    deletions: { ...f.deletions, async sourceObjects(...args) {
      const selected = await f.deletions.sourceObjects(...args);
      assert.ok(await f.repository.registerObject(late, 1)); blobs.add(late.objectKey);
      return selected;
    } },
    store: { async putIfAbsent() {}, async get() { return null; }, async delete(keys) { for (const key of keys) blobs.delete(key); } },
  };
  const request = new Request('https://app.test/api/evidence', { method: 'DELETE', headers: { 'Content-Type': 'application/json', Origin: 'https://app.test', 'X-Harness-Account': OWNER }, body: JSON.stringify({ caseId: CASE, expectedRevision: 1, deletionId: 'a6a09c67-67a8-443e-a2e0-54f968323104', target: { kind: 'file', id: 'original' } }) });
  const response = await handleEvidenceDelete(request, deps);
  assert.equal(response.status, 200); assert.equal((await response.json() as {cleanupPending: boolean}).cleanupPending, false);
  assert.equal(blobs.size, 0); assert.ok((await f.repository.readObject(OWNER, CASE, late.id))?.deletedAt);
});

test('D1 empty folder deletion stores an empty JSON key list and can complete cleanup', async t => {
  const f = fixture(); t.after(() => f.sqlite.close()); f.state.folders = [{ id: 'empty', parentId: null, name: 'Empty' }];
  f.sqlite.prepare('UPDATE cases SET state_json = ? WHERE owner_id = ?').run(JSON.stringify(f.state), OWNER);
  const target = { kind: 'folder' as const, id: 'empty' }, next = applyAction(f.state, { type: 'delete_evidence', target }); next.revision = 1;
  const job: EvidenceDeletionJob = { id: 'empty-job', ownerId: OWNER, caseId: CASE, target, expectedRevision: 0, objectKeys: [], deletedFiles: 0, deletedFolders: 1, createdAt: AT, completedAt: null };
  assert.equal(await f.deletions.commit(job, [], [], next), true);
  assert.deepEqual((await f.deletions.readJob(OWNER, CASE, job.id))?.objectKeys, []);
  await f.deletions.complete(job); assert.equal((await f.deletions.pendingJobs(OWNER)).length, 0);
});

test('D1 storage catalogue pins versions once and retains late receipts only after tombstoning', async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const original = object('s3-original'); original.objectKey = 's3:users/owner/Awards/files/folder/original'; original.metadata.storageBackend = 's3';
  await f.repository.registerObject(original, 0);
  await f.catalog.pinS3Version(original, 'v1', 'a'.repeat(64));
  await f.catalog.pinS3Version(original, 'v1', 'a'.repeat(64));
  assert.deepEqual((await f.catalog.read(original.objectKey))?.metadata.storageVersions, ['v1']);
  await assert.rejects(f.catalog.pinS3Version(original, 'v2', 'a'.repeat(64)));
  await assert.rejects(f.catalog.pinS3Version(original, 'v1', 'b'.repeat(64)));
  await assert.rejects(f.catalog.pinS3Version({ ...original, ownerId: 'other' }, 'v1', 'a'.repeat(64)));
  f.sqlite.prepare('UPDATE evidence_objects SET deleted_at=? WHERE id=?').run(AT, original.id);
  await f.catalog.pinS3Version(original, 'v2', 'a'.repeat(64));
  const stored = await f.catalog.read(original.objectKey);
  assert.equal(stored?.metadata.storageVersion, 'v1'); assert.deepEqual(stored?.metadata.storageVersions, ['v1', 'v2']);
});

test('D1 legacy backend discovery is durable and cannot change an explicit backend', async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const original = object('legacy'); original.objectKey = 'users/legacy-user/evidence.txt';
  await f.repository.registerObject(original, 0);
  await f.catalog.pinR2Backend(original); await f.catalog.pinR2Backend(original);
  assert.equal((await f.catalog.read(original.objectKey))?.metadata.storageBackend, 'r2');
  await assert.rejects(f.catalog.pinS3Version(original, 'v1', 'a'.repeat(64)));
});

test('D1 rename changes metadata and case together while preserving storage and original upload name', async t => {
  const f = fixture(); t.after(() => f.sqlite.close()); const original = object('rename-original');
  await f.repository.registerObject(original, 0);
  const { contentHash: _hash, uploadReplacementSourceId: _replacement, ...document } = original.metadata;
  const state = structuredClone(f.state); state.documents = [document]; state.revision = 1;
  assert.equal(await f.repository.saveCase(OWNER, CASE, 0, state), true);
  const next = structuredClone(state); next.documents[0].name = 'renamed.txt'; next.revision = 2;
  assert.equal(await f.repository.renameObject!(OWNER, CASE, original.id, 1, 'renamed.txt', next), true);
  const stored = await f.repository.readObject(OWNER, CASE, original.id);
  assert.equal(stored?.metadata.name, 'renamed.txt'); assert.equal(stored?.metadata.uploadOriginalName, 'rename-original.txt'); assert.equal(stored?.objectKey, original.objectKey);
  assert.equal((await f.repository.readCase(OWNER))?.documents[0].name, 'renamed.txt');
  const stale = structuredClone(next); stale.documents[0].name = 'stale.txt';
  assert.equal(await f.repository.renameObject!(OWNER, CASE, original.id, 1, 'stale.txt', stale), false);
  assert.equal((await f.repository.readObject(OWNER, CASE, original.id))?.metadata.name, 'renamed.txt');
});

test('D1 rename transaction rolls back metadata when its case update fails', async t => {
  const f = fixture(); t.after(() => f.sqlite.close()); const original = object('rename-rollback'); await f.repository.registerObject(original, 0);
  const { contentHash: _hash, uploadReplacementSourceId: _replacement, ...document } = original.metadata;
  const state = structuredClone(f.state); state.documents = [document]; state.revision = 1;
  await f.repository.saveCase(OWNER, CASE, 0, state);
  const next = structuredClone(state); next.revision = 2; next.documents[0].name = 'renamed.txt';
  f.tracker.failAt = 1;
  await assert.rejects(f.repository.renameObject!(OWNER, CASE, original.id, 1, 'renamed.txt', next));
  assert.equal((await f.repository.readObject(OWNER, CASE, original.id))?.metadata.name, 'rename-rollback.txt');
  assert.equal((await f.repository.readCase(OWNER))?.revision, 1);
});

test('D1 cleanup cannot finish while a late S3 version remains and pinning atomically requeues completed cleanup', async t => {
  const f = fixture(); t.after(() => f.sqlite.close()); const { original, state } = await seedSource(f);
  await f.catalog.pinS3Version(original, 'v1', 'a'.repeat(64));
  const { job, next } = deletion(state);
  assert.equal(await f.deletions.commit(job, ['original'], ['original'], next), true);
  assert.equal(await f.deletions.complete(job), false);
  await f.catalog.markS3VersionDeleted(original, 'v1');
  assert.equal(await f.deletions.complete(job), true);
  assert.ok((await f.deletions.readJob(OWNER, CASE, job.id))?.completedAt);
  await f.catalog.pinS3Version(original, 'v2', 'a'.repeat(64));
  assert.equal((await f.deletions.readJob(OWNER, CASE, job.id))?.completedAt, null);
  assert.equal(await f.deletions.complete(job), false);
  await f.catalog.markS3VersionDeleted(original, 'v2');
  assert.equal(await f.deletions.complete(job), true);
});
