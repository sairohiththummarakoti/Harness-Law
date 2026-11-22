import { z } from 'zod';
import { MAX_UPLOAD_BYTES } from './provider-contracts.ts';
import type {
  DocumentServiceInput, ExtractionOutput, ModelInput, ModelOutput, ObjectStore,
  ProviderConfig, ProviderRuntime, RenderInput, RenderOutput, S3Config, ScanOutput,
  ServiceEndpoint, StoredObject, SupportedContentType,
} from './provider-contracts';

export class ProviderError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly uncertain: boolean;
  constructor(code: string, message: string, status = 503, retryable = false, uncertain = false) {
    super(message); this.name = 'ProviderError'; this.code = code; this.status = status;
    this.retryable = retryable; this.uncertain = uncertain;
  }
}

const encoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const digestBase64 = (digest: string) => bytesToBase64(Uint8Array.from(digest.match(/../g)!, pair => parseInt(pair, 16)));
const buffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
export async function sha256(bytes: Uint8Array): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer(bytes))));
}
export function bytesToBase64(bytes: Uint8Array): string {
  let value = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(value);
}
export function base64ToBytes(value: string, maxBytes = 50 * 1024 * 1024): Uint8Array {
  if (value.length > Math.ceil(maxBytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new ProviderError('invalid_provider_output', 'The provider returned invalid binary content.', 422);
  }
  try { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
  catch { throw new ProviderError('invalid_provider_output', 'The provider returned invalid binary content.', 422); }
}
function starts(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}
function invalidUpload(): never {
  throw new ProviderError('unsupported_content', 'The actual file content is not a supported PDF, PNG, JPEG or DOCX document.', 422);
}

/** Validates the ZIP directory, not just PK magic. Antivirus and extraction remain mandatory. */
function isDocx(bytes: Uint8Array): boolean {
  if (!starts(bytes, [0x50, 0x4b, 0x03, 0x04]) || bytes.length < 22) return false;
  const view = new DataView(buffer(bytes));
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { end = offset; break; }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) return false;
  const count = view.getUint16(end + 10, true), directorySize = view.getUint32(end + 12, true), directoryStart = view.getUint32(end + 16, true);
  if (!count || count > 4096 || view.getUint16(end + 8, true) !== count || directoryStart + directorySize !== end) return false;
  let offset = directoryStart, totalSize = 0;
  const names = new Set<string>();
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) return false;
    const flags = view.getUint16(offset + 8, true), compression = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true), expanded = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    if ((flags & 1) || ![0, 8].includes(compression) || !nameLength || offset + 46 + nameLength + extra + comment > end) return false;
    let name: string;
    try { name = textDecoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)); } catch { return false; }
    if (names.has(name) || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..') || /vba|macro|activex/i.test(name)) return false;
    if (local + 30 > directoryStart || view.getUint32(local, true) !== 0x04034b50) return false;
    const localNameLength = view.getUint16(local + 26, true), localExtra = view.getUint16(local + 28, true);
    if (localNameLength !== nameLength || local + 30 + localNameLength + localExtra + compressed > directoryStart) return false;
    if (!bytes.subarray(local + 30, local + 30 + localNameLength).every((b, i) => b === bytes[offset + 46 + i])) return false;
    if (view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== compression) return false;
    totalSize += expanded;
    if (totalSize > 100 * 1024 * 1024 || expanded > Math.max(compressed * 200, 1024 * 1024)) return false;
    names.add(name); offset += 46 + nameLength + extra + comment;
  }
  return offset === end && names.has('[Content_Types].xml') && names.has('_rels/.rels') && names.has('word/document.xml');
}

export async function validateUpload(bytes: Uint8Array, declaredType: string, expectedSha256: string): Promise<{ sha256: string; size: number; contentType: SupportedContentType }> {
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw new ProviderError('invalid_size', 'Files must contain bytes and be no larger than 20 MB.', 422);
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new ProviderError('invalid_checksum', 'A lowercase SHA-256 checksum is required.', 422);
  let contentType: SupportedContentType;
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) && new TextDecoder().decode(bytes.subarray(Math.max(0, bytes.length - 1024))).includes('%%EOF')) contentType = 'application/pdf';
  else if (starts(bytes, [137, 80, 78, 71, 13, 10, 26, 10]) && bytes.length >= 33 && new TextDecoder().decode(bytes.subarray(12, 16)) === 'IHDR') contentType = 'image/png';
  else if (starts(bytes, [255, 216, 255]) && bytes.length >= 4 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) contentType = 'image/jpeg';
  else if (isDocx(bytes)) contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  else invalidUpload();
  if (declaredType !== contentType) throw new ProviderError('content_type_mismatch', 'The declared file type does not match the stored content.', 422);
  const digest = await sha256(bytes);
  if (digest !== expectedSha256) throw new ProviderError('checksum_mismatch', 'The stored content does not match the upload checksum.', 422);
  return { sha256: digest, size: bytes.length, contentType };
}

async function boundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const length = Number(response.headers.get('content-length') || 0);
  if (length > maxBytes) { await response.body?.cancel(); throw new ProviderError('provider_response_too_large', 'The provider response exceeds the configured limit.', 422); }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.length;
      if (total > maxBytes) { await reader.cancel(); throw new ProviderError('provider_response_too_large', 'The provider response exceeds the configured limit.', 422); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
function opaqueKey(key: string): void {
  if (!/^[A-Za-z0-9/_\-.]{1,512}$/.test(key) || key.startsWith('/') || key.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new ProviderError('invalid_object_key', 'A valid opaque storage key is required.', 422);
  }
}
function httpsUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new ProviderError('provider_not_configured', 'The provider endpoint is not configured correctly.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw new ProviderError('provider_not_configured', 'The provider requires a private HTTPS endpoint.');
  return url;
}
async function hmac(key: Uint8Array, message: string): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey('raw', buffer(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, buffer(encoder.encode(message))));
}
const uriEncode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

/** S3 Signature V4, immutable keys, pinned object versions, verified SHA-256 on every read. */
export function createS3Store(config: S3Config, runtime: Pick<ProviderRuntime, 'fetch' | 'now' | 'timeoutMs'> = {}): ObjectStore {
  if (!config.bucket || !config.region || !config.accessKeyId || !config.secretAccessKey || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket)) throw new ProviderError('storage_not_configured', 'Private S3 storage is not configured.');
  const endpoint = httpsUrl(config.endpoint || `https://${config.bucket}.s3.${config.region}.amazonaws.com`);
  if (endpoint.pathname !== '/') throw new ProviderError('storage_not_configured', 'The S3 endpoint must not contain a path.');
  const fetcher = runtime.fetch || fetch;
  async function request(method: string, key: string, bytes?: Uint8Array, contentType?: string, version?: string): Promise<Response> {
    opaqueKey(key);
    const path = '/' + (config.endpoint ? uriEncode(config.bucket) + '/' : '') + key.split('/').map(uriEncode).join('/');
    const url = new URL(endpoint.origin + path);
    if (version) url.search = `versionId=${uriEncode(version)}`;
    const timestamp = new Date(runtime.now?.() ?? Date.now()).toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = timestamp.slice(0, 8), digest = await sha256(bytes || new Uint8Array());
    const headers = new Headers({ 'x-amz-date': timestamp, 'x-amz-content-sha256': digest });
    if (config.sessionToken) headers.set('x-amz-security-token', config.sessionToken);
    if (method === 'PUT') {
      headers.set('Content-Type', contentType || 'application/octet-stream');
      headers.set('If-None-Match', '*'); headers.set('x-amz-meta-sha256', digest);
      headers.set('x-amz-checksum-sha256', digestBase64(digest));
    }
    const entries: [string, string][] = [(['host', url.host] as [string, string]), ...Array.from(headers.entries()).filter(([name]) => name.startsWith('x-amz-'))].sort(([a], [b]) => a.localeCompare(b));
    const signedHeaders = entries.map(([name]) => name).join(';');
    const canonicalHeaders = entries.map(([name, value]) => `${name}:${value.trim().replace(/\s+/g, ' ')}\n`).join('');
    const canonical = [method, url.pathname, url.search.slice(1), canonicalHeaders, signedHeaders, digest].join('\n');
    const scope = `${date}/${config.region}/s3/aws4_request`;
    const toSign = `AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${await sha256(encoder.encode(canonical))}`;
    const dateKey = await hmac(encoder.encode(`AWS4${config.secretAccessKey}`), date);
    const regionKey = await hmac(dateKey, config.region), serviceKey = await hmac(regionKey, 's3');
    const signature = hex(await hmac(await hmac(serviceKey, 'aws4_request'), toSign));
    headers.set('Authorization', `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`);
    try {
      return await fetcher(url, { method, headers, body: bytes ? buffer(bytes) : undefined, redirect: 'error', signal: AbortSignal.timeout(runtime.timeoutMs ?? 30_000) });
    } catch { throw new ProviderError('storage_unavailable', 'Private object storage is temporarily unavailable.', 503, true, method === 'PUT'); }
  }
  async function get(key: string, version?: string): Promise<StoredObject & { bytes: Uint8Array }> {
    const response = await request('GET', key, undefined, undefined, version);
    if (!response.ok) { await response.body?.cancel(); throw new ProviderError(response.status === 404 ? 'object_unavailable' : 'storage_unavailable', 'The private object is unavailable.', response.status === 404 ? 404 : 503, response.status >= 500); }
    const returnedVersion = response.headers.get('x-amz-version-id');
    if ((config.requireVersionId !== false && (!returnedVersion || returnedVersion === 'null')) || (version && returnedVersion !== version)) {
      await response.body?.cancel(); throw new ProviderError('object_version_mismatch', 'The requested immutable object version is unavailable.', 409);
    }
    const bytes = await boundedBytes(response, 50 * 1024 * 1024), digest = await sha256(bytes);
    const storedDigest = response.headers.get('x-amz-meta-sha256');
    const nativeChecksum = response.headers.get('x-amz-checksum-sha256');
    if (!storedDigest || storedDigest !== digest || (nativeChecksum && nativeChecksum !== digestBase64(digest))) throw new ProviderError('storage_integrity_failure', 'Private object integrity validation failed.', 422);
    return { key, version: returnedVersion || digest, sha256: digest, size: bytes.length, contentType: response.headers.get('content-type') || 'application/octet-stream', bytes };
  }
  return {
    async put(key, bytes, contentType) {
      const digest = await sha256(bytes), response = await request('PUT', key, bytes, contentType);
      if (response.status === 412) {
        await response.body?.cancel(); const existing = await get(key);
        if (existing.sha256 !== digest || existing.contentType !== contentType) throw new ProviderError('object_conflict', 'An immutable object already exists at this destination.', 409);
        const { bytes: omitted, ...metadata } = existing; void omitted; return metadata;
      }
      await response.body?.cancel();
      if (!response.ok) throw new ProviderError('storage_unavailable', 'The private upload could not be stored.', 503, response.status >= 500 || response.status === 429, response.status >= 500);
      const nativeChecksum = response.headers.get('x-amz-checksum-sha256');
      if (nativeChecksum && nativeChecksum !== digestBase64(digest)) throw new ProviderError('storage_integrity_failure', 'Private object integrity validation failed.', 422);
      const version = response.headers.get('x-amz-version-id');
      if (config.requireVersionId !== false && (!version || version === 'null')) throw new ProviderError('storage_versioning_required', 'Enable versioning on the private evidence bucket before accepting uploads.');
      return { key, version: version || digest, sha256: digest, size: bytes.length, contentType };
    },
    get,
    async delete(key, version) {
      const response = await request('DELETE', key, undefined, undefined, version); await response.body?.cancel();
      if (!response.ok && response.status !== 404) throw new ProviderError('storage_unavailable', 'The private object could not be removed.', 503, response.status >= 500);
    },
  };
}

/** R2 compatibility adapter uses immutable unique keys; it cannot retrieve overwritten historical objects. */
export function createR2Store(bucket: R2Bucket): ObjectStore {
  async function get(key: string, version?: string): Promise<StoredObject & { bytes: Uint8Array }> {
    opaqueKey(key); const object = await bucket.get(key);
    if (!object) throw new ProviderError('object_unavailable', 'The private object is unavailable.', 404);
    if (version && object.version !== version) { await object.body.cancel(); throw new ProviderError('object_version_mismatch', 'The requested immutable object version is unavailable.', 409); }
    const bytes = await boundedBytes(new Response(object.body), 50 * 1024 * 1024), digest = await sha256(bytes);
    if (object.customMetadata?.sha256 !== digest) throw new ProviderError('storage_integrity_failure', 'Private object integrity validation failed.', 422);
    return { key, version: object.version, sha256: digest, size: bytes.length, contentType: object.httpMetadata?.contentType || 'application/octet-stream', bytes };
  }
  return {
    async put(key, bytes, contentType) {
      opaqueKey(key); const digest = await sha256(bytes);
      const object = await bucket.put(key, buffer(bytes), { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType }, customMetadata: { sha256: digest }, sha256: digest });
      if (!object) {
        const existing = await get(key);
        if (existing.sha256 !== digest || existing.contentType !== contentType) throw new ProviderError('object_conflict', 'An immutable object already exists at this destination.', 409);
        const { bytes: omitted, ...metadata } = existing; void omitted; return metadata;
      }
      return { key, version: object.version, sha256: digest, size: bytes.length, contentType };
    },
    get,
    async delete(key, version) {
      opaqueKey(key);
      if (version) { const existing = await bucket.head(key); if (existing && existing.version !== version) throw new ProviderError('object_version_mismatch', 'The immutable object version changed.', 409); }
      await bucket.delete(key);
    },
  };
}

const id = z.string().min(1).max(200), digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const scanSchema = z.object({ schema_version: z.literal('1'), document_version_id: id, sha256: digestSchema, scanner_version: id, status: z.enum(['clean', 'infected', 'indeterminate']) }).strict();
const bboxSchema = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]).refine(([xMin, yMin, xMax, yMax]) => xMax > xMin && yMax > yMin);
const blockSchema = z.object({
  block_id: id, text: z.string().max(100_000), bbox: bboxSchema.optional(), reading_order: z.number().int().nonnegative(),
  table: z.object({ row: z.number().int().nonnegative(), column: z.number().int().nonnegative(), row_span: z.number().int().positive(), column_span: z.number().int().positive() }).strict().optional(),
}).strict();
const extractionSchema = z.object({
  schema_version: z.literal('1'), document_version_id: id, sha256: digestSchema, source_artifact_id: id,
  rendition_version_id: id.optional(), extraction_run_id: id, extractor_version: id,
  pages: z.array(z.object({ page_index: z.number().int().positive(), page_label: z.string().max(50).optional(), width: z.number().positive(), height: z.number().positive(), quality: z.number().min(0).max(1), status: z.enum(['complete', 'failed', 'needs_review']), blocks: z.array(blockSchema).max(10_000) }).strict()).min(1).max(2000),
  rendition_pdf_base64: z.string().max(70 * 1024 * 1024).optional(),
}).strict();
const referenceSchema = z.object({
  claim_id: id, claim_revision: z.number().int().positive(), citation_id: id, document_version_id: id,
  exhibit_label: z.string().regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)?$/), exhibit_pages: z.array(z.number().int().positive()).min(1).max(2000),
  packet_pages: z.array(z.number().int().positive()).min(1).max(2000), display_text: z.string().min(1).max(200),
}).strict();
const renderSchema = z.object({ schema_version: z.literal('1'), snapshot_digest: digestSchema, pdf_base64: z.string().min(1).max(70 * 1024 * 1024), page_count: z.number().int().positive().max(10000), reference_entries: z.array(referenceSchema).max(10000), reference_validation: z.literal('passed') }).strict();
function parseOutput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ProviderError('invalid_provider_output', 'The provider returned data that does not meet the versioned contract.', 422);
  return result.data;
}

/** Only optional citation fields can become absent; required null fields still fail domain validation. */
export function normalizeCriterionCandidate(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const result = structuredClone(value) as Record<string, unknown>;
  if (!Array.isArray(result.claims)) return result;
  for (const claim of result.claims) {
    if (!claim || typeof claim !== 'object' || !Array.isArray(claim.citations)) continue;
    for (const citation of claim.citations) {
      if (!citation || typeof citation !== 'object') continue;
      if (citation.rendition_version_id === null) delete citation.rendition_version_id;
      if (citation.locator && typeof citation.locator === 'object' && !Array.isArray(citation.locator)) {
        if (citation.locator.page_label === null) delete citation.locator.page_label;
        if (citation.locator.bbox === null) delete citation.locator.bbox;
      }
    }
  }
  return result;
}

export function createServiceAdapters(config: ProviderConfig, runtime: ProviderRuntime = {}) {
  const fetcher = runtime.fetch || fetch, now = runtime.now || Date.now;
  const sleep = runtime.sleep || ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const circuits = runtime.circuitState || new Map<string, { failures: number; openUntil: number }>();
  const timeoutMs = Math.max(1, Math.min(runtime.timeoutMs ?? 30_000, 120_000));
  const attempts = Math.max(1, Math.min(runtime.maxAttempts ?? 2, 3));
  async function call(operation: 'scan' | 'extract' | 'render' | 'model', endpoint: ServiceEndpoint | undefined, taskId: string, payload: unknown): Promise<unknown> {
    if (!endpoint?.url || !endpoint.token) throw new ProviderError('provider_not_configured', `The ${operation} provider is not configured.`);
    const url = httpsUrl(endpoint.url), circuitKey = `${operation}:${url.href}`, circuit = circuits.get(circuitKey) || { failures: 0, openUntil: 0 };
    if (circuit.openUntil > now()) throw new ProviderError('provider_circuit_open', 'The provider is temporarily unavailable. Retry after its recovery window.', 503, true);
    const body = JSON.stringify(payload);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      await runtime.onAttempt?.({ operation, task_id: taskId, attempt, outcome: 'started' });
      let providerError: ProviderError;
      try {
        const response = await fetcher(url, {
          method: 'POST', headers: { 'Authorization': `Bearer ${endpoint.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': `${taskId}:${operation}` },
          body, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
          await response.body?.cancel();
          const retryable = response.status === 429 || response.status === 408 || response.status >= 500;
          throw new ProviderError('provider_rejected', 'The provider could not complete this task.', retryable ? 503 : 422, retryable, operation === 'model' && response.status >= 500);
        }
        const bytes = await boundedBytes(response, operation === 'render' || operation === 'extract' ? 72 * 1024 * 1024 : 4 * 1024 * 1024);
        let parsed: unknown;
        try { parsed = JSON.parse(textDecoder.decode(bytes)); } catch { throw new ProviderError('invalid_provider_output', 'The provider returned invalid JSON.', 422); }
        circuit.failures = 0; circuit.openUntil = 0; circuits.set(circuitKey, circuit);
        await runtime.onAttempt?.({ operation, task_id: taskId, attempt, outcome: 'succeeded' });
        return parsed;
      } catch (error) {
        providerError = error instanceof ProviderError ? error : new ProviderError('provider_timeout', 'The provider request did not complete. Its outcome is unknown.', 503, true, true);
        await runtime.onAttempt?.({ operation, task_id: taskId, attempt, outcome: providerError.uncertain ? 'uncertain' : 'failed', retryable: providerError.retryable });
        if (!providerError.retryable) throw providerError;
        // A model timeout may already have incurred a charge. Reconciliation/retry belongs to the durable job controller.
        if (attempt === attempts || (operation === 'model' && providerError.uncertain)) {
          circuit.failures++;
          if (circuit.failures >= (runtime.circuitFailureThreshold ?? 3)) circuit.openUntil = now() + (runtime.circuitResetMs ?? 60_000);
          circuits.set(circuitKey, circuit); throw providerError;
        }
        await sleep(Math.min(250 * 2 ** (attempt - 1), 2000));
      }
    }
    throw new ProviderError('provider_unavailable', 'The provider is unavailable.', 503, true);
  }
  async function documentPayload(input: DocumentServiceInput) {
    await validateUpload(input.bytes, input.content_type, input.sha256);
    return { schema_version: '1', task_id: input.task_id, document_version_id: input.document_version_id, sha256: input.sha256, content_type: input.content_type, content_base64: bytesToBase64(input.bytes) };
  }
  return {
    async scan(input: DocumentServiceInput): Promise<ScanOutput> {
      const output = parseOutput(scanSchema, await call('scan', config.scanner, input.task_id, await documentPayload(input)));
      if (output.document_version_id !== input.document_version_id || output.sha256 !== input.sha256) throw new ProviderError('provider_scope_mismatch', 'The scan does not match this document version.', 422);
      return output;
    },
    async extract(input: DocumentServiceInput): Promise<ExtractionOutput> {
      const output = parseOutput(extractionSchema, await call('extract', config.extractor, input.task_id, await documentPayload(input)));
      if (output.document_version_id !== input.document_version_id || output.sha256 !== input.sha256) throw new ProviderError('provider_scope_mismatch', 'The extraction does not match this document version.', 422);
      const blockIds = new Set<string>();
      for (let index = 0; index < output.pages.length; index++) {
        const page = output.pages[index];
        if (page.page_index !== index + 1 || page.status === 'failed') throw new ProviderError('incomplete_extraction', 'One or more source pages could not be extracted.', 422);
        const order = new Set<number>();
        for (const block of page.blocks) {
          if (blockIds.has(block.block_id) || order.has(block.reading_order)) throw new ProviderError('invalid_provider_output', 'The extraction contains ambiguous source locations.', 422);
          blockIds.add(block.block_id); order.add(block.reading_order);
        }
      }
      if (input.content_type !== 'application/pdf' && (!output.rendition_version_id || !output.rendition_pdf_base64)) throw new ProviderError('rendition_required', 'A nonpaged source requires a pinned PDF rendition.', 422);
      if (output.rendition_pdf_base64) {
        if (!output.rendition_version_id) throw new ProviderError('rendition_required', 'A rendition version is required.', 422);
        const bytes = base64ToBytes(output.rendition_pdf_base64);
        if (!starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) throw new ProviderError('invalid_provider_output', 'The canonical rendition must be a PDF.', 422);
      }
      return output;
    },
    async render(input: RenderInput): Promise<RenderOutput & { bytes: Uint8Array; sha256: string }> {
      const output = parseOutput(renderSchema, await call('render', config.renderer, input.task_id, { schema_version: '1', ...input }));
      if (output.snapshot_digest !== input.snapshot_digest) throw new ProviderError('provider_scope_mismatch', 'The packet does not match the requested snapshot.', 422);
      const bytes = base64ToBytes(output.pdf_base64);
      if (!starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) || !new TextDecoder().decode(bytes.subarray(Math.max(0, bytes.length - 1024))).includes('%%EOF')) throw new ProviderError('invalid_provider_output', 'The packet renderer did not return a complete PDF.', 422);
      if (output.reference_entries.some(entry => entry.packet_pages.some(page => page > output.page_count))) throw new ProviderError('invalid_provider_output', 'The packet contains an out-of-bounds formal reference.', 422);
      return { ...output, bytes, sha256: await sha256(bytes) };
    },
    async generate(input: ModelInput): Promise<ModelOutput> {
      if (!config.model?.apiKey || !config.model.model || config.model.model !== input.model) throw new ProviderError('provider_not_configured', 'The approved model gateway is not configured.');
      if (!input.approved_prompt || !input.prompt_version || !input.rule_pack_version || !input.output_schema_version || !/^[a-f0-9]{64}$/.test(input.input_manifest_hash)) throw new ProviderError('invalid_model_task', 'A versioned approved prompt, schema and manifest are required.', 422);
      const serialized = JSON.stringify(input.authorized_input);
      if (encoder.encode(serialized).length > (config.model.maxInputBytes ?? 200_000)) throw new ProviderError('model_budget_exceeded', 'The authorized model input exceeds its configured budget.', 422);
      const output = await call('model', { url: 'https://api.openai.com/v1/responses', token: config.model.apiKey }, input.task_id, {
        model: input.model, store: false, stream: false, max_output_tokens: Math.max(256, Math.min(config.model.maxOutputTokens ?? 8000, 32000)),
        instructions: input.approved_prompt,
        input: [{ role: 'user', content: [{ type: 'input_text', text: serialized }] }],
        text: { format: { type: 'json_schema', name: 'criterion_result', strict: true, schema: input.output_schema } },
      });
      const responseSchema = z.object({ id, status: z.literal('completed'), model: id, output: z.array(z.object({ type: z.string(), content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).optional() }).passthrough()), usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }).passthrough() }).passthrough();
      const parsed = parseOutput(responseSchema, output);
      const text = parsed.output.flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text || '').join('');
      if (parsed.output.some(item => item.content?.some(part => part.type === 'refusal')) || !text) throw new ProviderError('model_output_unavailable', 'The model did not return a usable structured proposal.', 422);
      let candidate: unknown;
      try { candidate = JSON.parse(text); } catch { throw new ProviderError('invalid_provider_output', 'The model returned an invalid structured proposal.', 422); }
      return { candidate: normalizeCriterionCandidate(candidate), provider_response_id: parsed.id, model: parsed.model, usage: { input_tokens: parsed.usage.input_tokens, output_tokens: parsed.usage.output_tokens } };
    },
  };
}
