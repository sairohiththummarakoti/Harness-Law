import type { IntegrationCase } from './contracts.ts';
import type { StoredObject } from './provider-contracts.ts';

export interface SavedResponse { status: number; data: unknown; }
export interface Receipt { operation: string; hash: string; response: SavedResponse; created_at: string; }
export interface CaseEnvelope {
  state: IntegrationCase;
  receipts: Record<string, Receipt>;
  processing_consent?: boolean;
  upload_objects?: Record<string, StoredObject>;
  provider_attempts?: { job_id: string; operation: string; attempt: number; outcome: string; occurred_at: string }[];
}
export interface CaseRepository {
  find(ownerId: string, caseId?: string): Promise<CaseEnvelope | null>;
  findForWorker(caseId: string): Promise<CaseEnvelope | null>;
  insert(envelope: CaseEnvelope): Promise<boolean>;
  compareAndSwap(envelope: CaseEnvelope, expectedRevision: number): Promise<boolean>;
  dueCases(limit: number): Promise<string[]>;
}

export const MAX_CASE_RECORD_BYTES = 24 * 1024 * 1024;
// D1 limits individual values/rows to 2 MB. Chunk the aggregate into sub-MB
// UTF-8 values, then commit its head, chunks, outbox and receipts in one batch.
function serialize(envelope: CaseEnvelope) {
  const json = JSON.stringify(envelope);
  if (new TextEncoder().encode(json).byteLength > MAX_CASE_RECORD_BYTES) throw new Error('Case record capacity exceeded.');
  const chunks: string[] = [];
  for (let offset = 0; offset < json.length;) {
    let end = Math.min(offset + 200_000, json.length);
    if (end < json.length && /[\uD800-\uDBFF]/.test(json[end - 1])) end--;
    chunks.push(json.slice(offset, end)); offset = end;
  }
  return chunks;
}
function dueAt(envelope: CaseEnvelope) {
  const times = Object.values(envelope.state.jobs).filter(j => ['queued', 'running'].includes(j.state))
    .map(j => j.state === 'running' ? j.lease_expires_at || envelope.state.updated_at : j.next_attempt_at || envelope.state.updated_at);
  return times.length ? times.sort()[0] : null;
}
export class D1CaseRepository implements CaseRepository {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }
  private async read(where: string, values: string[]) {
    const rows = await this.db.prepare(`SELECT p.payload FROM integration_cases c
      JOIN integration_case_chunks p ON p.case_id = c.case_id AND p.revision = c.revision
      WHERE ${where} ORDER BY p.chunk_index`).bind(...values).all<{ payload: string }>();
    return rows.results.length ? JSON.parse(rows.results.map(row => row.payload).join('')) as CaseEnvelope : null;
  }
  async find(ownerId: string, caseId?: string) {
    return caseId ? this.read('c.owner_id = ? AND c.case_id = ?', [ownerId, caseId]) : this.read('c.owner_id = ?', [ownerId]);
  }
  async findForWorker(caseId: string) {
    return this.read('c.case_id = ?', [caseId]);
  }
  async insert(envelope: CaseEnvelope) {
    return this.write(envelope);
  }
  async compareAndSwap(envelope: CaseEnvelope, expectedRevision: number) {
    return this.write(envelope, expectedRevision);
  }
  private async write(envelope: CaseEnvelope, expectedRevision?: number) {
    const s = envelope.state, chunks = serialize(envelope), token = crypto.randomUUID();
    const head = expectedRevision === undefined
      ? this.db.prepare('INSERT OR IGNORE INTO integration_cases (case_id, owner_id, revision, commit_token, next_job_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(s.case_id, s.owner_id, s.revision, token, dueAt(envelope), s.updated_at)
      : this.db.prepare('UPDATE integration_cases SET revision = ?, commit_token = ?, next_job_at = ?, updated_at = ? WHERE case_id = ? AND owner_id = ? AND revision = ?').bind(s.revision, token, dueAt(envelope), s.updated_at, s.case_id, s.owner_id, expectedRevision);
    const inserts = chunks.map((chunk, index) => this.db.prepare(`INSERT INTO integration_case_chunks (case_id, revision, chunk_index, payload)
      SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM integration_cases WHERE case_id = ? AND commit_token = ?)`)
      .bind(s.case_id, s.revision, index, chunk, s.case_id, token));
    const cleanup = this.db.prepare(`DELETE FROM integration_case_chunks WHERE case_id = ? AND revision <> ?
      AND EXISTS (SELECT 1 FROM integration_cases WHERE case_id = ? AND commit_token = ?)`).bind(s.case_id, s.revision, s.case_id, token);
    // A zero-row CAS is not a SQL error. Every later statement is guarded by this
    // writer's unique token, so losing writers can neither insert nor remove chunks.
    const results = await this.db.batch([head, ...inserts, cleanup]);
    return results[0].meta.changes === 1;
  }
  async dueCases(limit: number) {
    const result = await this.db.prepare('SELECT case_id FROM integration_cases WHERE next_job_at <= ? ORDER BY next_job_at LIMIT ?').bind(new Date().toISOString(), Math.min(20, Math.max(1, limit))).all<{ case_id: string }>();
    return result.results.map(row => row.case_id);
  }
}

export class MemoryCaseRepository implements CaseRepository {
  private readonly rows = new Map<string, CaseEnvelope>();
  async find(ownerId: string, caseId?: string) {
    const row = [...this.rows.values()].find(v => v.state.owner_id === ownerId && (!caseId || v.state.case_id === caseId));
    return row ? structuredClone(row) : null;
  }
  async findForWorker(caseId: string) { const row = this.rows.get(caseId); return row ? structuredClone(row) : null; }
  async insert(envelope: CaseEnvelope) {
    if ([...this.rows.values()].some(v => v.state.owner_id === envelope.state.owner_id || v.state.case_id === envelope.state.case_id)) return false;
    this.rows.set(envelope.state.case_id, structuredClone(envelope)); return true;
  }
  async compareAndSwap(envelope: CaseEnvelope, expectedRevision: number) {
    const current = this.rows.get(envelope.state.case_id);
    if (!current || current.state.owner_id !== envelope.state.owner_id || current.state.revision !== expectedRevision) return false;
    this.rows.set(envelope.state.case_id, structuredClone(envelope)); return true;
  }
  async dueCases(limit: number) {
    return [...this.rows.values()].filter(v => Object.values(v.state.jobs).some(j => ['queued', 'running'].includes(j.state))).slice(0, limit).map(v => v.state.case_id);
  }
}
