import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfiguredEvidenceBlobStore, createEvidenceBlobStore, type EvidenceObjectCatalog } from '../lib/evidence-blob-store.ts';
import { createEmptyCase } from '../lib/model.ts';
import { evidenceObjectLocation, type EvidenceObjectRow } from '../lib/evidence-storage.ts';
import type { ObjectStore, StoredObject } from '../lib/integrations/provider-contracts.ts';
import { ProviderError, sha256 } from '../lib/integrations/providers.ts';

const bytes = new TextEncoder().encode('synthetic evidence');
const hash = await sha256(bytes);
const key = 's3:users/owner/Awards/files/folder/upload-id-proof.txt';
function row(locator = key): EvidenceObjectRow {
  return { id: 'upload-id', ownerId: 'owner', caseId: 'case', objectKey: locator, createdAt: '2026-11-26T12:00:00.000Z', metadata: {
    id: 'upload-id', objectId: 'upload-id', name: 'proof.txt', bytes: bytes.length, version: 1, kind: 'TXT', status: 'needs_attention', language: 'Not extracted', pages: 0, excerpt: '', associations: [], exhibit: '', uploadedAt: '2026-11-26T12:00:00.000Z', sample: false, contentHash: hash, uploadReplacementSourceId: null,
    ...(locator.startsWith('s3:') ? { storageBackend: 's3' as const } : {}),
  } };
}
function fixture(locator = key) {
  const current = row(locator), receipts: string[] = [], reads: string[] = [], removals: string[] = [];
  const s3Objects = new Map<string, StoredObject & { bytes: Uint8Array }>();
  const r2Objects = new Map<string, { bytes: Uint8Array; hash?: string }>();
  const hooks = { afterPut: undefined as (() => void) | undefined, failDelete: false, s3Puts: 0 };
  const catalog: EvidenceObjectCatalog = {
    async read(value) { return value === current.objectKey ? structuredClone(current) : null; },
    async pinS3Version(record, version, digest) {
      assert.equal(record.id, current.id); assert.equal(digest, current.metadata.contentHash);
      if (current.metadata.storageVersion && current.metadata.storageVersion !== version && !current.deletedAt) throw new Error('Version changed');
      current.metadata.storageBackend = 's3'; current.metadata.storageVersion ||= version;
      current.metadata.storageVersions = [...new Set([...(current.metadata.storageVersions || []), version])]; receipts.push(version);
    },
    async pinR2Backend() { assert.notEqual(current.metadata.storageBackend, 's3'); current.metadata.storageBackend = 'r2'; },
    async markS3VersionDeleted(_row, version) { current.metadata.storageDeletedVersions = [...new Set([...(current.metadata.storageDeletedVersions || []), version])]; },
  };
  const s3: ObjectStore = {
    async put(value, data, contentType) {
      const existing = [...s3Objects.values()].find(item => item.key === value);
      if (existing) { assert.equal(existing.sha256, await sha256(data)); return existing; }
      const stored = { key: value, bytes: data.slice(), version: `v${++hooks.s3Puts}`, sha256: await sha256(data), size: data.length, contentType };
      s3Objects.set(stored.version, stored); hooks.afterPut?.(); return stored;
    },
    async get(value, version) {
      reads.push(`s3:${value}:${version || 'latest'}`);
      const stored = [...s3Objects.values()].find(item => item.key === value && (!version || item.version === version));
      if (!stored) throw new ProviderError('object_unavailable', 'Not found', 404);
      return stored;
    },
    async delete(value, version) {
      assert.ok(version, 'S3 deletion must name an exact version');
      if (hooks.failDelete) throw new Error('Synthetic deletion outage');
      removals.push(`s3:${value}:${version}`); s3Objects.delete(version);
    },
  };
  const bucket = {
    async get(value: string) { reads.push(`r2:${value}`); const stored = r2Objects.get(value); return stored ? { body: new Response(stored.bytes.slice().buffer).body!, size: stored.bytes.length, customMetadata: { contentHash: stored.hash } } : null; },
    async head(value: string) { const stored = r2Objects.get(value); return stored ? { size: stored.bytes.length, customMetadata: { contentHash: stored.hash } } : null; },
    async put(value: string, data: ArrayBuffer, options: { customMetadata: { contentHash: string } }) {
      if (r2Objects.has(value)) return null;
      r2Objects.set(value, { bytes: new Uint8Array(data.slice(0)), hash: options.customMetadata.contentHash }); return { key: value };
    },
    async delete(value: string) { removals.push(`r2:${value}`); r2Objects.delete(value); },
  } as unknown as R2Bucket;
  const store = createEvidenceBlobStore({ bucket, s3, catalog, preferS3: true });
  return { current, receipts, reads, removals, s3Objects, r2Objects, hooks, catalog, s3, bucket, store };
}
const payload = () => bytes.slice().buffer;
const metadata = { owner: 'owner', caseId: 'case', contentHash: hash };

test('S3 folder locators use readable names and collision-safe owner, folder and upload identities', async () => {
  const state = createEmptyCase(); state.id = 'case';
  state.folders = [{ id: 'a', name: 'My Awards', parentId: null }, { id: 'b', name: 'My Awards', parentId: 'a' }];
  const owner = 'a'.repeat(64), upload = 'upload-' + 'b'.repeat(64);
  const first = await evidenceObjectLocation(state, owner, upload, 'a', 'résumé 2026.pdf', 's3');
  const second = await evidenceObjectLocation(state, owner, upload, 'b', 'résumé 2026.pdf', 's3');
  assert.match(first, /^s3:users\/[a-f0-9]{64}\/My-Awards\/files\/[a-f0-9]{64}\/upload-[a-f0-9]{64}-resume-2026.pdf$/);
  assert.notEqual(first, second);
  assert.equal(await evidenceObjectLocation(state, owner, upload, null, 'file.pdf', 'r2'), `quarantine/${owner}/${upload}`);
  await assert.rejects(evidenceObjectLocation(state, owner, upload, 'missing', 'file.pdf', 's3'));
});

test('new S3 upload retries pin one immutable version and reads/deletes use that version', async () => {
  const f = fixture();
  await f.store.putIfAbsent(key, payload(), metadata);
  await f.store.putIfAbsent(key, payload(), metadata);
  assert.equal(f.hooks.s3Puts, 1); assert.deepEqual(f.current.metadata.storageVersions, ['v1']);
  assert.equal(new TextDecoder().decode((await f.store.get(key))!.body as ArrayBuffer), 'synthetic evidence');
  assert.deepEqual(f.reads, ['s3:users/owner/Awards/files/folder/upload-id-proof.txt:v1']);
  await f.store.delete!([key]); await f.store.delete!([key]);
  assert.equal(f.s3Objects.size, 0); assert.ok(f.removals.every(value => value.endsWith(':v1')));
});

test('R2 originals remain readable and replaceable after S3 is enabled without probing S3', async () => {
  const old = 'quarantine/owner/upload-id', f = fixture(old);
  await f.store.putIfAbsent(old, payload(), metadata);
  assert.equal(f.r2Objects.size, 1); assert.equal(f.s3Objects.size, 0);
  assert.equal((await f.store.get(old))!.size, bytes.length);
  await f.store.delete!([old]);
  assert.deepEqual(f.reads, [`r2:${old}`]); assert.deepEqual(f.removals, [`r2:${old}`]);
});

test('unmarked legacy users S3 imports are discovered only after R2 misses and then pinned', async () => {
  const old = 'users/old-owner/My-Awards/old-proof.txt', f = fixture(old);
  await f.s3.put(old, bytes, 'application/octet-stream');
  assert.equal((await f.store.get(old))!.size, bytes.length);
  assert.equal(f.current.metadata.storageBackend, 's3'); assert.equal(f.current.metadata.storageVersion, 'v1');
  await f.store.get(old);
  assert.deepEqual(f.reads, [`r2:${old}`, `s3:${old}:latest`, `s3:${old}:v1`]);
});

test('legacy users R2 discovery persists its backend so lost delete responses are safe without S3', async () => {
  const old = 'users/old-owner/old-proof.txt', f = fixture(old);
  f.r2Objects.set(old, { bytes, hash });
  const store = createEvidenceBlobStore({ bucket: f.bucket, catalog: f.catalog });
  await store.delete!([old]); await store.delete!([old]);
  assert.equal(f.current.metadata.storageBackend, 'r2'); assert.equal(f.r2Objects.size, 0);
  assert.deepEqual(f.removals, [`r2:${old}`, `r2:${old}`]);
});

test('missing S3 or incomplete configuration never silently routes new S3 uploads to R2', async () => {
  const f = fixture();
  const store = createConfiguredEvidenceBlobStore({ HARNESS_S3_BUCKET: 'synthetic-bucket', BUCKET: f.bucket }, f.catalog)!;
  assert.equal(store.uploadBackend, 's3');
  await assert.rejects(store.putIfAbsent(key, payload(), metadata));
  await assert.rejects(store.get(key)); await assert.rejects(store.delete!([key]));
  assert.equal(f.r2Objects.size, 0);
});

test('late S3 upload during deletion records and removes its exact returned version', async () => {
  const f = fixture();
  f.hooks.afterPut = () => { f.current.deletedAt = '2026-11-26T13:00:00Z'; };
  await assert.rejects(f.store.putIfAbsent(key, payload(), metadata));
  assert.deepEqual(f.current.metadata.storageVersions, ['v1']); assert.equal(f.s3Objects.size, 0);
  assert.equal(await f.store.get(key), null);
});

test('failed late S3 deletion preserves all known versions for durable retry', async () => {
  const f = fixture();
  f.hooks.afterPut = () => { f.current.deletedAt = '2026-11-26T13:00:00Z'; f.hooks.failDelete = true; };
  await assert.rejects(f.store.putIfAbsent(key, payload(), metadata));
  assert.equal(f.s3Objects.size, 1); assert.deepEqual(f.current.metadata.storageVersions, ['v1']);
  f.hooks.failDelete = false; await f.store.delete!([key]); assert.equal(f.s3Objects.size, 0);
});

test('storage adapter rejects unknown reservations and mismatched retry bytes before writes', async () => {
  const f = fixture();
  await assert.rejects(f.store.putIfAbsent('s3:other/key', payload(), metadata));
  await assert.rejects(f.store.putIfAbsent(key, payload(), { ...metadata, contentHash: '0'.repeat(64) }));
  await assert.rejects(f.store.putIfAbsent(key, new ArrayBuffer(1), metadata));
  assert.equal(f.hooks.s3Puts, 0);
});
