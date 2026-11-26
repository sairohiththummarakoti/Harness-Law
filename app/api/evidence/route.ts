import { env } from 'cloudflare:workers';
import { getAppUser } from '@/app/auth';
import { database, parseCase, readCase as readSavedCase } from '@/lib/api';
import { handleEvidenceRead, handleEvidenceUpload, type EvidenceObjectRow, type EvidenceStorageDependencies } from '@/lib/evidence-storage';

export const dynamic = 'force-dynamic';
type StoredRow = { id: string; owner_id: string; case_id: string; object_key: string; metadata_json: string; created_at: string };

function dependencies(): EvidenceStorageDependencies {
  async function readObject(ownerId: string, caseId: string, objectId: string): Promise<EvidenceObjectRow | null> {
    const row = await database().prepare('SELECT id, owner_id, case_id, object_key, metadata_json, created_at FROM evidence_objects WHERE id = ? AND owner_id = ? AND case_id = ?').bind(objectId, ownerId, caseId).first<StoredRow>();
    return row ? { id: row.id, ownerId: row.owner_id, caseId: row.case_id, objectKey: row.object_key, metadata: JSON.parse(row.metadata_json), createdAt: row.created_at } : null;
  }
  const bucket = env.BUCKET;
  return {
    getUser: getAppUser,
    repository: {
      async readCase(ownerId) { const row = await readSavedCase(ownerId); return row ? parseCase(row) : null; },
      readObject,
      async registerObject(row) {
        await database().prepare('INSERT OR IGNORE INTO evidence_objects (id, owner_id, case_id, object_key, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(row.id, row.ownerId, row.caseId, row.objectKey, JSON.stringify(row.metadata), row.createdAt).run();
        const registered = await readObject(row.ownerId, row.caseId, row.id);
        if (!registered) throw new Error('Upload metadata could not be saved.');
        return registered;
      },
      async saveCase(ownerId, caseId, expectedRevision, state) {
        const saved = await database().prepare('UPDATE cases SET revision = ?, state_json = ?, updated_at = ? WHERE owner_id = ? AND case_id = ? AND revision = ?').bind(state.revision, JSON.stringify(state), state.updatedAt, ownerId, caseId, expectedRevision).run();
        return saved.meta.changes === 1;
      },
    },
    store: bucket ? {
      async putIfAbsent(key, bytes, metadata) {
        const stored = await bucket.put(key, bytes, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/octet-stream' }, customMetadata: { ...metadata, status: 'quarantine' } });
        if (!stored) {
          const existing = await bucket.head(key);
          if (!existing || existing.size !== bytes.byteLength || existing.customMetadata?.contentHash !== metadata.contentHash) throw new Error('Stored upload content did not match this retry.');
        }
      },
      async get(key) { const object = await bucket.get(key); return object ? { body: object.body, size: object.size } : null; },
    } : undefined,
  };
}

export function POST(request: Request) { return handleEvidenceUpload(request, dependencies()); }
export function GET(request: Request) { return handleEvidenceRead(request, dependencies()); }
