import test from 'node:test';
import assert from 'node:assert/strict';
import {createIntegrationCase,executeCommand,readResource,runIsCurrent,resultIsCurrent,compositionIsCurrent,getRunSources,digest,DomainError} from '../lib/integrations/domain.ts';
import type {Composition,CriterionResult,CriterionRun,DocumentVersion,DomainContext,EvidenceLink,Fact,IntegrationCase,ModuleConfig,PacketExport,ResultCandidate,UploadSession} from '../lib/integrations/contracts';

const now='2026-11-22T15:00:00.000Z', hash='a'.repeat(64);
const modules:ModuleConfig[]=['C04','C05','C08'].map(criterion_id=>({criterion_id:criterion_id as ModuleConfig['criterion_id'],module_version:'1',rule_pack_version:'synthetic-1',prompt_version:'1',output_schema_version:'1',evaluation_version:'fixture-1',model:'fixture-model',active:true,activation_approval:'synthetic-test-only',instructions:'Synthetic test instructions.',required_fact_keys:['name'],required_element_ids:['judging'],authority_refs:['fixture-authority']}));
const applicant:DomainContext={actorId:'owner-a',now,role:'applicant',modules,caseRule:{version:'case-rule-1',approval:'synthetic-test-only',authority_refs:['case-fixture-authority']}};
function worker(jobId:string,runId?:string):DomainContext{return {...applicant,role:'worker',actorId:'service',workerScope:{jobId,runId}};}
async function command<T>(state:IntegrationCase,operation:string,input:unknown,ctx=applicant):Promise<T>{return await executeCommand(state,operation,input,ctx) as T;}
async function fixture(){
  const state=createIntegrationCase('case-a','owner-a',now);
  const fact=await command<Fact>(state,'fact.create',{key:'name',value:'Fictional Applicant',confirmed:true});
  return {state,fact};
}
async function document(state:IntegrationCase,title='Evidence.pdf'){
  const upload=await command<UploadSession>(state,'upload.create',{title,media_type:'application/pdf',bytes:100,sha256:hash});
  const confirmation=await command<{document:DocumentVersion;job_id:string}>(state,'upload.confirm',{upload_id:upload.upload_id,storage_version_id:'storage-v1',sha256:hash,bytes:100,media_type:'application/pdf'});
  const d=await command<DocumentVersion>(state,'document.complete',{job_id:confirmation.job_id,document_version_id:confirmation.document.document_version_id,scan_result:'clean',extraction:{source_artifact_id:'artifact-a',extraction_run_id:`extraction-${upload.upload_id}`,extraction_version:'parser-1',page_count:2,blocks:[{block_id:'b1',text:'The applicant completed two manuscript reviews.',locator:{page_index:2,page_label:'ii',block_id:'b1',bbox:[0.1,0.2,0.8,0.4]},quality:'verified'}]}},worker(confirmation.job_id));
  return d;
}
async function associate(state:IntegrationCase,d:DocumentVersion,criterion_id:'C04'|'C05'|'C08',confirm=true){
  const link=await command<EvidenceLink>(state,'link.create',{criterion_id,document_version_id:d.document_version_id});
  if(confirm)await command(state,'link.update',{link_id:link.link_id,expected_revision:1,state:'confirmed'});
  return link;
}
function candidate(d:DocumentVersion):ResultCandidate{return {section_title:'Synthetic assessment',claims:[{text:'The applicant completed two reviews.',event_id:'shared-review-event',citations:[{document_version_id:d.document_version_id,source_artifact_id:d.source_artifact_id,extraction_run_id:d.extraction_run_id!,locator:d.blocks[0].locator,excerpt:'completed two manuscript reviews'}]}],element_assessments:[{element_id:'judging',status:'needs_review',authority_refs:['fixture-authority'],explanation:'Synthetic fixture requires human review.'}],missing_evidence_tasks:[],contradictions:[]};}
async function run(state:IntegrationCase,d:DocumentVersion,criterion_id:'C04'|'C05'|'C08'){
  const value=await command<CriterionRun>(state,'run.create',{criterion_id});
  const result=await command<CriterionResult>(state,'run.publish',{run_id:value.run_id,candidate:candidate(d)},worker(value.job_id,value.run_id));
  return {run:value,result};
}
async function reviewed(state:IntegrationCase,result:CriterionResult){return await command<CriterionResult>(state,'result.review',{result_id:result.result_id,expected_revision:result.result_revision,claim_id:result.claims[0].claim_id,support_status:'supported'});}
async function compose(state:IntegrationCase,results:CriterionResult[],selected_criteria=results.map(r=>r.criterion_id)){
  return await command<Composition>(state,'composition.create',{selected_criteria,selected_results:results.map(r=>({criterion_id:r.criterion_id,result_id:r.result_id,result_revision:r.result_revision})),case_wide_document_ids:[...new Set(results.flatMap(r=>r.claims.flatMap(c=>c.citations.map(c=>c.document_version_id))))]});
}
async function analyze(state:IntegrationCase,composition:Composition,d:DocumentVersion){
  await command(state,'composition.analysis',{composition_id:composition.composition_id,expected_revision:composition.draft_revision,route:'criteria',sections:['overall_record','continued_work','prospective_benefit'].map(kind=>({kind,authority_refs:['case-fixture-authority'],claims:[candidate(d).claims[0]]}))});
  for(const claim of composition.claims.filter(c=>c.review_status==='unreviewed'))await command(state,'paragraph.review',{draft_id:composition.draft_id,paragraph_id:claim.paragraph_id,expected_revision:composition.draft_revision,support_status:'supported'});
}
function isError(code:string,status?:number){return (error:unknown)=>error instanceof DomainError&&error.code===code&&(status===undefined||error.status===status);}

test('canonical manifest hashing ignores object key insertion order',async()=>{
  assert.equal(await digest({z:1,a:{b:2,a:3}}),await digest({a:{a:3,b:2},z:1}));
  assert.notEqual(await digest({revision:1}),await digest({revision:2}));
});
test('case scope and strict schemas deny ownership and server-state injection',async()=>{
  const {state}=await fixture();
  await assert.rejects(command(state,'fact.create',{key:'name2',value:'hidden',confirmed:true},{...applicant,actorId:'owner-b'}),isError('unavailable',404));
  assert.throws(()=>readResource(state,'case',undefined,{}, {...applicant,actorId:'owner-b'}),isError('unavailable',404));
  await assert.rejects(command(state,'fact.create',{key:'name2',value:'hidden',confirmed:true,owner_id:'owner-b'}),isError('invalid_fields',422));
});
test('uploads expire, renew the same destination, reject tampering, and stay quarantined until scanning',async()=>{
  const {state}=await fixture();const u=await command<UploadSession>(state,'upload.create',{title:'a.pdf',media_type:'application/pdf',bytes:100,sha256:hash});
  await assert.rejects(command(state,'upload.confirm',{upload_id:u.upload_id,storage_version_id:'v1',sha256:'b'.repeat(64),bytes:100,media_type:'application/pdf'}),isError('upload_mismatch'));
  const later={...applicant,now:'2026-11-22T16:00:00.000Z'};
  await assert.rejects(command(state,'upload.confirm',{upload_id:u.upload_id,storage_version_id:'v1',sha256:hash,bytes:100,media_type:'application/pdf'},later),isError('upload_expired'));
  const originalKey=u.storage_key;await command(state,'upload.renew',{upload_id:u.upload_id},later);assert.equal(u.storage_key,originalKey);
  const c=await command<{document:DocumentVersion;job_id:string}>(state,'upload.confirm',{upload_id:u.upload_id,storage_version_id:'v1',sha256:hash,bytes:100,media_type:'application/pdf'},later);
  assert.equal(c.document.state,'quarantined');await associate(state,c.document,'C04');await assert.rejects(command(state,'run.create',{criterion_id:'C04'}),isError('source_unavailable'));
  await command(state,'document.complete',{job_id:c.job_id,document_version_id:c.document.document_version_id,scan_result:'indeterminate'},worker(c.job_id));
  assert.equal(c.document.state,'rejected');assert.equal(c.document.blocks.length,0);
});
test('proposed links do not dispatch and C08 workers cannot retrieve or publish C04 sources',async()=>{
  const {state}=await fixture(), a=await document(state), b=await document(state,'Other.pdf');
  const proposed=await associate(state,a,'C08',false);await associate(state,b,'C04');
  await assert.rejects(command(state,'run.create',{criterion_id:'C08'}),isError('confirmed_link_required'));
  await command(state,'link.update',{link_id:proposed.link_id,expected_revision:1,state:'confirmed'});
  const r=await command<CriterionRun>(state,'run.create',{criterion_id:'C08'}), r04=await command<CriterionRun>(state,'run.create',{criterion_id:'C04'});
  assert.equal(getRunSources(state,r.run_id,worker(r.job_id,r.run_id))[0].document_version_id,a.document_version_id);
  assert.throws(()=>getRunSources(state,r04.run_id,worker(r.job_id,r.run_id)),isError('unavailable'));
  await assert.rejects(command(state,'run.publish',{run_id:r.run_id,candidate:candidate(b)},worker(r.job_id,r.run_id)),isError('invalid_provenance'));
  await assert.rejects(command(state,'link.update',{link_id:proposed.link_id,expected_revision:2,state:'removed'},worker(r.job_id,r.run_id)),isError('unavailable'));
  await assert.rejects(command(state,'run.publish',{run_id:r.run_id,candidate:candidate(a)}),isError('unavailable'));
});
test('run deduplication commits one result and stale generations are retained without replacing the latest',async()=>{
  const {state,fact}=await fixture(), d=await document(state);await associate(state,d,'C04');
  const first=await command<CriterionRun>(state,'run.create',{criterion_id:'C04'}), replay=await command<CriterionRun>(state,'run.create',{criterion_id:'C04'});assert.equal(first.run_id,replay.run_id);
  await command(state,'fact.update',{fact_id:fact.fact_id,expected_revision:1,value:'Updated fictional name',confirmed:true});
  const second=await run(state,d,'C04');const late=await command<CriterionResult>(state,'run.publish',{run_id:first.run_id,candidate:candidate(d)},worker(first.job_id,first.run_id));
  assert.equal(late.publication,'superseded');assert.equal(state.current_results.C04?.result_id,second.result.result_id);
  const duplicate=await command<CriterionResult>(state,'run.publish',{run_id:second.run.run_id,candidate:candidate(d)},worker(second.run.job_id,second.run.run_id));assert.equal(duplicate.result_id,second.result.result_id);assert.equal(Object.keys(state.results).length,2);
});
test('typed publication rejects fabricated passages, locators, authority and missing assessments',async()=>{
  const {state}=await fixture(), d=await document(state);await associate(state,d,'C04');const r=await command<CriterionRun>(state,'run.create',{criterion_id:'C04'});
  const fake=candidate(d);fake.claims[0].citations[0].excerpt='Invented passage';await assert.rejects(command(state,'run.publish',{run_id:r.run_id,candidate:fake},worker(r.job_id,r.run_id)),isError('invalid_locator'));
  const badPage=candidate(d);badPage.claims[0].citations[0].locator={...badPage.claims[0].citations[0].locator,page_index:1};await assert.rejects(command(state,'run.publish',{run_id:r.run_id,candidate:badPage},worker(r.job_id,r.run_id)),isError('invalid_locator'));
  const badAuthority=candidate(d);badAuthority.element_assessments[0].authority_refs=['fabricated'];await assert.rejects(command(state,'run.publish',{run_id:r.run_id,candidate:badAuthority},worker(r.job_id,r.run_id)),isError('invalid_authority'));
  const incomplete=candidate(d);incomplete.element_assessments=[];await assert.rejects(command(state,'run.publish',{run_id:r.run_id,candidate:incomplete},worker(r.job_id,r.run_id)),isError('invalid_fields'));
  const wrongElement=candidate(d);wrongElement.element_assessments[0].element_id='different-rule';await assert.rejects(command(state,'run.publish',{run_id:r.run_id,candidate:wrongElement},worker(r.job_id,r.run_id)),isError('incomplete_assessment'));
  assert.equal(Object.keys(state.results).length,0);
});
test('identical source-backed claims are deduplicated with both result origins preserved',async()=>{
  const {state}=await fixture(),d=await document(state);await associate(state,d,'C04');await associate(state,d,'C05');const a=await run(state,d,'C04'),b=await run(state,d,'C05'),composition=await compose(state,[a.result,b.result]);
  assert.equal(composition.claims.length,1);assert.equal(composition.claim_origins[composition.claims[0].claim_id].length,2);assert.equal(composition.event_conflicts.length,0);assert.equal(composition.selected_results.length,2);
});
test('ambiguous shared events require explicit reconciliation and renewed paragraph review',async()=>{
  const {state}=await fixture(),d=await document(state);await associate(state,d,'C04');await associate(state,d,'C05');const a=await run(state,d,'C04'),bRun=await command<CriterionRun>(state,'run.create',{criterion_id:'C05'}),bCandidate=candidate(d);bCandidate.claims[0].text='The same review activity demonstrates an original contribution.';bCandidate.claims[0].event_id='different-model-name';
  const b=await command<CriterionResult>(state,'run.publish',{run_id:bRun.run_id,candidate:bCandidate},worker(bRun.job_id,bRun.run_id)),composition=await compose(state,[await reviewed(state,a.result),await reviewed(state,b)]);await analyze(state,composition,d);
  assert.equal(composition.event_conflicts.length,1);await assert.rejects(command(state,'export.create',{composition_id:composition.composition_id,draft_revision:composition.draft_revision}),isError('event_reconciliation_required'));
  const group=composition.event_conflicts[0];await command(state,'composition.events',{composition_id:composition.composition_id,expected_revision:composition.draft_revision,group_id:group.group_id,decision:'same_event',reason:'Both sections discuss the same two reviews.'});
  const affected=composition.claims.filter(c=>group.claim_ids.includes(c.claim_id));assert.equal(new Set(affected.map(c=>c.event_id)).size,1);assert.ok(affected.every(c=>c.review_status==='unreviewed'&&c.support_status==='needs_review'));
  for(const claim of affected)await command(state,'paragraph.review',{draft_id:composition.draft_id,paragraph_id:claim.paragraph_id,expected_revision:composition.draft_revision,support_status:'supported'});
  const packet=await command<PacketExport>(state,'export.create',{composition_id:composition.composition_id,draft_revision:composition.draft_revision});assert.equal(packet.state,'queued');
  const frozenSnapshot=structuredClone(packet.snapshot);assert.equal(packet.snapshot.event_decisions[0].decision,'same_event');assert.equal(packet.snapshot.case_analysis.sections.length,3);assert.equal(packet.snapshot.sections.length,2);assert.equal(Object.keys(packet.snapshot.claim_origins).length,2);
  await command(state,'paragraph.edit',{draft_id:composition.draft_id,paragraph_id:affected[0].paragraph_id,expected_revision:composition.draft_revision,text:'A changed assertion about the shared reviews.'});assert.equal(group.decision,undefined);
  assert.deepEqual(packet.snapshot,frozenSnapshot);
});
test('removing a shared association invalidates just its criterion; removing source reaches every dependent composition',async()=>{
  const {state}=await fixture(), shared=await document(state), separate=await document(state,'Role.pdf');const l04=await associate(state,shared,'C04');await associate(state,shared,'C05');await associate(state,separate,'C08');
  const c04=await run(state,shared,'C04'),c05=await run(state,shared,'C05'),c08=await run(state,separate,'C08'),composition=await compose(state,[c04.result,c05.result,c08.result]);
  await command(state,'link.update',{link_id:l04.link_id,expected_revision:2,state:'removed'});
  assert.equal(resultIsCurrent(state,c04.result,applicant),false);assert.equal(resultIsCurrent(state,c05.result,applicant),true);assert.equal(resultIsCurrent(state,c08.result,applicant),true);assert.equal(compositionIsCurrent(state,composition,applicant),false);
  await command(state,'document.remove',{document_version_id:shared.document_version_id,expected_revision:2});assert.equal(resultIsCurrent(state,c05.result,applicant),false);assert.equal(resultIsCurrent(state,c08.result,applicant),true);
});
test('material edits retain exact old results and reset claim support/review atomically',async()=>{
  const {state}=await fixture(), d=await document(state);await associate(state,d,'C04');const published=await run(state,d,'C04'), approved=await reviewed(state,published.result), old=structuredClone(approved);
  const composition=await compose(state,[approved]);const next=await command<CriterionResult>(state,'result.edit',{result_id:approved.result_id,expected_revision:2,claim_id:approved.claims[0].claim_id,text:'The applicant completed twenty reviews.'});
  assert.equal(next.claims[0].support_status,'needs_review');assert.equal(next.claims[0].review_status,'unreviewed');assert.equal(next.claims[0].claim_revision,2);assert.equal(compositionIsCurrent(state,composition,applicant),false);
  const historical=readResource(state,'criterion-results',old.result_id,{result_revision:'2'},applicant) as CriterionResult;assert.deepEqual(historical.claims,old.claims);
  await assert.rejects(command(state,'result.edit',{result_id:approved.result_id,expected_revision:2,claim_id:approved.claims[0].claim_id,text:'Concurrent losing edit.'}),isError('revision_conflict',409));
});
test('compositions pin revisions and show selected incomplete criteria without inventing completion',async()=>{
  const {state}=await fixture(),d=await document(state);await associate(state,d,'C04');const {result}=await run(state,d,'C04');const composition=await compose(state,[result],['C04','C08']);
  assert.deepEqual(composition.unresolved_criteria,['C08']);assert.deepEqual(composition.selected_results,[{criterion_id:'C04',result_id:result.result_id,result_revision:1}]);
  assert.equal((readResource(state,'compositions',composition.composition_id,{},applicant) as {private_tasks:unknown[]}).private_tasks.length,2);
  await assert.rejects(command(state,'export.create',{composition_id:composition.composition_id,draft_revision:1}),isError('case_analysis_required'));
});
test('citation resolution requires an exact review context and preserves physical page versus page label',async()=>{
  const {state}=await fixture(),d=await document(state);await associate(state,d,'C04');const {result}=await run(state,d,'C04'), citation=result.claims[0].citations[0];
  assert.throws(()=>readResource(state,'citations',citation.citation_id,{},applicant),isError('citation_context_required'));
  const resolved=readResource(state,'citations',citation.citation_id,{result_id:result.result_id,result_revision:'1'},applicant) as {locator:{page_index:number;page_label:string};viewer_path:string};
  assert.equal(resolved.locator.page_index,2);assert.equal(resolved.locator.page_label,'ii');assert.equal(resolved.viewer_path,`/v1/cases/case-a/documents/${d.document_version_id}/view`);
});
test('historical citations preserve reviewed decisions while reporting stale result and draft contexts',async()=>{
  const {state}=await fixture(),d=await document(state),link=await associate(state,d,'C04'),{result}=await run(state,d,'C04'),approved=await reviewed(state,result),composition=await compose(state,[approved]);
  const citation=approved.claims[0].citations[0],resultQuery={result_id:approved.result_id,result_revision:String(approved.result_revision)},draftQuery={composition_id:composition.composition_id,draft_revision:'1'};
  type CitationResponse={context_current:boolean;support_status:string;review_status:string;claim_revision:number};
  const initial=readResource(state,'citations',citation.citation_id,resultQuery,applicant) as CitationResponse;assert.equal(initial.context_current,true);assert.equal(initial.support_status,'supported');
  await command(state,'paragraph.edit',{draft_id:composition.draft_id,paragraph_id:composition.claims[0].paragraph_id,expected_revision:1,text:'The applicant completed twenty reviews.'});
  const historical=readResource(state,'citations',citation.citation_id,draftQuery,applicant) as CitationResponse;assert.equal(historical.context_current,false);assert.equal(historical.support_status,'supported');assert.equal(historical.review_status,'applicant_reviewed');assert.equal(historical.claim_revision,1);
  const edited=composition.claims[0],current=readResource(state,'citations',edited.citations[0].citation_id,{composition_id:composition.composition_id,draft_revision:'2'},applicant) as CitationResponse;assert.equal(current.context_current,true);assert.equal(current.support_status,'needs_review');assert.equal(current.review_status,'unreviewed');
  await command(state,'link.update',{link_id:link.link_id,expected_revision:2,state:'removed'});
  const staleResult=readResource(state,'citations',citation.citation_id,resultQuery,applicant) as CitationResponse;assert.equal(staleResult.context_current,false);assert.equal(staleResult.support_status,'supported');assert.equal(staleResult.review_status,'applicant_reviewed');
  assert.equal((readResource(state,'citations',edited.citations[0].citation_id,{composition_id:composition.composition_id,draft_revision:'2'},applicant) as CitationResponse).context_current,false);
});
test('reviewed packet candidates require exact reference reconciliation and final digest; delayed invalidation cannot preserve approval',async()=>{
  const {state,fact}=await fixture(),d=await document(state);await associate(state,d,'C04');const {result}=await run(state,d,'C04'),approved=await reviewed(state,result),composition=await compose(state,[approved]);
  await analyze(state,composition,d);const draftRevision=composition.draft_revision;
  const packet=await command<PacketExport>(state,'export.create',{composition_id:composition.composition_id,draft_revision:draftRevision});assert.equal(packet.state,'queued');
  const payload={export_id:packet.export_id,packet_digest:'d'.repeat(64),storage_key:'packets/opaque',storage_version_id:'v1',bytes:1000,page_count:5,reference_entries:packet.snapshot.claims.flatMap(claim=>claim.citations.map(citation=>({claim_id:claim.claim_id,claim_revision:claim.claim_revision,citation_id:citation.citation_id,document_version_id:d.document_version_id,exhibit_label:'A',exhibit_pages:[2],packet_pages:[5],display_text:'See Exhibit A, p. 2.'})))};
  await assert.rejects(command(state,'export.complete',{...payload,reference_entries:[]},worker(packet.job_id)),isError('reference_reconciliation_failed'));
  await command(state,'export.complete',payload,worker(packet.job_id));assert.equal(packet.state,'preview_ready');
  await assert.rejects(command(state,'export.confirm',{export_id:packet.export_id,packet_digest:'e'.repeat(64),draft_revision:draftRevision}),isError('packet_mismatch'));
  await command(state,'export.confirm',{export_id:packet.export_id,packet_digest:payload.packet_digest,draft_revision:draftRevision});assert.equal(packet.state,'final_approved');
  await command(state,'fact.update',{fact_id:fact.fact_id,expected_revision:1,value:'Changed after preview',confirmed:true});state.outbox=[];
  await assert.rejects(command(state,'export.confirm',{export_id:packet.export_id,packet_digest:payload.packet_digest,draft_revision:draftRevision}),isError('stale_composition'));
  assert.equal(packet.packet_digest,payload.packet_digest);
});
test('case-wide analysis has its own approved rule and evidence boundary and cannot inherit section approval',async()=>{
  const {state}=await fixture(),d=await document(state),other=await document(state,'Case-wide.pdf');await associate(state,d,'C04');const {result}=await run(state,d,'C04'),approved=await reviewed(state,result),composition=await compose(state,[approved]);
  await assert.rejects(command(state,'export.create',{composition_id:composition.composition_id,draft_revision:1}),isError('case_analysis_required'));
  const payload={composition_id:composition.composition_id,expected_revision:1,route:'criteria',sections:['overall_record','continued_work','prospective_benefit'].map(kind=>({kind,authority_refs:['case-fixture-authority'],claims:[candidate(d).claims[0]]}))};
  await assert.rejects(command(state,'composition.analysis',payload,{...applicant,caseRule:undefined}),isError('case_rule_unavailable'));
  const wrong=structuredClone(payload);wrong.sections[0].claims=[candidate(other).claims[0]];await assert.rejects(command(state,'composition.analysis',wrong),isError('invalid_provenance'));
  await command(state,'composition.analysis',payload);assert.equal(composition.claims.filter(c=>c.review_status==='unreviewed').length,3);
  await assert.rejects(command(state,'export.create',{composition_id:composition.composition_id,draft_revision:2}),isError('review_required'));
  assert.equal(compositionIsCurrent(state,composition,{...applicant,caseRule:{...applicant.caseRule!,version:'new-rule'}}),false);
});
test('missing-evidence and contradiction findings survive composition and require version-scoped applicant disposition',async()=>{
  const {state}=await fixture(),d=await document(state);await associate(state,d,'C04');const r=await command<CriterionRun>(state,'run.create',{criterion_id:'C04'}),proposal=candidate(d);
  proposal.missing_evidence_tasks=[{task_id:'completion-proof',description:'Confirm whether the review was completed.'}];proposal.contradictions=[{description:'One source describes an invitation while another describes completion.',document_version_ids:[d.document_version_id]}];
  const result=await command<CriterionResult>(state,'run.publish',{run_id:r.run_id,candidate:proposal},worker(r.job_id,r.run_id)),composition=await compose(state,[await reviewed(state,result)]);await analyze(state,composition,d);
  assert.equal(composition.issues.length,2);assert.equal(composition.selected_result_bundles[0].contradictions.length,1);assert.equal(composition.issues[0].result_revision,2);
  const tasks=(readResource(state,'compositions',composition.composition_id,{},applicant) as {private_tasks:{code:string}[]}).private_tasks;assert.equal(tasks.filter(t=>t.code==='issue_review_required').length,2);
  await assert.rejects(command(state,'export.create',{composition_id:composition.composition_id,draft_revision:composition.draft_revision}),isError('issue_review_required'));
  const first=composition.issues[0],revisionBefore=composition.draft_revision;
  await command(state,'composition.issues',{composition_id:composition.composition_id,expected_revision:revisionBefore,issue_id:first.issue_id,disposition:'acknowledged',reason:'The uncertainty is retained and explicitly disclosed in the reviewed analysis.'});
  assert.equal(first.disposition?.reviewed_draft_revision,revisionBefore);assert.equal(first.disposition?.actor_id,applicant.actorId);
  await assert.rejects(command(state,'composition.issues',{composition_id:composition.composition_id,expected_revision:revisionBefore,issue_id:first.issue_id,disposition:'resolved',reason:'Stale competing decision.'}),isError('revision_conflict'));
  await command(state,'composition.issues',{composition_id:composition.composition_id,expected_revision:composition.draft_revision,issue_id:composition.issues[1].issue_id,disposition:'acknowledged',reason:'The adverse source is preserved for the reader.'});
  const packet=await command<PacketExport>(state,'export.create',{composition_id:composition.composition_id,draft_revision:composition.draft_revision}),frozen=structuredClone(packet.snapshot);
  assert.equal(packet.snapshot.issues.length,2);assert.deepEqual(packet.snapshot.selected_result_bundles[0].contradictions,proposal.contradictions);assert.equal(packet.snapshot.issues[1].disposition?.decision,'acknowledged');
  await command(state,'composition.issues',{composition_id:composition.composition_id,expected_revision:composition.draft_revision,issue_id:first.issue_id,disposition:'resolved',reason:'The applicant revised their recorded disposition.'});
  assert.equal(first.history.length,1);assert.equal(first.history[0].decision,'acknowledged');assert.deepEqual(packet.snapshot,frozen);
});
test('canceled jobs reject late output and inactive configuration fails only its criterion',async()=>{
  const {state}=await fixture(),d=await document(state);await associate(state,d,'C04');await associate(state,d,'C08');const r=await command<CriterionRun>(state,'run.create',{criterion_id:'C04'});
  await command(state,'job.cancel',{job_id:r.job_id});await assert.rejects(command(state,'run.publish',{run_id:r.run_id,candidate:candidate(d)},worker(r.job_id,r.run_id)),isError('job_canceled'));
  const ctx={...applicant,modules:modules.map(m=>m.criterion_id==='C04'?{...m,active:false}:m)};await assert.rejects(command(state,'run.create',{criterion_id:'C04'},ctx),isError('module_unavailable'));
  const other=await command<CriterionRun>(state,'run.create',{criterion_id:'C08'},ctx);assert.equal(runIsCurrent(state,other.run_id,ctx),true);
});
test('configuration recovery retries the exact pinned job with an audit reason and remaining budget',async()=>{
  const {state}=await fixture(),d=await document(state);await associate(state,d,'C04');const r=await command<CriterionRun>(state,'run.create',{criterion_id:'C04'}),pinned=structuredClone(r),job=state.jobs[r.job_id];
  job.state='failed';job.attempts=1;job.error={code:'provider_not_configured',message:'The model gateway is not configured.',retryable:false};job.checkpoints={scanning:'clean'};
  await command(state,'job.retry',{job_id:job.job_id,reason:'Operator configured the approved model gateway.'});
  assert.equal(job.state,'queued');assert.equal(job.attempts,1);assert.equal(job.object_id,r.run_id);assert.equal(job.max_attempts,3);assert.deepEqual(job.checkpoints,{scanning:'clean'});assert.deepEqual(state.runs[r.run_id],pinned);assert.equal(job.error,undefined);
  assert.deepEqual(job.retry_history,[{reason:'Operator configured the approved model gateway.',actor_id:applicant.actorId,occurred_at:now}]);
  assert.equal(job.next_attempt_at,now);
  const retryEvent=state.outbox.at(-1)!;assert.equal(retryEvent.type,'job.retry_requested');assert.equal(JSON.stringify(retryEvent).includes('approved model gateway'),false);
  job.state='failed';job.attempts=3;job.error={code:'provider_not_configured',message:'Unconfigured.',retryable:false};
  await assert.rejects(command(state,'job.retry',{job_id:job.job_id,reason:'Attempt beyond the job budget.'}),isError('retry_unavailable'));
  assert.equal(job.retry_history.length,1);
});
test('explicit recovery cannot retry an uncertain model attempt or an uncertain output storage write',async()=>{
  const {state}=await fixture(),d=await document(state);await associate(state,d,'C04');const r=await command<CriterionRun>(state,'run.create',{criterion_id:'C04'}),job=state.jobs[r.job_id];
  job.state='failed';job.attempts=1;job.error={code:'model_attempt_uncertain',message:'The provider may have completed.',retryable:false};job.checkpoints={model_intent:now};
  await assert.rejects(command(state,'job.retry',{job_id:job.job_id,reason:'Trying to retry uncertain generation.'}),isError('retry_unavailable'));
  job.error={code:'storage_unavailable',message:'Model output storage completion is uncertain.',retryable:false};
  await assert.rejects(command(state,'job.retry',{job_id:job.job_id,reason:'Storage is configured again but the model outcome has not been reconciled.'}),isError('retry_unavailable'));
  assert.equal(job.state,'failed');assert.equal(job.attempts,1);assert.equal(job.retry_history,undefined);
  job.checkpoints.model_output_intent='extractions/pinned/model-output';
  await command(state,'job.retry',{job_id:job.job_id,reason:'Reconcile the known output storage intent without starting another model call.'});
  assert.equal(job.state,'queued');assert.equal(job.checkpoints.model_intent,now);assert.equal(job.checkpoints.model_output_intent,'extractions/pinned/model-output');assert.equal(job.attempts,1);
});
test('form previews expose missing answers, overflow and invalid dates; no guessed defaults',async()=>{
  const {state}=await fixture();const ctx:DomainContext={...applicant,formTemplates:[{template_id:'test-form',version:'1',edition:'synthetic',source_url:'https://example.test/form.pdf',retrieved_at:now,sha256:hash,approval:'test-only',active:true,fields:[{field_id:'name',fact_key:'name',required:true,max_length:5},{field_id:'date',fact_key:'date',required:true,max_length:10,format:'date'},{field_id:'missing',fact_key:'missing',required:true,max_length:100}]}]};
  await command(state,'fact.create',{key:'date',value:'2026-02-31',confirmed:true});const preview=await command<{ready:boolean;fields:{value:string|null;errors:string[]}[]}>(state,'form.preview',{template_id:'test-form'},ctx);
  assert.equal(preview.ready,false);assert.deepEqual(preview.fields.map(f=>f.errors),[['overflow'],['invalid_date'],['required']]);assert.equal(preview.fields[2].value,null);
});
