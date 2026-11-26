import { matchesExpectedAccount } from './account-context.ts';
import { applyAction, type CaseState, type Evidence } from './model.ts';
import { caseSchema, evidenceSchema, MAX_CASE_BODY, MAX_FILE_BYTES, readLimitedBody, safeFilename, validUploadName } from './validation.ts';
import { evidenceDeletionSelection, type EvidenceDeleteTarget } from './evidence-deletion.ts';

export interface EvidenceObjectRow {
  id: string; ownerId: string; caseId: string; objectKey: string; createdAt: string;
  deletedAt?: string | null;
  metadata: Evidence & { contentHash: string; uploadReplacementSourceId: string | null; uploadOriginalName?: string; storageBackend?: 's3' | 'r2'; storageVersion?: string; storageVersions?: string[]; storageDeletedVersions?: string[] };
}
export interface EvidenceRepository {
  readCase(ownerId: string): Promise<CaseState | null>;
  readObject(ownerId: string, caseId: string, objectId: string): Promise<EvidenceObjectRow | null>;
  /** Atomically reserve the ID, returning the existing row when another retry won. */
  registerObject(row: EvidenceObjectRow, expectedRevision: number): Promise<EvidenceObjectRow | null>;
  saveCase(ownerId: string, caseId: string, expectedRevision: number, state: CaseState): Promise<boolean>;
  /** One transaction: rename the current original's metadata and compare-and-swap its case. */
  renameObject?(ownerId: string, caseId: string, objectId: string, expectedRevision: number, name: string, state: CaseState): Promise<boolean>;
}
export interface EvidenceBlobStore {
  /** Backend for new reservations. Existing reservations always retain their stored locator. */
  uploadBackend?: 's3' | 'r2';
  /** Never overwrite an existing key; verify its size and contentHash on a retry. */
  putIfAbsent(key: string, bytes: ArrayBuffer, metadata: { owner: string; caseId: string; contentHash: string }): Promise<void>;
  get(key: string): Promise<{ body: ReadableStream<Uint8Array> | ArrayBuffer; size: number } | null>;
  delete?(keys: string[]): Promise<void>;
}
export interface EvidenceDeletionJob {
  id: string; ownerId: string; caseId: string; target: EvidenceDeleteTarget; expectedRevision: number;
  objectKeys: string[]; deletedFiles: number; deletedFolders: number; createdAt: string; completedAt: string | null;
}
export interface EvidenceDeletionRepository {
  readJob(ownerId: string, caseId: string, id: string): Promise<EvidenceDeletionJob | null>;
  pendingJobs(ownerId: string): Promise<EvidenceDeletionJob[]>;
  sourceObjects(ownerId: string, caseId: string, sourceIds: string[], objectIds: string[]): Promise<EvidenceObjectRow[]>;
  /** One transaction: reserve job, compare-and-swap the case, and tombstone its objects. */
  commit(job: EvidenceDeletionJob, sourceIds: string[], objectIds: string[], state: CaseState): Promise<boolean>;
  complete(job: EvidenceDeletionJob): Promise<boolean | void>;
  requeueObject(ownerId: string, caseId: string, objectKey: string): Promise<void>;
}
export interface EvidenceStorageDependencies {
  getUser(): Promise<{ userId: string } | null>;
  repository: EvidenceRepository;
  store?: EvidenceBlobStore;
  deletions?: EvidenceDeletionRepository;
}

const MAX_MULTIPART_BYTES = MAX_FILE_BYTES + 65536;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const error = (message: string, status: number, code: string) => json({ error: message, code }, status);
const conflict = (message: string, state: CaseState | null, code = 'revision_conflict') => json({ error: message, code, ...(state ? { state, revision: state.revision } : {}) }, 409);
async function sha256(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
}
async function uploadIdentity(ownerId: string, caseId: string, uploadId: string) {
  const owner = await sha256(new TextEncoder().encode(ownerId).buffer as ArrayBuffer);
  const identity = await sha256(new TextEncoder().encode(JSON.stringify([ownerId, caseId, uploadId.toLowerCase()])).buffer as ArrayBuffer);
  return { owner, id: `upload-${identity}` };
}
function storageSlug(value: string, fallback: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[._-]+|[._-]+$/g, '').slice(0, 80) || fallback;
}
/** Folder names help operators; hashed owner/folder/upload identities prevent collisions. */
export async function evidenceObjectLocation(state: CaseState, owner: string, uploadId: string, folderId: string | null, name: string, backend: 's3' | 'r2'): Promise<string> {
  if (backend === 'r2') return `quarantine/${owner}/${uploadId}`;
  const folder = folderId ? state.folders?.find(item => item.id === folderId) : undefined;
  if (folderId && !folder) throw new Error('The evidence folder is unavailable.');
  const folderIdentity = await sha256(new TextEncoder().encode(JSON.stringify([state.id, folderId])).buffer as ArrayBuffer);
  return `s3:users/${owner}/${storageSlug(folder?.name || 'Evidence', 'folder')}/files/${folderIdentity}/${uploadId}-${storageSlug(name, 'document')}`;
}
function publicDocument(row: EvidenceObjectRow): Evidence {
  const { contentHash: _contentHash, uploadReplacementSourceId: _replacement, uploadOriginalName: _originalName, storageBackend: _backend, storageVersion: _version, storageVersions: _versions, storageDeletedVersions: _deletedVersions, ...document } = row.metadata;
  return evidenceSchema.parse(document) as Evidence;
}
function matchesUpload(row: EvidenceObjectRow, name: string, bytes: number, contentHash: string, replacementSourceId: string | null) {
  return (row.metadata.uploadOriginalName ?? row.metadata.name) === name && row.metadata.bytes === bytes && row.metadata.contentHash === contentHash && row.metadata.uploadReplacementSourceId === replacementSourceId;
}
function destination(state: CaseState, folderProvided: boolean, folderId: string | null, replacementSourceId: string | null): { folderId: string | null; error?: Response } {
  const source = replacementSourceId ? state.documents.find(document => document.id === replacementSourceId && !document.sample) : undefined;
  if (replacementSourceId && !source) return { folderId: null, error: conflict('The source to replace changed. Reload your case before retrying.', state, 'source_changed') };
  const selected = folderProvided ? folderId : source?.folderId ?? null;
  if (selected && !state.folders?.some(folder => folder.id === selected)) return { folderId: null, error: error('Choose a folder in the current case.', 422, 'invalid_folder') };
  return { folderId: selected };
}
function attachment(state: CaseState, document: Evidence, replacementSourceId: string | null): { state?: CaseState; error?: Response } {
  if (!replacementSourceId && state.documents.length >= 200) return { error: error('This case already contains 200 documents.', 413, 'document_limit') };
  const next = applyAction(state, { type: 'complete_upload', caseId: state.id, replacementSourceId, document });
  next.revision = state.revision + 1;
  next.updatedAt = new Date().toISOString();
  if (!caseSchema.safeParse(next).success) return { error: error('This document cannot be attached to the current case. Reload your case and try again.', 422, 'invalid_state') };
  if (new TextEncoder().encode(JSON.stringify({ state: next, expectedRevision: state.revision })).byteLength > MAX_CASE_BODY) return { error: error('This case is too large to save another document.', 413, 'case_limit') };
  return { state: next };
}
function caseGuard(state: CaseState | null, caseId: string): Response | undefined {
  if (!state) return conflict('Create and save a case before uploading.', state, 'case_required');
  if (state.id !== caseId) return conflict('The active case changed. Reload before continuing.', state, 'case_changed');
  if (state.mode !== 'personal') return conflict('Return to your personal case before uploading files.', state, 'sample_case');
}
function stringField(form: FormData, key: string, required = false): string | null | undefined {
  if (!form.has(key)) return required ? undefined : null;
  if (form.getAll(key).length !== 1 || typeof form.get(key) !== 'string') return undefined;
  return form.get(key) as string;
}

async function cleanDeletedUpload(row: EvidenceObjectRow, deps: EvidenceStorageDependencies) {
  // A writer can have passed its preflight before deletion committed. Reopen
  // cleanup *after* that late write, so even a failed object delete stays retryable.
  await deps.deletions?.requeueObject(row.ownerId, row.caseId, row.objectKey);
  await deps.store?.delete?.([row.objectKey]);
}

export async function handleEvidenceUpload(request: Request, deps: EvidenceStorageDependencies): Promise<Response> {
  try {
    const user = await deps.getUser();
    if (!user) return error('Sign in to upload evidence.', 401, 'session_expired');
    if (!matchesExpectedAccount(request, user.userId)) return error('Your session changed. Sign in to the account used in this tab before continuing.', 401, 'session_changed');
    const origin = request.headers.get('origin');
    if (!origin || origin !== new URL(request.url).origin) return error('This upload request did not originate from this app.', 403, 'invalid_origin');
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.split(';', 1)[0].trim().toLowerCase() !== 'multipart/form-data') return error('Use the document upload form.', 415, 'invalid_content_type');
    if (Number(request.headers.get('content-length') || 0) > MAX_MULTIPART_BYTES) return error('Each document must be 20 MB or smaller.', 413, 'file_too_large');
    const body = await readLimitedBody(request, MAX_MULTIPART_BYTES);
    if (!body) return error('Each document must be 20 MB or smaller.', 413, 'file_too_large');
    let form: FormData;
    try { form = await new Response(body.buffer as ArrayBuffer, { headers: { 'Content-Type': contentType } }).formData(); }
    catch { return error('The upload form could not be read.', 400, 'invalid_upload'); }
    const caseId = stringField(form, 'caseId', true), revisionValue = stringField(form, 'expectedRevision', true), uploadId = stringField(form, 'uploadId', true);
    const rawFolder = stringField(form, 'folderId'), rawReplacement = stringField(form, 'replacementSourceId');
    if (!caseId || caseId.length > 150 || !revisionValue || !/^\d+$/.test(revisionValue) || !Number.isSafeInteger(Number(revisionValue)) || Number(revisionValue) > 2147483647 || !uploadId || !UUID.test(uploadId) || rawFolder === undefined || (rawFolder?.length ?? 0) > 150 || rawReplacement === undefined || (rawReplacement?.length ?? 0) > 150) return error('Reload your case and choose the file again.', 400, 'invalid_upload');
    const expectedRevision = Number(revisionValue), folderProvided = form.has('folderId'), folderId = rawFolder || null, replacementSourceId = rawReplacement || null;
    const file = form.get('file');
    if (form.getAll('file').length !== 1 || !file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') return error('Choose one document to upload.', 400, 'invalid_file');
    if (file.size === 0) return error('The document is empty. Choose a file containing evidence.', 422, 'empty_file');
    if (file.size > MAX_FILE_BYTES) return error('Each document must be 20 MB or smaller.', 413, 'file_too_large');
    const name = safeFilename(file.name);
    if (!validUploadName(name)) return error('Supported files: PDF, DOCX, TXT, Markdown, CSV, JSON, JPG, and PNG.', 415, 'unsupported_file');
    let state = await deps.repository.readCase(user.userId);
    const initialGuard = caseGuard(state, caseId);
    if (initialGuard || !state) return initialGuard!;
    if (!state.consent) return error('Save your processing consent before uploading documents.', 403, 'consent_required');
    const bytes = await file.arrayBuffer(), contentHash = await sha256(bytes), identity = await uploadIdentity(user.userId, caseId, uploadId);
    let row = await deps.repository.readObject(user.userId, caseId, identity.id);
    if (row?.deletedAt) { await cleanDeletedUpload(row, deps); return error('This upload was deleted. Select the file again to create a new upload.', 410, 'file_deleted'); }
    if (row && !matchesUpload(row, name, file.size, contentHash, replacementSourceId)) return conflict('This upload attempt belongs to a different file. Choose the file again.', state, 'upload_id_conflict');
    if (row) {
      const attached = state.documents.find(document => !document.sample && document.objectId === row!.id);
      if (attached) return json({ document: { ...publicDocument(row), folderId: attached.folderId ?? null }, state, revision: state.revision });
    }
    if (state.revision !== expectedRevision) return conflict('This case changed before the upload. Review the latest case and retry.', state);
    let target = destination(state, folderProvided, folderId, replacementSourceId);
    if (target.error) return target.error;
    if (!deps.store) return error('Evidence storage is not configured.', 503, 'storage_unavailable');
    const uploadedAt = row?.createdAt ?? new Date().toISOString();
    const document: Evidence = row ? { ...publicDocument(row), folderId: target.folderId } : {
      id: identity.id, objectId: identity.id, name, version: 1, status: 'needs_attention', language: 'Not extracted', pages: 0,
      bytes: file.size, kind: name.split('.').pop()!.toUpperCase(), excerpt: '', associations: [], exhibit: '', uploadedAt, sample: false,
      issue: 'Stored in quarantine. Safety scanning and text extraction are not connected yet; preview and criterion processing are unavailable.', previousVersions: [], folderId: target.folderId,
    };
    const prepared = attachment(state, document, replacementSourceId);
    if (prepared.error) return prepared.error;
    // Reserving metadata before the deterministic key prevents concurrent retries
    // from overwriting bytes. Interrupted reservations remain safely retryable.
    const storageBackend = row?.metadata.storageBackend ?? deps.store.uploadBackend ?? 'r2';
    const objectKey = row?.objectKey ?? await evidenceObjectLocation(state, identity.owner, identity.id, target.folderId, name, storageBackend);
    row = await deps.repository.registerObject({ id: identity.id, ownerId: user.userId, caseId, objectKey, metadata: { ...document, contentHash, uploadReplacementSourceId: replacementSourceId, uploadOriginalName: name, storageBackend }, createdAt: uploadedAt }, expectedRevision);
    if (!row) return conflict('This case changed before the upload. Review the latest case and retry.', await deps.repository.readCase(user.userId));
    if (row.deletedAt) { await cleanDeletedUpload(row, deps); return error('This upload was deleted. Select the file again to create a new upload.', 410, 'file_deleted'); }
    if (!matchesUpload(row, name, file.size, contentHash, replacementSourceId)) return conflict('This upload attempt belongs to a different file. Choose the file again.', await deps.repository.readCase(user.userId), 'upload_id_conflict');
    state = await deps.repository.readCase(user.userId);
    const beforeWriteGuard = caseGuard(state, caseId);
    if (beforeWriteGuard || !state) return beforeWriteGuard!;
    const completedRetry = state.documents.find(item => !item.sample && item.objectId === row!.id);
    if (completedRetry) return json({ document: { ...publicDocument(row), folderId: completedRetry.folderId ?? null }, state, revision: state.revision });
    if (state.revision !== expectedRevision) return conflict('This case changed before the upload. Review the latest case and retry.', state);
    if (!state.consent) return error('Save your processing consent before uploading documents.', 403, 'consent_required');
    try { await deps.store.putIfAbsent(row.objectKey, bytes, { owner: identity.owner, caseId, contentHash }); }
    catch (writeError) {
      if ((await deps.repository.readObject(user.userId, caseId, row.id))?.deletedAt) {
        await cleanDeletedUpload(row, deps);
        return error('This upload was deleted.', 410, 'file_deleted');
      }
      throw writeError;
    }
    // A deletion can win while the object is writing. Never leave bytes recreated by that late write.
    if ((await deps.repository.readObject(user.userId, caseId, row.id))?.deletedAt) {
      await cleanDeletedUpload(row, deps);
      return error('This upload was deleted.', 410, 'file_deleted');
    }
    state = await deps.repository.readCase(user.userId);
    const afterWriteGuard = caseGuard(state, caseId);
    if (afterWriteGuard || !state) return afterWriteGuard!;
    const attached = state.documents.find(item => !item.sample && item.objectId === row!.id);
    if (attached) return json({ document: { ...publicDocument(row), folderId: attached.folderId ?? null }, state, revision: state.revision });
    if (state.revision !== expectedRevision) return conflict('The file is stored, but your case changed before it could be attached. Review the latest case and retry this file.', state);
    if (!state.consent) return error('Processing consent was withdrawn. The file was not attached.', 403, 'consent_required');
    target = destination(state, folderProvided, folderId, replacementSourceId);
    if (target.error) return target.error;
    const rawDocument = { ...publicDocument(row), folderId: target.folderId };
    const final = attachment(state, rawDocument, replacementSourceId);
    if (final.error || !final.state) return final.error!;
    if (!await deps.repository.saveCase(user.userId, caseId, expectedRevision, final.state)) {
      if ((await deps.repository.readObject(user.userId, caseId, row.id))?.deletedAt) {
        await cleanDeletedUpload(row, deps);
        return error('This upload was deleted.', 410, 'file_deleted');
      }
      const latest = await deps.repository.readCase(user.userId);
      const concurrentAttachment = latest?.id === caseId && latest.documents.find(item => !item.sample && item.objectId === row!.id);
      if (concurrentAttachment) return json({ document: { ...rawDocument, folderId: concurrentAttachment.folderId ?? null }, state: latest, revision: latest!.revision });
      return conflict('The file is stored, but your case changed before it could be attached. Review the latest case and retry this file.', latest, latest?.id !== caseId ? 'case_changed' : 'revision_conflict');
    }
    return json({ document: rawDocument, state: final.state, revision: final.state.revision }, 201);
  } catch { return error('The upload could not be completed. Retry the same file.', 503, 'upload_failed'); }
}

export function attachmentDisposition(name: string): string {
  const filename = safeFilename(name).replace(/[\x7f]/g, '') || 'document';
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, value => `%${value.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
export async function handleEvidenceRename(request: Request, deps: EvidenceStorageDependencies): Promise<Response> {
  try {
    const user = await deps.getUser();
    if (!user) return error('Sign in to rename evidence.', 401, 'session_expired');
    if (!matchesExpectedAccount(request, user.userId)) return error('Your session changed. Sign in to the account used in this tab before continuing.', 401, 'session_changed');
    if (request.headers.get('origin') !== new URL(request.url).origin) return error('This request did not originate from this app.', 403, 'invalid_origin');
    if (request.headers.get('content-type')?.split(';', 1)[0].trim() !== 'application/json') return error('Send the rename request as JSON.', 415, 'invalid_content_type');
    const bytes = await readLimitedBody(request, 4096);
    if (!bytes) return error('The rename request is too large.', 413, 'invalid_rename');
    let body: { caseId?: unknown; expectedRevision?: unknown; objectId?: unknown; name?: unknown };
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return error('The rename request is invalid.', 400, 'invalid_rename'); }
    if (!body || typeof body !== 'object' || typeof body.caseId !== 'string' || !body.caseId || body.caseId.length > 150 || typeof body.objectId !== 'string' || !body.objectId || body.objectId.length > 150 || !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0 || Number(body.expectedRevision) > 2147483646 || typeof body.name !== 'string') return error('Reload your case and select the file again.', 400, 'invalid_rename');
    const name = body.name.trim(), expectedRevision = Number(body.expectedRevision);
    if (!validUploadName(name) || safeFilename(name) !== name || /[\x7f]/.test(name)) return error('Use a valid filename without folders or control characters.', 422, 'invalid_filename');
    const state = await deps.repository.readCase(user.userId);
    const guard = caseGuard(state, body.caseId); if (guard || !state) return guard!;
    const document = state.documents.find(item => !item.sample && item.objectId === body.objectId);
    const row = await deps.repository.readObject(user.userId, body.caseId, body.objectId);
    if (!document || !row || row.deletedAt) return error('This file is not available in the current case.', 404, 'file_not_found');
    if (name.split('.').pop()!.toLowerCase() !== document.name.split('.').pop()!.toLowerCase()) return error('Keep the existing file extension when renaming.', 422, 'extension_changed');
    if (document.name === name && row.metadata.name === name) return json({ document, state, revision: state.revision });
    if (state.revision !== expectedRevision) return conflict('This case changed before the rename. Review the latest case and retry.', state);
    if (!deps.repository.renameObject) return error('Evidence rename is temporarily unavailable.', 503, 'rename_unavailable');
    const next = structuredClone(state); next.revision++; next.updatedAt = new Date().toISOString();
    const renamed = next.documents.find(item => item.objectId === body.objectId)!; renamed.name = name;
    if (!caseSchema.safeParse(next).success || new TextEncoder().encode(JSON.stringify({ state: next, expectedRevision })).byteLength > MAX_CASE_BODY) return error('The renamed case cannot be saved safely.', 422, 'invalid_state');
    if (!await deps.repository.renameObject(user.userId, body.caseId, body.objectId, expectedRevision, name, next)) return conflict('This case changed before the rename. Review the latest case and retry.', await deps.repository.readCase(user.userId));
    return json({ document: renamed, state: next, revision: next.revision });
  } catch { return error('The file could not be renamed. Please retry.', 503, 'rename_failed'); }
}
export async function handleEvidenceRead(request: Request, deps: EvidenceStorageDependencies): Promise<Response> {
  try {
    const user = await deps.getUser();
    if (!user) return error('Sign in to open evidence.', 401, 'session_expired');
    if (!matchesExpectedAccount(request, user.userId)) return error('Your session changed. Sign in to the account used in this tab before continuing.', 401, 'session_changed');
    const url = new URL(request.url), caseId = url.searchParams.get('caseId'), objectId = url.searchParams.get('objectId');
    if (!caseId || caseId.length > 150 || !objectId || objectId.length > 150) return error('Specify a case and stored file.', 400, 'invalid_file');
    const state = await deps.repository.readCase(user.userId);
    if (!state || state.id !== caseId) return conflict('The active case changed. Reload before opening files.', state, 'case_changed');
    if (state.mode !== 'personal' || !state.documents.some(document => !document.sample && document.objectId === objectId)) return error('This file is not available in the current case.', 404, 'file_not_found');
    const row = await deps.repository.readObject(user.userId, caseId, objectId);
    if (!row || row.deletedAt) return error('This file is not available in the current case.', 404, 'file_not_found');
    const document = publicDocument(row);
    if (!deps.store) return error('Evidence storage is not configured.', 503, 'storage_unavailable');
    const object = await deps.store.get(row.objectKey);
    if (!object) return error('The stored file could not be found.', 404, 'file_not_found');
    if (object.size !== document.bytes || object.size > MAX_FILE_BYTES) return error('The stored file could not be verified.', 503, 'file_unavailable');
    const latest = await deps.repository.readCase(user.userId);
    if (!latest || latest.id !== caseId) return conflict('The active case changed. Reload before opening files.', latest, 'case_changed');
    if (!latest.documents.some(item => !item.sample && item.objectId === objectId)) return error('This file is no longer attached to the current case.', 404, 'file_not_found');
    return new Response(object.body, { status: 200, headers: {
      'Content-Type': 'application/octet-stream', 'Content-Length': String(object.size),
      'Content-Disposition': attachmentDisposition(document.name), 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'none'",
      'Cross-Origin-Resource-Policy': 'same-origin',
    } });
  } catch { return error('The stored file could not be opened. Please retry.', 503, 'file_unavailable'); }
}

async function cleanDeletion(job: EvidenceDeletionJob, deps: EvidenceStorageDependencies): Promise<boolean> {
  if (job.completedAt) return true;
  if (!deps.deletions || !deps.store?.delete) return false;
  try {
    // Routed object deletion is idempotent, including a lost response or DB write.
    for (let offset = 0; offset < job.objectKeys.length; offset += 500) await deps.store.delete(job.objectKeys.slice(offset, offset + 500));
    return await deps.deletions.complete(job) !== false;
  } catch { return false; }
}

/** Resume durable cleanup on ordinary workspace loads; no user files become readable again. */
export async function resumeEvidenceDeletions(ownerId: string, deps: EvidenceStorageDependencies): Promise<void> {
  if (!deps.deletions || !deps.store?.delete) return;
  try { for (const job of (await deps.deletions.pendingJobs(ownerId)).slice(0, 5)) await cleanDeletion(job, deps); }
  catch { /* A failed retry stays queued. It must not prevent opening the workspace. */ }
}

export async function handleEvidenceDelete(request: Request, deps: EvidenceStorageDependencies): Promise<Response> {
  try {
    const user = await deps.getUser();
    if (!user) return error('Sign in to delete evidence.', 401, 'session_expired');
    if (!matchesExpectedAccount(request, user.userId)) return error('Your session changed. Sign in to the account used in this tab before continuing.', 401, 'session_changed');
    if (request.headers.get('origin') !== new URL(request.url).origin) return error('This deletion request did not originate from this app.', 403, 'invalid_origin');
    if (request.headers.get('content-type')?.split(';', 1)[0].trim() !== 'application/json') return error('Send a deletion request as JSON.', 415, 'invalid_content_type');
    const bytes = await readLimitedBody(request, 4096);
    if (!bytes) return error('The deletion request is too large.', 413, 'invalid_delete');
    let body: { caseId?: unknown; expectedRevision?: unknown; deletionId?: unknown; target?: { kind?: unknown; id?: unknown } };
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return error('The deletion request is invalid.', 400, 'invalid_delete'); }
    if (!body || typeof body !== 'object' || typeof body.caseId !== 'string' || !body.caseId || body.caseId.length > 150 || !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0 || Number(body.expectedRevision) > 2147483646 || typeof body.deletionId !== 'string' || !UUID.test(body.deletionId) || !body.target || !['file', 'folder'].includes(String(body.target.kind)) || typeof body.target.id !== 'string' || !body.target.id || body.target.id.length > 150) return error('Reload your case and select the item again.', 400, 'invalid_delete');
    if (!deps.deletions || !deps.store?.delete) return error('Evidence deletion is temporarily unavailable.', 503, 'storage_unavailable');
    await resumeEvidenceDeletions(user.userId, deps);
    const caseId = body.caseId, expectedRevision = Number(body.expectedRevision), target = body.target as EvidenceDeleteTarget;
    const jobId = await sha256(new TextEncoder().encode(JSON.stringify([user.userId, caseId, body.deletionId.toLowerCase()])).buffer as ArrayBuffer);
    let state = await deps.repository.readCase(user.userId);
    const guard = caseGuard(state, caseId); if (guard || !state) return guard!;
    let job = await deps.deletions.readJob(user.userId, caseId, jobId);
    if (job && (job.target.kind !== target.kind || job.target.id !== target.id)) return error('This deletion request belongs to another item.', 409, 'delete_id_conflict');
    if (!job) {
      if (state.revision !== expectedRevision) return conflict('This case changed before deletion. Review the latest case and try again.', state);
      let selected: ReturnType<typeof evidenceDeletionSelection>;
      try { selected = evidenceDeletionSelection(state, target); } catch { return error('This file or folder no longer exists.', 404, 'item_not_found'); }
      const objects = await deps.deletions.sourceObjects(user.userId, caseId, selected.documents.map(document => document.id), selected.documents.flatMap(document => document.objectId ? [document.objectId] : []));
      if (selected.documents.some(document => document.sample || !document.objectId || !objects.some(row => row.id === document.objectId && !row.deletedAt))) return error('A file could not be verified as belonging to this case. Reload before deleting.', 422, 'invalid_evidence');
      const next = applyAction(state, { type: 'delete_evidence', target }); next.revision = state.revision + 1;
      if (!caseSchema.safeParse(next).success) return error('This case could not be updated safely.', 422, 'invalid_state');
      job = { id: jobId, ownerId: user.userId, caseId, target, expectedRevision, objectKeys: [...new Set(objects.map(row => row.objectKey))], deletedFiles: selected.documents.length, deletedFolders: selected.folderIds.size, createdAt: new Date().toISOString(), completedAt: null };
      if (!await deps.deletions.commit(job, selected.documents.map(document => document.id), objects.map(row => row.id), next)) {
        const existing = await deps.deletions.readJob(user.userId, caseId, jobId);
        if (existing && existing.target.kind === target.kind && existing.target.id === target.id) job = existing;
        else return conflict('This case changed before deletion. Review the latest case and try again.', await deps.repository.readCase(user.userId));
      }
      // The transaction may include replacement uploads registered after the
      // earlier ownership check. Cleanup must use its authoritative key list.
      job = await deps.deletions.readJob(user.userId, caseId, jobId);
      if (!job) return error('Deletion status could not be read. Retry the same item.', 503, 'delete_failed');
    }
    const cleanupPending = !await cleanDeletion(job, deps);
    state = await deps.repository.readCase(user.userId);
    if (!state || state.id !== caseId) return conflict('The active case changed. Reload before continuing.', state, 'case_changed');
    return json({ state, revision: state.revision, deletedFiles: job.deletedFiles, deletedFolders: job.deletedFolders, cleanupPending });
  } catch { return error('Deletion could not be completed. Retry the same item to check its status.', 503, 'delete_failed'); }
}
