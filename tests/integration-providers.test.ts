import test from 'node:test';
import assert from 'node:assert/strict';
import { base64ToBytes, bytesToBase64, createR2Store, createS3Store, createServiceAdapters, normalizeCriterionCandidate, ProviderError, sha256, validateUpload } from '../lib/integrations/providers.ts';
import type { DocumentServiceInput, ModelInput, ProviderAttempt } from '../lib/integrations/provider-contracts';

const encoder = new TextEncoder();
const pdf = encoder.encode('%PDF-1.7\nSynthetic fixture only\n%%EOF');
const endpoint = { url: 'https://private-provider.example/process', token: 'synthetic-test-token' };
async function docInput(): Promise<DocumentServiceInput> { return { task_id: 'job_1', document_version_id: 'docv_1', sha256: await sha256(pdf), content_type: 'application/pdf', bytes: pdf }; }
const asFetch = (fn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) => fn as typeof fetch;
const errorCode = (code: string) => (error: unknown) => error instanceof ProviderError && error.code === code;
function zip(entries: Record<string, string>): Uint8Array {
  const locals: Uint8Array[] = [], directories: Uint8Array[] = []; let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const filename = encoder.encode(name), content = encoder.encode(text), local = new Uint8Array(30 + filename.length + content.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint32(18, content.length, true); lv.setUint32(22, content.length, true); lv.setUint16(26, filename.length, true);
    local.set(filename, 30); local.set(content, 30 + filename.length); locals.push(local);
    const central = new Uint8Array(46 + filename.length), cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(6, 20, true); cv.setUint32(20, content.length, true); cv.setUint32(24, content.length, true); cv.setUint16(28, filename.length, true); cv.setUint32(42, offset, true); central.set(filename, 46); directories.push(central); offset += local.length;
  }
  const end = new Uint8Array(22), ev = new DataView(end.buffer), directorySize = directories.reduce((sum, x) => sum + x.length, 0);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, locals.length, true); ev.setUint16(10, locals.length, true); ev.setUint32(12, directorySize, true); ev.setUint32(16, offset, true);
  const output = new Uint8Array(offset + directorySize + end.length); let at = 0;
  for (const chunk of [...locals, ...directories, end]) { output.set(chunk, at); at += chunk.length; }
  return output;
}

test('upload validation uses bytes and checksum, rejects renamed text and oversize payloads', async () => {
  const digest = await sha256(pdf);
  assert.equal((await validateUpload(pdf, 'application/pdf', digest)).contentType, 'application/pdf');
  await assert.rejects(validateUpload(pdf, 'image/png', digest), errorCode('content_type_mismatch'));
  await assert.rejects(validateUpload(pdf, 'application/pdf', 'a'.repeat(64)), errorCode('checksum_mismatch'));
  await assert.rejects(validateUpload(encoder.encode('fake.pdf'), 'application/pdf', digest), errorCode('unsupported_content'));
  await assert.rejects(validateUpload(new Uint8Array(20 * 1024 * 1024 + 1), 'application/pdf', digest), errorCode('invalid_size'));
  await assert.rejects(validateUpload(new Uint8Array(), 'application/pdf', digest), errorCode('invalid_size'));
});

test('DOCX requires an intact office ZIP directory and rejects macros and encrypted ZIPs', async () => {
  const parts = { '[Content_Types].xml': '<Types/>', '_rels/.rels': '<Relationships/>', 'word/document.xml': '<w:document/>' };
  const bytes = zip(parts), type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  assert.equal((await validateUpload(bytes, type, await sha256(bytes))).contentType, type);
  for (const invalid of [zip({ 'a.txt': 'text' }), zip({ ...parts, 'word/vbaProject.bin': 'bad' }), bytes.subarray(0, bytes.length - 1)]) {
    await assert.rejects(validateUpload(invalid, type, await sha256(invalid)), errorCode('unsupported_content'));
  }
  const encrypted = bytes.slice(); new DataView(encrypted.buffer).setUint16(6, 1, true);
  await assert.rejects(validateUpload(encrypted, type, await sha256(encrypted)), errorCode('unsupported_content'));
});

test('S3 signs private requests, pins version IDs, verifies reads and reconciles immutable PUT retries', async () => {
  const digest = await sha256(pdf), calls: { url: URL; init: RequestInit }[] = []; let puts = 0;
  const store = createS3Store({ bucket: 'private-fixtures', region: 'us-east-1', accessKeyId: 'TEST', secretAccessKey: 'synthetic-secret' }, {
    now: () => Date.UTC(2026, 10, 22), fetch: asFetch(async (input, init = {}) => {
      calls.push({ url: new URL(String(input)), init });
      if (init.method === 'PUT') return new Response(null, { status: ++puts > 1 ? 412 : 200, headers: { 'x-amz-version-id': 'version/1' } });
      return new Response(pdf, { headers: { 'x-amz-version-id': 'version/1', 'x-amz-meta-sha256': digest, 'Content-Type': 'application/pdf' } });
    }),
  });
  const saved = await store.put('quarantine/opaque-id', pdf, 'application/pdf');
  assert.equal(saved.version, 'version/1');
  const loaded = await store.get(saved.key, saved.version); assert.deepEqual(loaded.bytes, pdf);
  assert.equal(calls[1].url.search, '?versionId=version%2F1');
  const headers = new Headers(calls[0].init.headers);
  assert.match(headers.get('Authorization')!, /^AWS4-HMAC-SHA256 Credential=TEST\/20261122\/us-east-1\/s3\/aws4_request/);
  assert.equal(headers.get('If-None-Match'), '*'); assert.equal(headers.get('x-amz-content-sha256'), digest);
  assert.equal(calls[0].init.redirect, 'error'); assert.equal((await store.put(saved.key, pdf, 'application/pdf')).version, saved.version);
  await assert.rejects(store.get(saved.key, 'old-version'), errorCode('object_version_mismatch'));
  await assert.rejects(store.put('../unsafe', pdf, 'application/pdf'), errorCode('invalid_object_key'));
});

test('S3 refuses unversioned buckets and altered bytes without exposing upstream errors', async () => {
  const config = { bucket: 'private-fixtures', region: 'us-east-1', accessKeyId: 'TEST', secretAccessKey: 'synthetic-secret' };
  const noVersion = createS3Store(config, { fetch: asFetch(async () => new Response(null)) });
  await assert.rejects(noVersion.put('quarantine/id', pdf, 'application/pdf'), errorCode('storage_versioning_required'));
  const corrupt = createS3Store(config, { fetch: asFetch(async () => new Response(pdf, { headers: { 'x-amz-version-id': 'v1', 'x-amz-meta-sha256': '0'.repeat(64) } })) });
  await assert.rejects(corrupt.get('quarantine/id', 'v1'), errorCode('storage_integrity_failure'));
  const wrongAcknowledgement = createS3Store(config, { fetch: asFetch(async () => new Response(null, { headers: { 'x-amz-version-id': 'v1', 'x-amz-checksum-sha256': 'invalid-checksum' } })) });
  await assert.rejects(wrongAcknowledgement.put('quarantine/id', pdf, 'application/pdf'), errorCode('storage_integrity_failure'));
});

test('S3 evidence read limit bounds streaming response bodies before allocation', async () => {
  const config = { bucket: 'private-fixtures', region: 'us-east-1', accessKeyId: 'TEST', secretAccessKey: 'synthetic-secret' };
  let canceled = false;
  const store = createS3Store(config, { maxObjectBytes: 3, fetch: asFetch(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(4)); },
    cancel() { canceled = true; },
  }), { headers: { 'x-amz-version-id': 'v1', 'x-amz-meta-sha256': 'a'.repeat(64) } })) });
  await assert.rejects(store.get('users/test/file'), errorCode('provider_response_too_large'));
  assert.equal(canceled, true);
  await assert.rejects(store.put('users/test/file', new Uint8Array(4), 'application/octet-stream'), errorCode('invalid_size'));
});

test('R2 keys are immutable and retrieval checks the stored digest and version', async () => {
  const data = new Map<string, { bytes: Uint8Array; metadata: Record<string, string>; contentType: string; version: string }>();
  const bucket = {
    async put(key: string, bytes: ArrayBuffer, options: { onlyIf: { etagDoesNotMatch: string }; customMetadata: Record<string, string>; httpMetadata: { contentType: string } }) {
      assert.equal(options.onlyIf.etagDoesNotMatch, '*'); if (data.has(key)) return null;
      data.set(key, { bytes: new Uint8Array(bytes), metadata: options.customMetadata, contentType: options.httpMetadata.contentType, version: 'version1' }); return { version: 'version1' };
    },
    async get(key: string) { const saved = data.get(key); return saved ? { body: new Response(saved.bytes.buffer as ArrayBuffer).body!, version: saved.version, customMetadata: saved.metadata, httpMetadata: { contentType: saved.contentType } } : null; },
    async head(key: string) { return data.get(key) || null; }, async delete(key: string) { data.delete(key); },
  } as unknown as R2Bucket;
  const store = createR2Store(bucket), saved = await store.put('quarantine/id', pdf, 'application/pdf');
  assert.equal((await store.put(saved.key, pdf, 'application/pdf')).version, 'version1');
  await assert.rejects(store.put(saved.key, encoder.encode('changed'), 'application/pdf'), errorCode('object_conflict'));
  await assert.rejects(store.get(saved.key, 'wrong'), errorCode('object_version_mismatch'));
  data.get(saved.key)!.bytes = encoder.encode('tampered');
  await assert.rejects(store.get(saved.key, saved.version), errorCode('storage_integrity_failure'));
});

test('scan schema pins exact source bytes; infected and indeterminate are never clean', async () => {
  const input = await docInput(); let status = 'indeterminate';
  const adapters = createServiceAdapters({ scanner: endpoint }, { fetch: asFetch(async (_url, init) => {
    const sent = JSON.parse(String(init?.body)); assert.equal(sent.document_version_id, input.document_version_id);
    assert.deepEqual(base64ToBytes(sent.content_base64), pdf);
    return Response.json({ schema_version: '1', document_version_id: input.document_version_id, sha256: input.sha256, scanner_version: 'scanner-1', status });
  }) });
  assert.equal((await adapters.scan(input)).status, 'indeterminate'); status = 'infected'; assert.equal((await adapters.scan(input)).status, 'infected');
  status = 'unknown'; await assert.rejects(adapters.scan(input), errorCode('invalid_provider_output'));
  await assert.rejects(createServiceAdapters({}).scan(input), errorCode('provider_not_configured'));
});

test('extraction preserves geometry and reading order and refuses partial pages or mismatched scope', async () => {
  const input = await docInput();
  const output = { schema_version: '1', document_version_id: input.document_version_id, sha256: input.sha256, source_artifact_id: 'artifact1', extraction_run_id: 'extract1', extractor_version: 'parser-1', pages: [{ page_index: 1, page_label: 'i', width: 612, height: 792, quality: 0.95, status: 'complete', blocks: [{ block_id: 'block1', text: 'Synthetic source passage', reading_order: 0, bbox: [0.1, 0.2, 0.6, 0.3] }] }] };
  const adapters = createServiceAdapters({ extractor: endpoint }, { fetch: asFetch(async () => Response.json(output)) });
  assert.equal((await adapters.extract(input)).pages[0].blocks[0].block_id, 'block1');
  output.pages[0].status = 'failed'; await assert.rejects(adapters.extract(input), errorCode('incomplete_extraction'));
  output.pages[0].status = 'complete'; output.pages[0].blocks[0].bbox = [0.8, 0.2, 0.5, 0.1]; await assert.rejects(adapters.extract(input), errorCode('invalid_provider_output'));
  output.pages[0].blocks[0].bbox = [0.1, 0.2, 0.6, 0.3]; output.document_version_id = 'other-source'; await assert.rejects(adapters.extract(input), errorCode('provider_scope_mismatch'));
});

test('provider retries are bounded, safe errors redact upstream content, and circuit prevents repeated outages', async () => {
  const input = await docInput(); let calls = 0, clock = 0;
  const adapters = createServiceAdapters({ scanner: endpoint }, { fetch: asFetch(async () => { calls++; return new Response('secret provider detail', { status: 503 }); }), maxAttempts: 2, circuitFailureThreshold: 1, circuitResetMs: 1000, now: () => clock, sleep: async () => {} });
  await assert.rejects(adapters.scan(input), (error: unknown) => error instanceof ProviderError && !error.message.includes('secret'));
  assert.equal(calls, 2); await assert.rejects(adapters.scan(input), errorCode('provider_circuit_open')); assert.equal(calls, 2);
  clock = 1001; await assert.rejects(adapters.scan(input), errorCode('provider_rejected')); assert.equal(calls, 4);
});

test('circuit state carries across job adapters while isolating different configured providers', async () => {
  const input = await docInput(), circuitState = new Map<string, { failures: number; openUntil: number }>(); let calls = 0;
  const runtime = { circuitState, maxAttempts: 1, circuitFailureThreshold: 1, fetch: asFetch(async () => { calls++; return new Response(null, { status: 503 }); }) };
  await assert.rejects(createServiceAdapters({ scanner: endpoint }, runtime).scan(input), errorCode('provider_rejected'));
  await assert.rejects(createServiceAdapters({ scanner: endpoint }, runtime).scan(input), errorCode('provider_circuit_open'));
  assert.equal(calls, 1);
  await assert.rejects(createServiceAdapters({ scanner: { ...endpoint, url: 'https://another-provider.example/process' } }, runtime).scan(input), errorCode('provider_rejected'));
  assert.equal(calls, 2);
});

test('renderer binds snapshot, validates formal page bounds and computes digest over returned PDF bytes', async () => {
  const snapshotDigest = 'a'.repeat(64), output = { schema_version: '1', snapshot_digest: snapshotDigest, pdf_base64: bytesToBase64(pdf), page_count: 2, reference_entries: [{ claim_id: 'claim1', claim_revision: 1, citation_id: 'cit1', document_version_id: 'doc1', exhibit_label: 'C-2', exhibit_pages: [1], packet_pages: [2], display_text: 'See Exhibit C-2, p. 1.' }], reference_validation: 'passed' };
  const adapters = createServiceAdapters({ renderer: endpoint }, { fetch: asFetch(async () => Response.json(output)) });
  const rendered = await adapters.render({ task_id: 'render1', snapshot_digest: snapshotDigest, snapshot: {} });
  assert.equal(rendered.sha256, await sha256(pdf)); assert.deepEqual(rendered.bytes, pdf);
  output.reference_entries[0].packet_pages = [3]; await assert.rejects(adapters.render({ task_id: 'render1', snapshot_digest: snapshotDigest, snapshot: {} }), errorCode('invalid_provider_output'));
  output.snapshot_digest = 'b'.repeat(64); await assert.rejects(adapters.render({ task_id: 'render1', snapshot_digest: snapshotDigest, snapshot: {} }), errorCode('provider_scope_mismatch'));
});

function modelInput(): ModelInput { return { task_id: 'run1', approved_prompt: 'Return a proposed structured result from only the authorized input.', prompt_version: 'prompt1', rule_pack_version: 'rules1', model: 'test-model', input_manifest_hash: 'a'.repeat(64), authorized_input: { sources: [] }, output_schema: { type: 'object', properties: {}, additionalProperties: false }, output_schema_version: 'schema1' }; }
test('OpenAI gateway uses structured Responses with no storage and rejects incomplete or refused output', async () => {
  const output: Record<string, unknown> = { id: 'response1', status: 'completed', model: 'test-model', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"proposal":true}' }] }], usage: { input_tokens: 10, output_tokens: 5 } };
  const adapters = createServiceAdapters({ model: { apiKey: 'synthetic-test-key', model: 'test-model' } }, { fetch: asFetch(async (url, init) => {
    assert.equal(String(url), 'https://api.openai.com/v1/responses'); const body = JSON.parse(String(init?.body));
    assert.equal(body.store, false); assert.equal(body.text.format.type, 'json_schema'); assert.equal(body.text.format.strict, true);
    assert.equal(body.instructions, modelInput().approved_prompt); assert.equal(body.tools, undefined);
    return Response.json(output);
  }) });
  assert.deepEqual((await adapters.generate(modelInput())).candidate, { proposal: true });
  output.status = 'incomplete'; await assert.rejects(adapters.generate(modelInput()), errorCode('invalid_provider_output'));
  output.status = 'completed'; output.output = [{ type: 'message', content: [{ type: 'refusal', refusal: 'unavailable' }] }]; await assert.rejects(adapters.generate(modelInput()), errorCode('model_output_unavailable'));
});

test('uncertain model attempts are reported once and require durable controller reconciliation', async () => {
  let calls = 0; const attempts: ProviderAttempt[] = [];
  const adapters = createServiceAdapters({ model: { apiKey: 'synthetic-test-key', model: 'test-model', maxInputBytes: 100 } }, { fetch: asFetch(async () => { calls++; throw new Error('network secret'); }), onAttempt: attempt => { attempts.push(attempt); }, maxAttempts: 3 });
  await assert.rejects(adapters.generate(modelInput()), (error: unknown) => error instanceof ProviderError && error.uncertain && error.retryable);
  assert.equal(calls, 1); assert.deepEqual(attempts.map(attempt => attempt.outcome), ['started', 'uncertain']);
  await assert.rejects(adapters.generate({ ...modelInput(), authorized_input: 'a'.repeat(101) }), errorCode('model_budget_exceeded'));
  assert.equal(calls, 1);
});

test('structured output normalization removes optional nulls without inventing or repairing required source IDs', () => {
  const candidate = { claims: [{ text: 'Proposed claim', citations: [{ document_version_id: null, rendition_version_id: null, locator: { page_index: 1, page_label: null, block_id: 'b1', bbox: null } }] }] };
  assert.deepEqual(normalizeCriterionCandidate(candidate), { claims: [{ text: 'Proposed claim', citations: [{ document_version_id: null, locator: { page_index: 1, block_id: 'b1' } }] }] });
  assert.equal(candidate.claims[0].citations[0].rendition_version_id, null);
});
