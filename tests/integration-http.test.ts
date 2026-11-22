import test from 'node:test';
import assert from 'node:assert/strict';
import { handleIntegrationRequest, type ApiDependencies } from '../lib/integrations/http.ts';
import { MemoryCaseRepository, type CaseEnvelope } from '../lib/integrations/repository.ts';
import { executeCommand } from '../lib/integrations/domain.ts';
import { sha256, ProviderError } from '../lib/integrations/providers.ts';
import { signWorkerCapability } from '../lib/integrations/security.ts';
import type { ObjectStore, StoredObject } from '../lib/integrations/provider-contracts';
import type { ModuleConfig } from '../lib/integrations/contracts';

const origin = 'https://harness.example.test';
const instant = '2026-11-22T15:00:00.000Z';
const pdf = new TextEncoder().encode('%PDF-1.7\nSynthetic HTTP fixture\n%%EOF');
const workerSecret = 'synthetic-worker-secret-with-at-least-32-characters';
const moduleFixture: ModuleConfig = {
  criterion_id: 'C08', module_version: '1', rule_pack_version: '1', prompt_version: '1', output_schema_version: '1',
  evaluation_version: '1', model: 'fixture-model', active: true, activation_approval: 'fixture-review',
  instructions: 'Use supplied sources only.', required_fact_keys: [], required_element_ids: ['role-element'], authority_refs: ['fixture-authority'],
};
class MemoryStore implements ObjectStore {
  objects = new Map<string, StoredObject & { bytes: Uint8Array }>();
  reads: { key: string; version?: string }[] = [];
  puts = 0;
  async put(key: string, bytes: Uint8Array, contentType: string) {
    const digest = await sha256(bytes), prior = this.objects.get(key);
    if (prior) { if (prior.sha256 !== digest) throw new ProviderError('immutable_object', 'An immutable object cannot change.', 409); return prior; }
    this.puts++;
    const result = { key, version: `version-${this.puts}`, sha256: digest, size: bytes.length, contentType, bytes: bytes.slice() };
    this.objects.set(key, result);
    return result;
  }
  async get(key: string, version?: string) {
    this.reads.push({ key, version });
    const result = this.objects.get(key);
    if (!result || (version !== undefined && result.version !== version)) throw new ProviderError('storage_unavailable', 'Pinned content unavailable.', 503);
    return structuredClone(result);
  }
  async delete(key: string) { this.objects.delete(key); }
}

function request(method: string, path: string, value?: unknown, extra: Record<string, string> = {}) {
  const headers = new Headers({ Origin: origin, 'Idempotency-Key': crypto.randomUUID(), ...extra });
  let body: BodyInit | undefined;
  if (value instanceof Uint8Array) body = value.slice().buffer as ArrayBuffer;
  else if (value !== undefined) { body = JSON.stringify(value); if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json'); }
  return new Request(`${origin}${path}`, { method, headers, body });
}
async function data<T = Record<string, unknown>>(response: Response): Promise<T> { return await response.json() as T; }
async function error(response: Response, status: number, code: string) {
  assert.equal(response.status, status, JSON.stringify(await response.clone().json()));
  const result = await data(response);
  assert.equal(result.code, code); assert.equal(typeof result.request_id, 'string'); assert.equal(typeof result.retryable, 'boolean');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
}
async function fixture(repository = new MemoryCaseRepository(), consent = true) {
  let now = instant;
  const store = new MemoryStore();
  const deps: ApiDependencies = { repository, actorId: 'applicant-a', modules: [moduleFixture], formTemplates: [], store, workerSecret, now: () => now };
  const response = await handleIntegrationRequest(request('POST', '/v1/cases', { processing_consent: consent }), deps);
  assert.equal(response.status, 201);
  const created = await data<{ case_id: string }>(response), caseId = created.case_id;
  return { repository, store, deps, caseId, path: `/v1/cases/${caseId}`, setNow: (value: string) => { now = value; } };
}
async function upload(f: Awaited<ReturnType<typeof fixture>>) {
  const response = await handleIntegrationRequest(request('POST', `${f.path}/upload-sessions`, { title: 'Synthetic.pdf', media_type: 'application/pdf', bytes: pdf.length, sha256: await sha256(pdf) }), f.deps);
  assert.equal(response.status, 201);
  return await data<{ upload_id: string; document_version_id: string; document_id: string; expires_at: string; upload_grant: { url: string; sha256: string; max_bytes: number; media_type: string } }>(response);
}
async function confirmUpload(f: Awaited<ReturnType<typeof fixture>>) {
  const session = await upload(f);
  assert.equal((await handleIntegrationRequest(request('PUT', session.upload_grant.url, pdf), f.deps)).status, 200);
  const response = await handleIntegrationRequest(request('POST', `${f.path}/upload-sessions/${session.upload_id}/confirm`, {}), f.deps);
  assert.equal(response.status, 201);
  const confirmed = await data<{ job_id: string; document: { document_version_id: string } }>(response);
  return { session, ...confirmed };
}
async function readyRun(f: Awaited<ReturnType<typeof fixture>>) {
  const confirmed = await confirmUpload(f), envelope = (await f.repository.find('applicant-a', f.caseId))!;
  const revision = envelope.state.revision;
  await executeCommand(envelope.state, 'document.complete', {
    job_id: confirmed.job_id, document_version_id: confirmed.document.document_version_id, scan_result: 'clean',
    extraction: { source_artifact_id: 'artifact-http', extraction_run_id: 'extraction-http', extraction_version: '1', page_count: 1,
      blocks: [{ block_id: 'block-http', text: 'Synthetic applicant leads a team.', locator: { page_index: 1, block_id: 'block-http' }, quality: 'verified' }] },
  }, { actorId: 'worker', role: 'worker', now: instant, modules: [moduleFixture], workerScope: { jobId: confirmed.job_id } });
  envelope.state.revision++;
  assert.equal(await f.repository.compareAndSwap(envelope, revision), true);
  const linkResponse = await handleIntegrationRequest(request('POST', `${f.path}/criterion-links`, { criterion_id: 'C08', document_version_id: confirmed.document.document_version_id }), f.deps);
  const link = await data<{ link_id: string }>(linkResponse);
  assert.equal(linkResponse.status, 201);
  assert.equal((await handleIntegrationRequest(request('PATCH', `${f.path}/criterion-links/${link.link_id}`, { expected_revision: 1, state: 'confirmed' }), f.deps)).status, 200);
  const runResponse = await handleIntegrationRequest(request('POST', `${f.path}/criterion-runs`, { criterion_id: 'C08' }), f.deps);
  assert.equal(runResponse.status, 201, JSON.stringify(await runResponse.clone().json()));
  return { ...confirmed, run: await data<{ run_id: string; job_id: string }>(runResponse) };
}

test('case creation is authenticated, server scoped and idempotent', async () => {
  const repository = new MemoryCaseRepository(), deps: ApiDependencies = { repository, modules: [], formTemplates: [], now: () => instant };
  await error(await handleIntegrationRequest(request('POST', '/v1/cases', { processing_consent: true }), deps), 401, 'authentication_required');
  assert.equal(await repository.find('applicant-a'), null);
  deps.actorId = 'applicant-a';
  await error(await handleIntegrationRequest(request('POST', '/v1/cases', { processing_consent: true, owner_id: 'applicant-b' }), deps), 422, 'invalid_fields');
  const headers = { 'Idempotency-Key': 'case-create-key' };
  const first = await handleIntegrationRequest(request('POST', '/v1/cases', { processing_consent: true }, headers), deps);
  const replay = await handleIntegrationRequest(request('POST', '/v1/cases', { processing_consent: true }, headers), deps);
  assert.equal(first.status, 201); assert.equal(replay.status, 201); assert.deepEqual(await data(first), await data(replay));
  await error(await handleIntegrationRequest(request('POST', '/v1/cases', { processing_consent: false }, headers), deps), 409, 'idempotency_conflict');
  const list = await data<{ items: unknown[] }>(await handleIntegrationRequest(request('GET', '/v1/cases'), deps));
  assert.equal(list.items.length, 1); assert.equal(JSON.stringify(list).includes('owner_id'), false);
});

test('every case route rejects anonymous and cross-case access before inspecting content', async () => {
  const f = await fixture();
  const routes: [string, string][] = [
    ['GET', ''], ['PATCH', '/consent'], ['POST', '/facts'], ['PATCH', '/facts/fact'], ['POST', '/upload-sessions'],
    ['PUT', '/upload-sessions/upload/content'], ['POST', '/upload-sessions/upload/renew'], ['POST', '/upload-sessions/upload/confirm'],
    ['GET', '/jobs/job'], ['POST', '/jobs/job/cancel'], ['POST', '/jobs/job/retry'], ['POST', '/draft-jobs'],
    ['PATCH', '/drafts/draft/paragraphs/paragraph'], ['POST', '/drafts/draft/paragraphs/paragraph/reviews'],
    ['GET', '/citations/citation'], ['GET', '/documents'], ['GET', '/documents/document/view'], ['DELETE', '/documents/document'],
    ['POST', '/criterion-links'], ['PATCH', '/criterion-links/link'], ['GET', '/criterion-links'],
    ['POST', '/criterion-runs'], ['GET', '/criterion-runs/run'], ['POST', '/criterion-runs/run/results'],
    ['GET', '/criterion-results/result'], ['PATCH', '/criterion-results/result'], ['POST', '/criterion-results/result/reviews'],
    ['POST', '/compositions'], ['GET', '/compositions/composition'], ['PATCH', '/compositions/composition/analysis'], ['PATCH', '/compositions/composition/events'], ['PATCH', '/compositions/composition/issues'], ['POST', '/form-previews'],
    ['POST', '/exports'], ['GET', '/exports/export'], ['GET', '/exports/export/preview'], ['GET', '/exports/export/download'],
    ['POST', '/exports/export/confirm'], ['POST', '/engagements'],
  ];
  const original = await f.repository.find('applicant-a', f.caseId);
  for (const [method, suffix] of routes) {
    const payload = ['GET', 'HEAD'].includes(method) ? undefined : {};
    await error(await handleIntegrationRequest(request(method, f.path + suffix, payload), { ...f.deps, actorId: undefined }), 401, 'authentication_required');
    await error(await handleIntegrationRequest(request(method, f.path + suffix, payload), { ...f.deps, actorId: 'applicant-b' }), 404, 'unavailable');
  }
  assert.deepEqual(await f.repository.find('applicant-a', f.caseId), original);
});

test('JSON, origin, idempotency, pagination and revision headers are strictly validated', async () => {
  const f = await fixture(), endpoint = `${f.path}/facts`;
  await error(await handleIntegrationRequest(request('POST', endpoint, {}, { Origin: 'https://attacker.test' }), f.deps), 403, 'origin_required');
  await error(await handleIntegrationRequest(request('POST', endpoint, {}, { 'Content-Type': 'application/jsonp' }), f.deps), 415, 'json_required');
  await error(await handleIntegrationRequest(new Request(origin + endpoint, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': 'invalid-json-key' }, body: '{' }), f.deps), 400, 'invalid_json');
  await error(await handleIntegrationRequest(request('POST', endpoint, []), f.deps), 422, 'invalid_fields');
  await error(await handleIntegrationRequest(request('POST', endpoint, { key: 'name', value: 'Synthetic', confirmed: true, owner_id: 'other' }), f.deps), 422, 'invalid_fields');
  await error(await handleIntegrationRequest(request('POST', endpoint, {}, { 'Idempotency-Key': 'x' }), f.deps), 422, 'idempotency_key_required');
  await error(await handleIntegrationRequest(request('GET', `${f.path}/documents?limit=101`), f.deps), 422, 'invalid_pagination');
  for (const match of ['"1', '1"', '0', 'W/"1"', '9007199254740992'])
    await error(await handleIntegrationRequest(request('PATCH', `${endpoint}/fact`, { value: 'Synthetic', confirmed: true }, { 'If-Match': match }), f.deps), 422, 'invalid_revision');
  await error(await handleIntegrationRequest(request('PATCH', `${endpoint}/fact`, { expected_revision: 2, value: 'Synthetic', confirmed: true }, { 'If-Match': '"1"' }), f.deps), 422, 'invalid_revision');
  assert.equal(Object.keys((await f.repository.find('applicant-a', f.caseId))!.state.facts).length, 0);
});

test('fact edits replay once, reject payload mismatch and preserve winning revisions', async () => {
  const f = await fixture(), key = { 'Idempotency-Key': 'fact-create-key' }, value = { key: 'name', value: 'Synthetic applicant', confirmed: true };
  const first = await handleIntegrationRequest(request('POST', `${f.path}/facts`, value, key), f.deps);
  const fact = await data<{ fact_id: string }>(first), before = (await f.repository.find('applicant-a', f.caseId))!;
  assert.deepEqual(await data(await handleIntegrationRequest(request('POST', `${f.path}/facts`, value, key), f.deps)), fact);
  assert.deepEqual(await f.repository.find('applicant-a', f.caseId), before);
  await error(await handleIntegrationRequest(request('POST', `${f.path}/facts`, { ...value, value: 'Changed' }, key), f.deps), 409, 'idempotency_conflict');
  assert.equal((await handleIntegrationRequest(request('PATCH', `${f.path}/facts/${fact.fact_id}`, { value: 'New confirmed value', confirmed: true }, { 'If-Match': '"1"' }), f.deps)).status, 200);
  await error(await handleIntegrationRequest(request('PATCH', `${f.path}/facts/${fact.fact_id}`, { expected_revision: 1, value: 'Losing value', confirmed: true }), f.deps), 409, 'revision_conflict');
  const stored = (await f.repository.find('applicant-a', f.caseId))!.state.facts[fact.fact_id];
  assert.equal(stored.current.value, 'New confirmed value'); assert.equal(stored.history.length, 1);
});

test('a CAS race commits only one fact edit, receipt and outbox event', async () => {
  class RaceRepository extends MemoryCaseRepository {
    race = false;
    private arrivals = 0;
    private release!: () => void;
    private gate = new Promise<void>(resolve => { this.release = resolve; });
    override async compareAndSwap(envelope: CaseEnvelope, revision: number) {
      if (this.race && this.arrivals < 2) { this.arrivals++; if (this.arrivals === 2) this.release(); await this.gate; }
      return super.compareAndSwap(envelope, revision);
    }
  }
  const repository = new RaceRepository(), f = await fixture(repository);
  const fact = await data<{ fact_id: string }>(await handleIntegrationRequest(request('POST', `${f.path}/facts`, { key: 'name', value: 'Original', confirmed: true }), f.deps));
  const before = (await repository.find('applicant-a', f.caseId))!;
  repository.race = true;
  const outcomes = await Promise.all(['First edit', 'Second edit'].map(value => handleIntegrationRequest(request('PATCH', `${f.path}/facts/${fact.fact_id}`, { expected_revision: 1, value, confirmed: true }), f.deps)));
  assert.deepEqual(outcomes.map(r => r.status).sort(), [200, 409]);
  const after = (await repository.find('applicant-a', f.caseId))!;
  assert.equal(after.state.revision, before.state.revision + 1);
  assert.equal(after.state.outbox.length, before.state.outbox.length + 1);
  assert.equal(Object.keys(after.receipts).length, Object.keys(before.receipts).length + 1);
  assert.equal(after.state.facts[fact.fact_id].history.length, 1);
});

test('upload expiry and renewal preserve destination and cannot broaden limits', async () => {
  const f = await fixture(), session = await upload(f);
  assert.equal('storage_key' in session, false);
  const before = (await f.repository.find('applicant-a', f.caseId))!.state.upload_sessions[session.upload_id];
  f.setNow('2026-11-22T15:16:00.000Z');
  await error(await handleIntegrationRequest(request('PUT', session.upload_grant.url, pdf), f.deps), 422, 'upload_expired');
  await error(await handleIntegrationRequest(request('POST', `${f.path}/upload-sessions/${session.upload_id}/renew`, { bytes: 9999999 }), f.deps), 422, 'invalid_fields');
  const renewed = await data<typeof session>(await handleIntegrationRequest(request('POST', `${f.path}/upload-sessions/${session.upload_id}/renew`, {}), f.deps));
  assert.equal(renewed.upload_grant.url, session.upload_grant.url);
  assert.equal(renewed.upload_grant.sha256, session.upload_grant.sha256);
  assert.equal(renewed.upload_grant.max_bytes, session.upload_grant.max_bytes);
  assert.equal(renewed.document_version_id, session.document_version_id);
  const after = (await f.repository.find('applicant-a', f.caseId))!.state.upload_sessions[session.upload_id];
  assert.equal(before.storage_key, after.storage_key); assert.notEqual(before.expires_at, after.expires_at);
  assert.equal((await handleIntegrationRequest(request('PUT', renewed.upload_grant.url, pdf), f.deps)).status, 200);
  assert.equal(f.store.puts, 1);
});

test('uploads validate actual bytes and stored digests before a single quarantine job is committed', async () => {
  const f = await fixture(), session = await upload(f);
  await error(await handleIntegrationRequest(request('POST', `${f.path}/upload-sessions/${session.upload_id}/confirm`, {}), f.deps), 422, 'upload_incomplete');
  const fake = new Uint8Array(pdf.length); fake.fill(65);
  await error(await handleIntegrationRequest(request('PUT', session.upload_grant.url, fake), f.deps), 422, 'unsupported_content');
  const changed = pdf.slice(); changed[12] = 65;
  await error(await handleIntegrationRequest(request('PUT', session.upload_grant.url, changed), f.deps), 422, 'checksum_mismatch');
  await error(await handleIntegrationRequest(request('PUT', session.upload_grant.url, new Uint8Array(pdf.length + 1)), f.deps), 413, 'body_too_large');
  const transferKey = { 'Idempotency-Key': 'upload-transfer-key' };
  assert.equal((await handleIntegrationRequest(request('PUT', session.upload_grant.url, pdf, transferKey), f.deps)).status, 200);
  assert.equal((await handleIntegrationRequest(request('PUT', session.upload_grant.url, pdf, transferKey), f.deps)).status, 200);
  assert.equal(f.store.puts, 1);
  const object = [...f.store.objects.values()][0]; object.bytes = changed;
  await error(await handleIntegrationRequest(request('POST', `${f.path}/upload-sessions/${session.upload_id}/confirm`, {}), f.deps), 422, 'checksum_mismatch');
  object.bytes = pdf.slice();
  const confirmKey = { 'Idempotency-Key': 'upload-confirm-key' };
  const first = await handleIntegrationRequest(request('POST', `${f.path}/upload-sessions/${session.upload_id}/confirm`, {}, confirmKey), f.deps);
  const replay = await handleIntegrationRequest(request('POST', `${f.path}/upload-sessions/${session.upload_id}/confirm`, {}, confirmKey), f.deps);
  assert.equal(first.status, 201); assert.deepEqual(await data(first), await data(replay));
  assert.equal((await handleIntegrationRequest(request('PUT', session.upload_grant.url, pdf, transferKey), f.deps)).status, 200);
  assert.equal(f.store.puts, 1);
  await error(await handleIntegrationRequest(request('PUT', session.upload_grant.url, pdf), f.deps), 409, 'upload_closed');
  const state = (await f.repository.find('applicant-a', f.caseId))!.state;
  assert.equal(Object.keys(state.jobs).length, 1); assert.equal(Object.keys(state.documents).length, 1);
  assert.equal(Object.values(state.documents)[0].state, 'quarantined');
  assert.equal(state.outbox.filter(event => event.type === 'document.processing.requested').length, 1);
});

test('withdrawn or absent processing consent blocks upload creation and transfer', async () => {
  const f = await fixture(new MemoryCaseRepository(), false);
  await error(await handleIntegrationRequest(request('POST', `${f.path}/upload-sessions`, { title: 'Synthetic.pdf', media_type: 'application/pdf', bytes: pdf.length, sha256: await sha256(pdf) }), f.deps), 403, 'consent_required');
  assert.equal(f.store.puts, 0);
});

test('worker capabilities bind case and job; applicants cannot publish candidate results', async () => {
  const f = await fixture(), { run, job_id: documentJob } = await readyRun(f);
  await error(await handleIntegrationRequest(request('POST', `${f.path}/criterion-runs/${run.run_id}/results`, {}), f.deps), 403, 'worker_only');
  const token = await signWorkerCapability({ case_id: f.caseId, job_id: run.job_id, expires_at: Date.parse(instant) + 60000 }, workerSecret);
  const auth = { Authorization: `Bearer ${token}` };
  const sources = await handleIntegrationRequest(request('GET', `${f.path}/criterion-runs/${run.run_id}/sources`, undefined, auth), { ...f.deps, actorId: undefined });
  assert.equal(sources.status, 200); assert.equal((await data<{ items: unknown[] }>(sources)).items.length, 1);
  await error(await handleIntegrationRequest(request('GET', '/v1/cases/another-case/criterion-runs/another-run/sources', undefined, auth), f.deps), 404, 'unavailable');
  await error(await handleIntegrationRequest(request('GET', `${f.path}/criterion-runs/another-run/sources`, undefined, auth), f.deps), 404, 'unavailable');
  const wrong = await signWorkerCapability({ case_id: f.caseId, job_id: documentJob, expires_at: Date.parse(instant) + 60000 }, workerSecret);
  await error(await handleIntegrationRequest(request('POST', `${f.path}/criterion-runs/${run.run_id}/results`, {}, { Authorization: `Bearer ${wrong}` }), f.deps), 404, 'unavailable');
  await error(await handleIntegrationRequest(request('GET', `${f.path}/criterion-runs/${run.run_id}/sources`, undefined, { Authorization: `Bearer ${token}x` }), f.deps), 401, 'worker_authentication_required');
  f.setNow('2026-11-22T15:02:00.000Z');
  await error(await handleIntegrationRequest(request('GET', `${f.path}/criterion-runs/${run.run_id}/sources`, undefined, auth), f.deps), 401, 'worker_authentication_required');
});

test('consent revocation blocks worker retrieval, execution and publication until an explicit current revision update', async () => {
  const f = await fixture(), { run } = await readyRun(f);
  let executions = 0;
  f.deps.executeJob = async () => { executions++; return {}; };
  const token = await signWorkerCapability({ case_id: f.caseId, job_id: run.job_id, expires_at: Date.parse(instant) + 60000 }, workerSecret);
  const auth = { Authorization: `Bearer ${token}` };
  const before = (await f.repository.find('applicant-a', f.caseId))!;
  const revoked = await handleIntegrationRequest(request('PATCH', `${f.path}/consent`, { processing_consent: false, expected_revision: before.state.revision }), f.deps);
  assert.equal(revoked.status, 200);
  const revision = (await data<{ revision: number }>(revoked)).revision;
  assert.equal((await data(await handleIntegrationRequest(request('GET', f.path), f.deps))).processing_consent, false);
  await error(await handleIntegrationRequest(request('GET', `${f.path}/criterion-runs/${run.run_id}/sources`, undefined, auth), f.deps), 403, 'consent_required');
  await error(await handleIntegrationRequest(request('POST', `/v1/internal/cases/${f.caseId}/jobs/${run.job_id}/execute`, {}, auth), f.deps), 403, 'consent_required');
  await error(await handleIntegrationRequest(request('POST', `${f.path}/criterion-runs/${run.run_id}/results`, {}, auth), f.deps), 403, 'consent_required');
  assert.equal(executions, 0);
  const after = (await f.repository.find('applicant-a', f.caseId))!;
  assert.equal(after.state.jobs[run.job_id].state, 'canceled'); assert.equal(Object.keys(after.state.results).length, 0);
  await error(await handleIntegrationRequest(request('PATCH', `${f.path}/consent`, { processing_consent: true, expected_revision: before.state.revision }), f.deps), 409, 'revision_conflict');
  assert.equal((await f.repository.find('applicant-a', f.caseId))!.processing_consent, false);
  assert.equal((await handleIntegrationRequest(request('PATCH', `${f.path}/consent`, { processing_consent: true, expected_revision: revision }), f.deps)).status, 200);
  assert.equal((await data(await handleIntegrationRequest(request('GET', f.path), f.deps))).processing_consent, true);
  await error(await handleIntegrationRequest(request('GET', `${f.path}/criterion-runs/${run.run_id}/sources`, undefined, auth), f.deps), 409, 'job_canceled');
  const fresh = await data<{ run_id: string }>(await handleIntegrationRequest(request('POST', `${f.path}/criterion-runs`, { criterion_id: 'C08' }), f.deps));
  assert.notEqual(fresh.run_id, run.run_id);
});

test('revocation winning the publication CAS prevents a late candidate and its receipt from committing', async () => {
  class InterleavingRepository extends MemoryCaseRepository {
    beforeSwap?: () => Promise<void>;
    override async compareAndSwap(envelope: CaseEnvelope, revision: number) {
      const hook = this.beforeSwap; this.beforeSwap = undefined; await hook?.();
      return super.compareAndSwap(envelope, revision);
    }
  }
  const repository = new InterleavingRepository(), f = await fixture(repository), { run, document } = await readyRun(f);
  const token = await signWorkerCapability({ case_id: f.caseId, job_id: run.job_id, expires_at: Date.parse(instant) + 60000 }, workerSecret);
  const candidate = {
    section_title: 'Synthetic role',
    claims: [{ text: 'Synthetic applicant leads a team.', event_id: 'synthetic-event', citations: [{ document_version_id: document.document_version_id, source_artifact_id: 'artifact-http', extraction_run_id: 'extraction-http', locator: { page_index: 1, block_id: 'block-http' }, excerpt: 'Synthetic applicant leads a team.' }] }],
    element_assessments: [{ element_id: 'role-element', status: 'needs_review', authority_refs: ['fixture-authority'], explanation: 'Synthetic review fixture.' }],
    missing_evidence_tasks: [], contradictions: [],
  };
  const before = (await repository.find('applicant-a', f.caseId))!;
  repository.beforeSwap = async () => {
    const revoked = await handleIntegrationRequest(request('PATCH', `${f.path}/consent`, { processing_consent: false, expected_revision: before.state.revision }), f.deps);
    assert.equal(revoked.status, 200);
  };
  await error(await handleIntegrationRequest(request('POST', `${f.path}/criterion-runs/${run.run_id}/results`, { candidate }, { Authorization: `Bearer ${token}`, 'Idempotency-Key': 'late-publication-key' }), f.deps), 403, 'consent_required');
  const after = (await repository.find('applicant-a', f.caseId))!;
  assert.equal(after.processing_consent, false); assert.equal(after.state.jobs[run.job_id].state, 'canceled');
  assert.equal(Object.keys(after.state.results).length, 0);
  assert.equal(after.state.outbox.some(event => event.type === 'criterion.result.published'), false);
  assert.equal(Object.keys(after.receipts).length, Object.keys(before.receipts).length + 1);
});

test('revocation during a byte transfer prevents late upload metadata from committing', async () => {
  const f = await fixture(), session = await upload(f), before = (await f.repository.find('applicant-a', f.caseId))!;
  const put = f.store.put.bind(f.store);
  f.store.put = async (key, bytes, contentType) => {
    const saved = await put(key, bytes, contentType);
    const revoked = await handleIntegrationRequest(request('PATCH', `${f.path}/consent`, { processing_consent: false, expected_revision: before.state.revision }), f.deps);
    assert.equal(revoked.status, 200);
    return saved;
  };
  await error(await handleIntegrationRequest(request('PUT', session.upload_grant.url, pdf), f.deps), 403, 'consent_required');
  const after = (await f.repository.find('applicant-a', f.caseId))!;
  assert.equal(after.processing_consent, false); assert.equal(after.upload_objects?.[session.upload_id], undefined);
  assert.equal(Object.keys(after.state.documents).length, 0); assert.equal(Object.keys(after.state.jobs).length, 0);
  assert.equal(after.state.upload_sessions[session.upload_id].state, 'pending');
  assert.equal(Object.keys(after.receipts).length, Object.keys(before.receipts).length + 1);
});

test('draft orchestration dispatches ready criteria and retains unresolved sections and independent blockers', async () => {
  const f = await fixture(), { run } = await readyRun(f);
  assert.equal((await handleIntegrationRequest(request('POST', `${f.path}/jobs/${run.job_id}/cancel`, {}), f.deps)).status, 200);
  const payload = { selected_criteria: ['C08', 'C04'], selected_results: [] }, headers = { 'Idempotency-Key': 'draft-orchestration-key' };
  const response = await handleIntegrationRequest(request('POST', `${f.path}/draft-jobs`, payload, headers), f.deps);
  assert.equal(response.status, 201);
  const draft = await data<{ composition: { composition_id: string; unresolved_criteria: string[]; selected_results: unknown[] }; runs: { run_id: string; criterion_id: string }[]; blockers: { criterion_id: string; code: string }[] }>(response);
  assert.deepEqual(draft.composition.unresolved_criteria, ['C08', 'C04']); assert.deepEqual(draft.composition.selected_results, []);
  assert.equal(draft.runs.length, 1); assert.equal(draft.runs[0].criterion_id, 'C08'); assert.notEqual(draft.runs[0].run_id, run.run_id);
  assert.equal(draft.blockers.length, 1); assert.equal(draft.blockers[0].criterion_id, 'C04'); assert.equal(draft.blockers[0].code, 'module_unavailable');
  const before = await f.repository.find('applicant-a', f.caseId);
  assert.deepEqual(await data(await handleIntegrationRequest(request('POST', `${f.path}/draft-jobs`, payload, headers), f.deps)), draft);
  assert.deepEqual(await f.repository.find('applicant-a', f.caseId), before);
});

test('composition issues retain missing evidence and contradictions with revision-scoped applicant dispositions', async () => {
  const f = await fixture(), { run, document } = await readyRun(f);
  const token = await signWorkerCapability({ case_id: f.caseId, job_id: run.job_id, expires_at: Date.parse(instant) + 60000 }, workerSecret);
  const candidate = {
    section_title: 'Synthetic role',
    claims: [{ text: 'Synthetic applicant leads a team.', event_id: 'synthetic-event', citations: [{ document_version_id: document.document_version_id, source_artifact_id: 'artifact-http', extraction_run_id: 'extraction-http', locator: { page_index: 1, block_id: 'block-http' }, excerpt: 'Synthetic applicant leads a team.' }] }],
    element_assessments: [{ element_id: 'role-element', status: 'needs_review', authority_refs: ['fixture-authority'], explanation: 'Synthetic review fixture.' }],
    missing_evidence_tasks: [{ task_id: 'need-proof', description: 'Missing independent proof.' }],
    contradictions: [{ description: 'A synthetic source conflicts.', document_version_ids: [document.document_version_id] }],
  };
  const published = await handleIntegrationRequest(request('POST', `${f.path}/criterion-runs/${run.run_id}/results`, { candidate }, { Authorization: `Bearer ${token}` }), f.deps);
  assert.equal(published.status, 201, JSON.stringify(await published.clone().json()));
  const result = await data<{ result_id: string; result_revision: number }>(published);
  const assembled = await handleIntegrationRequest(request('POST', `${f.path}/compositions`, { selected_criteria: ['C08'], selected_results: [{ criterion_id: 'C08', result_id: result.result_id, result_revision: result.result_revision }] }), f.deps);
  assert.equal(assembled.status, 201);
  type Issue = { issue_id: string; kind: string; description: string; document_version_ids: string[]; issue_revision: number; history: unknown[]; disposition?: { decision: string; actor_id: string } };
  type Composed = { composition_id: string; draft_revision: number; issues: Issue[]; selected_result_bundles: unknown[] };
  const composition = await data<Composed>(assembled);
  assert.equal(composition.issues.length, 2); assert.equal(composition.selected_result_bundles.length, 1);
  const missing = composition.issues.find(issue => issue.kind === 'missing_evidence')!;
  const contradiction = composition.issues.find(issue => issue.kind === 'contradiction')!;
  assert.equal(missing.description, 'Missing independent proof.');
  assert.deepEqual(contradiction.document_version_ids, [document.document_version_id]);
  const immutable = (await f.repository.find('applicant-a', f.caseId))!.state.results[result.result_id];
  const payload = { expected_revision: 1, issue_id: missing.issue_id, disposition: 'acknowledged', reason: 'Applicant has inspected this unresolved limitation.' };
  const key = { 'Idempotency-Key': 'issue-review-key' };
  const response = await handleIntegrationRequest(request('PATCH', `${f.path}/compositions/${composition.composition_id}/issues`, payload, key), f.deps);
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const reviewed = await data<Composed>(response), reviewedIssue = reviewed.issues.find(issue => issue.issue_id === missing.issue_id)!;
  assert.equal(reviewed.draft_revision, 2); assert.equal(reviewedIssue.issue_revision, 2);
  assert.equal(reviewedIssue.disposition?.decision, 'acknowledged'); assert.equal(reviewedIssue.disposition?.actor_id, 'applicant-a');
  assert.equal(reviewed.issues.find(issue => issue.kind === 'contradiction')!.disposition, undefined);
  const beforeReplay = await f.repository.find('applicant-a', f.caseId);
  assert.deepEqual(await data(await handleIntegrationRequest(request('PATCH', `${f.path}/compositions/${composition.composition_id}/issues`, payload, key), f.deps)), reviewed);
  assert.deepEqual(await f.repository.find('applicant-a', f.caseId), beforeReplay);
  await error(await handleIntegrationRequest(request('PATCH', `${f.path}/compositions/${composition.composition_id}/issues`, { ...payload, disposition: 'resolved' }), f.deps), 409, 'revision_conflict');
  await error(await handleIntegrationRequest(request('PATCH', `${f.path}/compositions/${composition.composition_id}/issues`, { ...payload, expected_revision: 2, approved: true }), f.deps), 422, 'invalid_fields');
  const changed = await data<Composed>(await handleIntegrationRequest(request('PATCH', `${f.path}/compositions/${composition.composition_id}/issues`, { ...payload, expected_revision: 2, disposition: 'resolved', reason: 'Applicant records the reviewed disposition.' }), f.deps));
  assert.equal(changed.draft_revision, 3); assert.equal(changed.issues.find(issue => issue.issue_id === missing.issue_id)!.history.length, 1);
  assert.deepEqual((await f.repository.find('applicant-a', f.caseId))!.state.results[result.result_id], immutable);
});

test('an upload that expires during transfer cannot commit completion metadata', async () => {
  const f = await fixture(), session = await upload(f), original = f.store.put.bind(f.store);
  f.store.put = async (...args) => { const stored = await original(...args); f.setNow('2026-11-22T15:16:00.000Z'); return stored; };
  await error(await handleIntegrationRequest(request('PUT', session.upload_grant.url, pdf), f.deps), 422, 'upload_expired');
  const envelope = (await f.repository.find('applicant-a', f.caseId))!;
  assert.equal(envelope.upload_objects?.[session.upload_id], undefined);
  assert.equal(Object.keys(envelope.state.documents).length, 0);
  assert.equal(Object.keys(envelope.state.jobs).length, 0);
});

test('viewer reauthorizes every range request and refuses quarantine or changed source bytes', async () => {
  const f = await fixture(), quarantined = await confirmUpload(f), lockedPath = `${f.path}/documents/${quarantined.document.document_version_id}/view`;
  const reads = f.store.reads.length;
  await error(await handleIntegrationRequest(request('GET', lockedPath, undefined, { Range: 'bytes=0-4' }), f.deps), 404, 'unavailable');
  assert.equal(f.store.reads.length, reads);
  const { document } = await readyRun(f), viewer = `${f.path}/documents/${document.document_version_id}/view`;
  const full = await handleIntegrationRequest(request('GET', viewer), f.deps);
  assert.equal(full.status, 200); assert.deepEqual(new Uint8Array(await full.arrayBuffer()), pdf);
  const partial = await handleIntegrationRequest(request('GET', viewer, undefined, { Range: 'bytes=0-4' }), f.deps);
  assert.equal(partial.status, 206); assert.equal(await partial.text(), '%PDF-'); assert.equal(partial.headers.get('content-range'), `bytes 0-4/${pdf.length}`);
  const suffix = await handleIntegrationRequest(request('GET', viewer, undefined, { Range: 'bytes=-5' }), f.deps);
  assert.equal(suffix.status, 206); assert.equal(await suffix.text(), '%%EOF');
  await error(await handleIntegrationRequest(request('GET', viewer, undefined, { Range: 'bytes=0-4' }), { ...f.deps, actorId: undefined }), 401, 'authentication_required');
  await error(await handleIntegrationRequest(request('GET', viewer, undefined, { Range: 'bytes=0-4' }), { ...f.deps, actorId: 'applicant-b' }), 404, 'unavailable');
  for (const range of ['bytes=-0', 'bytes=9999-', 'bytes=0-2,4-5', 'bytes=3-1'])
    await error(await handleIntegrationRequest(request('GET', viewer, undefined, { Range: range }), f.deps), 416, 'invalid_range');
  const envelope = (await f.repository.find('applicant-a', f.caseId))!, source = envelope.state.documents[document.document_version_id];
  const stored = f.store.objects.get(source.storage_key)!; stored.sha256 = 'f'.repeat(64);
  await error(await handleIntegrationRequest(request('GET', viewer), f.deps), 409, 'source_integrity');
  assert.ok(f.store.reads.some(read => read.key === source.storage_key && read.version === source.storage_version_id));
});
