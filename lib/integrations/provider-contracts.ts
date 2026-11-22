/** Version 1 private service contracts. These are Harness Law contracts, not vendor APIs. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const SUPPORTED_CONTENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] as const;
export type SupportedContentType = typeof SUPPORTED_CONTENT_TYPES[number];

export interface StoredObject {
  key: string;
  version: string;
  sha256: string;
  size: number;
  contentType: string;
}
export interface ObjectStore {
  /** Keys are opaque, unique and immutable. A repeated put must have identical bytes. */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<StoredObject>;
  get(key: string, version?: string): Promise<StoredObject & { bytes: Uint8Array }>;
  delete(key: string, version?: string): Promise<void>;
}
export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  endpoint?: string;
  /** Amazon S3 bucket versioning is required by default. */
  requireVersionId?: boolean;
}
export interface ServiceEndpoint { url: string; token: string }
export interface ProviderConfig {
  scanner?: ServiceEndpoint;
  extractor?: ServiceEndpoint;
  renderer?: ServiceEndpoint;
  model?: { apiKey: string; model: string; maxOutputTokens?: number; maxInputBytes?: number };
}
export interface ProviderRuntime {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  maxAttempts?: number;
  circuitFailureThreshold?: number;
  circuitResetMs?: number;
  /** Share this map across jobs in a worker isolate; state is keyed by operation and endpoint URL. */
  circuitState?: Map<string, { failures: number; openUntil: number }>;
  onAttempt?: (attempt: ProviderAttempt) => void | Promise<void>;
}
export interface ProviderAttempt {
  operation: 'scan' | 'extract' | 'render' | 'model';
  task_id: string;
  attempt: number;
  outcome: 'started' | 'succeeded' | 'failed' | 'uncertain';
  retryable?: boolean;
}
export interface DocumentServiceInput {
  task_id: string;
  document_version_id: string;
  sha256: string;
  content_type: SupportedContentType;
  bytes: Uint8Array;
}
export interface ScanOutput {
  schema_version: '1';
  document_version_id: string;
  sha256: string;
  scanner_version: string;
  status: 'clean' | 'infected' | 'indeterminate';
}
export interface ExtractionBlock {
  block_id: string;
  text: string;
  /** Normalized [x_min, y_min, x_max, y_max] coordinates within the physical page. */
  bbox?: [number, number, number, number];
  reading_order: number;
  table?: { row: number; column: number; row_span: number; column_span: number };
}
export interface ExtractionPage {
  page_index: number;
  page_label?: string;
  width: number;
  height: number;
  quality: number;
  status: 'complete' | 'failed' | 'needs_review';
  blocks: ExtractionBlock[];
}
export interface ExtractionOutput {
  schema_version: '1';
  document_version_id: string;
  sha256: string;
  source_artifact_id: string;
  rendition_version_id?: string;
  extraction_run_id: string;
  extractor_version: string;
  pages: ExtractionPage[];
  /** A nonpaged source requires a canonical PDF rendition, delivered as bytes, never a URL. */
  rendition_pdf_base64?: string;
}
export interface RenderReference {
  claim_id: string;
  claim_revision: number;
  citation_id: string;
  document_version_id: string;
  exhibit_label: string;
  exhibit_pages: number[];
  packet_pages: number[];
  display_text: string;
}
export interface RenderInput { task_id: string; snapshot_digest: string; snapshot: unknown }
export interface RenderOutput {
  schema_version: '1';
  snapshot_digest: string;
  pdf_base64: string;
  page_count: number;
  reference_entries: RenderReference[];
  reference_validation: 'passed';
}
export interface ModelInput {
  task_id: string;
  approved_prompt: string;
  prompt_version: string;
  rule_pack_version: string;
  model: string;
  input_manifest_hash: string;
  /** Only server-selected evidence, profile facts and approved rules. */
  authorized_input: unknown;
  output_schema: Record<string, unknown>;
  output_schema_version: string;
}
export interface ModelOutput {
  candidate: unknown;
  provider_response_id: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}
