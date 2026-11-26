import { env } from 'cloudflare:workers';
import { getAppUser } from '@/app/auth';
import { database } from '@/lib/api';
import { createEvidenceObjectCatalog, createEvidenceRepository } from '@/lib/evidence-d1';
import { createConfiguredEvidenceBlobStore } from '@/lib/evidence-blob-store';
import type { EvidenceStorageDependencies } from '@/lib/evidence-storage';

export function evidenceStorageDependencies(): EvidenceStorageDependencies {
  const db = database();
  return {
    getUser: getAppUser,
    ...createEvidenceRepository(db),
    store: createConfiguredEvidenceBlobStore(env as unknown as Record<string, unknown>, createEvidenceObjectCatalog(db)),
  };
}
