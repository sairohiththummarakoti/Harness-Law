import type { EvidenceDeletionJob, EvidenceObjectRow, EvidenceStorageDependencies } from './evidence-storage.ts';

type StoredRow = { id: string; owner_id: string; case_id: string; object_key: string; metadata_json: string; created_at: string; deleted_at: string | null };
type JobRow = { id: string; owner_id: string; case_id: string; target_kind: 'file' | 'folder'; target_id: string; expected_revision: number; object_keys_json: string; deleted_files: number; deleted_folders: number; created_at: string; completed_at: string | null };
const objectRow = (row: StoredRow): EvidenceObjectRow => ({ id: row.id, ownerId: row.owner_id, caseId: row.case_id, objectKey: row.object_key, metadata: JSON.parse(row.metadata_json), createdAt: row.created_at, deletedAt: row.deleted_at });
const jobRow = (row: JobRow): EvidenceDeletionJob => ({ id: row.id, ownerId: row.owner_id, caseId: row.case_id, target: { kind: row.target_kind, id: row.target_id }, expectedRevision: row.expected_revision, objectKeys: JSON.parse(row.object_keys_json), deletedFiles: row.deleted_files, deletedFolders: row.deleted_folders, createdAt: row.created_at, completedAt: row.completed_at });

export function createEvidenceRepository(db: D1Database): Pick<EvidenceStorageDependencies, 'repository' | 'deletions'> {
  async function readObject(ownerId: string, caseId: string, objectId: string): Promise<EvidenceObjectRow | null> {
    const row = await db.prepare('SELECT * FROM evidence_objects WHERE id = ? AND owner_id = ? AND case_id = ?').bind(objectId, ownerId, caseId).first<StoredRow>();
    return row ? objectRow(row) : null;
  }
  async function readJob(ownerId: string, caseId: string, id: string) {
    const row = await db.prepare('SELECT * FROM evidence_deletions WHERE id = ? AND owner_id = ? AND case_id = ?').bind(id, ownerId, caseId).first<JobRow>();
    return row ? jobRow(row) : null;
  }
  return {
    repository: {
      async readCase(ownerId) { const row = await db.prepare('SELECT state_json, revision FROM cases WHERE owner_id = ?').bind(ownerId).first<{ state_json: string; revision: number }>(); return row ? { ...JSON.parse(row.state_json), revision: row.revision } : null; },
      readObject,
      async registerObject(row, expectedRevision) {
        const replacementId = row.metadata.uploadReplacementSourceId;
        // Reserve only while the same case revision and replacement source are
        // live. An already reserved ID still returns normally for idempotent retries.
        await db.prepare(`INSERT OR IGNORE INTO evidence_objects (id, owner_id, case_id, object_key, metadata_json, created_at)
          SELECT ?, ?, ?, ?, ?, ? FROM cases WHERE owner_id = ? AND case_id = ? AND revision = ?
          AND (? IS NULL OR EXISTS (SELECT 1 FROM json_each(cases.state_json, '$.documents') document
            JOIN evidence_objects source ON source.id = json_extract(document.value, '$.objectId')
            WHERE json_extract(document.value, '$.id') = ? AND json_extract(document.value, '$.sample') = 0
            AND source.owner_id = cases.owner_id AND source.case_id = cases.case_id AND source.deleted_at IS NULL))`)
          .bind(row.id, row.ownerId, row.caseId, row.objectKey, JSON.stringify(row.metadata), row.createdAt, row.ownerId, row.caseId, expectedRevision, replacementId, replacementId).run();
        return readObject(row.ownerId, row.caseId, row.id);
      },
      async saveCase(ownerId, caseId, expectedRevision, state) {
        const saved = await db.prepare('UPDATE cases SET revision = ?, state_json = ?, updated_at = ? WHERE owner_id = ? AND case_id = ? AND revision = ?').bind(state.revision, JSON.stringify(state), state.updatedAt, ownerId, caseId, expectedRevision).run();
        return saved.meta.changes === 1;
      },
    },
    deletions: {
      readJob,
      async pendingJobs(ownerId) {
        const rows = await db.prepare('SELECT * FROM evidence_deletions WHERE owner_id = ? AND completed_at IS NULL ORDER BY created_at LIMIT 5').bind(ownerId).all<JobRow>();
        return rows.results.map(jobRow);
      },
      async sourceObjects(ownerId, caseId, sourceIds, objectIds) {
        if (!sourceIds.length && !objectIds.length) return [];
        const rows = await db.prepare("SELECT * FROM evidence_objects WHERE owner_id = ? AND case_id = ? AND (id IN (SELECT value FROM json_each(?)) OR id IN (SELECT value FROM json_each(?)) OR json_extract(metadata_json, '$.uploadReplacementSourceId') IN (SELECT value FROM json_each(?)))").bind(ownerId, caseId, JSON.stringify(sourceIds), JSON.stringify(objectIds), JSON.stringify(sourceIds)).all<StoredRow>();
        return rows.results.map(objectRow);
      },
      async commit(job, sourceIds, objectIds, state) {
        // D1 batch is a transaction: reserve the job against this revision,
        // compare-and-swap the case, and tombstone only the job's objects.
        const result = await db.batch([
          db.prepare(`INSERT OR IGNORE INTO evidence_deletions (id, owner_id, case_id, target_kind, target_id, expected_revision, object_keys_json, deleted_files, deleted_folders, created_at)
            SELECT ?, ?, ?, ?, ?, ?, (SELECT json_group_array(DISTINCT object_key) FROM evidence_objects
              WHERE owner_id = ? AND case_id = ? AND (id IN (SELECT value FROM json_each(?))
                OR id IN (SELECT value FROM json_each(?)) OR json_extract(metadata_json, '$.uploadReplacementSourceId') IN (SELECT value FROM json_each(?)))),
              ?, ?, ? FROM cases WHERE owner_id = ? AND case_id = ? AND revision = ?`)
            .bind(job.id, job.ownerId, job.caseId, job.target.kind, job.target.id, job.expectedRevision, job.ownerId, job.caseId, JSON.stringify(sourceIds), JSON.stringify(objectIds), JSON.stringify(sourceIds), job.deletedFiles, job.deletedFolders, job.createdAt, job.ownerId, job.caseId, job.expectedRevision),
          db.prepare('UPDATE cases SET revision = ?, state_json = ?, updated_at = ? WHERE owner_id = ? AND case_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM evidence_deletions WHERE id = ? AND owner_id = ? AND case_id = ? AND expected_revision = ? AND target_kind = ? AND target_id = ?)').bind(state.revision, JSON.stringify(state), state.updatedAt, job.ownerId, job.caseId, job.expectedRevision, job.id, job.ownerId, job.caseId, job.expectedRevision, job.target.kind, job.target.id),
          db.prepare('UPDATE evidence_objects SET deleted_at = COALESCE(deleted_at, ?) WHERE owner_id = ? AND case_id = ? AND object_key IN (SELECT value FROM evidence_deletions, json_each(evidence_deletions.object_keys_json) WHERE evidence_deletions.id = ? AND owner_id = ? AND case_id = ? AND expected_revision = ? AND target_kind = ? AND target_id = ?)').bind(job.createdAt, job.ownerId, job.caseId, job.id, job.ownerId, job.caseId, job.expectedRevision, job.target.kind, job.target.id),
        ]);
        return result[1].meta.changes === 1;
      },
      async complete(job) {
        await db.prepare('UPDATE evidence_deletions SET completed_at = ? WHERE id = ? AND owner_id = ? AND case_id = ?').bind(new Date().toISOString(), job.id, job.ownerId, job.caseId).run();
      },
      async requeueObject(ownerId, caseId, objectKey) {
        await db.prepare('UPDATE evidence_deletions SET completed_at = NULL WHERE owner_id = ? AND case_id = ? AND EXISTS (SELECT 1 FROM json_each(object_keys_json) WHERE value = ?)').bind(ownerId, caseId, objectKey).run();
      },
    },
  };
}
