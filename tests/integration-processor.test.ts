import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntegrationCase, executeCommand } from '../lib/integrations/domain.ts';
import { MemoryCaseRepository } from '../lib/integrations/repository.ts';
import { processJob, type ProcessorDependencies } from '../lib/integrations/processor.ts';
import { updateWorkerCase } from '../lib/integrations/transactions.ts';
import { bytesToBase64, ProviderError, sha256, type createServiceAdapters } from '../lib/integrations/providers.ts';
import type { Composition, CriterionResult, CriterionRun, DocumentVersion, DomainContext, EvidenceLink, FormPreview, Job, ModuleConfig, PacketExport, ResultCandidate, UploadSession } from '../lib/integrations/contracts.ts';
import type { DocumentServiceInput, ExtractionOutput, ObjectStore, StoredObject } from '../lib/integrations/provider-contracts.ts';

const bytes = new TextEncoder().encode('%PDF-1.7\nSynthetic source and packet bytes\n%%EOF');
const moduleConfig: ModuleConfig = { criterion_id: 'C04', module_version: '1', rule_pack_version: 'fixture-1', prompt_version: '1', output_schema_version: '1', evaluation_version: 'fixture-1', model: 'fixture-model', active: true, activation_approval: 'synthetic-test-only', instructions: 'Use only these synthetic sources.', required_fact_keys: ['name'], required_element_ids: ['judging'], authority_refs: ['fixture-authority'] };
const context: DomainContext = { actorId: 'owner1', now: new Date().toISOString(), role: 'applicant', modules: [moduleConfig], caseRule: { version: 'case-rule-1', approval: 'synthetic-test-only', authority_refs: ['case-authority'] } };
type Services = ReturnType<typeof createServiceAdapters>;
function services(overrides: Partial<Services>): Services {
  const unexpected = async (): Promise<never> => { throw new Error('Unexpected provider call'); };
  return { scan: unexpected, extract: unexpected, generate: unexpected, render: unexpected, ...overrides };
}
class ObjectMemory implements ObjectStore {
  readonly objects = new Map<string, StoredObject & { bytes: Uint8Array }>();
  readonly writes: string[] = [];
  failRenditionOnce = false;
  loseModelWriteAcknowledgementOnce = false;
  async put(key: string, content: Uint8Array, contentType: string) {
    this.writes.push(key);
    if (this.failRenditionOnce && key.startsWith('renditions/')) { this.failRenditionOnce = false; throw new ProviderError('storage_unavailable', 'Synthetic transient failure.', 503, true); }
    const digest = await sha256(content), previous = this.objects.get(key);
    if (previous && previous.sha256 !== digest) throw new ProviderError('object_conflict', 'Synthetic immutable conflict.', 409);
    const object = previous || { key, version: crypto.randomUUID(), sha256: digest, size: content.length, contentType, bytes: content.slice() };
    this.objects.set(key, object);
    if (this.loseModelWriteAcknowledgementOnce && key.includes('/model-')) { this.loseModelWriteAcknowledgementOnce = false; throw new ProviderError('storage_unavailable', 'Synthetic upload response loss.', 503, true, true); }
    const { bytes: omitted, ...metadata } = object; void omitted; return metadata;
  }
  async get(key: string, version?: string) {
    const object = this.objects.get(key); if (!object || (version && object.version !== version)) throw new ProviderError('object_unavailable', 'Synthetic object unavailable.', 404);
    return structuredClone(object);
  }
  async delete(key: string) { this.objects.delete(key); }
}
async function fixture() {
  const state = createIntegrationCase('case1', 'owner1'), repository = new MemoryCaseRepository(), store = new ObjectMemory();
  const ctx = { ...context, now: new Date().toISOString() };
  await executeCommand(state, 'fact.create', { key: 'name', value: 'Fictional Applicant', confirmed: true }, ctx);
  const upload = await executeCommand(state, 'upload.create', { title: 'Synthetic.pdf', media_type: 'application/pdf', bytes: bytes.length, sha256: await sha256(bytes) }, ctx) as UploadSession;
  const object = await store.put(upload.storage_key, bytes, 'application/pdf');
  const confirmed = await executeCommand(state, 'upload.confirm', { upload_id: upload.upload_id, storage_version_id: object.version, sha256: object.sha256, bytes: object.size, media_type: object.contentType }, ctx) as { document: DocumentVersion; job_id: string };
  await repository.insert({ state, receipts: {}, processing_consent: true });
  const deps: ProcessorDependencies = { repository, store, providers: {}, context: { modules: context.modules, caseRule: context.caseRule } };
  return { repository, store, deps, document: confirmed.document, jobId: confirmed.job_id };
}
function extraction(input: DocumentServiceInput): ExtractionOutput {
  return { schema_version: '1', document_version_id: input.document_version_id, sha256: input.sha256, source_artifact_id: 'artifact1', extraction_run_id: 'extract1', extractor_version: 'fixture-parser', pages: [{ page_index: 1, page_label: 'i', width: 612, height: 792, quality: 0.95, status: 'complete', blocks: [{ block_id: 'b1', text: 'The applicant completed two manuscript reviews.', reading_order: 0, bbox: [0.1, 0.2, 0.6, 0.3] }] }] };
}
const cleanScan: Services['scan'] = async input => ({ schema_version: '1', document_version_id: input.document_version_id, sha256: input.sha256, scanner_version: 'fixture-scanner', status: 'clean' });
async function snapshot(f: Awaited<ReturnType<typeof fixture>>) { return (await f.repository.findForWorker('case1'))!; }
async function readyRun(rendition?: Uint8Array) {
  const f = await fixture();
  f.deps.services = services({ scan: cleanScan, extract: async input => extraction(input) });
  await processJob('case1', f.jobId, f.deps);
  if (rendition) {
    const saved = await f.store.put('renditions/large-fixture', rendition, 'application/pdf');
    await updateWorkerCase(f.repository, 'case1', async envelope => { Object.assign(envelope.state.documents[f.document.document_version_id], { rendition_version_id: 'rendition1', rendition_storage_key: saved.key, rendition_storage_version_id: saved.version, rendition_sha256: saved.sha256 }); });
  }
  const run = await updateWorkerCase(f.repository, 'case1', async envelope => {
    const d = envelope.state.documents[f.document.document_version_id];
    const link = await executeCommand(envelope.state, 'link.create', { criterion_id: 'C04', document_version_id: d.document_version_id }, context) as EvidenceLink;
    await executeCommand(envelope.state, 'link.update', { link_id: link.link_id, expected_revision: 1, state: 'confirmed' }, context);
    return await executeCommand(envelope.state, 'run.create', { criterion_id: 'C04' }, context) as CriterionRun;
  });
  const d = (await snapshot(f)).state.documents[f.document.document_version_id];
  const candidate: ResultCandidate = { section_title: 'Synthetic judging assessment', claims: [{ text: 'The applicant completed two reviews.', event_id: 'review-event1', citations: [{ document_version_id: d.document_version_id, source_artifact_id: d.source_artifact_id, ...(d.rendition_version_id ? { rendition_version_id: d.rendition_version_id } : {}), extraction_run_id: d.extraction_run_id!, locator: d.blocks[0].locator, excerpt: 'completed two manuscript reviews' }] }], element_assessments: [{ element_id: 'judging', status: 'needs_review', authority_refs: ['fixture-authority'], explanation: 'Synthetic proposal requires review.' }], missing_evidence_tasks: [], contradictions: [] };
  const output = { candidate, provider_response_id: 'response1', model: 'fixture-model', usage: { input_tokens: 100, output_tokens: 50 } };
  return { ...f, run, candidate, output };
}

async function preparedPacket(f: Awaited<ReturnType<typeof readyRun>>, templateIds: string[] = []) {
  f.deps.services = services({ generate: async () => f.output }); await processJob('case1', f.run.job_id, f.deps);
  const ctx = { ...context, formTemplates: f.deps.context.formTemplates };
  return updateWorkerCase(f.repository, 'case1', async envelope => {
    const pointer = envelope.state.current_results.C04!, result = envelope.state.results[pointer.result_id][0];
    const reviewed = await executeCommand(envelope.state, 'result.review', { result_id: result.result_id, expected_revision: result.result_revision, claim_id: result.claims[0].claim_id, support_status: 'supported' }, ctx) as CriterionResult;
    const composition = await executeCommand(envelope.state, 'composition.create', { selected_criteria: ['C04'], selected_results: [{ criterion_id: 'C04', result_id: reviewed.result_id, result_revision: reviewed.result_revision }], case_wide_document_ids: [f.document.document_version_id] }, ctx) as Composition;
    await executeCommand(envelope.state, 'composition.analysis', { composition_id: composition.composition_id, expected_revision: composition.draft_revision, route: 'criteria', sections: ['overall_record', 'continued_work', 'prospective_benefit'].map(kind => ({ kind, authority_refs: ['case-authority'], claims: [f.candidate.claims[0]] })) }, ctx);
    for (const claim of composition.claims.filter(value => value.review_status === 'unreviewed')) await executeCommand(envelope.state, 'paragraph.review', { draft_id: composition.draft_id, paragraph_id: claim.paragraph_id, expected_revision: composition.draft_revision, support_status: 'supported' }, ctx);
    const previewIds: string[] = [];
    for (const template_id of templateIds) { const preview = await executeCommand(envelope.state, 'form.preview', { template_id }, ctx) as FormPreview; previewIds.push(preview.preview_id); }
    return await executeCommand(envelope.state, 'export.create', { composition_id: composition.composition_id, draft_revision: composition.draft_revision, form_preview_ids: previewIds }, ctx) as PacketExport;
  });
}

function largePdf(size: number) {
  const fixture = new Uint8Array(size).fill(32); fixture.set(new TextEncoder().encode('%PDF-1.7\n')); fixture.set(new TextEncoder().encode('\n%%EOF'), size - 6); return fixture;
}

test('document processing checkpoints clean scanning and raw extraction before publishing exact locations', async () => {
  const f = await fixture(); let scans = 0, extracts = 0;
  f.deps.services = services({ scan: async input => { scans++; return cleanScan(input); }, extract: async input => { extracts++; return extraction(input); } });
  const job = await processJob('case1', f.jobId, f.deps) as Job;
  assert.equal(job.state, 'succeeded', JSON.stringify(job.error)); const envelope = await snapshot(f), document = envelope.state.documents[f.document.document_version_id];
  assert.equal(document.state, 'ready'); assert.equal(document.scan_result, 'clean'); assert.equal(document.extraction_run_id, 'extract1');
  assert.deepEqual(document.blocks[0].locator, { page_index: 1, page_label: 'i', block_id: 'b1', bbox: [0.1, 0.2, 0.6, 0.3] });
  assert.ok(document.raw_extraction_storage_key); assert.equal(envelope.state.jobs[f.jobId].checkpoints.scanning, 'clean');
  await processJob('case1', f.jobId, f.deps); assert.equal(scans, 1); assert.equal(extracts, 1);
});

test('unsafe scan never invokes extraction or publishes retrieval-ready source bytes', async () => {
  for (const status of ['infected', 'indeterminate'] as const) {
    const f = await fixture(); let extracts = 0;
    f.deps.services = services({ scan: async input => ({ ...await cleanScan(input), status }), extract: async input => { extracts++; return extraction(input); } });
    await processJob('case1', f.jobId, f.deps); const envelope = await snapshot(f);
    assert.equal(extracts, 0); assert.equal(envelope.state.documents[f.document.document_version_id].state, 'rejected');
    assert.equal(envelope.state.documents[f.document.document_version_id].blocks.length, 0); assert.equal(envelope.state.jobs[f.jobId].state, 'failed');
  }
});

test('retry after rendition storage failure reuses durable scan and extraction checkpoints', async () => {
  const f = await fixture(); f.store.failRenditionOnce = true; let scans = 0, extracts = 0;
  f.deps.services = services({ scan: async input => { scans++; return cleanScan(input); }, extract: async input => { extracts++; return { ...extraction(input), rendition_version_id: 'rendition1', rendition_pdf_base64: bytesToBase64(bytes) }; } });
  assert.equal((await processJob('case1', f.jobId, f.deps) as Job).state, 'queued');
  await updateWorkerCase(f.repository, 'case1', async envelope => { envelope.state.jobs[f.jobId].next_attempt_at = '2000-01-01T00:00:00.000Z'; });
  assert.equal((await processJob('case1', f.jobId, f.deps) as Job).state, 'succeeded');
  assert.equal(scans, 1); assert.equal(extracts, 1); const d = (await snapshot(f)).state.documents[f.document.document_version_id];
  assert.ok(d.rendition_storage_version_id); assert.equal(d.rendition_sha256, await sha256(bytes));
});

test('provider outage exhausts the bounded job budget and writes a dead-letter event', async () => {
  const f = await fixture(); let calls = 0;
  f.deps.services = services({ scan: async () => { calls++; throw new ProviderError('provider_rejected', 'Synthetic outage.', 503, true); } });
  const maximum = (await snapshot(f)).state.jobs[f.jobId].max_attempts;
  for (let attempt = 0; attempt < maximum; attempt++) {
    await processJob('case1', f.jobId, f.deps);
    await updateWorkerCase(f.repository, 'case1', async envelope => { envelope.state.jobs[f.jobId].next_attempt_at = '2000-01-01T00:00:00.000Z'; });
  }
  const envelope = await snapshot(f); assert.equal(calls, maximum); assert.equal(envelope.state.jobs[f.jobId].state, 'failed');
  assert.equal(envelope.state.jobs[f.jobId].error?.retryable, false); assert.ok(envelope.state.outbox.some(event => event.type === 'job.dead_lettered'));
  await processJob('case1', f.jobId, f.deps); assert.equal(calls, maximum);
});

test('a successful model candidate passes domain provenance and publishes one typed result', async () => {
  const f = await readyRun(); let calls = 0;
  f.deps.services = services({ generate: async input => { calls++; assert.equal(input.input_manifest_hash, f.run.input_manifest_hash); return f.output; } });
  const finished = await processJob('case1', f.run.job_id, f.deps) as Job; assert.equal(finished.state, 'succeeded');
  const envelope = await snapshot(f), current = envelope.state.current_results.C04!;
  assert.ok(current); const result = envelope.state.results[current.result_id][0];
  assert.equal(result.claims[0].support_status, 'needs_review'); assert.equal(result.claims[0].review_status, 'unreviewed');
  assert.equal(result.claims[0].citations[0].document_version_id, f.document.document_version_id);
  assert.ok(envelope.state.jobs[f.run.job_id].checkpoints.model_output_key);
  await processJob('case1', f.run.job_id, f.deps); assert.equal(calls, 1); assert.equal(Object.keys((await snapshot(f)).state.results).length, 1);
});

test('duplicate delivery during a held lease executes only one model request', async () => {
  const f = await readyRun(); let calls = 0, started!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  f.deps.services = services({ generate: async () => { calls++; started(); await gate; return f.output; } });
  const first = processJob('case1', f.run.job_id, f.deps); await entered;
  const duplicate = await processJob('case1', f.run.job_id, f.deps) as Job; assert.equal(duplicate.state, 'running'); assert.equal(calls, 1);
  release(); assert.equal((await first as Job).state, 'succeeded'); assert.equal(calls, 1);
});

test('cancellation while the model is running prevents late publication and keeps cancellation authoritative', async () => {
  const f = await readyRun();
  f.deps.services = services({ generate: async () => {
    await updateWorkerCase(f.repository, 'case1', async envelope => executeCommand(envelope.state, 'job.cancel', { job_id: f.run.job_id }, context));
    return f.output;
  } });
  const job = await processJob('case1', f.run.job_id, f.deps) as Job;
  assert.equal(job.state, 'canceled'); const envelope = await snapshot(f); assert.equal(Object.keys(envelope.state.results).length, 0); assert.equal(envelope.state.current_results.C04, undefined);
});

test('uncertain model outcome is retained for reconciliation and is never automatically billed again', async () => {
  const f = await readyRun(); let calls = 0;
  f.deps.services = services({ generate: async () => { calls++; throw new ProviderError('provider_timeout', 'Synthetic timeout.', 503, true, true); } });
  const job = await processJob('case1', f.run.job_id, f.deps) as Job;
  assert.equal(job.state, 'failed'); assert.equal(job.error?.retryable, false); assert.ok(job.checkpoints.model_intent);
  await processJob('case1', f.run.job_id, f.deps); assert.equal(calls, 1); assert.equal(Object.keys((await snapshot(f)).state.results).length, 0);
});

test('a worker crash after model object storage recovers its intent without a second model request', async () => {
  const f = await readyRun(), key = `extractions/${f.run.job_id}/model-crash-fixture`; let calls = 0;
  const saved = await f.store.put(key, new TextEncoder().encode(JSON.stringify(f.candidate)), 'application/json');
  await updateWorkerCase(f.repository, 'case1', async envelope => {
    const job = envelope.state.jobs[f.run.job_id]; job.state = 'running'; job.stage = 'validating'; job.attempts = 1;
    job.lease_token = 'expired-worker'; job.lease_expires_at = '2000-01-01T00:00:00.000Z';
    job.checkpoints.model_intent = 'previous-attempt'; job.checkpoints.model_output_intent = key;
  });
  f.deps.services = services({ generate: async () => { calls++; return f.output; } });
  const finished = await processJob('case1', f.run.job_id, f.deps) as Job;
  assert.equal(finished.state, 'succeeded'); assert.equal(calls, 0);
  assert.equal(finished.checkpoints.model_output_key, key); assert.equal(finished.checkpoints.model_output_version, saved.version); assert.equal(finished.checkpoints.model_output_digest, saved.sha256);
});

test('extraction storage intent recovers across a crash before its output receipt checkpoint', async () => {
  const f = await fixture(), key = `extractions/${f.jobId}/crash-fixture`; let scans = 0, extracts = 0;
  const raw = extraction({ task_id: f.jobId, document_version_id: f.document.document_version_id, sha256: f.document.sha256, content_type: 'application/pdf', bytes });
  const saved = await f.store.put(key, new TextEncoder().encode(JSON.stringify(raw)), 'application/json');
  await updateWorkerCase(f.repository, 'case1', async envelope => {
    const job = envelope.state.jobs[f.jobId]; job.state = 'running'; job.stage = 'extraction'; job.attempts = 1;
    job.lease_token = 'expired-worker'; job.lease_expires_at = '2000-01-01T00:00:00.000Z';
    job.checkpoints.scanning = 'clean'; job.checkpoints.extraction_intent = key;
  });
  f.deps.services = services({ scan: async input => { scans++; return cleanScan(input); }, extract: async input => { extracts++; return extraction(input); } });
  const finished = await processJob('case1', f.jobId, f.deps) as Job;
  assert.equal(finished.state, 'succeeded'); assert.equal(scans, 0); assert.equal(extracts, 0);
  assert.equal(finished.checkpoints.extraction_key, key); assert.equal(finished.checkpoints.extraction_digest, saved.sha256);
});

test('lost storage acknowledgement permits explicit reconciliation but never another model call', async () => {
  const f = await readyRun(); f.store.loseModelWriteAcknowledgementOnce = true; let calls = 0;
  f.deps.services = services({ generate: async () => { calls++; return f.output; } });
  const failed = await processJob('case1', f.run.job_id, f.deps) as Job;
  assert.equal(failed.state, 'failed'); assert.equal(failed.error?.retryable, true); assert.ok(failed.checkpoints.model_output_intent);
  await updateWorkerCase(f.repository, 'case1', async envelope => executeCommand(envelope.state, 'job.retry', { job_id: f.run.job_id, reason: 'Recover the immutable output after the storage acknowledgement was lost.' }, { ...context, now: new Date().toISOString() }));
  assert.equal((await processJob('case1', f.run.job_id, f.deps) as Job).state, 'succeeded'); assert.equal(calls, 1);
});

test('recovered model output still needs domain provenance validation', async () => {
  const f = await readyRun(), key = `extractions/${f.run.job_id}/model-invalid-fixture`, candidate = structuredClone(f.candidate); let calls = 0;
  candidate.claims[0].citations[0].document_version_id = 'unauthorized-source';
  await f.store.put(key, new TextEncoder().encode(JSON.stringify(candidate)), 'application/json');
  await updateWorkerCase(f.repository, 'case1', async envelope => { const job = envelope.state.jobs[f.run.job_id]; job.checkpoints.model_intent = 'previous-attempt'; job.checkpoints.model_output_intent = key; });
  f.deps.services = services({ generate: async () => { calls++; return f.output; } });
  const finished = await processJob('case1', f.run.job_id, f.deps) as Job;
  assert.equal(finished.state, 'failed'); assert.equal(finished.error?.code, 'invalid_provenance'); assert.equal(calls, 0); assert.equal(Object.keys((await snapshot(f)).state.results).length, 0);
});

test('an absent object behind a model output intent never triggers regeneration', async () => {
  const f = await readyRun(); let calls = 0;
  await updateWorkerCase(f.repository, 'case1', async envelope => { const job = envelope.state.jobs[f.run.job_id]; job.checkpoints.model_intent = 'previous-attempt'; job.checkpoints.model_output_intent = `extractions/${f.run.job_id}/missing-output`; });
  f.deps.services = services({ generate: async () => { calls++; return f.output; } });
  const finished = await processJob('case1', f.run.job_id, f.deps) as Job;
  assert.equal(finished.state, 'failed'); assert.equal(finished.error?.code, 'model_attempt_uncertain'); assert.equal(calls, 0);
});

test('packet processing binds exact preview bytes and reconciled formal references before applicant confirmation', async () => {
  const f = await readyRun(), packet = await preparedPacket(f);
  f.deps.services = services({ render: async input => {
    assert.equal(input.snapshot_digest, packet.snapshot_digest);
    return { schema_version: '1', snapshot_digest: packet.snapshot_digest, pdf_base64: bytesToBase64(bytes), bytes, sha256: await sha256(bytes), page_count: 2, reference_validation: 'passed', reference_entries: packet.snapshot.claims.flatMap(claim => claim.citations.map(citation => ({ claim_id: claim.claim_id, claim_revision: claim.claim_revision, citation_id: citation.citation_id, document_version_id: citation.document_version_id, exhibit_label: 'A', exhibit_pages: [1], packet_pages: [2], display_text: 'See Exhibit A, p. 1.' }))) };
  } });
  assert.equal((await processJob('case1', packet.job_id, f.deps) as Job).state, 'succeeded');
  const preview = (await snapshot(f)).state.exports[packet.export_id]; assert.equal(preview.state, 'preview_ready'); assert.equal(preview.packet_digest, await sha256(bytes));
  const saved = await f.store.get(preview.storage_key!, preview.storage_version_id); assert.deepEqual(saved.bytes, bytes);
  await updateWorkerCase(f.repository, 'case1', async envelope => executeCommand(envelope.state, 'export.confirm', { export_id: packet.export_id, packet_digest: preview.packet_digest, draft_revision: packet.draft_revision }, context));
  assert.equal((await snapshot(f)).state.exports[packet.export_id].state, 'final_approved');
});

test('packet input limit counts actual canonical rendition bytes instead of the smaller original upload', async () => {
  const f = await readyRun(largePdf(20 * 1024 * 1024 + 1)), packet = await preparedPacket(f); let renders = 0;
  assert.ok(f.document.bytes < 1024);
  f.deps.services = services({ render: async () => { renders++; throw new Error('Renderer must not receive an oversized packet.'); } });
  const job = await processJob('case1', packet.job_id, f.deps) as Job;
  assert.equal(job.state, 'failed'); assert.equal(job.error?.code, 'packet_input_limit'); assert.equal(renders, 0);
  assert.equal((await snapshot(f)).state.exports[packet.export_id].state, 'queued');
});

test('packet input limit includes all selected template bytes before calling the renderer', async () => {
  const f = await readyRun(), templateBytes = largePdf(11 * 1024 * 1024), templateDigest = await sha256(templateBytes);
  f.deps.context.formTemplates = ['form1', 'form2'].map(template_id => ({ template_id, version: '1', edition: 'synthetic', source_url: `https://forms.example/${template_id}.pdf`, retrieved_at: new Date().toISOString(), sha256: templateDigest, approval: 'synthetic-test-only', active: true, fields: [{ field_id: 'name', fact_key: 'name', required: true, max_length: 100 }] }));
  const packet = await preparedPacket(f, ['form1', 'form2']); let fetches = 0, renders = 0;
  f.deps.fetch = (async () => { fetches++; return new Response(templateBytes.buffer as ArrayBuffer); }) as typeof fetch;
  f.deps.services = services({ render: async () => { renders++; throw new Error('Renderer must not receive an oversized packet.'); } });
  const job = await processJob('case1', packet.job_id, f.deps) as Job;
  assert.equal(job.state, 'failed'); assert.equal(job.error?.code, 'packet_input_limit'); assert.equal(fetches, 2); assert.equal(renders, 0);
});
