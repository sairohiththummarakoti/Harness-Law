import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Node's built-in TS runner requires explicit extensions.
import {applyAction,createEmptyCase,createSampleCase,criterionReady,getBlockers,runBlockers} from '../lib/model.ts';
// @ts-ignore Node's built-in TS runner requires explicit extensions.
import {caseSchema,readLimitedBody,saveSchema,safeFilename,validUploadName} from '../lib/validation.ts';

test('sample and personal cases pass strict persistence schema',()=>{
  assert.equal(caseSchema.safeParse(createSampleCase()).success,true);
  assert.equal(caseSchema.safeParse(createEmptyCase()).success,true);
  assert.equal(saveSchema.safeParse({state:{...createSampleCase(),ownerId:'attacker'},expectedRevision:0}).success,false);
  assert.equal(caseSchema.safeParse({...createSampleCase(),documents:[{id:'incomplete'}]}).success,false);
});
test('material paragraph edit resets support and review without changing other criteria',()=>{
  const s=createSampleCase();const c08=s.runs.C08.result!;const other=structuredClone(s.runs.C06);
  const next=applyAction(s,{type:'edit_claim',target:'C08',claimId:c08.claims[0].id,text:'A materially changed numerical claim.'});
  assert.equal(next.runs.C08.result!.claims[0].supportStatus,'needs_review');
  assert.equal(next.runs.C08.result!.claims[0].reviewStatus,'unreviewed');
  assert.equal(next.runs.C08.result!.claims[0].history[0].text,c08.claims[0].text);
  assert.equal(next.runs.C08.result!.claims[0].history[0].supportStatus,'supported');
  assert.equal(next.runs.C08.result!.claims[0].history[0].reviewStatus,'applicant_reviewed');
  const undone=applyAction(next,{type:'undo_claim',target:'C08',claimId:c08.claims[0].id});
  assert.equal(undone.runs.C08.result!.claims[0].history[1].reviewStatus,'applicant_reviewed');
  assert.equal(undone.runs.C08.result!.claims[0].reviewStatus,'unreviewed');
  assert.deepEqual(next.runs.C06,other);
});
test('locked claim text cannot be edited',()=>{
  const s=createSampleCase(),claim=s.runs.C08.result!.claims[0];
  const locked=applyAction(s,{type:'lock_claim',target:'C08',claimId:claim.id,locked:true});
  const next=applyAction(locked,{type:'edit_claim',target:'C08',claimId:claim.id,text:'Changed'});
  assert.equal(next.runs.C08.result!.claims[0].text,claim.text);
});
test('shared source replacement invalidates its criteria and composition only',()=>{
  let s=createSampleCase();s=applyAction(s,{type:'compose',criteria:['C04','C05','C08']});
  const role=structuredClone(s.runs.C08);const source=s.documents.find(d=>d.id==='src-impact')!;
  s=applyAction(s,{type:'replace_document',sourceId:source.id,document:{...source,name:'Updated dossier.pdf'}});
  assert.equal(s.runs.C04.result!.stale,true);assert.equal(s.runs.C05.result!.stale,true);
  assert.deepEqual(s.runs.C08,role);assert.equal(s.composition!.stale,true);
  const replaced=s.documents.find(d=>d.id===source.id)!;
  assert.equal(replaced.version,2);assert.equal(replaced.previousVersions![0].version,1);
  assert.ok(replaced.associations.every(a=>a.status==='proposed'));
});
test('removing one association preserves shared source and unrelated criterion',()=>{
  const s=createSampleCase();const c05=structuredClone(s.runs.C05);
  const next=applyAction(s,{type:'association',sourceId:'src-impact',criterion:'C04',status:'removed'});
  assert.ok(next.documents.some(d=>d.id==='src-impact'));assert.equal(next.runs.C04.result!.stale,true);
  assert.deepEqual(next.runs.C05,c05);
});
test('targeted invalidation preserves unrelated composed paragraphs and their reviews',()=>{
  let s=applyAction(createSampleCase(),{type:'compose',criteria:['C04','C05','C08']});
  const role=s.composition!.claims.find(c=>c.id.startsWith('C08-'))!;
  const before=structuredClone(role);
  s=applyAction(s,{type:'association',sourceId:'src-impact',criterion:'C04',status:'removed'});
  assert.equal(s.composition!.stale,true);
  assert.deepEqual(s.composition!.claims.find(c=>c.id.startsWith('C08-')),before);
  assert.equal(s.composition!.claims.find(c=>c.id.startsWith('C04-'))!.supportStatus,'needs_review');
});
test('only accepted, associated evidence and resolved relevant facts can enter a run',()=>{
  let s=createSampleCase();assert.ok(runBlockers(s,'C04').some(x=>x.includes('outstanding facts')));
  s=applyAction(s,{type:'fact',id:'fact-reviews',status:'confirmed',value:'Completion is not established',reason:'Invitation only.'});
  assert.equal(runBlockers(s,'C04').length,0);
  s=applyAction(s,{type:'start_run',criterion:'C04'});assert.equal(s.runs.C04.status,'running');
  const next=applyAction(s,{type:'finish_run',criterion:'C04',generation:s.runs.C04.generation,outcome:'failed'});
  assert.equal(next.runs.C04.status,'failed');assert.equal(next.runs.C08.status,'succeeded');
});
test('late run completion cannot replace a newer generation',()=>{
  let s=createSampleCase();s=applyAction(s,{type:'fact',id:'fact-role-date',status:'confirmed'});
  s=applyAction(s,{type:'start_run',criterion:'C08'});const old=s.runs.C08.generation;
  s=applyAction(s,{type:'start_run',criterion:'C08'});const active=s.runs.C08.generation;
  s=applyAction(s,{type:'finish_run',criterion:'C08',generation:old});
  assert.equal(s.runs.C08.status,'running');assert.equal(s.runs.C08.generation,active);
  s=applyAction(s,{type:'finish_run',criterion:'C08',generation:active});assert.equal(s.runs.C08.status,'succeeded');
});
test('removed source scope cannot regain support after rerun',()=>{
  let s=createSampleCase();s=applyAction(s,{type:'association',sourceId:'src-impact',criterion:'C05',status:'removed'});
  s=applyAction(s,{type:'start_run',criterion:'C05'});s=applyAction(s,{type:'finish_run',criterion:'C05',generation:s.runs.C05.generation});
  const claim=s.runs.C05.result!.claims[0];assert.equal(claim.supportStatus,'evidence_missing');
  s=applyAction(s,{type:'review_claim',target:'C05',claimId:claim.id,supportStatus:'supported',reviewStatus:'applicant_reviewed'});
  assert.equal(s.runs.C05.result!.claims[0].supportStatus,'evidence_missing');assert.equal(criterionReady(s,'C05'),false);
});
test('composition pins exact result revisions and later edits block final approval',()=>{
  let s=applyAction(createSampleCase(),{type:'compose',criteria:['C08']});
  assert.equal(s.composition!.selected[0].revision,s.runs.C08.result!.revision);
  s=applyAction(s,{type:'edit_claim',target:'C08',claimId:s.runs.C08.result!.claims[0].id,text:'Changed role'});
  assert.equal(s.composition!.stale,true);assert.ok(getBlockers(s).some(b=>b.id==='stale'));
});
test('personal manual drafting works without claiming evidence support',()=>{
  let s=createEmptyCase();s=applyAction(s,{type:'toggle_criterion',criterion:'C08'});
  s=applyAction(s,{type:'manual_section',criterion:'C08',text:'Applicant-provided account of my role.'});
  assert.equal(s.runs.C08.result!.moduleVersion,'manual-1.0');assert.equal(s.runs.C08.status,'succeeded');
  assert.equal(s.runs.C08.result!.claims[0].supportStatus,'evidence_missing');
  assert.equal(s.runs.C08.result!.claims[0].reviewStatus,'unreviewed');
  s=applyAction(s,{type:'compose',criteria:['C08']});assert.equal(s.composition!.claims.length,1);
  assert.ok(getBlockers(s).some(b=>b.id==='claims'));
});

test('composition edits and recomposition preserve earlier snapshots',()=>{
  let s=applyAction(createSampleCase(),{type:'compose',criteria:['C08']});
  const original=structuredClone(s.composition!);
  s=applyAction(s,{type:'edit_claim',target:'composition',claimId:s.composition!.claims[0].id,text:'A materially revised combined claim.'});
  assert.deepEqual(s.compositionHistory![0],original);
  assert.equal(s.composition!.version,original.version+1);
  const edited=structuredClone(s.composition!);
  s=applyAction(s,{type:'compose',criteria:['C06','C08']});
  assert.deepEqual(s.compositionHistory![0],edited);
  assert.deepEqual(s.compositionHistory![1],original);
  assert.equal(caseSchema.safeParse(s).success,true);
});

test('changed source-result review invalidates composed decisions and retains review history',()=>{
  let s=applyAction(createSampleCase(),{type:'compose',criteria:['C08']});
  const selectedRevision=s.composition!.selected[0].revision;
  s=applyAction(s,{type:'review_claim',target:'C08',claimId:'claim-c08',supportStatus:'conflicting',reviewStatus:'unreviewed'});
  assert.equal(s.composition!.stale,true);
  assert.ok(s.runs.C08.result!.revision>selectedRevision);
  assert.equal(s.runs.C08.history[0].claims[0].supportStatus,'supported');
  assert.equal(s.runs.C08.history[0].claims[0].reviewStatus,'applicant_reviewed');
  assert.ok(getBlockers(s).some(b=>b.id==='stale'));
});
test('sample evidence cannot be added to a personal case and unsupported files are rejected',()=>{
  const s=createEmptyCase();assert.equal(applyAction(s,{type:'add_document',document:createSampleCase().documents[0]}).documents.length,0);
  assert.equal(validUploadName('payload.exe'),false);assert.equal(validUploadName('report.pdf'),true);
  assert.equal(safeFilename('../../report.pdf'),'report.pdf');assert.equal(safeFilename('C:\\secrets\\report.pdf'),'report.pdf');
});
test('body limit is enforced even without Content-Length',async()=>{
  const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(8));controller.enqueue(new Uint8Array(8));controller.close();}});
  const request=new Request('https://example.test',{method:'POST',body,duplex:'half'} as RequestInit);
  assert.equal(await readLimitedBody(request,10),null);
  const accepted=await readLimitedBody(new Request('https://example.test',{method:'POST',body:'hello'}),10);
  assert.equal(new TextDecoder().decode(accepted!),'hello');
});

test('late uploads cannot attach private metadata to a sample or a different case',()=>{
  const personal=createEmptyCase();
  const doc={...createSampleCase().documents[0],id:'upload-test',sample:false,status:'needs_attention' as const,excerpt:'',objectId:'upload-test'};
  const uploaded=applyAction(personal,{type:'complete_upload',caseId:personal.id,document:doc});
  assert.equal(uploaded.documents[0].id,'upload-test');
  const sample=createSampleCase();
  assert.deepEqual(applyAction(sample,{type:'complete_upload',caseId:personal.id,document:doc}).documents,sample.documents);
  const another=createEmptyCase();
  assert.equal(applyAction(another,{type:'complete_upload',caseId:personal.id,document:doc}).documents.length,0);
});

test('replacement completion uses its explicit source target and preserves other sources',()=>{
  const s=createEmptyCase();
  const base={...createSampleCase().documents[0],sample:false,status:'needs_attention' as const,excerpt:'',objectId:'original-object'};
  s.documents=[{...base,id:'source-a'},{...base,id:'source-b'}];
  const replacement={...base,id:'new-upload',objectId:'new-object',name:'replacement.pdf'};
  const next=applyAction(s,{type:'complete_upload',caseId:s.id,replacementSourceId:'source-a',document:replacement});
  assert.equal(next.documents[0].id,'source-a');assert.equal(next.documents[0].version,2);
  assert.equal(next.documents[0].objectId,'new-object');assert.deepEqual(next.documents[1],s.documents[1]);
});
