export const CRITERION_IDS = ['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08', 'C09', 'C10'] as const;
export type CriterionId = typeof CRITERION_IDS[number];
export type SupportStatus = 'unassessed' | 'supported' | 'needs_review' | 'conflicting' | 'evidence_missing';
export type ReviewStatus = 'unreviewed' | 'applicant_reviewed' | 'attorney_reviewed';
export const SUPPORTED_FORMATS = {
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
} as const;
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export interface ModuleConfig {
  criterion_id: CriterionId; module_version: string; rule_pack_version: string;
  prompt_version: string; output_schema_version: string; evaluation_version: string;
  model: string; active: boolean; activation_approval: string; instructions: string;
  required_fact_keys: string[]; required_element_ids: string[]; authority_refs: string[];
}
export interface FormTemplate {
  template_id: string; version: string; edition: string; source_url: string; retrieved_at: string;
  sha256: string; approval: string; active: boolean;
  fields: { field_id: string; fact_key: string; required: boolean; max_length: number; format?: 'date' | 'text' }[];
}
export interface CaseRule { version: string; approval: string; authority_refs: string[]; }
export interface CaseAnalysis {
  route: 'criteria' | 'major_award'; rule_version: string;
  sections: { kind: 'overall_record' | 'continued_work' | 'prospective_benefit' | 'major_award'; authority_refs: string[]; claim_ids: string[] }[];
}
export interface Locator {
  page_index: number; page_label?: string; block_id: string;
  bbox?: [number, number, number, number];
}
export interface SourceBlock { block_id: string; text: string; locator: Locator; quality: 'verified' | 'needs_review'; }
export interface DocumentVersion {
  document_id: string; document_version_id: string; case_id: string; revision: number;
  title: string; storage_key: string; storage_version_id: string; sha256: string;
  media_type: string; bytes: number; state: 'quarantined' | 'ready' | 'rejected' | 'removed';
  scan_result: 'pending' | 'clean' | 'malware' | 'indeterminate';
  source_artifact_id: string; rendition_version_id?: string; rendition_storage_key?: string;
  rendition_storage_version_id?: string; rendition_sha256?: string; raw_extraction_storage_key?: string;
  extraction_run_id?: string; extraction_version?: string; page_count: number;
  blocks: SourceBlock[]; created_at: string;
}
export interface UploadSession {
  upload_id: string; document_id: string; document_version_id: string; storage_key: string;
  title: string; media_type: string; bytes: number; sha256: string;
  expires_at: string; state: 'pending' | 'confirmed' | 'rejected'; job_id?: string;
}
export interface FactRevision {
  fact_revision: number; value: string; confirmed: boolean; actor_id: string; occurred_at: string;
}
export interface Fact {
  fact_id: string; key: string; origin: 'applicant_statement' | 'extracted';
  document_version_id?: string; extracted_value?: string;
  current: FactRevision; history: FactRevision[];
}
export interface EvidenceLink {
  link_id: string; case_id: string; criterion_id: CriterionId; document_version_id: string;
  link_revision: number; state: 'proposed' | 'confirmed' | 'removed'; actor_id: string; updated_at: string;
}
export interface Manifest {
  canonicalization_version: '1'; case_id: string; criterion_id: CriterionId; configuration: ModuleConfig;
  sources: { document_version_id: string; revision: number; sha256: string; storage_version_id: string;
    source_artifact_id: string; rendition_version_id?: string; extraction_run_id: string; extraction_version: string;
    link_id: string; link_revision: number }[];
  facts: { fact_id: string; fact_revision: number; key: string; value: string }[];
}
export interface CriterionRun {
  run_id: string; criterion_id: CriterionId; run_generation: number; input_manifest_hash: string;
  manifest: Manifest; job_id: string; created_at: string;
  disposition: 'pending' | 'published' | 'superseded'; result_id?: string;
}
export interface Citation {
  citation_id: string; document_version_id: string; source_artifact_id: string;
  rendition_version_id?: string; extraction_run_id: string; locator: Locator; excerpt: string;
}
export interface Claim {
  claim_id: string; claim_revision: number; paragraph_id: string; text: string;
  event_id: string; citations: Citation[]; support_status: SupportStatus; review_status: ReviewStatus;
  reviewed_by?: string; reviewed_at?: string;
}
export interface ResultCandidate {
  section_title: string;
  claims: { text: string; event_id: string; citations: Omit<Citation, 'citation_id'>[] }[];
  element_assessments: { element_id: string; status: 'supported' | 'needs_review' | 'evidence_missing' | 'conflicting'; authority_refs: string[]; explanation: string }[];
  missing_evidence_tasks: { task_id: string; description: string }[];
  contradictions: { description: string; document_version_ids: string[] }[];
}
export interface CriterionResult {
  result_id: string; result_revision: number; run_id: string; criterion_id: CriterionId;
  input_manifest_hash: string; section_draft_id: string; section_revision: number; section_title: string;
  claims: Claim[]; element_assessments: ResultCandidate['element_assessments'];
  missing_evidence_tasks: ResultCandidate['missing_evidence_tasks']; contradictions: ResultCandidate['contradictions'];
  publication: 'published' | 'superseded'; created_at: string;
}
export interface ResultSelection { criterion_id: CriterionId; result_id: string; result_revision: number; }
export interface IssueDisposition {
  decision: 'resolved' | 'acknowledged'; reason: string; actor_id: string; occurred_at: string;
  issue_revision: number; reviewed_draft_revision: number;
}
export interface CompositionIssue {
  issue_id: string; kind: 'missing_evidence' | 'contradiction'; result_id: string; result_revision: number;
  criterion_id: CriterionId; description: string; document_version_ids: string[]; task_id?: string;
  issue_revision: number; disposition?: IssueDisposition; history: IssueDisposition[];
}
export interface Composition {
  composition_id: string; draft_id: string; draft_revision: number; selected_criteria: CriterionId[];
  selected_results: ResultSelection[]; unresolved_criteria: CriterionId[];
  case_wide_document_ids: string[]; case_wide_fact_ids: string[];
  dependencies: Record<string, string>; snapshot_digest: string; claims: Claim[];
  claim_origins: Record<string, { result_id: string; result_revision: number; claim_id: string }[]>;
  event_conflicts: { group_id: string; claim_ids: string[]; decision?: 'same_event' | 'distinct_events'; reason?: string; actor_id?: string; reviewed_at?: string }[];
  issues: CompositionIssue[];
  selected_result_bundles: Pick<CriterionResult, 'result_id' | 'result_revision' | 'criterion_id' | 'element_assessments' | 'missing_evidence_tasks' | 'contradictions'>[];
  case_analysis?: CaseAnalysis;
  history: { draft_revision: number; claims: Claim[] }[];
  job_id: string; created_at: string;
}
export interface ReferenceEntry {
  claim_id: string; claim_revision: number; citation_id: string; document_version_id: string;
  exhibit_label: string; exhibit_pages: number[]; packet_pages: number[]; display_text: string;
}
export interface PacketExport {
  export_id: string; composition_id: string; draft_revision: number; selected_results: ResultSelection[];
  snapshot_digest: string; snapshot: {
    claims: Claim[]; dependencies: Record<string, string>; form_previews: FormPreview[];
    case_analysis: CaseAnalysis; claim_origins: Composition['claim_origins'];
    event_decisions: Composition['event_conflicts'];
    issues: CompositionIssue[]; selected_result_bundles: Composition['selected_result_bundles'];
    sections: { criterion_id: CriterionId; result_id: string; result_revision: number; title: string; claim_ids: string[] }[];
  };
  state: 'queued' | 'preview_ready' | 'final_approved'; job_id: string; created_at: string;
  packet_digest?: string; storage_key?: string; storage_version_id?: string; bytes?: number; page_count?: number;
  reference_entries?: ReferenceEntry[]; reference_validation?: 'passed'; approved_by?: string; approved_at?: string;
}
export interface FormPreview {
  preview_id: string; template_id: string; template_version: string; template_sha256: string;
  fields: { field_id: string; value: string | null; fact_id?: string; fact_revision?: number; errors: string[] }[];
  ready: boolean;
}
export interface Job {
  job_id: string; kind: 'document' | 'criterion' | 'composition' | 'export'; object_id: string;
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'; stage: string;
  attempts: number; max_attempts: number; pipeline_version: string; checkpoints: Record<string, string>;
  lease_token?: string; lease_expires_at?: string; next_attempt_at?: string;
  error?: { code: string; message: string; retryable: boolean }; created_at: string;
  retry_history?: { reason: string; actor_id: string; occurred_at: string }[];
}
export interface DomainEvent {
  event_id: string; schema_version: '1'; case_id: string; type: string; object_id: string;
  object_revision: number; occurred_at: string; correlation_id: string; causation_id: string;
  delivered_at?: string;
}
export interface IntegrationCase {
  schema_version: '1'; case_id: string; owner_id: string; revision: number; created_at: string; updated_at: string;
  facts: Record<string, Fact>; documents: Record<string, DocumentVersion>; upload_sessions: Record<string, UploadSession>;
  links: Record<string, EvidenceLink>; runs: Record<string, CriterionRun>; results: Record<string, CriterionResult[]>;
  generations: Partial<Record<CriterionId, number>>; current_results: Partial<Record<CriterionId, { result_id: string; result_revision: number }>>;
  compositions: Record<string, Composition>; exports: Record<string, PacketExport>; jobs: Record<string, Job>;
  form_previews: Record<string, FormPreview>; outbox: DomainEvent[];
}
export interface DomainContext {
  actorId: string; now: string; role: 'applicant' | 'worker'; modules: ModuleConfig[];
  formTemplates?: FormTemplate[]; correlationId?: string; causationId?: string;
  caseRule?: CaseRule;
  workerScope?: { jobId: string; runId?: string };
}
