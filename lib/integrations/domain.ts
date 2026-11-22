import { z } from 'zod';
import { CRITERION_IDS, MAX_UPLOAD_BYTES, SUPPORTED_FORMATS } from './contracts.ts';
import type { Citation, Claim, Composition, CriterionId, CriterionResult, DomainContext, EvidenceLink, IntegrationCase, Job, Manifest, ModuleConfig, PacketExport } from './contracts';

export class DomainError extends Error {
  status: number; code: string; currentRevision?: number; fieldErrors?: Record<string, string[]>;
  constructor(status: number, code: string, message: string, currentRevision?: number) {
    super(message); this.name = 'DomainError'; this.status = status; this.code = code; this.currentRevision = currentRevision;
  }
}
const id = () => crypto.randomUUID();
const opaque = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const text = z.string().trim().min(1).max(20000);
const short = z.string().trim().min(1).max(200);
const revision = z.number().int().positive();
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const criterion = z.enum(CRITERION_IDS);
const support = z.enum(['unassessed', 'supported', 'needs_review', 'conflicting', 'evidence_missing']);
const locatorSchema = z.object({page_index: revision, page_label: short.optional(), block_id: opaque, bbox: z.tuple([z.number().min(0).max(1),z.number().min(0).max(1),z.number().min(0).max(1),z.number().min(0).max(1)]).optional()}).strict();
const citationSchema = z.object({document_version_id: opaque, source_artifact_id: opaque, rendition_version_id: opaque.optional(), extraction_run_id: opaque, locator: locatorSchema, excerpt: text}).strict();
export const moduleConfigSchema = z.object({criterion_id: criterion, module_version: short, rule_pack_version: short, prompt_version: short, output_schema_version: z.literal('1'), evaluation_version: short, model: short, active: z.boolean(), activation_approval: short, instructions: text, required_fact_keys: z.array(short).max(100), required_element_ids: z.array(opaque).min(1).max(100).refine(values=>new Set(values).size===values.length), authority_refs: z.array(short).min(1).max(100)}).strict();
export const resultCandidateSchema = z.object({
  section_title: short,
  claims: z.array(z.object({text, event_id: opaque, citations: z.array(citationSchema).min(1).max(30)}).strict()).min(1).max(100),
  element_assessments: z.array(z.object({element_id: opaque, status: z.enum(['supported','needs_review','evidence_missing','conflicting']), authority_refs: z.array(short).min(1).max(30), explanation: text}).strict()).min(1).max(100),
  missing_evidence_tasks: z.array(z.object({task_id: opaque, description: text}).strict()).max(100),
  contradictions: z.array(z.object({description: text, document_version_ids: z.array(opaque).min(1).max(30)}).strict()).max(100),
}).strict();
const expected = {expected_revision: revision};
const selectionSchema = z.object({criterion_id: criterion, result_id: opaque, result_revision: revision}).strict();
const schemas = {
  'fact.create': z.object({key: short, value: text, confirmed: z.boolean()}).strict(),
  'fact.update': z.object({fact_id: opaque, ...expected, value: text, confirmed: z.boolean()}).strict(),
  'upload.create': z.object({title: short, media_type: z.string().refine(v => Object.hasOwn(SUPPORTED_FORMATS,v)), bytes: z.number().int().positive().max(MAX_UPLOAD_BYTES), sha256: sha}).strict(),
  'upload.renew': z.object({upload_id: opaque}).strict(),
  'upload.confirm': z.object({upload_id: opaque, storage_version_id: short, sha256: sha, bytes: z.number().int().positive().max(MAX_UPLOAD_BYTES), media_type: short}).strict(),
  'document.complete': z.object({job_id: opaque, document_version_id: opaque, scan_result: z.enum(['clean','malware','indeterminate']), extraction: z.object({source_artifact_id: opaque, rendition_version_id: opaque.optional(), rendition_storage_key: short.optional(), rendition_storage_version_id: short.optional(), rendition_sha256: sha.optional(), raw_extraction_storage_key: short.optional(), extraction_run_id: opaque, extraction_version: short, page_count: revision.max(10000), blocks: z.array(z.object({block_id: opaque, text, locator: locatorSchema, quality: z.enum(['verified','needs_review'])}).strict()).min(1).max(20000)}).strict().optional()}).strict(),
  'document.remove': z.object({document_version_id: opaque, ...expected}).strict(),
  'link.create': z.object({criterion_id: criterion, document_version_id: opaque}).strict(),
  'link.update': z.object({link_id: opaque, ...expected, state: z.enum(['confirmed','removed'])}).strict(),
  'run.create': z.object({criterion_id: criterion}).strict(),
  'run.publish': z.object({run_id: opaque, candidate: resultCandidateSchema}).strict(),
  'result.edit': z.object({result_id: opaque, ...expected, claim_id: opaque, text}).strict(),
  'result.review': z.object({result_id: opaque, ...expected, claim_id: opaque, support_status: support}).strict(),
  'composition.create': z.object({selected_criteria: z.array(criterion).max(10), selected_results: z.array(selectionSchema).max(10), case_wide_document_ids: z.array(opaque).max(100).default([]), case_wide_fact_ids: z.array(opaque).max(100).default([])}).strict(),
  'composition.analysis': z.object({composition_id: opaque, ...expected, route: z.enum(['criteria','major_award']), sections: z.array(z.object({kind:z.enum(['overall_record','continued_work','prospective_benefit','major_award']),authority_refs:z.array(short).min(1).max(30),claims:z.array(z.object({text,event_id:opaque,citations:z.array(citationSchema).min(1).max(30)}).strict()).min(1).max(30)}).strict()).min(3).max(4)}).strict(),
  'composition.events': z.object({composition_id:opaque,...expected,group_id:opaque,decision:z.enum(['same_event','distinct_events']),reason:text}).strict(),
  'composition.issues': z.object({composition_id:opaque,...expected,issue_id:opaque,disposition:z.enum(['resolved','acknowledged']),reason:text}).strict(),
  'paragraph.edit': z.object({draft_id: opaque, paragraph_id: opaque, ...expected, text}).strict(),
  'paragraph.review': z.object({draft_id: opaque, paragraph_id: opaque, ...expected, support_status: support}).strict(),
  'form.preview': z.object({template_id: opaque}).strict(),
  'export.create': z.object({composition_id: opaque, draft_revision: revision, form_preview_ids: z.array(opaque).max(30).default([])}).strict(),
  'export.complete': z.object({export_id: opaque, packet_digest: sha, storage_key: short, storage_version_id: short, bytes: z.number().int().positive().max(200*1024*1024), page_count: revision.max(10000), reference_entries: z.array(z.object({claim_id: opaque, claim_revision: revision, citation_id: opaque, document_version_id: opaque, exhibit_label: z.string().regex(/^[A-Z][A-Z0-9-]{0,19}$/), exhibit_pages: z.array(revision).min(1).max(100), packet_pages: z.array(revision).min(1).max(100), display_text: short}).strict()).max(3000)}).strict(),
  'export.confirm': z.object({export_id: opaque, packet_digest: sha, draft_revision: revision}).strict(),
  'job.cancel': z.object({job_id: opaque}).strict(),
  'job.retry': z.object({job_id: opaque, reason: short}).strict(),
} as const;
export type DomainOperation = keyof typeof schemas;
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value).filter(([,v])=>v !== undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
}
export async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalize(value)));
  return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function createIntegrationCase(caseId: string, ownerId: string, now = new Date().toISOString()): IntegrationCase {
  return {schema_version:'1',case_id:caseId,owner_id:ownerId,revision:0,created_at:now,updated_at:now,facts:{},documents:{},upload_sessions:{},links:{},runs:{},results:{},generations:{},current_results:{},compositions:{},exports:{},jobs:{},form_previews:{},outbox:[]};
}
function unavailable(): never { throw new DomainError(404,'unavailable','The requested resource is unavailable.'); }
function without<T extends object,K extends keyof T>(value:T,keys:K[]):Omit<T,K> {const copy={...value};for(const key of keys)delete copy[key];return copy;}
function fail(code: string, message: string): never { throw new DomainError(422,code,message); }
function match(actual: number, wanted: number) { if(actual !== wanted) throw new DomainError(409,'revision_conflict','The resource changed. Reload and reconcile the proposed edit.',actual); }
function applicant(state: IntegrationCase, ctx: DomainContext) { if(ctx.role !== 'applicant' || ctx.actorId !== state.owner_id) unavailable(); }
function worker(state: IntegrationCase, ctx: DomainContext, jobId: string, runId?: string) {
  if(ctx.role !== 'worker' || ctx.workerScope?.jobId !== jobId || (runId && ctx.workerScope.runId !== runId)) unavailable();
  const job = state.jobs[jobId]; if(!job || job.state === 'canceled' || job.state === 'failed') throw new DomainError(409,job?.state==='canceled'?'job_canceled':'job_unavailable','This job is unavailable for new writes.');
}
function event(state: IntegrationCase, ctx: DomainContext, type: string, objectId: string, objectRevision: number) {
  state.outbox.push({event_id:id(),schema_version:'1',case_id:state.case_id,type,object_id:objectId,object_revision:objectRevision,occurred_at:ctx.now,correlation_id:ctx.correlationId || id(),causation_id:ctx.causationId || ctx.correlationId || id()});
}
function job(state: IntegrationCase, ctx: DomainContext, kind: Job['kind'], objectId: string): Job {
  const value: Job = {job_id:id(),kind,object_id:objectId,state:'queued',stage:kind === 'document' ? 'scanning' : 'pending',attempts:0,max_attempts:3,pipeline_version:'1',checkpoints:{},created_at:ctx.now};
  state.jobs[value.job_id] = value; return value;
}
function moduleFor(ctx: DomainContext, criterionId: CriterionId): ModuleConfig {
  const entries = ctx.modules.filter(m=>m.criterion_id === criterionId && m.active);
  if(entries.length !== 1 || !moduleConfigSchema.safeParse(entries[0]).success) fail('module_unavailable','An approved active configuration is required for this criterion.');
  return structuredClone(entries[0]);
}
function accepted(state: IntegrationCase, documentId: string) {
  const source = state.documents[documentId];
  if(!source) unavailable();
  if(source.state !== 'ready' || source.scan_result !== 'clean' || !source.extraction_run_id || !source.extraction_version) fail('source_unavailable','The selected source has not completed scanning and extraction.');
  return source;
}
export function buildManifest(state: IntegrationCase, criterionId: CriterionId, ctx: DomainContext): Manifest {
  const configuration = moduleFor(ctx,criterionId);
  const links = Object.values(state.links).filter(l=>l.criterion_id === criterionId && l.state === 'confirmed').sort((a,b)=>a.link_id.localeCompare(b.link_id));
  if(!links.length) fail('confirmed_link_required','Confirm an evidence association before dispatching this criterion.');
  const sources = links.map(link=>{const d=accepted(state,link.document_version_id);return {document_version_id:d.document_version_id,revision:d.revision,sha256:d.sha256,storage_version_id:d.storage_version_id,source_artifact_id:d.source_artifact_id,rendition_version_id:d.rendition_version_id,extraction_run_id:d.extraction_run_id!,extraction_version:d.extraction_version!,link_id:link.link_id,link_revision:link.link_revision};});
  const facts = configuration.required_fact_keys.map(key=>{
    const matches = Object.values(state.facts).filter(f=>f.key === key);
    if(matches.length !== 1 || !matches[0].current.confirmed) fail('confirmed_fact_required','Confirm all required profile facts before dispatching this criterion.');
    const f=matches[0];return {fact_id:f.fact_id,fact_revision:f.current.fact_revision,key:f.key,value:f.current.value};
  }).sort((a,b)=>a.fact_id.localeCompare(b.fact_id));
  return {canonicalization_version:'1',case_id:state.case_id,criterion_id:criterionId,configuration,sources,facts};
}
export function runIsCurrent(state: IntegrationCase, runId: string, ctx: DomainContext): boolean {
  const run=state.runs[runId]; if(!run || state.generations[run.criterion_id] !== run.run_generation) return false;
  try { return canonicalize(buildManifest(state,run.criterion_id,ctx)) === canonicalize(run.manifest); } catch { return false; }
}
export function resultIsCurrent(state: IntegrationCase, result: CriterionResult, ctx: DomainContext): boolean {
  const current=state.current_results[result.criterion_id];
  return result.publication === 'published' && current?.result_id === result.result_id && current.result_revision === result.result_revision && runIsCurrent(state,result.run_id,ctx);
}
function resultAt(state: IntegrationCase, resultId: string, resultRevision?: number): CriterionResult {
  const versions=state.results[resultId]; if(!versions) unavailable();
  const value=resultRevision === undefined ? versions.at(-1) : versions.find(r=>r.result_revision === resultRevision); if(!value) unavailable(); return value;
}
function dependencyValue(state: IntegrationCase, key: string, ctx: DomainContext): string {
  const separator=key.indexOf(':'); const kind=key.slice(0,separator), resourceId=key.slice(separator+1);
  if(kind === 'source') {const d=state.documents[resourceId];return d ? canonicalize({revision:d.revision,state:d.state,sha256:d.sha256,extraction_run_id:d.extraction_run_id,storage_version_id:d.storage_version_id,source_artifact_id:d.source_artifact_id,rendition_version_id:d.rendition_version_id}) : 'absent';}
  if(kind === 'fact') {const f=state.facts[resourceId];return f ? canonicalize(f.current) : 'absent';}
  if(kind === 'link') {const l=state.links[resourceId];return l ? canonicalize({revision:l.link_revision,state:l.state}) : 'absent';}
  if(kind === 'module') {try {return canonicalize(moduleFor(ctx,resourceId as CriterionId));} catch{return 'unavailable';}}
  if(kind === 'result') {const r=state.results[resourceId]?.at(-1);return r && resultIsCurrent(state,r,ctx) ? String(r.result_revision) : 'stale';}
  if(kind === 'template') {const t=ctx.formTemplates?.find(t=>t.template_id===resourceId&&t.active);return t ? canonicalize(t) : 'unavailable';}
  if(kind === 'case_rule') return ctx.caseRule?.approval ? canonicalize(ctx.caseRule) : 'unavailable';
  return 'absent';
}
export function compositionIsCurrent(state: IntegrationCase, composition: Composition, ctx: DomainContext): boolean {
  return Object.entries(composition.dependencies).every(([key,value])=>dependencyValue(state,key,ctx)===value);
}
function requireCurrentComposition(state: IntegrationCase, composition: Composition, ctx: DomainContext) {
  if(!compositionIsCurrent(state,composition,ctx)) throw new DomainError(409,'stale_composition','A selected input changed. Create and review a new composition.',composition.draft_revision);
}
function invalidateEvents(state: IntegrationCase, ctx: DomainContext, criteria?: Set<CriterionId>, changedDependency?: string, includeResults = true) {
  if(includeResults) for(const [criterionId,pointer] of Object.entries(state.current_results)) {
    if(criteria && !criteria.has(criterionId as CriterionId)) continue;
    if(pointer) event(state,ctx,'criterion.result.invalidated',pointer.result_id,pointer.result_revision);
  }
  for(const c of Object.values(state.compositions)) if(!criteria || c.selected_criteria.some(x=>criteria.has(x)) || (changedDependency && Object.hasOwn(c.dependencies,changedDependency))) event(state,ctx,'composition.invalidated',c.composition_id,c.draft_revision);
}
function validateCitation(state: IntegrationCase, value: Omit<Citation,'citation_id'>, allowed: Set<string>, historical = false) {
  if(!allowed.has(value.document_version_id)) fail('invalid_provenance','The candidate cites a source outside its pinned manifest.');
  const d=historical ? state.documents[value.document_version_id] : accepted(state,value.document_version_id);
  if(!d) fail('invalid_provenance','The pinned source version is unavailable.');
  if(d.source_artifact_id!==value.source_artifact_id || d.rendition_version_id!==value.rendition_version_id || d.extraction_run_id!==value.extraction_run_id) fail('invalid_provenance','The citation does not match the pinned source artifact.');
  const block=d.blocks.find(b=>b.block_id===value.locator.block_id);
  if(!block || block.quality !== 'verified' || canonicalize(block.locator)!==canonicalize(value.locator) || !block.text.includes(value.excerpt)) fail('invalid_locator','The citation must resolve to a verified extracted block and exact excerpt.');
}
function reviseClaim(claim: Claim, newText?: string, status?: Claim['support_status'], ctx?: DomainContext): Claim {
  if(newText !== undefined) return {...structuredClone(claim),claim_revision:claim.claim_revision+1,text:newText,citations:claim.citations.map(c=>({...structuredClone(c),citation_id:id()})),support_status:'needs_review',review_status:'unreviewed',reviewed_by:undefined,reviewed_at:undefined};
  return {...structuredClone(claim),support_status:status!,review_status:'applicant_reviewed',reviewed_by:ctx!.actorId,reviewed_at:ctx!.now};
}
function validateReviewedClaim(state: IntegrationCase, claim: Claim, status: Claim['support_status']) {
  if(status==='supported') {if(!claim.citations.length) fail('evidence_missing','A supported claim needs exact source citations.');for(const c of claim.citations) validateCitation(state,c,new Set(claim.citations.map(x=>x.document_version_id)));}
}
function previewIsCurrent(state: IntegrationCase, previewId: string, ctx: DomainContext) {
  const preview=state.form_previews[previewId]; if(!preview) unavailable();
  const template=ctx.formTemplates?.find(t=>t.template_id===preview.template_id&&t.active&&t.approval);
  return Boolean(template && template.version===preview.template_version && template.sha256===preview.template_sha256 && preview.ready && preview.fields.every(field=>!field.fact_id || (state.facts[field.fact_id]?.current.fact_revision===field.fact_revision&&state.facts[field.fact_id].current.confirmed)));
}

/** Call on a transaction-local clone. Persist state and its outbox together after success. */
export async function executeCommand(state: IntegrationCase, operation: string, input: unknown, ctx: DomainContext): Promise<unknown> {
  if(!Object.hasOwn(schemas,operation)) unavailable();
  const schema=schemas[operation as DomainOperation];
  const parsed=schema.safeParse(input); if(!parsed.success) {const e=new DomainError(422,'invalid_fields','The request contains invalid fields.');e.fieldErrors=Object.fromEntries(parsed.error.issues.map(issue=>[issue.path.join('.')||'body',['Invalid value.']]));throw e;}
  // Narrowing each branch below preserves its individual strict contract.
  const data=parsed.data;
  if(!['document.complete','run.publish','export.complete'].includes(operation)) applicant(state,ctx);
  if(operation === 'fact.create') {
    const v=schemas['fact.create'].parse(data);if(Object.values(state.facts).some(f=>f.key===v.key)) fail('duplicate_fact','A fact already exists for this key. Update its exact revision.');
    const fact={fact_id:id(),key:v.key,origin:'applicant_statement' as const,current:{fact_revision:1,value:v.value,confirmed:v.confirmed,actor_id:ctx.actorId,occurred_at:ctx.now},history:[]};state.facts[fact.fact_id]=fact;event(state,ctx,'fact.changed',fact.fact_id,1);invalidateEvents(state,ctx,new Set(ctx.modules.filter(m=>m.required_fact_keys.includes(fact.key)).map(m=>m.criterion_id)),`fact:${fact.fact_id}`);return fact;
  }
  if(operation === 'fact.update') {
    const v=schemas['fact.update'].parse(data), f=state.facts[v.fact_id];if(!f) unavailable();match(f.current.fact_revision,v.expected_revision);
    f.history.push(structuredClone(f.current));f.current={fact_revision:f.current.fact_revision+1,value:v.value,confirmed:v.confirmed,actor_id:ctx.actorId,occurred_at:ctx.now};event(state,ctx,'fact.changed',f.fact_id,f.current.fact_revision);invalidateEvents(state,ctx,new Set(ctx.modules.filter(m=>m.required_fact_keys.includes(f.key)).map(m=>m.criterion_id)),`fact:${f.fact_id}`);return f;
  }
  if(operation === 'upload.create') {
    const v=schemas['upload.create'].parse(data), uploadId=id();
    const value={...v,upload_id:uploadId,document_id:id(),document_version_id:id(),storage_key:`quarantine/${id()}`,expires_at:new Date(Date.parse(ctx.now)+15*60*1000).toISOString(),state:'pending' as const};state.upload_sessions[uploadId]=value;event(state,ctx,'upload.created',uploadId,1);return value;
  }
  if(operation === 'upload.renew') {
    const v=schemas['upload.renew'].parse(data), u=state.upload_sessions[v.upload_id];if(!u) unavailable();if(u.state!=='pending') fail('upload_closed','This upload session is already closed.');u.expires_at=new Date(Date.parse(ctx.now)+15*60*1000).toISOString();return u;
  }
  if(operation === 'upload.confirm') {
    const v=schemas['upload.confirm'].parse(data), u=state.upload_sessions[v.upload_id];if(!u) unavailable();
    if(u.state==='confirmed') return {document:state.documents[u.document_version_id],job_id:u.job_id};
    if(u.state!=='pending' || Date.parse(u.expires_at)<=Date.parse(ctx.now)) fail('upload_expired','Renew the upload session before confirmation.');
    if(u.sha256!==v.sha256 || u.bytes!==v.bytes || u.media_type!==v.media_type) fail('upload_mismatch','Stored content does not match the declared checksum, size, and type.');
    const document={document_id:u.document_id,document_version_id:u.document_version_id,case_id:state.case_id,revision:1,title:u.title,storage_key:u.storage_key,storage_version_id:v.storage_version_id,sha256:v.sha256,media_type:v.media_type,bytes:v.bytes,state:'quarantined' as const,scan_result:'pending' as const,source_artifact_id:id(),page_count:0,blocks:[],created_at:ctx.now};
    state.documents[document.document_version_id]=document;const processing=job(state,ctx,'document',document.document_version_id);u.state='confirmed';u.job_id=processing.job_id;event(state,ctx,'document.processing.requested',document.document_version_id,1);return {document,job_id:processing.job_id};
  }
  if(operation === 'document.complete') {
    const v=schemas['document.complete'].parse(data), d=state.documents[v.document_version_id];if(!d) unavailable();worker(state,ctx,v.job_id);const processing=state.jobs[v.job_id];if(processing.object_id!==d.document_version_id || processing.kind!=='document') unavailable();
    if(processing.state==='succeeded') return d;
    if(d.state==='removed') throw new DomainError(409,'source_unavailable','The source was removed while processing.');
    if(v.scan_result!=='clean') {d.state='rejected';d.scan_result=v.scan_result;d.revision++;processing.state='failed';processing.stage='scanning';processing.error={code:'scan_rejected',message:'The file did not pass safety scanning.',retryable:false};event(state,ctx,'document.rejected',d.document_version_id,d.revision);return d;}
    if(!v.extraction) fail('extraction_required','A clean scan alone cannot make a document available.');
    const extraction=v.extraction, seen=new Set<string>();
    if(d.media_type!=='application/pdf'&&(!extraction.rendition_version_id||!extraction.rendition_storage_key||!extraction.rendition_storage_version_id||!extraction.rendition_sha256)) fail('rendition_required','This format requires a pinned paged rendition and exact stored bytes.');
    for(const block of extraction.blocks) {if(seen.has(block.block_id)||block.locator.block_id!==block.block_id||block.locator.page_index>extraction.page_count||(block.locator.bbox&&(block.locator.bbox[0]>=block.locator.bbox[2]||block.locator.bbox[1]>=block.locator.bbox[3]))) fail('invalid_extraction','The extraction contains duplicate or invalid source locations.');seen.add(block.block_id);}
    Object.assign(d,extraction,{state:'ready',scan_result:'clean',revision:d.revision+1});processing.state='succeeded';processing.stage='indexed';processing.checkpoints.scanning='clean';processing.checkpoints.extraction=extraction.extraction_run_id;event(state,ctx,'document.ready',d.document_version_id,d.revision);return d;
  }
  if(operation === 'document.remove') {
    const v=schemas['document.remove'].parse(data), d=state.documents[v.document_version_id];if(!d) unavailable();match(d.revision,v.expected_revision);d.state='removed';d.revision++;
    const impacted=new Set(Object.values(state.links).filter(l=>l.document_version_id===d.document_version_id).map(l=>l.criterion_id));invalidateEvents(state,ctx,impacted,`source:${d.document_version_id}`);event(state,ctx,'document.removed',d.document_version_id,d.revision);return d;
  }
  if(operation === 'link.create') {
    const v=schemas['link.create'].parse(data);moduleFor(ctx,v.criterion_id);if(!state.documents[v.document_version_id]) unavailable();
    const duplicate=Object.values(state.links).find(l=>l.document_version_id===v.document_version_id&&l.criterion_id===v.criterion_id);if(duplicate) return duplicate;
    const link:EvidenceLink={...v,link_id:id(),case_id:state.case_id,link_revision:1,state:'proposed',actor_id:ctx.actorId,updated_at:ctx.now};state.links[link.link_id]=link;event(state,ctx,'criterion.evidence_link.changed',link.link_id,1);return link;
  }
  if(operation === 'link.update') {
    const v=schemas['link.update'].parse(data), link=state.links[v.link_id];if(!link) unavailable();match(link.link_revision,v.expected_revision);
    if(v.state==='confirmed'&&state.documents[link.document_version_id]?.state==='removed') fail('source_unavailable','Removed evidence cannot be associated.');
    if(link.state!==v.state) {link.state=v.state;link.link_revision++;link.actor_id=ctx.actorId;link.updated_at=ctx.now;invalidateEvents(state,ctx,new Set([link.criterion_id]));event(state,ctx,'criterion.evidence_link.changed',link.link_id,link.link_revision);}return link;
  }
  if(operation === 'run.create') {
    const v=schemas['run.create'].parse(data), manifest=buildManifest(state,v.criterion_id,ctx), hash=await digest(manifest);
    const existing=Object.values(state.runs).find(r=>r.criterion_id===v.criterion_id&&r.input_manifest_hash===hash&&r.run_generation===state.generations[v.criterion_id]&&state.jobs[r.job_id]?.state!=='canceled');if(existing) return existing;
    const runId=id(), generation=(state.generations[v.criterion_id]||0)+1, processing=job(state,ctx,'criterion',runId);
    if(state.current_results[v.criterion_id]) invalidateEvents(state,ctx,new Set([v.criterion_id]));
    const run={run_id:runId,criterion_id:v.criterion_id,run_generation:generation,input_manifest_hash:hash,manifest,job_id:processing.job_id,created_at:ctx.now,disposition:'pending' as const};state.generations[v.criterion_id]=generation;state.runs[runId]=run;event(state,ctx,'criterion.run.requested',runId,generation);return run;
  }
  if(operation === 'run.publish') {
    const v=schemas['run.publish'].parse(data), run=state.runs[v.run_id];if(!run) unavailable();worker(state,ctx,run.job_id,run.run_id);
    if(run.result_id) return resultAt(state,run.result_id,1);
    const allowed=new Set(run.manifest.sources.map(s=>s.document_version_id)), current=runIsCurrent(state,run.run_id,ctx);
    for(const claim of v.candidate.claims) for(const citation of claim.citations) validateCitation(state,citation,allowed,!current);
    for(const element of v.candidate.element_assessments) if(element.authority_refs.some(a=>!run.manifest.configuration.authority_refs.includes(a))) fail('invalid_authority','The result references authority outside the approved rule pack.');
    if(new Set(v.candidate.element_assessments.map(e=>e.element_id)).size!==v.candidate.element_assessments.length || new Set(v.candidate.missing_evidence_tasks.map(t=>t.task_id)).size!==v.candidate.missing_evidence_tasks.length) fail('invalid_result','Assessment and task identifiers must be unique within a result.');
    if(canonicalize(v.candidate.element_assessments.map(e=>e.element_id).sort())!==canonicalize([...run.manifest.configuration.required_element_ids].sort()))fail('incomplete_assessment','The result must assess every approved rule element exactly once.');
    for(const contradiction of v.candidate.contradictions) if(contradiction.document_version_ids.some(d=>!allowed.has(d))) fail('invalid_provenance','A contradiction references a source outside the run.');
    const resultId=id();
    const claims:Claim[]=v.candidate.claims.map(c=>({claim_id:id(),claim_revision:1,paragraph_id:id(),text:c.text,event_id:c.event_id,citations:c.citations.map(citation=>({...structuredClone(citation),citation_id:id()})),support_status:'needs_review',review_status:'unreviewed'}));
    const result:CriterionResult={result_id:resultId,result_revision:1,run_id:run.run_id,criterion_id:run.criterion_id,input_manifest_hash:run.input_manifest_hash,section_draft_id:id(),section_revision:1,section_title:v.candidate.section_title,claims,element_assessments:v.candidate.element_assessments,missing_evidence_tasks:v.candidate.missing_evidence_tasks,contradictions:v.candidate.contradictions,publication:current?'published':'superseded',created_at:ctx.now};
    state.results[resultId]=[result];run.result_id=resultId;run.disposition=current?'published':'superseded';state.jobs[run.job_id].state='succeeded';state.jobs[run.job_id].stage=current?'published':'superseded';
    if(current) {state.current_results[run.criterion_id]={result_id:resultId,result_revision:1};event(state,ctx,'criterion.result.published',resultId,1);}return result;
  }
  if(operation === 'result.edit' || operation === 'result.review') {
    const v=operation==='result.edit'?schemas['result.edit'].parse(data):schemas['result.review'].parse(data), previous=resultAt(state,v.result_id);match(previous.result_revision,v.expected_revision);
    if(!resultIsCurrent(state,previous,ctx)) throw new DomainError(409,'stale_result','The result is no longer current. Run this criterion again.');
    const selected=previous.claims.find(c=>c.claim_id===v.claim_id);if(!selected) unavailable();
    if('support_status' in v) validateReviewedClaim(state,selected,v.support_status);
    const updated=structuredClone(previous);updated.result_revision++;updated.section_revision++;updated.created_at=ctx.now;updated.claims=previous.claims.map(c=>c.claim_id===v.claim_id?reviseClaim(c,'text' in v?v.text:undefined,'support_status' in v?v.support_status:undefined,ctx):structuredClone(c));
    event(state,ctx,'criterion.result.invalidated',previous.result_id,previous.result_revision);state.results[v.result_id].push(updated);state.current_results[updated.criterion_id]={result_id:updated.result_id,result_revision:updated.result_revision};invalidateEvents(state,ctx,new Set([updated.criterion_id]),undefined,false);event(state,ctx,'criterion.result.published',updated.result_id,updated.result_revision);return updated;
  }
  if(operation === 'composition.create') {
    const v=schemas['composition.create'].parse(data);
    if(new Set(v.selected_criteria).size!==v.selected_criteria.length||new Set(v.selected_results.map(r=>r.criterion_id)).size!==v.selected_results.length) fail('duplicate_selection','Select each criterion once.');
    const dependencies:Record<string,string>={}, claims:Claim[]=[], claimOrigins:Composition['claim_origins']={}, claimKeys=new Map<string,Claim>(),issues:Composition['issues']=[],bundles:Composition['selected_result_bundles']=[];
    const depend=(key:string)=>{dependencies[key]=dependencyValue(state,key,ctx);};
    for(const selected of v.selected_results) {
      if(!v.selected_criteria.includes(selected.criterion_id)) fail('invalid_selection','A result must belong to a selected criterion.');
      const result=resultAt(state,selected.result_id,selected.result_revision);if(result.criterion_id!==selected.criterion_id||!resultIsCurrent(state,result,ctx)) throw new DomainError(409,'stale_composition','Select exact current result revisions.');
      const identity={result_id:result.result_id,result_revision:result.result_revision,criterion_id:result.criterion_id};
      bundles.push({...identity,element_assessments:structuredClone(result.element_assessments),missing_evidence_tasks:structuredClone(result.missing_evidence_tasks),contradictions:structuredClone(result.contradictions)});
      for(const task of result.missing_evidence_tasks)issues.push({...identity,issue_id:id(),kind:'missing_evidence',description:task.description,task_id:task.task_id,document_version_ids:[],issue_revision:1,history:[]});
      for(const contradiction of result.contradictions)issues.push({...identity,issue_id:id(),kind:'contradiction',description:contradiction.description,document_version_ids:[...contradiction.document_version_ids],issue_revision:1,history:[]});
      depend(`result:${result.result_id}`);depend(`module:${result.criterion_id}`);
      const run=state.runs[result.run_id];for(const source of run.manifest.sources){depend(`source:${source.document_version_id}`);depend(`link:${source.link_id}`);}for(const fact of run.manifest.facts) depend(`fact:${fact.fact_id}`);
      for(const claim of result.claims) {
        const key=canonicalize({text:claim.text,citations:claim.citations.map(citation=>without(citation,['citation_id']))}), duplicate=claimKeys.get(key);
        const origin={result_id:result.result_id,result_revision:result.result_revision,claim_id:claim.claim_id};
        if(duplicate){claimOrigins[duplicate.claim_id].push(origin);if(duplicate.support_status!==claim.support_status||duplicate.review_status!==claim.review_status){duplicate.support_status='needs_review';duplicate.review_status='unreviewed';duplicate.reviewed_by=undefined;duplicate.reviewed_at=undefined;}}
        else {const copy=structuredClone(claim);claims.push(copy);claimKeys.set(key,copy);claimOrigins[copy.claim_id]=[origin];}
      }
    }
    for(const sourceId of v.case_wide_document_ids){accepted(state,sourceId);depend(`source:${sourceId}`);}
    for(const factId of v.case_wide_fact_ids){const fact=state.facts[factId];if(!fact) unavailable();if(!fact.current.confirmed)fail('confirmed_fact_required','Case-wide facts must be confirmed.');depend(`fact:${factId}`);}
    const unresolved=v.selected_criteria.filter(c=>!v.selected_results.some(s=>s.criterion_id===c));
    const snapshot=await digest({...v,dependencies}), existing=Object.values(state.compositions).find(c=>c.snapshot_digest===snapshot&&c.draft_revision===1);if(existing) return existing;
    const compositionId=id(), processing=job(state,ctx,'composition',compositionId);processing.state='succeeded';processing.stage='assembled';
    // Shared passages and repeated model event IDs are review signals, not proof that events are identical.
    const groups:Claim[][]=[];
    for(const claim of claims){const passages=new Set(claim.citations.map(c=>canonicalize([c.document_version_id,c.source_artifact_id,c.extraction_run_id,c.locator.block_id])));const matching=groups.filter(group=>group.some(other=>other.event_id===claim.event_id||other.citations.some(c=>passages.has(canonicalize([c.document_version_id,c.source_artifact_id,c.extraction_run_id,c.locator.block_id])))));if(!matching.length)groups.push([claim]);else {const merged=[claim,...matching.flat()];for(const group of matching)groups.splice(groups.indexOf(group),1);groups.push(merged);}}
    const eventConflicts=groups.filter(group=>group.length>1).map(group=>({group_id:id(),claim_ids:group.map(c=>c.claim_id)}));
    const composition:Composition={composition_id:compositionId,draft_id:id(),draft_revision:1,selected_criteria:v.selected_criteria,selected_results:v.selected_results,unresolved_criteria:unresolved,case_wide_document_ids:v.case_wide_document_ids,case_wide_fact_ids:v.case_wide_fact_ids,dependencies,snapshot_digest:snapshot,claims,claim_origins:claimOrigins,event_conflicts:eventConflicts,issues,selected_result_bundles:bundles,history:[],job_id:processing.job_id,created_at:ctx.now};
    state.compositions[compositionId]=composition;event(state,ctx,'composition.created',compositionId,1);return composition;
  }
  if(operation === 'composition.analysis') {
    const v=schemas['composition.analysis'].parse(data), composition=state.compositions[v.composition_id];if(!composition)unavailable();match(composition.draft_revision,v.expected_revision);requireCurrentComposition(state,composition,ctx);
    const rule=ctx.caseRule;if(!rule?.approval||!rule.version||!rule.authority_refs.length)fail('case_rule_unavailable','An approved case-wide rule configuration is required.');
    const required=['overall_record','continued_work','prospective_benefit',...(v.route==='major_award'?['major_award']:[])];
    if(new Set(v.sections.map(s=>s.kind)).size!==v.sections.length||required.length!==v.sections.length||required.some(kind=>!v.sections.some(s=>s.kind===kind)))fail('case_analysis_incomplete','Supply each required case-level analysis section exactly once.');
    if(v.route==='criteria'&&!composition.selected_criteria.length)fail('case_analysis_incomplete','Select criterion sections for the criteria route.');
    const allowed=new Set(composition.case_wide_document_ids), newClaims:Claim[]=[];
    for(const section of v.sections){if(section.authority_refs.some(a=>!rule.authority_refs.includes(a)))fail('invalid_authority','Case-wide analysis must use the approved case rule references.');for(const claim of section.claims)for(const citation of claim.citations)validateCitation(state,citation,allowed);}
    const sections=v.sections.map(section=>{
      const claims=section.claims.map(c=>({claim_id:id(),claim_revision:1,paragraph_id:id(),text:c.text,event_id:c.event_id,citations:c.citations.map(citation=>({...structuredClone(citation),citation_id:id()})),support_status:'needs_review' as const,review_status:'unreviewed' as const}));newClaims.push(...claims);return {kind:section.kind,authority_refs:section.authority_refs,claim_ids:claims.map(c=>c.claim_id)};
    });
    composition.history.push({draft_revision:composition.draft_revision,claims:structuredClone(composition.claims)});composition.draft_revision++;
    const oldIds=new Set(composition.case_analysis?.sections.flatMap(s=>s.claim_ids)||[]);composition.claims=[...composition.claims.filter(c=>!oldIds.has(c.claim_id)),...newClaims];composition.case_analysis={route:v.route,rule_version:rule.version,sections};composition.dependencies['case_rule:current']=dependencyValue(state,'case_rule:current',ctx);event(state,ctx,'composition.changed',composition.composition_id,composition.draft_revision);return composition;
  }
  if(operation === 'composition.events') {
    const v=schemas['composition.events'].parse(data), composition=state.compositions[v.composition_id];if(!composition)unavailable();match(composition.draft_revision,v.expected_revision);requireCurrentComposition(state,composition,ctx);
    const group=composition.event_conflicts.find(g=>g.group_id===v.group_id);if(!group)unavailable();
    composition.history.push({draft_revision:composition.draft_revision,claims:structuredClone(composition.claims)});composition.draft_revision++;
    const sharedId=id();composition.claims=composition.claims.map(claim=>group.claim_ids.includes(claim.claim_id)?{...reviseClaim(claim,claim.text),event_id:v.decision==='same_event'?sharedId:id()}:claim);
    Object.assign(group,{decision:v.decision,reason:v.reason,actor_id:ctx.actorId,reviewed_at:ctx.now});event(state,ctx,'composition.changed',composition.composition_id,composition.draft_revision);return composition;
  }
  if(operation === 'composition.issues') {
    const v=schemas['composition.issues'].parse(data), composition=state.compositions[v.composition_id];if(!composition)unavailable();match(composition.draft_revision,v.expected_revision);requireCurrentComposition(state,composition,ctx);
    const issue=composition.issues.find(issue=>issue.issue_id===v.issue_id);if(!issue)unavailable();
    composition.history.push({draft_revision:composition.draft_revision,claims:structuredClone(composition.claims)});const reviewedRevision=composition.draft_revision;composition.draft_revision++;
    if(issue.disposition)issue.history.push(structuredClone(issue.disposition));issue.issue_revision++;
    issue.disposition={decision:v.disposition,reason:v.reason,actor_id:ctx.actorId,occurred_at:ctx.now,issue_revision:issue.issue_revision,reviewed_draft_revision:reviewedRevision};event(state,ctx,'composition.changed',composition.composition_id,composition.draft_revision);return composition;
  }
  if(operation === 'paragraph.edit' || operation === 'paragraph.review') {
    const v=operation==='paragraph.edit'?schemas['paragraph.edit'].parse(data):schemas['paragraph.review'].parse(data), composition=Object.values(state.compositions).find(c=>c.draft_id===v.draft_id);if(!composition) unavailable();match(composition.draft_revision,v.expected_revision);requireCurrentComposition(state,composition,ctx);
    const claim=composition.claims.find(c=>c.paragraph_id===v.paragraph_id);if(!claim) unavailable();if('support_status' in v)validateReviewedClaim(state,claim,v.support_status);
    composition.history.push({draft_revision:composition.draft_revision,claims:structuredClone(composition.claims)});composition.draft_revision++;composition.claims=composition.claims.map(c=>c.paragraph_id===v.paragraph_id?reviseClaim(c,'text' in v?v.text:undefined,'support_status' in v?v.support_status:undefined,ctx):c);
    if('text' in v) for(const group of composition.event_conflicts) if(group.claim_ids.includes(claim.claim_id)) {group.decision=undefined;group.reason=undefined;group.actor_id=undefined;group.reviewed_at=undefined;}
    event(state,ctx,'composition.changed',composition.composition_id,composition.draft_revision);return composition;
  }
  if(operation === 'form.preview') {
    const v=schemas['form.preview'].parse(data), template=ctx.formTemplates?.find(t=>t.template_id===v.template_id&&t.active&&t.approval);
    if(!template) fail('template_unavailable','A reviewed current official template is required.');
    const fields=template.fields.map(field=>{
      const fact=Object.values(state.facts).find(f=>f.key===field.fact_key), value=fact?.current.confirmed?fact.current.value:null, errors:string[]=[];
      if(field.required&&!value)errors.push('required');if(value&&value.length>field.max_length)errors.push('overflow');
      if(value&&field.format==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))errors.push('invalid_date');
      return {field_id:field.field_id,value,fact_id:fact?.fact_id,fact_revision:fact?.current.fact_revision,errors};
    });
    const preview={preview_id:id(),template_id:template.template_id,template_version:template.version,template_sha256:template.sha256,fields,ready:fields.every(f=>!f.errors.length)};state.form_previews[preview.preview_id]=preview;return preview;
  }
  if(operation === 'export.create') {
    const v=schemas['export.create'].parse(data), composition=state.compositions[v.composition_id];if(!composition) unavailable();match(composition.draft_revision,v.draft_revision);requireCurrentComposition(state,composition,ctx);
    if(!composition.case_analysis||!ctx.caseRule?.approval)fail('case_analysis_required','Complete and review the case-wide analysis before rendering a final packet candidate.');
    if(composition.event_conflicts.some(group=>!group.decision))fail('event_reconciliation_required','Review potentially repeated evidence events before rendering the packet.');
    if(composition.issues.some(issue=>!issue.disposition))fail('issue_review_required','Review every missing-evidence task and contradiction before rendering the packet.');
    if(composition.unresolved_criteria.length||!composition.claims.length||composition.claims.some(c=>c.support_status!=='supported'||c.review_status==='unreviewed'))fail('review_required','Resolve every selected criterion and review all material claims before rendering a final packet candidate.');
    for(const claim of composition.claims)validateReviewedClaim(state,claim,'supported');
    for(const previewId of v.form_preview_ids) if(!previewIsCurrent(state,previewId,ctx))fail('template_unavailable','Refresh and resolve the selected form preview before exporting.');
    const dependencies={...composition.dependencies};for(const previewId of v.form_preview_ids){const p=state.form_previews[previewId];dependencies[`template:${p.template_id}`]=dependencyValue(state,`template:${p.template_id}`,ctx);for(const field of p.fields)if(field.fact_id)dependencies[`fact:${field.fact_id}`]=dependencyValue(state,`fact:${field.fact_id}`,ctx);}
    const sections=composition.selected_results.map(selected=>({ ...selected,title:resultAt(state,selected.result_id,selected.result_revision).section_title,claim_ids:Object.entries(composition.claim_origins).filter(([,origins])=>origins.some(origin=>origin.result_id===selected.result_id&&origin.result_revision===selected.result_revision)).map(([claimId])=>claimId) }));
    const snapshot={claims:structuredClone(composition.claims),dependencies,form_previews:v.form_preview_ids.map(p=>structuredClone(state.form_previews[p])),case_analysis:structuredClone(composition.case_analysis),claim_origins:structuredClone(composition.claim_origins),event_decisions:structuredClone(composition.event_conflicts),issues:structuredClone(composition.issues),selected_result_bundles:structuredClone(composition.selected_result_bundles),sections}, snapshotDigest=await digest({composition_id:composition.composition_id,draft_revision:composition.draft_revision,selected_results:composition.selected_results,snapshot});
    const existing=Object.values(state.exports).find(e=>e.snapshot_digest===snapshotDigest);if(existing)return existing;
    const exportId=id(), processing=job(state,ctx,'export',exportId), packet:PacketExport={export_id:exportId,composition_id:composition.composition_id,draft_revision:composition.draft_revision,selected_results:structuredClone(composition.selected_results),snapshot_digest:snapshotDigest,snapshot,state:'queued',job_id:processing.job_id,created_at:ctx.now};state.exports[exportId]=packet;event(state,ctx,'export.requested',exportId,composition.draft_revision);return packet;
  }
  if(operation === 'export.complete') {
    const v=schemas['export.complete'].parse(data), packet=state.exports[v.export_id];if(!packet) unavailable();worker(state,ctx,packet.job_id);if(packet.state!=='queued') return packet;
    const targets=packet.snapshot.claims.flatMap(claim=>claim.citations.map(citation=>({claim,citation}))), seen=new Set<string>(), labels=new Map<string,string>(), documents=new Map<string,string>();
    if(v.reference_entries.length!==targets.length)fail('reference_reconciliation_failed','Every material citation must appear exactly once in the final reference manifest.');
    for(const reference of v.reference_entries) {
      const target=targets.find(t=>t.claim.claim_id===reference.claim_id&&t.claim.claim_revision===reference.claim_revision&&t.citation.citation_id===reference.citation_id&&t.citation.document_version_id===reference.document_version_id);
      if(!target||seen.has(reference.citation_id))fail('reference_reconciliation_failed','The reference manifest contains an unknown or duplicate target.');seen.add(reference.citation_id);
      if(reference.exhibit_pages.length!==1||reference.exhibit_pages[0]!==target.citation.locator.page_index||reference.packet_pages.length!==1||reference.packet_pages[0]>v.page_count)fail('reference_reconciliation_failed','The rendered reference does not identify its exact source page.');
      if((labels.has(reference.exhibit_label)&&labels.get(reference.exhibit_label)!==reference.document_version_id)||(documents.has(reference.document_version_id)&&documents.get(reference.document_version_id)!==reference.exhibit_label))fail('reference_reconciliation_failed','Exhibit labels must uniquely identify a source version.');
      labels.set(reference.exhibit_label,reference.document_version_id);documents.set(reference.document_version_id,reference.exhibit_label);
      if(reference.display_text!==`See Exhibit ${reference.exhibit_label}, p. ${reference.exhibit_pages[0]}.`)fail('reference_reconciliation_failed','Each reference needs its readable exhibit and page label.');
    }
    Object.assign(packet,{packet_digest:v.packet_digest,storage_key:v.storage_key,storage_version_id:v.storage_version_id,bytes:v.bytes,page_count:v.page_count,reference_entries:v.reference_entries,reference_validation:'passed',state:'preview_ready'});state.jobs[packet.job_id].state='succeeded';state.jobs[packet.job_id].stage='preview_ready';event(state,ctx,'export.preview_ready',packet.export_id,packet.draft_revision);return packet;
  }
  if(operation === 'export.confirm') {
    const v=schemas['export.confirm'].parse(data), packet=state.exports[v.export_id];if(!packet) unavailable();const composition=state.compositions[packet.composition_id];if(!composition) unavailable();
    if(packet.state==='queued'||packet.packet_digest!==v.packet_digest||packet.draft_revision!==v.draft_revision||composition.draft_revision!==v.draft_revision)throw new DomainError(409,'packet_mismatch','Review the exact current packet bytes and draft revision before confirming.');
    requireCurrentComposition(state,composition,ctx);
    if(Object.entries(packet.snapshot.dependencies).some(([key,value])=>dependencyValue(state,key,ctx)!==value))throw new DomainError(409,'stale_composition','A packet dependency changed after preview. Create and inspect a new packet.');
    packet.state='final_approved';packet.approved_by=ctx.actorId;packet.approved_at=ctx.now;event(state,ctx,'export.confirmed',packet.export_id,packet.draft_revision);return packet;
  }
  if(operation === 'job.cancel') {
    const v=schemas['job.cancel'].parse(data), processing=state.jobs[v.job_id];if(!processing)unavailable();if(processing.state==='succeeded')throw new DomainError(409,'job_completed','This job has already completed.');processing.state='canceled';processing.lease_token=undefined;processing.lease_expires_at=undefined;event(state,ctx,'job.canceled',processing.job_id,1);return processing;
  }
  if(operation === 'job.retry') {
    const v=schemas['job.retry'].parse(data), processing=state.jobs[v.job_id];if(!processing)unavailable();
    const configurationRecovery=['provider_not_configured','storage_unavailable'].includes(processing.error?.code||'');
    const uncertainModel=processing.checkpoints.model_intent&&!processing.checkpoints.model_output_key&&!processing.checkpoints.model_output_intent;
    if(processing.state!=='failed'||(!processing.error?.retryable&&!configurationRecovery)||processing.attempts>=processing.max_attempts||processing.error?.code==='model_attempt_uncertain'||uncertainModel)fail('retry_unavailable','This version-pinned job cannot be retried.');
    (processing.retry_history??=[]).push({reason:v.reason,actor_id:ctx.actorId,occurred_at:ctx.now});processing.state='queued';processing.error=undefined;processing.next_attempt_at=ctx.now;event(state,ctx,'job.retry_requested',processing.job_id,processing.attempts);return processing;
  }
  unavailable();
}

export function getRunSources(state: IntegrationCase, runId: string, ctx: DomainContext) {
  const run=state.runs[runId];if(!run)unavailable();worker(state,ctx,run.job_id,runId);
  if(!runIsCurrent(state,runId,ctx))throw new DomainError(409,'stale_run','The run inputs changed.');
  return run.manifest.sources.map(s=>structuredClone(accepted(state,s.document_version_id)));
}
export function readResource(state: IntegrationCase, resource: string, resourceId?: string, query: Record<string,string> = {}, ctx?: DomainContext): unknown {
  if(!ctx)throw new DomainError(401,'authentication_required','Authentication is required.');applicant(state,ctx);
  if(resource==='case')return {schema_version:state.schema_version,case_id:state.case_id,revision:state.revision,created_at:state.created_at,updated_at:state.updated_at,current_results:Object.fromEntries(Object.entries(state.current_results).map(([criterionId,pointer])=>[criterionId,{...pointer,current:pointer?resultIsCurrent(state,resultAt(state,pointer.result_id,pointer.result_revision),ctx):false}])),facts:Object.values(state.facts),criteria:Object.keys(state.generations),counts:{documents:Object.keys(state.documents).length,jobs:Object.keys(state.jobs).length}};
  if(resource==='jobs') {const value=state.jobs[resourceId||''];if(!value)unavailable();return without(value,['lease_token']);}
  if(resource==='criterion-runs') {const value=state.runs[resourceId||''];if(!value)unavailable();return {...value,current:runIsCurrent(state,value.run_id,ctx)};}
  if(resource==='criterion-results') {const number=Number(query.result_revision);if(!Number.isInteger(number)||number<1)fail('result_revision_required','Specify the exact result_revision to read.');const value=resultAt(state,resourceId||'',number);return {...value,current:resultIsCurrent(state,value,ctx)};}
  if(resource==='compositions') {const value=state.compositions[resourceId||''];if(!value)unavailable();return {...value,current:compositionIsCurrent(state,value,ctx),private_tasks:[...value.unresolved_criteria.map(criterionId=>({criterion_id:criterionId,code:'criterion_result_required'})),...(!value.case_analysis?[{code:'case_analysis_required'}]:[]),...value.event_conflicts.filter(group=>!group.decision).map(group=>({code:'event_reconciliation_required',group_id:group.group_id,claim_ids:group.claim_ids})),...value.issues.filter(issue=>!issue.disposition).map(issue=>({code:'issue_review_required',issue_id:issue.issue_id,kind:issue.kind,result_id:issue.result_id,result_revision:issue.result_revision,description:issue.description}))]};}
  if(resource==='exports') {const value=state.exports[resourceId||''];if(!value)unavailable();return {...without(value,['storage_key']),current:compositionIsCurrent(state,state.compositions[value.composition_id],ctx)&&state.compositions[value.composition_id].draft_revision===value.draft_revision};}
  if(resource==='citations') {
    const candidates: {claim:Claim;context:Record<string,unknown>}[]=[];
    if(query.composition_id) {const c=state.compositions[query.composition_id];if(!c)unavailable();const draftRevision=Number(query.draft_revision);if(!Number.isInteger(draftRevision)||draftRevision<1)fail('draft_revision_required','Specify the exact draft_revision for this citation.');const claims=draftRevision===c.draft_revision?c.claims:c.history.find(h=>h.draft_revision===draftRevision)?.claims;if(!claims)unavailable();candidates.push(...claims.map(claim=>({claim,context:{composition_id:c.composition_id,draft_revision:draftRevision,context_current:draftRevision===c.draft_revision&&compositionIsCurrent(state,c,ctx)}})));}
    else if(query.result_id) {const resultRevision=Number(query.result_revision);if(!Number.isInteger(resultRevision)||resultRevision<1)fail('result_revision_required','Specify the exact result_revision for this citation.');const r=resultAt(state,query.result_id,resultRevision);candidates.push(...r.claims.map(claim=>({claim,context:{result_id:r.result_id,result_revision:r.result_revision,criterion_id:r.criterion_id,context_current:resultIsCurrent(state,r,ctx)}})));}
    else fail('citation_context_required','Specify the result and its revision, or composition and draft revision.');
    const target=candidates.find(x=>x.claim.citations.some(c=>c.citation_id===resourceId));if(!target)unavailable();const citation=target.claim.citations.find(c=>c.citation_id===resourceId)!;const document=accepted(state,citation.document_version_id);validateCitation(state,citation,new Set([citation.document_version_id]));return {...citation,...target.context,claim_id:target.claim.claim_id,claim_revision:target.claim.claim_revision,claim_text:target.claim.text,source_title:document.title,support_status:target.claim.support_status,review_status:target.claim.review_status,viewer_path:`/v1/cases/${state.case_id}/documents/${document.document_version_id}/view`};
  }
  const lists:Record<string,unknown[]>={documents:Object.values(state.documents).map(d=>without(d,['storage_key','rendition_storage_key','raw_extraction_storage_key'])),'criterion-links':Object.values(state.links),facts:Object.values(state.facts)};
  if(lists[resource]) {const offset=Number(query.offset||0), limit=Number(query.limit||25);if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)fail('invalid_pagination','Use a nonnegative offset and a limit from 1 to 100.');return {items:lists[resource].slice(offset,offset+limit),next_offset:offset+limit<lists[resource].length?offset+limit:null};}
  unavailable();
}
