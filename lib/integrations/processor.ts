import type { DomainContext, Job } from './contracts.ts';
import type { CaseEnvelope, CaseRepository } from './repository.ts';
import type { DocumentServiceInput, ExtractionOutput, ObjectStore, ProviderConfig, SupportedContentType } from './provider-contracts.ts';
import { base64ToBytes, bytesToBase64, createServiceAdapters, ProviderError, sha256 } from './providers.ts';
import { executeCommand, getRunSources } from './domain.ts';
import { MODEL_OUTPUT_SCHEMA } from './model-schema.ts';
import { ApiError, unavailable, updateWorkerCase } from './transactions.ts';

export interface ProcessorDependencies {
  repository: CaseRepository;
  store?: ObjectStore;
  providers: ProviderConfig;
  context: Omit<DomainContext, 'actorId' | 'now' | 'role' | 'workerScope'>;
  services?: ReturnType<typeof createServiceAdapters>;
  fetch?: typeof fetch;
}
const leaseDuration = 10 * 60_000;
const providerCircuits = new Map<string, { failures: number; openUntil: number }>();
function scopedContext(deps: ProcessorDependencies, job: Job): DomainContext {
  return { ...deps.context, actorId: `worker-${job.job_id}`, now: new Date().toISOString(), role: 'worker', workerScope: { jobId: job.job_id, ...(job.kind === 'criterion' ? { runId: job.object_id } : {}) } };
}
function active(envelope: CaseEnvelope, jobId: string, lease: string) {
  if (!envelope.processing_consent) throw new ApiError(403, 'consent_required', 'Processing consent has been withdrawn.');
  const job = envelope.state.jobs[jobId];
  if (!job || job.state !== 'running' || job.lease_token !== lease || Date.parse(job.lease_expires_at || '') <= Date.now()) throw new ApiError(409, 'job_canceled', 'This worker no longer holds the active job lease.');
  return job;
}
function safeJob(job: Job) { const result = { ...job }; delete result.lease_token; return result; }

export async function processJob(caseId: string, jobId: string, deps: ProcessorDependencies): Promise<unknown> {
  const lease = crypto.randomUUID();
  const claimed = await updateWorkerCase(deps.repository, caseId, async envelope => {
    if (!envelope.processing_consent) throw new ApiError(403, 'consent_required', 'Processing consent has been withdrawn.');
    const job = envelope.state.jobs[jobId]; if (!job) throw unavailable();
    if (['succeeded', 'canceled', 'failed'].includes(job.state)) return { acquired: false, job: structuredClone(job) };
    if ((job.state === 'running' && Date.parse(job.lease_expires_at || '') > Date.now()) || (job.next_attempt_at && Date.parse(job.next_attempt_at) > Date.now())) return { acquired: false, job: structuredClone(job) };
    if (job.attempts >= job.max_attempts) { job.state = 'failed'; job.error = { code: 'retry_budget_exhausted', message: 'The processing retry budget is exhausted.', retryable: false }; return { acquired: false, job: structuredClone(job) }; }
    job.state = 'running'; job.attempts++; job.lease_token = lease; job.lease_expires_at = new Date(Date.now() + leaseDuration).toISOString(); job.error = undefined;
    for (const event of envelope.state.outbox) if (event.object_id === job.object_id && !event.delivered_at) event.delivered_at = new Date().toISOString();
    return { acquired: true, job: structuredClone(job) };
  });
  if (!claimed.acquired) return safeJob(claimed.job);
  const checkpointMany = async (values: Record<string, string>, stage: string) => updateWorkerCase(deps.repository, caseId, async envelope => { const job = active(envelope, jobId, lease); Object.assign(job.checkpoints, values); job.stage = stage; job.lease_expires_at = new Date(Date.now() + leaseDuration).toISOString(); });
  const checkpoint = async (key: string, value: string, stage: string) => checkpointMany({ [key]: value }, stage);
  const current = async () => { const envelope = await deps.repository.findForWorker(caseId); if (!envelope) throw unavailable(); active(envelope, jobId, lease); return envelope; };
  const commit = async (operation: string, input: unknown) => updateWorkerCase(deps.repository, caseId, async envelope => { const job = active(envelope, jobId, lease); const result = await executeCommand(envelope.state, operation, input, scopedContext(deps, job)); job.lease_token = undefined; job.lease_expires_at = undefined; return result; });
  const store = deps.store;
  const recoverOutput = async (checkpoints: Record<string, string>, prefix: 'extraction' | 'model_output', stage: string) => {
    const key = checkpoints[`${prefix}_key`] || checkpoints[`${prefix}_intent`];
    if (!key || !store) return null;
    let stored;
    try { stored = await store.get(key, checkpoints[`${prefix}_version`]); }
    catch (error) {
      // An intent can precede the first byte write. A completed checkpoint must never silently switch outputs.
      if (error instanceof ProviderError && error.code === 'object_unavailable' && !checkpoints[`${prefix}_key`]) return null;
      throw error;
    }
    if (checkpoints[`${prefix}_digest`] && stored.sha256 !== checkpoints[`${prefix}_digest`]) throw new ApiError(422, 'checkpoint_integrity', 'The stored task checkpoint failed integrity validation.');
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder().decode(stored.bytes)); }
    catch { throw new ApiError(422, 'checkpoint_integrity', 'The stored task checkpoint is not valid JSON.'); }
    // Recover a successful immutable write even when the previous worker died before recording its receipt.
    await checkpointMany({ [`${prefix}_key`]: key, [`${prefix}_version`]: stored.version, [`${prefix}_digest`]: stored.sha256 }, stage);
    return { parsed };
  };
  const services = deps.services || createServiceAdapters(deps.providers, {
    circuitState: providerCircuits,
    onAttempt: async attempt => { await updateWorkerCase(deps.repository, caseId, async envelope => {
      active(envelope, jobId, lease); envelope.provider_attempts ||= [];
      envelope.provider_attempts.push({ job_id: jobId, operation: attempt.operation, attempt: attempt.attempt, outcome: attempt.outcome, occurred_at: new Date().toISOString() });
    }); },
  });
  try {
    if (!store) throw new ProviderError('storage_unavailable', 'Private evidence storage is not configured.', 503, false);
    if (claimed.job.kind === 'document') {
      let envelope = await current(); const document = envelope.state.documents[claimed.job.object_id];
      if (!document || document.state === 'removed') throw new ApiError(409, 'source_unavailable', 'The source is no longer available.');
      const object = await store.get(document.storage_key, document.storage_version_id);
      if (object.sha256 !== document.sha256 || object.size !== document.bytes) throw new ApiError(422, 'source_integrity', 'The pinned source bytes do not match their registered digest.');
      const input: DocumentServiceInput = { task_id: jobId, document_version_id: document.document_version_id, sha256: document.sha256, content_type: document.media_type as SupportedContentType, bytes: object.bytes };
      if (!envelope.state.jobs[jobId].checkpoints.scanning) {
        const scan = await services.scan(input);
        if (scan.status !== 'clean') {
          await commit('document.complete', { job_id: jobId, document_version_id: document.document_version_id, scan_result: scan.status === 'infected' ? 'malware' : 'indeterminate' });
          return safeJob((await deps.repository.findForWorker(caseId))!.state.jobs[jobId]);
        }
        await checkpoint('scanning', 'clean', 'extraction');
      }
      envelope = await current(); let extraction: ExtractionOutput;
      const recovered = await recoverOutput(envelope.state.jobs[jobId].checkpoints, 'extraction', 'indexing');
      if (recovered) {
        extraction = recovered.parsed as ExtractionOutput;
      } else {
        extraction = await services.extract(input);
        const key = `extractions/${jobId}/${crypto.randomUUID()}`;
        // Persist output intent before its storage side effect, then bind the exact version.
        await checkpoint('extraction_intent', key, 'extraction');
        const raw = await store.put(key, new TextEncoder().encode(JSON.stringify(extraction)), 'application/json');
        await checkpointMany({ extraction_version: raw.version, extraction_digest: raw.sha256, extraction_key: key }, 'indexing');
      }
      let rendition: { rendition_storage_key: string; rendition_storage_version_id: string; rendition_sha256: string } | undefined;
      if (extraction.rendition_pdf_base64) {
        const bytes = base64ToBytes(extraction.rendition_pdf_base64), key = `renditions/${jobId}/${extraction.rendition_version_id}`;
        await checkpoint('rendition_intent', key, 'indexing');
        const saved = await store.put(key, bytes, 'application/pdf');
        rendition = { rendition_storage_key: key, rendition_storage_version_id: saved.version, rendition_sha256: saved.sha256 };
      }
      const latest = await current();
      await commit('document.complete', { job_id: jobId, document_version_id: document.document_version_id, scan_result: 'clean', extraction: {
        source_artifact_id: extraction.source_artifact_id, rendition_version_id: extraction.rendition_version_id, ...rendition,
        raw_extraction_storage_key: latest.state.jobs[jobId].checkpoints.extraction_key,
        extraction_run_id: extraction.extraction_run_id, extraction_version: extraction.extractor_version, page_count: extraction.pages.length,
        blocks: extraction.pages.flatMap(page => page.blocks.map(block => ({ block_id: block.block_id, text: block.text, locator: { page_index: page.page_index, page_label: page.page_label, block_id: block.block_id, bbox: block.bbox }, quality: page.status === 'complete' && page.quality >= 0.8 ? 'verified' : 'needs_review' }))),
      } });
    } else if (claimed.job.kind === 'criterion') {
      const envelope = await current(), run = envelope.state.runs[claimed.job.object_id]; if (!run) throw unavailable();
      const job = envelope.state.jobs[jobId], ctx = scopedContext(deps, job), sources = getRunSources(envelope.state, run.run_id, ctx);
      let candidate: unknown;
      const recovered = await recoverOutput(job.checkpoints, 'model_output', 'validating');
      if (recovered) {
        candidate = recovered.parsed;
      } else {
        if (job.checkpoints.model_intent) throw new ApiError(409, 'model_attempt_uncertain', 'A prior model attempt may have completed. Reconcile the recorded attempt before initiating another billable request.');
        await checkpoint('model_intent', new Date().toISOString(), 'model');
        const config = run.manifest.configuration;
        const output = await services.generate({ task_id: jobId, approved_prompt: config.instructions, model: config.model, prompt_version: config.prompt_version, rule_pack_version: config.rule_pack_version, output_schema_version: config.output_schema_version, input_manifest_hash: run.input_manifest_hash, output_schema: MODEL_OUTPUT_SCHEMA, authorized_input: {
          criterion_id: run.criterion_id, facts: run.manifest.facts,
          sources: sources.map(source => ({ document_version_id: source.document_version_id, source_artifact_id: source.source_artifact_id, rendition_version_id: source.rendition_version_id, extraction_run_id: source.extraction_run_id, blocks: source.blocks })),
          authority_refs: config.authority_refs,
          required_element_ids: config.required_element_ids,
        } });
        candidate = output.candidate;
        const key = `extractions/${jobId}/model-${crypto.randomUUID()}`;
        await checkpoint('model_output_intent', key, 'validating');
        const saved = await store.put(key, new TextEncoder().encode(JSON.stringify(candidate)), 'application/json');
        await checkpointMany({ model_output_version: saved.version, model_output_digest: saved.sha256, model_output_key: key, model_usage: JSON.stringify({ model: output.model, response_id: output.provider_response_id, ...output.usage }) }, 'validating');
      }
      await commit('run.publish', { run_id: run.run_id, candidate });
    } else if (claimed.job.kind === 'export') {
      const envelope = await current(), packet = envelope.state.exports[claimed.job.object_id]; if (!packet) throw unavailable();
      const ids = [...new Set(packet.snapshot.claims.flatMap(claim => claim.citations.map(citation => citation.document_version_id)))];
      const sources = []; let packetInputBytes = 0;
      const reservePacketInput = (size: number) => {
        packetInputBytes += size;
        if (packetInputBytes > 20 * 1024 * 1024) throw new ApiError(413, 'packet_input_limit', 'This renderer transport supports at most 20 MB of source and form material per packet.');
      };
      for (const id of ids) {
        const document = envelope.state.documents[id]; if (!document || document.state !== 'ready' || document.scan_result !== 'clean') throw new ApiError(409, 'source_unavailable', 'A packet source is unavailable.');
        const stored = await store.get(document.rendition_storage_key || document.storage_key, document.rendition_storage_key ? document.rendition_storage_version_id : document.storage_version_id);
        if (stored.sha256 !== (document.rendition_storage_key ? document.rendition_sha256 : document.sha256)) throw new ApiError(422, 'source_integrity', 'A packet source failed integrity validation.');
        reservePacketInput(stored.size);
        sources.push({ document_version_id: id, source_artifact_id: document.source_artifact_id, rendition_version_id: document.rendition_version_id, page_count: document.page_count, content_type: 'application/pdf', sha256: stored.sha256, content_base64: bytesToBase64(stored.bytes) });
      }
      const templates = [];
      for (const preview of packet.snapshot.form_previews) {
        const template = deps.context.formTemplates?.find(t => t.template_id === preview.template_id && t.version === preview.template_version && t.sha256 === preview.template_sha256 && t.active);
        if (!template) throw new ApiError(422, 'template_unavailable', 'The official template is no longer approved.');
        const response = await (deps.fetch || fetch)(template.source_url, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new ApiError(503, 'template_unavailable', 'The official template could not be retrieved.', true);
        const { readBytes } = await import('./http.ts');
        const bytes = await readBytes(new Request('https://template.invalid', { method: 'POST', body: response.body, duplex: 'half' } as RequestInit), 20 * 1024 * 1024);
        reservePacketInput(bytes.byteLength);
        if (await sha256(bytes) !== template.sha256 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new ApiError(422, 'template_integrity', 'The official template bytes do not match the approved registry.');
        templates.push({ ...preview, edition: template.edition, content_base64: bytesToBase64(bytes) });
      }
      await checkpoint('render_intent', packet.snapshot_digest, 'rendering');
      const output = await services.render({ task_id: jobId, snapshot_digest: packet.snapshot_digest, snapshot: { ...packet.snapshot, selected_results: packet.selected_results, sources, templates } });
      const bytes = base64ToBytes(output.pdf_base64), key = `exports/${packet.export_id}/${await sha256(bytes)}`;
      await checkpoint('packet_intent', key, 'validating');
      const stored = await store.put(key, bytes, 'application/pdf');
      await commit('export.complete', { export_id: packet.export_id, packet_digest: stored.sha256, storage_key: key, storage_version_id: stored.version, bytes: stored.size, page_count: output.page_count, reference_entries: output.reference_entries });
    }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'processing_failed';
    const retryable = (error instanceof ProviderError || error instanceof ApiError) && error.retryable;
    await updateWorkerCase(deps.repository, caseId, async envelope => {
      const job = envelope.state.jobs[jobId];
      // Canceled/replaced leases are authoritative; late work must not change them.
      if (!job || job.state !== 'running' || job.lease_token !== lease) return;
      const uncertain = job.kind === 'criterion' && ((error instanceof ProviderError && error.uncertain) || code === 'model_attempt_uncertain');
      const recoverableOutput = !!job.checkpoints.model_output_intent;
      const mayRetry = retryable && !uncertain && job.attempts < job.max_attempts;
      job.state = mayRetry ? 'queued' : 'failed'; job.lease_token = undefined; job.lease_expires_at = undefined;
      job.next_attempt_at = mayRetry ? new Date(Date.now() + Math.min(300_000, 5_000 * 2 ** (job.attempts - 1))).toISOString() : undefined;
      if (!uncertain && job.stage === 'model') delete job.checkpoints.model_intent;
      job.error = { code, message: uncertain ? 'The model attempt has an uncertain outcome and needs operator reconciliation.' : 'This processing step could not complete. Check provider configuration or correct the pinned inputs.', retryable: retryable && (!uncertain || recoverableOutput) && job.attempts < job.max_attempts };
      envelope.state.outbox.push({ event_id: crypto.randomUUID(), schema_version: '1', case_id: caseId, type: mayRetry ? 'job.retry_scheduled' : 'job.dead_lettered', object_id: jobId, object_revision: job.attempts, occurred_at: new Date().toISOString(), correlation_id: jobId, causation_id: jobId });
    });
  }
  const finished = await deps.repository.findForWorker(caseId); if (!finished) throw unavailable(); return safeJob(finished.state.jobs[jobId]);
}

export async function processDueJobs(deps: ProcessorDependencies, limit = 10) {
  const cases = await deps.repository.dueCases(Math.min(limit, 20)); let processed = 0;
  for (const caseId of cases) {
    const envelope = await deps.repository.findForWorker(caseId); if (!envelope) continue;
    for (const job of Object.values(envelope.state.jobs)) {
      if (processed >= limit) return processed;
      if (!['queued', 'running'].includes(job.state) || (job.next_attempt_at && Date.parse(job.next_attempt_at) > Date.now()) || (job.state === 'running' && Date.parse(job.lease_expires_at || '') > Date.now())) continue;
      await processJob(caseId, job.job_id, deps); processed++;
    }
  }
  return processed;
}
