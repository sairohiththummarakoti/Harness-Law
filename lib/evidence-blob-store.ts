import type { EvidenceBlobStore, EvidenceObjectRow } from './evidence-storage.ts';
import { MAX_FILE_BYTES } from './validation.ts';
import { createS3Store, ProviderError } from './integrations/providers.ts';
import { loadIntegrationConfig } from './integrations/config.ts';
import type { ObjectStore } from './integrations/provider-contracts.ts';

export interface EvidenceObjectCatalog {
  read(key: string): Promise<EvidenceObjectRow | null>;
  pinS3Version(row: EvidenceObjectRow, version: string, contentHash: string): Promise<void>;
  pinR2Backend(row: EvidenceObjectRow): Promise<void>;
  markS3VersionDeleted(row: EvidenceObjectRow, version: string): Promise<void>;
}
interface BlobStoreOptions {
  bucket?: R2Bucket;
  s3?: ObjectStore;
  catalog: EvidenceObjectCatalog;
  /** True also for incomplete S3 configuration: new uploads must not silently fall back. */
  preferS3?: boolean;
}
const missing = (error: unknown) => error instanceof ProviderError && error.code === 'object_unavailable' && error.status === 404;
const unavailable = () => new Error('The private evidence storage backend is unavailable.');
export function createConfiguredEvidenceBlobStore(bindings: Record<string, unknown>, catalog: EvidenceObjectCatalog): EvidenceBlobStore | undefined {
  const names = ['HARNESS_S3_BUCKET', 'HARNESS_S3_REGION', 'HARNESS_S3_ACCESS_KEY_ID', 'HARNESS_S3_SECRET_ACCESS_KEY', 'HARNESS_S3_SESSION_TOKEN'];
  const settings = Object.fromEntries(names.map(name => [name, bindings[name]]));
  const preferS3 = Object.values(settings).some(value => typeof value === 'string' && value.length > 0);
  const bucket = bindings.BUCKET as R2Bucket | undefined;
  if (!preferS3 && !bucket) return undefined;
  let s3: ObjectStore | undefined;
  try {
    const config = loadIntegrationConfig(settings).s3;
    if (config) s3 = createS3Store(config, { maxObjectBytes: MAX_FILE_BYTES });
  } catch { /* Keep legacy R2 reads available; S3 writes fail closed below. */ }
  return createEvidenceBlobStore({ bucket, s3, catalog, preferS3 });
}
function backend(row: EvidenceObjectRow): 's3' | 'r2' | 'legacy-users' {
  if (row.objectKey.startsWith('s3:')) {
    if (row.metadata.storageBackend && row.metadata.storageBackend !== 's3') throw new Error('Evidence backend mismatch.');
    return 's3';
  }
  if (row.metadata.storageBackend) return row.metadata.storageBackend;
  // The retired Drive importer wrote users/... without recording its backend.
  // Only that known legacy namespace may probe S3 after a missing R2 object.
  if (row.objectKey.startsWith('users/')) return 'legacy-users';
  if (row.objectKey.startsWith('quarantine/')) return 'r2';
  throw new Error('Unknown evidence storage locator.');
}
const objectKey = (row: EvidenceObjectRow) => row.objectKey.startsWith('s3:') ? row.objectKey.slice(3) : row.objectKey;
function verifyObject(row: EvidenceObjectRow, size: number, hash?: string) {
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_FILE_BYTES || size !== row.metadata.bytes ||
      (row.metadata.contentHash && hash !== row.metadata.contentHash)) throw new Error('Stored evidence failed integrity verification.');
}

/** R2 originals and S3 originals coexist; the durable locator, never current config, selects reads/deletes. */
export function createEvidenceBlobStore({ bucket, s3, catalog, preferS3 }: BlobStoreOptions): EvidenceBlobStore {
  async function rowFor(key: string) {
    const row = await catalog.read(key);
    if (!row || row.objectKey !== key) throw new Error('Evidence storage reservation is missing.');
    return row;
  }
  async function readS3(row: EvidenceObjectRow) {
    if (!s3) throw unavailable();
    let stored;
    try { stored = await s3.get(objectKey(row), row.metadata.storageVersion); }
    catch (error) { if (missing(error)) return null; throw error; }
    verifyObject(row, stored.size, stored.sha256);
    await catalog.pinS3Version(row, stored.version, stored.sha256);
    return stored;
  }
  async function readR2(row: EvidenceObjectRow) {
    if (!bucket) throw unavailable();
    const object = await bucket.get(row.objectKey);
    if (!object) return null;
    try { verifyObject(row, object.size, object.customMetadata?.contentHash); }
    catch (error) { await object.body.cancel(); throw error; }
    return { body: object.body, size: object.size };
  }
  async function removeS3(row: EvidenceObjectRow) {
    if (!s3) throw unavailable();
    const versions = new Set([...(row.metadata.storageVersions || []), ...(row.metadata.storageVersion ? [row.metadata.storageVersion] : [])]);
    if (!versions.size) {
      const stored = await readS3(row);
      if (!stored) return;
      versions.add(stored.version);
    }
    for (const version of versions) {
      await s3.delete(objectKey(row), version);
      await catalog.markS3VersionDeleted(row, version);
    }
  }
  return {
    uploadBackend: preferS3 || s3 ? 's3' : 'r2',
    async putIfAbsent(key, bytes, metadata) {
      const row = await rowFor(key), selected = backend(row);
      if (row.deletedAt) throw new Error('Evidence was deleted.');
      if (row.caseId !== metadata.caseId || row.metadata.contentHash !== metadata.contentHash || row.metadata.bytes !== bytes.byteLength || bytes.byteLength > MAX_FILE_BYTES) throw new Error('Upload does not match the storage reservation.');
      if (selected === 'legacy-users') throw new Error('A legacy cloud import cannot be reused as a new upload reservation.');
      if (selected === 's3') {
        if (!s3) throw unavailable();
        const stored = await s3.put(objectKey(row), new Uint8Array(bytes), 'application/octet-stream');
        verifyObject(row, stored.size, stored.sha256);
        try {
          await catalog.pinS3Version(row, stored.version, stored.sha256);
          if ((await rowFor(key)).deletedAt) {
            await s3.delete(objectKey(row), stored.version);
            throw new Error('Evidence was deleted during upload.');
          }
        } catch (error) {
          // Each late writer removes its own returned version, including when a
          // previous cleanup had already deleted an earlier version of the key.
          if ((await rowFor(key)).deletedAt) await s3.delete(objectKey(row), stored.version);
          throw error;
        }
      } else {
        if (!bucket) throw unavailable();
        const stored = await bucket.put(key, bytes, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/octet-stream' }, customMetadata: { ...metadata, status: 'quarantine' } });
        if (!stored) {
          const existing = await bucket.head(key);
          if (!existing || existing.size !== bytes.byteLength || existing.customMetadata?.contentHash !== metadata.contentHash) throw new Error('Stored upload content did not match this retry.');
        }
      }
    },
    async get(key) {
      const row = await rowFor(key), selected = backend(row);
      if (row.deletedAt) return null;
      if (selected === 'r2') return readR2(row);
      if (selected === 'legacy-users' && bucket) {
        const object = await readR2(row);
        if (object) {
          try { await catalog.pinR2Backend(row); }
          catch (error) { await object.body.cancel(); throw error; }
          return object;
        }
      }
      const stored = await readS3(row);
      return stored ? { body: stored.bytes.buffer.slice(stored.bytes.byteOffset, stored.bytes.byteOffset + stored.bytes.byteLength) as ArrayBuffer, size: stored.size } : null;
    },
    async delete(keys) {
      for (const key of [...new Set(keys)]) {
        const row = await rowFor(key), selected = backend(row);
        if (selected === 's3') await removeS3(row);
        else if (selected === 'r2') {
          if (!bucket) throw unavailable();
          await bucket.delete(key);
        } else {
          // Legacy keys were immutable and unique. Delete R2 when it exists;
          // otherwise reconcile S3. Never declare cleanup complete without the
          // backend needed to disambiguate a missing legacy object.
          const r2Object = bucket ? await bucket.head(key) : null;
          if (r2Object) {
            verifyObject(row, r2Object.size, r2Object.customMetadata?.contentHash);
            await catalog.pinR2Backend(row);
            await bucket!.delete(key);
          }
          else await removeS3(row);
        }
      }
    },
  };
}
