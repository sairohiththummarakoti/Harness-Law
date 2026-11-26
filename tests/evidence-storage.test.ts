import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createEmptyCase, createSampleCase, type CaseState, type Evidence } from '../lib/model.ts';
import { MAX_FILE_BYTES } from '../lib/validation.ts';
import { attachmentDisposition, handleEvidenceDelete, handleEvidenceRead, handleEvidenceUpload, resumeEvidenceDeletions, type EvidenceDeletionJob, type EvidenceObjectRow, type EvidenceStorageDependencies } from '../lib/evidence-storage.ts';

const OWNER = 'google:applicant';
const UPLOAD_ID = '4a752850-571d-4e35-a823-4ef193a7add0';
type UploadOptions = { caseId?: string; revision?: number; uploadId?: string; name?: string; content?: string | Uint8Array; account?: string; origin?: string; folderId?: string; replacementSourceId?: string };
type UploadBody = { document: Evidence; state: CaseState; revision: number; error?: string; code?: string };
async function responseBody(response: Response): Promise<UploadBody> { return await response.json() as UploadBody; }

function fixture() {
  const initial = createEmptyCase(); initial.id = 'case-current'; initial.consent = true;
  const cases = new Map<string, CaseState>([[OWNER, initial]]);
  const objects = new Map<string, EvidenceObjectRow>();
  const blobs = new Map<string, { bytes: ArrayBuffer; hash: string }>();
  const jobs = new Map<string, EvidenceDeletionJob>();
  const tracker = { writes: 0, reads: 0, saves: 0, deletes: 0, user: OWNER as string | null, beforeSave: undefined as (() => void) | undefined, beforeDelete: undefined as (() => void) | undefined, beforeWrite: undefined as (() => Promise<void>) | undefined, afterWrite: undefined as (() => void) | undefined, failWrite: false, failDelete: false };
  const deps: EvidenceStorageDependencies = {
    getUser: async () => tracker.user ? { userId: tracker.user } : null,
    repository: {
      async readCase(ownerId) { return structuredClone(cases.get(ownerId) ?? null); },
      async readObject(ownerId, caseId, objectId) { const row = objects.get(objectId); return row && row.ownerId === ownerId && row.caseId === caseId ? structuredClone(row) : null; },
      async registerObject(row, expectedRevision) {
        const current = cases.get(row.ownerId);
        if (!objects.has(row.id) && current?.id === row.caseId && current.revision === expectedRevision && (!row.metadata.uploadReplacementSourceId || current.documents.some(document => document.id === row.metadata.uploadReplacementSourceId && !document.sample && document.objectId && !objects.get(document.objectId)?.deletedAt))) objects.set(row.id, structuredClone(row));
        return structuredClone(objects.get(row.id) ?? null);
      },
      async saveCase(ownerId, caseId, expectedRevision, state) {
        tracker.saves++; tracker.beforeSave?.();
        const current = cases.get(ownerId);
        if (!current || current.id !== caseId || current.revision !== expectedRevision) return false;
        cases.set(ownerId, structuredClone(state)); return true;
      },
    },
    deletions: {
      async readJob(ownerId, caseId, id) { const job = jobs.get(id); return job?.ownerId === ownerId && job.caseId === caseId ? structuredClone(job) : null; },
      async pendingJobs(ownerId) { return [...jobs.values()].filter(job => job.ownerId === ownerId && !job.completedAt).map(job => structuredClone(job)); },
      async sourceObjects(ownerId, caseId, sourceIds, objectIds) { return [...objects.values()].filter(row => row.ownerId === ownerId && row.caseId === caseId && (sourceIds.includes(row.id) || objectIds.includes(row.id) || !!row.metadata.uploadReplacementSourceId && sourceIds.includes(row.metadata.uploadReplacementSourceId))).map(row => structuredClone(row)); },
      async commit(job, sourceIds, objectIds, state) {
        tracker.beforeDelete?.();
        const current = cases.get(job.ownerId);
        if (!current || current.id !== job.caseId || current.revision !== job.expectedRevision || jobs.has(job.id)) return false;
        const selected = [...objects.values()].filter(row => row.ownerId === job.ownerId && row.caseId === job.caseId && (sourceIds.includes(row.id) || objectIds.includes(row.id) || !!row.metadata.uploadReplacementSourceId && sourceIds.includes(row.metadata.uploadReplacementSourceId)));
        jobs.set(job.id, structuredClone({ ...job, objectKeys: selected.map(row => row.objectKey) })); cases.set(job.ownerId, structuredClone(state));
        for (const row of selected) row.deletedAt = job.createdAt;
        return true;
      },
      async complete(job) { jobs.get(job.id)!.completedAt = new Date().toISOString(); },
      async requeueObject(ownerId, caseId, key) { for (const job of jobs.values()) if (job.ownerId === ownerId && job.caseId === caseId && job.objectKeys.includes(key)) job.completedAt = null; },
    },
    store: {
      async putIfAbsent(key, bytes, metadata) {
        if (tracker.failWrite) throw new Error('temporary storage failure');
        await tracker.beforeWrite?.();
        const existing = blobs.get(key);
        if (existing) { assert.equal(existing.hash, metadata.contentHash); assert.equal(existing.bytes.byteLength, bytes.byteLength); }
        else { blobs.set(key, { bytes: bytes.slice(0), hash: metadata.contentHash }); tracker.writes++; }
        tracker.afterWrite?.();
      },
      async get(key) { tracker.reads++; const value = blobs.get(key); return value ? { body: value.bytes.slice(0), size: value.bytes.byteLength } : null; },
      async delete(keys) { if (tracker.failDelete) throw new Error('temporary deletion failure'); for (const key of keys) { blobs.delete(key); tracker.deletes++; } },
    },
  };
  return { cases, objects, blobs, jobs, tracker, deps, current: () => cases.get(OWNER)! };
}

function upload(options: UploadOptions = {}) {
  const form = new FormData();
  const content = options.content ?? 'Applicant: Alex Example';
  form.append('file', new Blob([typeof content === 'string' ? content : content.buffer as ArrayBuffer], { type: 'text/plain' }), options.name ?? 'profile.txt');
  form.append('caseId', options.caseId ?? 'case-current');
  form.append('expectedRevision', String(options.revision ?? 0));
  form.append('uploadId', options.uploadId ?? UPLOAD_ID);
  if (options.folderId !== undefined) form.append('folderId', options.folderId);
  if (options.replacementSourceId !== undefined) form.append('replacementSourceId', options.replacementSourceId);
  return new Request('https://app.test/api/evidence', { method: 'POST', headers: { Origin: options.origin ?? 'https://app.test', 'X-Harness-Account': options.account ?? OWNER }, body: form });
}

function read(objectId: string, caseId = 'case-current', account = OWNER) {
  return new Request(`https://app.test/api/evidence?caseId=${encodeURIComponent(caseId)}&objectId=${encodeURIComponent(objectId)}`, { headers: { 'X-Harness-Account': account } });
}

async function uploaded(f: ReturnType<typeof fixture>, options: UploadOptions = {}) {
  const response = await handleEvidenceUpload(upload(options), f.deps);
  const body = await responseBody(response);
  assert.equal(response.status, 201, JSON.stringify(body));
  return body;
}

test('upload atomically attaches quarantined metadata and returns the saved revision', async () => {
  const f = fixture(); const body = await uploaded(f);
  assert.equal(body.revision, 1); assert.equal(f.current().revision, 1); assert.equal(f.current().documents.length, 1);
  assert.deepEqual(body.document, f.current().documents[0]);
  assert.equal(body.document.status, 'needs_attention'); assert.equal(body.document.excerpt, ''); assert.equal(body.document.pages, 0);
  assert.equal('contentHash' in body.document, false); assert.equal('uploadReplacementSourceId' in body.document, false);
  assert.match([...f.objects.values()][0].metadata.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(f.tracker.writes, 1);
});

test('upload rejects missing authentication, stale account, foreign origin and unsaved consent before writes', async () => {
  const f = fixture(); f.tracker.user = null;
  assert.equal((await handleEvidenceUpload(upload(), f.deps)).status, 401);
  f.tracker.user = OWNER;
  assert.equal((await handleEvidenceUpload(upload({ account: 'other-account' }), f.deps)).status, 401);
  assert.equal((await handleEvidenceUpload(upload({ origin: 'https://foreign.test' }), f.deps)).status, 403);
  f.current().consent = false;
  assert.equal((await handleEvidenceUpload(upload(), f.deps)).status, 403);
  assert.equal(f.objects.size, 0); assert.equal(f.tracker.writes, 0);
});

test('stale case and revision return latest state without registering or storing a file', async () => {
  const f = fixture(); f.current().revision = 3;
  for (const options of [{ caseId: 'case-old' }, { revision: 2 }]) {
    const response = await handleEvidenceUpload(upload(options), f.deps); const body = await responseBody(response);
    assert.equal(response.status, 409); assert.equal(body.state.id, 'case-current'); assert.equal(body.revision, 3);
  }
  assert.equal(f.objects.size, 0); assert.equal(f.tracker.writes, 0);
});

test('retry after a lost response returns current state without another attachment or version increment', async () => {
  const f = fixture(); const first = await uploaded(f);
  f.current().name = 'Updated case title'; f.current().revision = 2;
  const response = await handleEvidenceUpload(upload(), f.deps); const body = await responseBody(response);
  assert.equal(response.status, 200); assert.equal(body.revision, 2); assert.equal(body.state.name, 'Updated case title');
  assert.equal(body.document.objectId, first.document.objectId); assert.equal(body.document.version, 1);
  assert.equal(f.current().documents.length, 1); assert.equal(f.objects.size, 1); assert.equal(f.tracker.writes, 1); assert.equal(f.tracker.saves, 1);
});

test('simultaneous identical retries produce one stored file and one case attachment', async () => {
  const f = fixture();
  const results = await Promise.all([handleEvidenceUpload(upload(), f.deps), handleEvidenceUpload(upload(), f.deps)]);
  assert.ok(results.every(response => response.status === 200 || response.status === 201));
  assert.equal(results.filter(response => response.status === 201).length, 1);
  assert.equal(f.current().revision, 1); assert.equal(f.current().documents.length, 1);
  assert.equal(f.objects.size, 1); assert.equal(f.tracker.writes, 1);
});

test('simultaneous upload ID collisions cannot overwrite the reserved original bytes', async () => {
  const f = fixture();
  const texts = ['original file A', 'different file B'];
  const results = await Promise.all(texts.map(content => handleEvidenceUpload(upload({ content }), f.deps)));
  const winner = results.findIndex(response => response.status === 201);
  assert.notEqual(winner, -1); assert.equal(results[1 - winner].status, 409);
  const stored = await handleEvidenceRead(read(f.current().documents[0].objectId!), f.deps);
  assert.equal(await stored.text(), texts[winner]); assert.equal(f.tracker.writes, 1); assert.equal(f.objects.size, 1);
});

test('upload ID collisions reject changed bytes, filename, size, or replacement target', async () => {
  const f = fixture(); await uploaded(f);
  for (const options of [{ content: 'Applicant: Other Person' }, { name: 'other.txt' }, { content: 'tiny' }, { replacementSourceId: f.current().documents[0].id }]) {
    const response = await handleEvidenceUpload(upload({ revision: 1, ...options }), f.deps);
    assert.equal(response.status, 409); assert.equal((await responseBody(response)).code, 'upload_id_conflict');
  }
  assert.equal(f.objects.size, 1); assert.equal(f.tracker.writes, 1); assert.equal(f.current().documents.length, 1);
});

test('CAS failure retains registered bytes and the same upload ID attaches on a later retry', async () => {
  const f = fixture();
  f.tracker.beforeSave = () => { f.current().name = 'Changed elsewhere'; f.current().revision = 1; f.tracker.beforeSave = undefined; };
  const failed = await handleEvidenceUpload(upload(), f.deps); const conflict = await responseBody(failed);
  assert.equal(failed.status, 409); assert.equal(conflict.state.name, 'Changed elsewhere'); assert.equal(conflict.revision, 1);
  assert.equal(f.current().documents.length, 0); assert.equal(f.objects.size, 1); assert.equal(f.blobs.size, 1);
  const body = await uploaded(f, { revision: 1 });
  assert.equal(body.state.name, 'Changed elsewhere'); assert.equal(body.revision, 2); assert.equal(f.current().documents.length, 1);
  assert.equal(f.tracker.writes, 1); assert.equal(f.objects.size, 1);
});

test('a case reset during upload never attaches the original to the new case', async () => {
  const f = fixture();
  f.tracker.afterWrite = () => { const next = createEmptyCase(); next.id = 'case-new'; next.consent = true; next.revision = 1; f.cases.set(OWNER, next); };
  const response = await handleEvidenceUpload(upload(), f.deps); const body = await responseBody(response);
  assert.equal(response.status, 409); assert.equal(body.code, 'case_changed'); assert.equal(body.state.id, 'case-new');
  assert.equal(f.current().documents.length, 0); assert.equal(f.tracker.saves, 0); assert.equal(f.objects.size, 1);
});

test('an interrupted object write leaves a reservation that can be retried safely', async () => {
  const f = fixture(); f.tracker.failWrite = true;
  assert.equal((await handleEvidenceUpload(upload(), f.deps)).status, 503);
  assert.equal(f.objects.size, 1); assert.equal(f.blobs.size, 0); assert.equal(f.current().documents.length, 0);
  f.tracker.failWrite = false; await uploaded(f);
  assert.equal(f.objects.size, 1); assert.equal(f.tracker.writes, 1);
});

test('replacement preserves its folder unless explicitly changed and returns raw version-one metadata', async () => {
  const f = fixture(); f.current().folders = [{ id: 'folder-a', name: 'Awards', parentId: null }];
  const original = await uploaded(f, { folderId: 'folder-a' });
  const replacementOptions = { revision: 1, uploadId: '5b752850-571d-4e35-a823-4ef193a7add1', name: 'replacement.txt', replacementSourceId: original.document.id };
  const replaced = await uploaded(f, replacementOptions);
  assert.equal(replaced.document.version, 1); assert.notEqual(replaced.document.id, original.document.id);
  assert.equal(replaced.state.documents[0].id, original.document.id); assert.equal(replaced.state.documents[0].version, 2); assert.equal(replaced.state.documents[0].folderId, 'folder-a');
  assert.equal(replaced.state.documents[0].objectId, replaced.document.id);
  const retried = await handleEvidenceUpload(upload(replacementOptions), f.deps);
  assert.equal(retried.status, 200); assert.equal((await responseBody(retried)).state.documents[0].version, 2);
  const moved = await uploaded(f, { ...replacementOptions, revision: 2, uploadId: '6b752850-571d-4e35-a823-4ef193a7add2', folderId: '' });
  assert.equal(moved.state.documents[0].folderId, null); assert.equal(moved.state.documents[0].version, 3);
});

test('missing folder and missing replacement source cannot register a file', async () => {
  const f = fixture();
  assert.equal((await handleEvidenceUpload(upload({ folderId: 'foreign-folder' }), f.deps)).status, 422);
  assert.equal((await handleEvidenceUpload(upload({ replacementSourceId: 'removed-source' }), f.deps)).status, 409);
  assert.equal(f.objects.size, 0); assert.equal(f.tracker.writes, 0);
});

test('download is an attachment with restrictive headers and unchanged quarantine status', async () => {
  const f = fixture(); const body = await uploaded(f, { name: 'résumé "draft".txt' });
  f.current().consent = false; // Withdrawal prevents new uploads, not access to one's stored original.
  const response = await handleEvidenceRead(read(body.document.objectId!), f.deps);
  assert.equal(response.status, 200); assert.equal(await response.text(), 'Applicant: Alex Example');
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-security-policy')!, /sandbox/);
  assert.match(response.headers.get('content-disposition')!, /^attachment; filename="r_sum_ _draft_\.txt"; filename\*=UTF-8''r%C3%A9sum%C3%A9%20%22draft%22\.txt$/);
  assert.equal(f.current().documents[0].status, 'needs_attention'); assert.equal(f.current().documents[0].excerpt, '');
});

test('download rejects other accounts, stale cases, and unreferenced object IDs before reading bytes', async () => {
  const f = fixture(); const first = await uploaded(f);
  assert.equal((await handleEvidenceRead(read(first.document.objectId!, 'case-current', 'old-account'), f.deps)).status, 401);
  assert.equal((await handleEvidenceRead(read(first.document.objectId!, 'case-old'), f.deps)).status, 409);
  assert.equal((await handleEvidenceRead(read('unknown-object'), f.deps)).status, 404);
  const other = createEmptyCase(); other.id = 'other-case'; f.cases.set('google:other', other); f.tracker.user = 'google:other';
  assert.equal((await handleEvidenceRead(read(first.document.objectId!, 'other-case', 'google:other'), f.deps)).status, 404);
  f.tracker.user = null;
  assert.equal((await handleEvidenceRead(read(first.document.objectId!), f.deps)).status, 401);
  assert.equal(f.tracker.reads, 0);
});

test('download checks object ownership even if case JSON contains a forged reference', async () => {
  const f = fixture(); const first = await uploaded(f);
  const other = createEmptyCase(); other.id = 'other-case'; other.documents = [first.document];
  f.cases.set('google:other', other); f.tracker.user = 'google:other';
  assert.equal((await handleEvidenceRead(read(first.document.objectId!, 'other-case', 'google:other'), f.deps)).status, 404);
  assert.equal(f.tracker.reads, 0);
});

test('download cannot expose an unreferenced original after replacement or removal', async () => {
  const f = fixture(); const first = await uploaded(f);
  const second = await uploaded(f, { revision: 1, uploadId: '7b752850-571d-4e35-a823-4ef193a7add3', replacementSourceId: first.document.id });
  assert.equal((await handleEvidenceRead(read(first.document.objectId!), f.deps)).status, 404);
  assert.equal((await handleEvidenceRead(read(second.document.objectId!), f.deps)).status, 200);
  f.current().documents = [];
  assert.equal((await handleEvidenceRead(read(second.document.objectId!), f.deps)).status, 404);
});

test('empty, unsupported, oversized, and malformed uploads are rejected without storage writes', async () => {
  const f = fixture();
  assert.equal((await handleEvidenceUpload(upload({ content: '' }), f.deps)).status, 422);
  assert.equal((await handleEvidenceUpload(upload({ name: 'script.html' }), f.deps)).status, 415);
  assert.equal((await handleEvidenceUpload(upload({ uploadId: 'not-a-uuid' }), f.deps)).status, 400);
  const tooLarge = upload(); tooLarge.headers.set('Content-Length', String(MAX_FILE_BYTES + 65537));
  assert.equal((await handleEvidenceUpload(tooLarge, f.deps)).status, 413);
  assert.equal((await handleEvidenceUpload(upload({ content: new Uint8Array(MAX_FILE_BYTES + 1) }), f.deps)).status, 413);
  assert.equal(f.objects.size, 0); assert.equal(f.tracker.writes, 0);
});

test('all supported form import formats can be retained as quarantined originals', async () => {
  for (const extension of ['pdf', 'docx', 'txt', 'md', 'markdown', 'csv', 'json', 'jpg', 'png']) {
    const f = fixture(); const body = await uploaded(f, { name: `document.${extension}` });
    assert.equal(body.document.kind, extension.toUpperCase()); assert.equal(body.document.status, 'needs_attention');
  }
});

test('the 200-document limit is checked before metadata or object writes', async () => {
  const f = fixture(); const first = await uploaded(f);
  f.current().documents = Array.from({ length: 200 }, (_, index) => ({ ...first.document, id: `source-${index}`, objectId: `object-${index}` }));
  const response = await handleEvidenceUpload(upload({ revision: 1, uploadId: '8b752850-571d-4e35-a823-4ef193a7add4' }), f.deps);
  assert.equal(response.status, 413); assert.equal((await responseBody(response)).code, 'document_limit');
  assert.equal(f.objects.size, 1); assert.equal(f.tracker.writes, 1);
});

test('attachment filenames cannot add headers or path components', () => {
  const header = attachmentDisposition('../unsafe"\r\nX-Injected: yes.txt');
  assert.equal(/[\r\n]/.test(header), false); assert.equal(header.includes('../'), false);
  assert.match(header, /^attachment; filename="unsafe_X-Injected: yes.txt";/);
});

const DELETION_ID = 'ba752850-571d-4e35-a823-4ef193a7add0';
function remove(target: {kind: 'file' | 'folder'; id: string}, revision: number, options: { caseId?: string; account?: string; origin?: string; deletionId?: string } = {}) {
  return new Request('https://app.test/api/evidence', { method: 'DELETE', headers: { 'Content-Type': 'application/json', Origin: options.origin ?? 'https://app.test', 'X-Harness-Account': options.account ?? OWNER }, body: JSON.stringify({ caseId: options.caseId ?? 'case-current', expectedRevision: revision, target, deletionId: options.deletionId ?? DELETION_ID }) });
}

test('recursive folder deletion removes originals and replacement versions but preserves siblings', async () => {
  const f = fixture();
  f.current().folders = [{ id: 'parent', name: 'Awards', parentId: null }, { id: 'child', name: 'Letters', parentId: 'parent' }, { id: 'keep', name: 'Keep', parentId: null }];
  const original = await uploaded(f, { folderId: 'child' });
  const replacement = await uploaded(f, { revision: 1, uploadId: '5b752850-571d-4e35-a823-4ef193a7add1', name: 'new.txt', replacementSourceId: original.document.id });
  const sibling = await uploaded(f, { revision: 2, uploadId: '6b752850-571d-4e35-a823-4ef193a7add2', folderId: 'keep', name: 'keep.txt' });
  const response = await handleEvidenceDelete(remove({ kind: 'folder', id: 'parent' }, 3), f.deps);
  const body = await response.json() as { deletedFiles: number; deletedFolders: number; cleanupPending: boolean };
  assert.equal(response.status, 200); assert.deepEqual(body.deletedFiles, 1); assert.equal(body.deletedFolders, 2); assert.equal(body.cleanupPending, false);
  assert.deepEqual(f.current().folders?.map(folder => folder.id), ['keep']); assert.deepEqual(f.current().documents.map(document => document.id), [sibling.document.id]);
  assert.equal(f.blobs.size, 1); assert.ok(f.objects.get(original.document.id)?.deletedAt); assert.ok(f.objects.get(replacement.document.id)?.deletedAt);
  assert.equal((await handleEvidenceRead(read(replacement.document.objectId!), f.deps)).status, 404);
  assert.equal((await handleEvidenceRead(read(sibling.document.objectId!), f.deps)).status, 200);
});

test('deletion rejects missing auth, changed accounts, foreign origins, foreign targets and stale state', async () => {
  const f = fixture(); const first = await uploaded(f); const target = { kind: 'file' as const, id: first.document.id };
  f.tracker.user = null; assert.equal((await handleEvidenceDelete(remove(target, 1), f.deps)).status, 401);
  f.tracker.user = OWNER;
  assert.equal((await handleEvidenceDelete(remove(target, 1, { account: 'other' }), f.deps)).status, 401);
  assert.equal((await handleEvidenceDelete(remove(target, 1, { origin: 'https://foreign.test' }), f.deps)).status, 403);
  assert.equal((await handleEvidenceDelete(remove(target, 1, { caseId: 'case-old' }), f.deps)).status, 409);
  assert.equal((await handleEvidenceDelete(remove(target, 0), f.deps)).status, 409);
  assert.equal((await handleEvidenceDelete(remove({ kind: 'file', id: 'someone-elses-file' }, 1), f.deps)).status, 404);
  const row = f.objects.get(first.document.id)!; row.ownerId = 'other';
  assert.equal((await handleEvidenceDelete(remove(target, 1), f.deps)).status, 422);
  assert.equal(f.current().documents.length, 1); assert.equal(f.blobs.size, 1); assert.equal(f.jobs.size, 0); assert.equal(f.tracker.deletes, 0);
});

test('a lost deletion response can retry the same operation without deleting twice or changing newer case edits', async () => {
  const f = fixture(); const first = await uploaded(f); const target = { kind: 'file' as const, id: first.document.id };
  assert.equal((await handleEvidenceDelete(remove(target, 1), f.deps)).status, 200);
  const deletes = f.tracker.deletes;
  f.current().revision = 3; f.current().name = 'A newer title';
  const response = await handleEvidenceDelete(remove(target, 1), f.deps); const body = await responseBody(response);
  assert.equal(response.status, 200); assert.equal(body.revision, 3); assert.equal(body.state.name, 'A newer title');
  assert.equal(f.tracker.deletes, deletes); assert.equal(f.jobs.size, 1);
  const collision = await handleEvidenceDelete(remove({ kind: 'folder', id: 'different-target' }, 3), f.deps);
  assert.equal(collision.status, 409); assert.equal((await responseBody(collision)).code, 'delete_id_conflict');
});

test('R2 failure keeps originals inaccessible and queues cleanup for the next workspace load', async () => {
  const f = fixture(); const first = await uploaded(f); f.tracker.failDelete = true;
  const response = await handleEvidenceDelete(remove({ kind: 'file', id: first.document.id }, 1), f.deps);
  assert.equal(response.status, 200); assert.equal((await response.json() as {cleanupPending: boolean}).cleanupPending, true);
  assert.equal(f.current().documents.length, 0); assert.equal(f.blobs.size, 1); assert.equal([...f.jobs.values()][0].completedAt, null);
  assert.equal((await handleEvidenceRead(read(first.document.objectId!), f.deps)).status, 404);
  f.tracker.failDelete = false; await resumeEvidenceDeletions(OWNER, f.deps);
  assert.equal(f.blobs.size, 0); assert.ok([...f.jobs.values()][0].completedAt);
});

test('a concurrent save before deletion commits does not remove files or reserve a cleanup job', async () => {
  const f = fixture(); const first = await uploaded(f);
  f.tracker.beforeDelete = () => { f.current().revision = 2; f.current().name = 'Saved elsewhere'; };
  const response = await handleEvidenceDelete(remove({ kind: 'file', id: first.document.id }, 1), f.deps);
  assert.equal(response.status, 409); assert.equal((await responseBody(response)).state.name, 'Saved elsewhere');
  assert.equal(f.current().documents.length, 1); assert.equal(f.blobs.size, 1); assert.equal(f.jobs.size, 0); assert.equal(f.tracker.deletes, 0);
});

test('deleted upload identities cannot be retried into a case or downloaded through a forged attachment', async () => {
  const f = fixture(); const first = await uploaded(f);
  await handleEvidenceDelete(remove({ kind: 'file', id: first.document.id }, 1), f.deps);
  const response = await handleEvidenceUpload(upload({ revision: 2 }), f.deps);
  assert.equal(response.status, 410); assert.equal((await responseBody(response)).code, 'file_deleted'); assert.equal(f.blobs.size, 0); assert.equal(f.tracker.writes, 1);
  f.current().documents = [first.document];
  assert.equal((await handleEvidenceRead(read(first.document.objectId!), f.deps)).status, 404);
});

test('a late replacement write after completed deletion reopens cleanup even if immediate R2 removal fails', async () => {
  const f = fixture(); const first = await uploaded(f);
  f.tracker.beforeWrite = async () => {
    f.tracker.beforeWrite = undefined;
    const response = await handleEvidenceDelete(remove({ kind: 'file', id: first.document.id }, 1), f.deps);
    assert.equal(response.status, 200); assert.ok([...f.jobs.values()][0].completedAt);
    f.tracker.failDelete = true;
  };
  const response = await handleEvidenceUpload(upload({ revision: 1, uploadId: '7b752850-571d-4e35-a823-4ef193a7add3', replacementSourceId: first.document.id }), f.deps);
  assert.equal(response.status, 503); assert.equal(f.current().documents.length, 0); assert.equal(f.blobs.size, 1);
  assert.equal([...f.jobs.values()][0].completedAt, null);
  f.tracker.failDelete = false; await resumeEvidenceDeletions(OWNER, f.deps);
  assert.equal(f.blobs.size, 0);
});

test('empty folder deletion is durable and requires no object deletion', async () => {
  const f = fixture(); f.current().folders = [{ id: 'empty', name: 'Empty', parentId: null }];
  const response = await handleEvidenceDelete(remove({ kind: 'folder', id: 'empty' }, 0), f.deps);
  assert.equal(response.status, 200); assert.equal(f.current().folders?.length, 0); assert.equal(f.current().revision, 1); assert.equal(f.tracker.deletes, 0);
});

test('sample recursive deletion invalidates dependent drafts and removes source facts without changing unrelated evidence', () => {
  const state = createSampleCase();
  const source = state.documents.find(document => state.facts.some(fact => fact.sourceId === document.id)) ?? state.documents[0];
  state.folders = [{ id: 'parent', name: 'Delete', parentId: null }, { id: 'child', name: 'Child', parentId: 'parent' }, { id: 'keep', name: 'Keep', parentId: null }];
  source.folderId = 'child';
  const dependent = Object.values(state.runs).filter(run => run.result?.sourceVersions.some(version => version.id === source.id)).map(run => run.criterion);
  const next = applyAction(state, { type: 'delete_evidence', target: { kind: 'folder', id: 'parent' } });
  assert.equal(next.documents.length, state.documents.length - 1); assert.deepEqual(next.folders?.map(folder => folder.id), ['keep']);
  assert.equal(next.facts.some(fact => fact.sourceId === source.id), false);
  for (const criterion of dependent) assert.equal(next.runs[criterion].result?.stale, true);
  assert.equal(state.documents.length, 6); assert.equal(state.folders.length, 3);
});
