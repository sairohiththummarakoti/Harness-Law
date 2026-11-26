import { env } from 'cloudflare:workers';
import { getAppUser } from '@/app/auth';
import { database } from '@/lib/api';
import { createEvidenceRepository } from '@/lib/evidence-d1';
import type { EvidenceStorageDependencies } from '@/lib/evidence-storage';

export function evidenceStorageDependencies(): EvidenceStorageDependencies {
  const bucket = env.BUCKET;
  return {
    getUser: getAppUser,
    ...createEvidenceRepository(database()),
    store: bucket ? {
      async putIfAbsent(key, bytes, metadata) {
        const stored = await bucket.put(key, bytes, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/octet-stream' }, customMetadata: { ...metadata, status: 'quarantine' } });
        if (!stored) {
          const existing = await bucket.head(key);
          if (!existing || existing.size !== bytes.byteLength || existing.customMetadata?.contentHash !== metadata.contentHash) throw new Error('Stored upload content did not match this retry.');
        }
      },
      async get(key) { const object = await bucket.get(key); return object ? { body: object.body, size: object.size } : null; },
      async delete(keys) { if (keys.length) await bucket.delete(keys); },
    } : undefined,
  };
}
