import type { CaseRule, DomainContext, FormTemplate, IntegrationCase, ModuleConfig, UploadSession } from './contracts.ts';
import { createIntegrationCase, DomainError, executeCommand, getRunSources, readResource } from './domain.ts';
import type { CaseEnvelope, CaseRepository, SavedResponse } from './repository.ts';
import type { ObjectStore } from './provider-contracts.ts';
import { ProviderError, validateUpload } from './providers.ts';
import { ApiError, mutateCase, requestKey, unavailable } from './transactions.ts';
import { canonicalHash, verifyWorkerCapability } from './security.ts';

export interface ApiDependencies {
  repository: CaseRepository;
  actorId?: string;
  modules: ModuleConfig[];
  formTemplates: FormTemplate[];
  caseRule?: CaseRule;
  store?: ObjectStore;
  workerSecret?: string;
  now?: () => string;
  executeJob?: (caseId: string, jobId: string) => Promise<unknown>;
}

const safe = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(safe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['owner_id', 'storage_key', 'rendition_storage_key', 'raw_extraction_storage_key', 'lease_token'].includes(key)).map(([key, item]) => [key, safe(item)]));
  return value;
};
function json(data: unknown, status: number, requestId: string) {
  return Response.json(safe(data), { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Request-ID': requestId, 'X-Schema-Version': '1', ...(status === 429 ? { 'Retry-After': '60' } : {}) } });
}
export async function readBytes(request: Request, limit: number): Promise<Uint8Array> {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new ApiError(413, 'body_too_large', 'The request exceeds its size limit.');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const result = await reader.read(); if (result.done) break; length += result.value.byteLength; if (length > limit) { await reader.cancel(); throw new ApiError(413, 'body_too_large', 'The request exceeds its size limit.'); } chunks.push(result.value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}
async function body(request: Request) {
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw new ApiError(415, 'json_required', 'Send a JSON request body.');
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(await readBytes(request, 512 * 1024))); }
  catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, 'invalid_json', 'The request contains invalid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(422, 'invalid_fields', 'Send a JSON object.');
  const data = value as Record<string, unknown>;
  const match = request.headers.get('if-match');
  if (match) {
    if (!/^(?:[1-9]\d*|"[1-9]\d*")$/.test(match)) throw new ApiError(422, 'invalid_revision', 'If-Match must contain an exact positive revision.');
    const expected = Number(match.replaceAll('"', ''));
    if (!Number.isSafeInteger(expected)) throw new ApiError(422, 'invalid_revision', 'If-Match must contain an exact positive revision.');
    if (data.expected_revision !== undefined && data.expected_revision !== expected) throw new ApiError(422, 'invalid_revision', 'If-Match and expected_revision disagree.');
    data.expected_revision = expected;
  }
  return data;
}
function only(data: Record<string, unknown>, fields: string[]) { if (Object.keys(data).some(k => !fields.includes(k))) throw new ApiError(422, 'invalid_fields', 'The request contains unsupported fields.'); }
function storage(deps: ApiDependencies): ObjectStore { if (!deps.store) throw new ApiError(503, 'storage_unavailable', 'Private evidence storage is not configured.'); return deps.store; }
function uploadGrant(state: IntegrationCase, session: UploadSession) {
  return { ...session, upload_grant: { method: 'PUT', url: `/v1/cases/${state.case_id}/upload-sessions/${session.upload_id}/content`, expires_at: session.expires_at, max_bytes: session.bytes, media_type: session.media_type, sha256: session.sha256, authentication: 'current_session' } };
}
function assertSession(session: UploadSession | undefined, now: string): asserts session is UploadSession {
  if (!session) throw unavailable();
  if (session.state !== 'pending') throw new ApiError(409, 'upload_closed', 'This upload session is closed.');
  if (Date.parse(session.expires_at) <= Date.parse(now)) throw new ApiError(422, 'upload_expired', 'Renew this upload session before transferring bytes.');
}
function bytesResponse(request: Request, stored: { bytes: Uint8Array; sha256: string }, mime: string, requestId: string, filename: string) {
  const bytes = stored.bytes, headers = new Headers({ 'Content-Type': mime, 'Content-Disposition': `inline; filename="${filename}"`, 'Content-Length': String(bytes.length), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Request-ID': requestId, ETag: `"${stored.sha256}"` });
  const range = request.headers.get('range');
  if (!range) return new Response(bytes.slice().buffer as ArrayBuffer, { headers });
  const parts = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!parts || (!parts[1] && !parts[2])) throw new ApiError(416, 'invalid_range', 'Request one valid byte range.');
  const start = parts[1] ? Number(parts[1]) : Math.max(0, bytes.length - Number(parts[2]));
  const end = parts[1] && parts[2] ? Math.min(Number(parts[2]), bytes.length - 1) : bytes.length - 1;
  if (!Number.isSafeInteger(start) || start < 0 || start >= bytes.length || end < start) throw new ApiError(416, 'invalid_range', 'The requested range is unavailable.');
  headers.set('Content-Range', `bytes ${start}-${end}/${bytes.length}`); headers.set('Content-Length', String(end - start + 1));
  return new Response(bytes.slice(start, end + 1).buffer as ArrayBuffer, { status: 206, headers });
}

export async function handleIntegrationRequest(request: Request, deps: ApiDependencies): Promise<Response> {
  const requestId = crypto.randomUUID(), now = deps.now?.() || new Date().toISOString();
  try {
    const url = new URL(request.url), parts = url.pathname.split('/').filter(Boolean);
    if (parts.shift() !== 'v1' || parts.some(p => !/^[A-Za-z0-9_-]{1,100}$/.test(p))) throw unavailable();
    const isWorker = request.headers.get('authorization')?.startsWith('Bearer ') || parts[0] === 'internal';
    const capability = isWorker ? await verifyWorkerCapability(request.headers.get('authorization')?.slice(7) || '', deps.workerSecret, Date.parse(now)) : null;
    if (isWorker && !capability) throw new ApiError(401, 'worker_authentication_required', 'A valid job-scoped worker capability is required.');
    if (!isWorker && !deps.actorId) throw new ApiError(401, 'authentication_required', 'Sign in to access your case.');
    if (!['GET', 'HEAD'].includes(request.method) && !isWorker && request.headers.get('origin') !== url.origin) throw new ApiError(403, 'origin_required', 'Use the authenticated application origin for this mutation.');
    if (parts[0] === 'criterion-modules' && parts.length === 1 && request.method === 'GET' && !isWorker) {
      return json({ schema_version: '1', items: deps.modules.filter(m => m.active).map(module => Object.fromEntries(Object.entries(module).filter(([key]) => key !== 'instructions'))) }, 200, requestId);
    }
    const ctx: DomainContext = { actorId: deps.actorId || 'worker', now, role: isWorker ? 'worker' : 'applicant', modules: deps.modules, formTemplates: deps.formTemplates, caseRule: deps.caseRule, correlationId: requestId, causationId: requestId };
    if (parts[0] === 'cases' && parts.length === 1 && !isWorker) {
      if (request.method === 'GET') { const existing = await deps.repository.find(deps.actorId!); return json({ items: existing ? [readResource(existing.state, 'case', undefined, {}, ctx)] : [] }, 200, requestId); }
      if (request.method === 'POST') {
        const data = await body(request); only(data, ['processing_consent']);
        if (typeof data.processing_consent !== 'boolean') throw new ApiError(422, 'consent_required', 'Specify processing_consent as true or false.');
        const key = requestKey(request), hash = await canonicalHash(data), receiptKey = await canonicalHash({ actor: deps.actorId, key, operation: 'case.create' });
        const existing = await deps.repository.find(deps.actorId!);
        if (existing) {
          const receipt = existing.receipts[receiptKey];
          if (receipt && receipt.hash === hash) return json(receipt.response.data, receipt.response.status, requestId);
          throw new ApiError(409, receipt ? 'idempotency_conflict' : 'case_exists', receipt ? 'This key was used with different inputs.' : 'An active preparation case already exists. Use GET /v1/cases.');
        }
        const state = createIntegrationCase(crypto.randomUUID(), deps.actorId!, now), response = { status: 201, data: readResource(state, 'case', undefined, {}, ctx) };
        const envelope: CaseEnvelope = { state, processing_consent: data.processing_consent, receipts: { [receiptKey]: { operation: 'case.create', hash, response, created_at: now } } };
        if (!await deps.repository.insert(envelope)) {
          const concurrent = await deps.repository.find(deps.actorId!); const receipt = concurrent?.receipts[receiptKey];
          if (receipt?.hash === hash) return json(receipt.response.data, receipt.response.status, requestId);
          throw new ApiError(409, 'case_exists', 'A preparation case was created concurrently. Reload your cases.');
        }
        return json(response.data, response.status, requestId);
      }
    }
    if (parts[0] === 'internal') parts.shift();
    if (parts[0] !== 'cases' || !parts[1]) throw unavailable();
    const caseId = parts[1];
    if (capability && capability.case_id !== caseId) throw unavailable();
    const loaded = capability ? await deps.repository.findForWorker(caseId) : await deps.repository.find(deps.actorId!, caseId); if (!loaded) throw unavailable();
    const state = loaded.state, [, , resource, resourceId, action] = parts;
    if (capability) {
      if (!loaded.processing_consent) throw new ApiError(403, 'consent_required', 'Processing consent has been withdrawn.');
      const job = state.jobs[capability.job_id]; if (!job) throw unavailable();
      ctx.workerScope = { jobId: job.job_id, ...(job.kind === 'criterion' ? { runId: job.object_id } : {}) };
      if (parts.length === 5 && resource === 'jobs' && resourceId === job.job_id && action === 'execute' && request.method === 'POST') {
        if (!deps.executeJob) throw new ApiError(503, 'worker_unavailable', 'The job processor is not configured.');
        return json(await deps.executeJob(caseId, job.job_id), 200, requestId);
      }
      if (parts.length === 5 && resource === 'criterion-runs' && resourceId === job.object_id && action === 'sources' && request.method === 'GET') return json({ items: getRunSources(state, resourceId, ctx) }, 200, requestId);
      if (!(parts.length === 5 && resource === 'criterion-runs' && resourceId === job.object_id && action === 'results' && request.method === 'POST')) throw unavailable();
    }
    if (request.method === 'GET' && !capability) {
      if (parts.length === 2) return json({ ...readResource(state, 'case', undefined, {}, ctx) as object, processing_consent: !!loaded.processing_consent }, 200, requestId);
      if (parts.length === 5 && resource === 'documents' && action === 'view') {
        const document = state.documents[resourceId]; if (!document || document.state !== 'ready' || document.scan_result !== 'clean') throw unavailable();
        const key = document.rendition_storage_key || document.storage_key;
        const object = await storage(deps).get(key, document.rendition_storage_key ? document.rendition_storage_version_id : document.storage_version_id);
        if (object.sha256 !== (document.rendition_storage_key ? document.rendition_sha256 : document.sha256)) throw new ApiError(409, 'source_integrity', 'The pinned source cannot be verified.');
        return bytesResponse(request, object, document.rendition_storage_key ? 'application/pdf' : document.media_type, requestId, `${document.document_version_id}.pdf`);
      }
      if (parts.length === 5 && resource === 'exports' && ['preview', 'download'].includes(action)) {
        const packet = state.exports[resourceId]; if (!packet?.storage_key || (action === 'download' && packet.state !== 'final_approved')) throw unavailable();
        const object = await storage(deps).get(packet.storage_key, packet.storage_version_id);
        if (object.sha256 !== packet.packet_digest || object.size !== packet.bytes) throw new ApiError(409, 'packet_integrity', 'The pinned packet cannot be verified.');
        return bytesResponse(request, object, 'application/pdf', requestId, `${packet.export_id}.pdf`);
      }
      if (parts.length <= 4) return json(readResource(state, resource, resourceId, Object.fromEntries(url.searchParams), ctx), 200, requestId);
      throw unavailable();
    }
    const key = requestKey(request);
    if (!capability && request.method === 'PUT' && resource === 'upload-sessions' && parts.length === 5 && action === 'content') {
      if (!loaded.processing_consent) throw new ApiError(403, 'consent_required', 'Confirm processing consent before uploading evidence.');
      const session = state.upload_sessions[resourceId]; if (!session) throw unavailable();
      const bytes = await readBytes(request, session.bytes), checked = await validateUpload(bytes, session.media_type, session.sha256);
      if (bytes.length !== session.bytes) throw new ApiError(422, 'upload_mismatch', 'The uploaded size does not match the session.');
      const result = await mutateCase(deps.repository, state.owner_id, caseId, { key, operation: `upload.content:${resourceId}`, payload: { sha256: session.sha256, bytes: bytes.length }, now }, async envelope => {
        if (!envelope.processing_consent) throw new ApiError(403, 'consent_required', 'Processing consent has been withdrawn.');
        assertSession(envelope.state.upload_sessions[resourceId], deps.now?.() || new Date().toISOString());
        const object = await storage(deps).put(session.storage_key, bytes, checked.contentType);
        assertSession(envelope.state.upload_sessions[resourceId], deps.now?.() || new Date().toISOString());
        envelope.upload_objects ||= {}; envelope.upload_objects[resourceId] = object;
        return { status: 200, data: { upload_id: resourceId, bytes: object.size, sha256: object.sha256 } };
      });
      return json(result.data, result.status, requestId);
    }
    const data = await body(request);
    let operation = '', input: Record<string, unknown> = data, status = request.method === 'POST' ? 201 : 200;
    const bind = (field: string, id: string) => { if (data[field] !== undefined && data[field] !== id) throw new ApiError(422, 'invalid_fields', 'The path and body identify different resources.'); return { ...data, [field]: id }; };
    if (request.method === 'POST') {
      if (parts.length === 3) operation = ({ facts: 'fact.create', 'upload-sessions': 'upload.create', 'criterion-links': 'link.create', 'criterion-runs': 'run.create', compositions: 'composition.create', 'form-previews': 'form.preview', exports: 'export.create' } as Record<string, string>)[resource] || '';
      if (parts.length === 3 && resource === 'engagements') throw new ApiError(422, 'reviewer_unavailable', 'Reviewer engagements are not enabled in this release.');
      if (parts.length === 5 && resource === 'upload-sessions' && action === 'renew') { operation = 'upload.renew'; input = bind('upload_id', resourceId); }
      if (parts.length === 5 && resource === 'upload-sessions' && action === 'confirm') { operation = 'upload.confirm'; only(data, []); input = { upload_id: resourceId }; }
      if (parts.length === 5 && resource === 'criterion-runs' && action === 'results') { if (!capability) throw new ApiError(403, 'worker_only', 'Only the assigned worker may publish a result.'); operation = 'run.publish'; input = bind('run_id', resourceId); }
      if (parts.length === 5 && resource === 'criterion-results' && action === 'reviews') { operation = 'result.review'; input = bind('result_id', resourceId); }
      if (parts.length === 5 && resource === 'exports' && action === 'confirm') { operation = 'export.confirm'; input = bind('export_id', resourceId); status = 200; }
      if (parts.length === 5 && resource === 'jobs' && ['cancel', 'retry'].includes(action)) { operation = `job.${action}`; input = bind('job_id', resourceId); status = 200; }
      if (parts.length === 3 && resource === 'draft-jobs') operation = 'draft.orchestrate';
    }
    if (request.method === 'PATCH' && parts.length === 4) {
      operation = ({ facts: 'fact.update', 'criterion-links': 'link.update', 'criterion-results': 'result.edit' } as Record<string, string>)[resource] || '';
      const field = ({ facts: 'fact_id', 'criterion-links': 'link_id', 'criterion-results': 'result_id' } as Record<string, string>)[resource]; if (field) input = bind(field, resourceId);
    }
    if (request.method === 'PATCH' && parts.length === 3 && resource === 'consent') operation = 'case.consent';
    if (request.method === 'PATCH' && parts.length === 5 && resource === 'compositions' && action === 'analysis') { operation = 'composition.analysis'; input = bind('composition_id', resourceId); }
    if (request.method === 'PATCH' && parts.length === 5 && resource === 'compositions' && action === 'events') { operation = 'composition.events'; input = bind('composition_id', resourceId); }
    if (request.method === 'PATCH' && parts.length === 5 && resource === 'compositions' && action === 'issues') { operation = 'composition.issues'; input = bind('composition_id', resourceId); }
    if (request.method === 'DELETE' && parts.length === 4 && resource === 'documents') { operation = 'document.remove'; input = bind('document_version_id', resourceId); }
    if (resource === 'drafts' && parts[4] === 'paragraphs' && parts[5] && ((parts.length === 6 && request.method === 'PATCH') || (parts.length === 7 && parts[6] === 'reviews' && request.method === 'POST'))) {
      operation = request.method === 'PATCH' ? 'paragraph.edit' : 'paragraph.review';
      if (data.paragraph_id !== undefined && data.paragraph_id !== parts[5]) throw new ApiError(422, 'invalid_fields', 'Paragraph identity mismatch.');
      input = { ...bind('draft_id', resourceId), paragraph_id: parts[5] };
    }
    if (!operation) throw unavailable();
    const response = await mutateCase(deps.repository, state.owner_id, caseId, { key, operation: `${operation}:${resourceId || ''}`, payload: input, now }, async envelope => {
      if (capability && !envelope.processing_consent) throw new ApiError(403, 'consent_required', 'Processing consent has been withdrawn.');
      if (operation === 'case.consent') {
        only(input, ['processing_consent', 'expected_revision']);
        if (typeof input.processing_consent !== 'boolean' || !Number.isSafeInteger(input.expected_revision)) throw new ApiError(422, 'invalid_fields', 'Specify processing_consent and the expected case revision.');
        if (input.expected_revision !== envelope.state.revision) throw new ApiError(409, 'revision_conflict', 'The case changed. Reload before changing consent.', false, envelope.state.revision);
        envelope.processing_consent = input.processing_consent;
        if (!input.processing_consent) for (const job of Object.values(envelope.state.jobs)) if (['queued', 'running'].includes(job.state)) await executeCommand(envelope.state, 'job.cancel', { job_id: job.job_id }, ctx);
        envelope.state.outbox.push({ event_id: crypto.randomUUID(), schema_version: '1', case_id: caseId, type: 'consent.changed', object_id: caseId, object_revision: envelope.state.revision + 1, occurred_at: now, correlation_id: requestId, causation_id: requestId });
        return { status: 200, data: { processing_consent: input.processing_consent, revision: envelope.state.revision + 1 } };
      }
      if (['upload.create', 'upload.confirm', 'run.create', 'draft.orchestrate', 'export.create', 'job.retry'].includes(operation) && !envelope.processing_consent) throw new ApiError(403, 'consent_required', 'Processing consent is required for this operation.');
      let authoritativeInput = input;
      if (operation === 'upload.confirm') {
        const session = envelope.state.upload_sessions[resourceId]; if (!session) throw unavailable();
        const saved = envelope.upload_objects?.[resourceId]; if (!saved) throw new ApiError(422, 'upload_incomplete', 'Transfer the evidence bytes before confirmation.');
        const object = await storage(deps).get(session.storage_key, saved.version);
        const checked = await validateUpload(object.bytes, session.media_type, session.sha256);
        authoritativeInput = { upload_id: resourceId, storage_version_id: object.version, bytes: object.size, sha256: checked.sha256, media_type: checked.contentType };
      }
      if (operation === 'draft.orchestrate') {
        only(input, ['selected_criteria', 'selected_results', 'case_wide_document_ids', 'case_wide_fact_ids']);
        const composition = await executeCommand(envelope.state, 'composition.create', input, ctx);
        const runs: unknown[] = [], blockers: {criterion_id: string; code: string; message: string}[] = [];
        for (const criterionId of input.selected_criteria as string[]) {
          if ((input.selected_results as {criterion_id: string}[]).some(selection => selection.criterion_id === criterionId)) continue;
          try { runs.push(await executeCommand(envelope.state, 'run.create', { criterion_id: criterionId }, ctx)); }
          catch (error) { if (!(error instanceof DomainError)) throw error; blockers.push({ criterion_id: criterionId, code: error.code, message: error.message }); }
        }
        return { status: 201, data: { composition, runs, blockers } };
      }
      const value = await executeCommand(envelope.state, operation, authoritativeInput, { ...ctx, now: deps.now?.() || new Date().toISOString() });
      const superseded = operation === 'run.publish' && (value as { publication?: string }).publication === 'superseded';
      if (superseded) return { status: 409, data: { code: 'stale_run', message: 'The obsolete outcome was retained as superseded.', request_id: requestId, retryable: false, result: value } };
      return { status, data: ['upload.create', 'upload.renew'].includes(operation) ? uploadGrant(envelope.state, value as UploadSession) : value } satisfies SavedResponse;
    });
    return json(response.data, response.status, requestId);
  } catch (error) {
    if (error instanceof ApiError || error instanceof DomainError || error instanceof ProviderError) return json({ code: error.code, message: error.message, request_id: requestId, retryable: 'retryable' in error ? error.retryable : false, ...('currentRevision' in error && error.currentRevision !== undefined ? { current_revision: error.currentRevision } : {}), ...(error instanceof DomainError && error.fieldErrors ? { field_errors: error.fieldErrors } : {}) }, error.status, requestId);
    return json({ code: 'service_unavailable', message: 'The service is temporarily unavailable. Retry using the same idempotency key.', request_id: requestId, retryable: true }, 503, requestId);
  }
}
