import type { CaseIntake } from './intake';
export type SupportStatus = 'unassessed' | 'supported' | 'needs_review' | 'conflicting' | 'evidence_missing';
export type ReviewStatus = 'unreviewed' | 'applicant_reviewed' | 'attorney_reviewed';
export type AssociationStatus = 'proposed' | 'confirmed' | 'removed';
export interface Profile { fullName:string; preferredName:string; email:string; phone:string; country:string; address:string; priorNames:string; confirmed:boolean }
export interface Professional { field:string; role:string; organization:string; timeline:string; achievements:string; intendedWork:string }
export interface Forms { fullName:string; address:string; country:string; intendedWork:string; reviewed:boolean; templateStatus:'unverified'|'current' }
export interface Association { criterion:string; status:AssociationStatus; actor:string; revision:number }
export interface EvidenceVersion { version:number; name:string; excerpt:string; status:Evidence['status']; at:string }
export interface Evidence { id:string; name:string; version:number; status:'ready'|'needs_attention'|'rejected'; language:string; pages:number; bytes:number; kind:string; excerpt:string; associations:Association[]; exhibit:string; uploadedAt:string; sample:boolean; objectId?:string; issue?:string; previousVersions?:EvidenceVersion[] }
export interface Fact { id:string; label:string; value:string; originalValue:string; sourceId:string; page:number; status:'unresolved'|'confirmed'|'corrected'|'issue'; reason:string }
export interface Citation { sourceId:string; sourceVersion:number; page:number; quote:string }
export interface Claim { id:string; text:string; citations:Citation[]; supportStatus:SupportStatus; reviewStatus:ReviewStatus; locked:boolean; revision:number; history:{text:string;revision:number;author:string;at:string;supportStatus?:SupportStatus;reviewStatus?:ReviewStatus}[] }
export interface CriterionResult { id:string; criterion:string; revision:number; sourceVersions:{id:string;version:number}[]; claims:Claim[]; stale:boolean; createdAt:string; moduleVersion:string; ruleVersion:string }
export interface CriterionRun { criterion:string; generation:number; status:'idle'|'queued'|'running'|'succeeded'|'failed'|'canceled'; stage:string; error?:string; questions:string[]; result:CriterionResult|null; history:CriterionResult[] }
export interface Composition { id:string; version:number; selected:{criterion:string;resultId:string;revision:number}[]; claims:Claim[]; stale:boolean; createdAt:string }
export interface Activity { id:string;title:string;detail:string;at:string }
export type OnboardingGoal = 'evidence' | 'narrative' | 'review';
export interface Onboarding { version:1;step:1|2|3|4;goal?:OnboardingGoal;completedAt?:string }
export interface CaseState { id:string;name:string;mode:'sample'|'personal';revision:number;profile:Profile;professional:Professional;criteria:string[];documents:Evidence[];facts:Fact[];runs:Record<string,CriterionRun>;composition:Composition|null;compositionHistory?:Composition[];forms:Forms;activities:Activity[];consent:boolean;lastPage:string;updatedAt:string;onboarding?:Onboarding;intake?:CaseIntake }
export interface Blocker { id:string;title:string;detail:string;page:string }
export const GUIDANCE_URL='https://www.uscis.gov/policy-manual/volume-6-part-f-chapter-2';
export const CRITERIA = [
  {id:'C01',title:'Prizes and awards',shortTitle:'Awards',description:'Nationally or internationally recognized prizes or awards for excellence in your field.',examples:['Award certificates','Selection criteria and award context']},
  {id:'C02',title:'Selective memberships',shortTitle:'Memberships',description:'Memberships that require outstanding achievements, judged by recognized experts.',examples:['Membership criteria','Evidence of expert selection']},
  {id:'C03',title:'Published material about you',shortTitle:'Published material',description:'Published material about you, relating to your work, in professional or major trade publications or other major media.',examples:['Articles with title, date, and author','Publication reach and context']},
  {id:'C04',title:'Judging the work of others',shortTitle:'Judging',description:'Your participation as a judge of others’ work in the same or an allied field.',examples:['Completed peer reviews','Judging records and confirmation']},
  {id:'C05',title:'Original contributions',shortTitle:'Contributions',description:'Original scientific, scholarly, artistic, athletic, or business-related contributions of major significance.',examples:['Documented adoption or influence','Independent evidence of significance']},
  {id:'C06',title:'Scholarly authorship',shortTitle:'Authorship',description:'Authorship of scholarly articles in professional or major trade publications or other major media.',examples:['Published scholarly articles','Publication information']},
  {id:'C07',title:'Artistic exhibitions',shortTitle:'Exhibitions',description:'Display of your work at artistic exhibitions or showcases.',examples:['Exhibition programs','Evidence identifying your displayed work']},
  {id:'C08',title:'Leading or critical role',shortTitle:'Critical role',description:'A leading or critical role for organizations or establishments with a distinguished reputation.',examples:['Detailed role letters','Evidence of organizational reputation']},
  {id:'C09',title:'High remuneration',shortTitle:'Remuneration',description:'A high salary or other significantly high remuneration compared with others in the field.',examples:['Compensation records','Relevant comparison data']},
  {id:'C10',title:'Commercial success in the performing arts',shortTitle:'Commercial success',description:'Commercial success in the performing arts shown by box-office receipts or sales.',examples:['Box-office receipts','Record, cassette, CD, or video sales']},
] as const;
const now=()=>new Date().toISOString();
const uid=(prefix:string)=>`${prefix}-${crypto.randomUUID()}`;
export function emptyRun(criterion:string):CriterionRun {return {criterion,generation:0,status:'idle',stage:'Not started',questions:[],result:null,history:[]};}
export function createEmptyCase():CaseState {
  return {id:uid('case'),name:'My EB-1A preparation',mode:'personal',revision:0,profile:{fullName:'',preferredName:'',email:'',phone:'',country:'',address:'',priorNames:'',confirmed:false},professional:{field:'',role:'',organization:'',timeline:'',achievements:'',intendedWork:''},criteria:[],documents:[],facts:[],runs:Object.fromEntries(CRITERIA.map(c=>[c.id,emptyRun(c.id)])),composition:null,forms:{fullName:'',address:'',country:'',intendedWork:'',reviewed:false,templateStatus:'unverified'},activities:[],consent:false,lastPage:'overview',updatedAt:now()};
}
const association=(criterion:string,status:AssociationStatus='confirmed'):Association=>({criterion,status,actor:'Maya Chen',revision:1});
const sampleDoc=(id:string,name:string,excerpt:string,associations:Association[],exhibit:string,pages=2):Evidence=>({id,name,version:1,status:'ready',language:'English',pages,bytes:148000,kind:'PDF',excerpt,associations,exhibit,uploadedAt:'2026-11-20T14:30:00.000Z',sample:true,previousVersions:[]});
const makeClaim=(id:string,text:string,doc:Evidence,page:number,quote:string,supportStatus:SupportStatus='unassessed',reviewStatus:ReviewStatus='unreviewed'):Claim=>({id,text,citations:[{sourceId:doc.id,sourceVersion:doc.version,page,quote}],supportStatus,reviewStatus,locked:false,revision:1,history:[]});
export function createSampleCase():CaseState {
  const s=createEmptyCase(); s.id='sample-maya-chen';s.name='Maya Chen · EB-1A';s.mode='sample';s.consent=true;
  s.profile={fullName:'Maya Chen',preferredName:'Maya',email:'maya.chen@example.com',phone:'',country:'Canada',address:'Toronto, Ontario, Canada',priorNames:'',confirmed:true};
  s.professional={field:'Artificial intelligence and medical imaging',role:'Principal Research Scientist',organization:'Northstar Research Institute',timeline:'2022–present · Principal Research Scientist, Northstar Research Institute\n2018–2022 · Research Scientist, Lumen Imaging',achievements:'Developed an open research method for low-resource medical image analysis. Published peer-reviewed research and contributed to a multi-institution research program.',intendedWork:'Continue research in accessible medical imaging and collaborate with academic research teams in the United States.'};
  s.criteria=['C04','C05','C06','C08'];
  const cv=sampleDoc('src-cv','Maya_Chen_CV.pdf','FICTIONAL SAMPLE • Curriculum vitae\nMaya Chen\nPrincipal Research Scientist, Northstar Research Institute, 2022–present.\nResearch Scientist, Lumen Imaging, 2018–2022.\nField: artificial intelligence and medical imaging.',[association('C08','proposed')],'A-1',3);
  const judging=sampleDoc('src-judging','Editorial_review_invitation.pdf','FICTIONAL SAMPLE • Editorial correspondence\nDear Dr. Chen,\nWe invite you to review two submissions for the Journal of Medical Imaging Research. Please confirm whether you can accept these assignments.\nThis invitation does not confirm that either review was completed.',[association('C04')],'C-1',1);
  const impact=sampleDoc('src-impact','Research_impact_and_service.pdf','FICTIONAL SAMPLE • Research impact and service dossier\nPage 1 — The evaluation method developed by Maya Chen was used by two collaborating research groups in a pilot study. This report describes use; it does not assess field-wide significance.\nPage 2 — Two peer-review invitations are recorded in the service log. Completion confirmations have not yet been attached.',[association('C04'),association('C05')],'D-1',2);
  const paper=sampleDoc('src-paper','Medical_imaging_publication.pdf','FICTIONAL SAMPLE • Journal of Medical Imaging Research\nLow-resource image analysis for collaborative research\nAuthors: Maya Chen, Alex Rivera, and Priya Shah\nPublished: June 2024.\nThis article describes a research method and its evaluation on a pilot dataset.',[association('C06')],'E-1',8);
  const role=sampleDoc('src-role','Northstar_role_letter.pdf','FICTIONAL SAMPLE • Northstar Research Institute\nTo whom it may concern:\nMaya Chen has served as Principal Research Scientist at Northstar Research Institute since March 2022.\nDr. Chen leads the medical imaging research program and coordinates its technical research direction.\nThe institute’s reputation should be established using separate, independent evidence.\nSigned: Elena Park, Research Director',[association('C08')],'F-1',2);
  const press=sampleDoc('src-press','Research_program_spotlight.pdf','FICTIONAL SAMPLE • Research program spotlight\nAn independent research newsletter describes a collaboration using a medical imaging method co-developed by Maya Chen.\nThe report names the collaborating groups and describes the pilot project. Its circulation and broader impact have not been independently verified.',[association('C03','proposed'),association('C05')],'D-2',2);
  s.documents=[cv,judging,impact,paper,role,press];
  s.facts=[{id:'fact-name',label:'Full legal name',value:'Maya Chen',originalValue:'Maya Chen',sourceId:cv.id,page:1,status:'confirmed',reason:'Confirmed against sample CV.'},{id:'fact-role-date',label:'Role start date',value:'March 2022',originalValue:'March 2022',sourceId:role.id,page:1,status:'unresolved',reason:'CV gives 2022 without a month. Confirm the exact start date.'},{id:'fact-reviews',label:'Completed peer reviews',value:'Not confirmed',originalValue:'Two invitations',sourceId:judging.id,page:1,status:'unresolved',reason:'An invitation does not establish completed judging.'}];
  const result=(criterion:string,docs:Evidence[],claims:Claim[]):CriterionResult=>({id:`result-${criterion}-1`,criterion,revision:1,sourceVersions:docs.map(d=>({id:d.id,version:d.version})),claims,stale:false,createdAt:'2026-11-21T16:20:00.000Z',moduleVersion:'sample-1.0',ruleVersion:'sample-guidance-1.0'});
  const c04=result('C04',[judging,impact],[makeClaim('claim-c04','Maya Chen received invitations to review two submissions for the Journal of Medical Imaging Research.',judging,1,'We invite you to review two submissions for the Journal of Medical Imaging Research.','supported')]);
  const c05=result('C05',[impact,press],[makeClaim('claim-c05','Two collaborating research groups used a method developed by Maya Chen in a pilot study.',impact,1,'The evaluation method developed by Maya Chen was used by two collaborating research groups in a pilot study.','needs_review')]);
  const c06=result('C06',[paper],[makeClaim('claim-c06','Maya Chen co-authored “Low-resource image analysis for collaborative research,” published in June 2024.',paper,1,'Authors: Maya Chen, Alex Rivera, and Priya Shah\nPublished: June 2024.','supported')]);
  const c08=result('C08',[role],[makeClaim('claim-c08','Maya Chen serves as Principal Research Scientist at Northstar Research Institute and leads its medical imaging research program.',role,1,'Maya Chen has served as Principal Research Scientist at Northstar Research Institute since March 2022.\nDr. Chen leads the medical imaging research program and coordinates its technical research direction.','supported','applicant_reviewed')]);
  for(const r of [c04,c05,c06,c08])s.runs[r.criterion]={...emptyRun(r.criterion),generation:1,status:'succeeded',stage:'Sample run complete',result:r};
  s.runs.C04.questions=['Add confirmation that the invited peer reviews were completed.'];
  s.runs.C05.questions=['Add independent evidence explaining the significance of the contribution.'];
  s.runs.C08.questions=['Add independent evidence of the organization’s distinguished reputation.'];
  s.forms={fullName:s.profile.fullName,address:s.profile.address,country:s.profile.country,intendedWork:s.professional.intendedWork,reviewed:false,templateStatus:'unverified'};
  s.activities=[{id:'activity-1',title:'Critical-role section reviewed',detail:'Applicant review recorded for C08 result revision 1.',at:'2026-11-21T16:20:00.000Z'},{id:'activity-2',title:'Six sample documents organized',detail:'Evidence associations retain one source identity across criteria.',at:'2026-11-20T14:30:00.000Z'}];
  return s;
}

export type Action =
 | {type:'complete_upload';caseId:string;document:Evidence;replacementSourceId?:string|null}
 | {type:'profile';patch:Partial<Profile>} | {type:'professional';patch:Partial<Professional>} | {type:'consent';value:boolean} | {type:'navigate';page:string} | {type:'rename';name:string}
 | {type:'toggle_criterion';criterion:string} | {type:'association';sourceId:string;criterion:string;status:AssociationStatus} | {type:'add_document';document:Evidence} | {type:'replace_document';sourceId:string;document:Evidence} | {type:'remove_document';sourceId:string}
 | {type:'fact';id:string;value?:string;status:Fact['status'];reason?:string} | {type:'start_run';criterion:string} | {type:'finish_run';criterion:string;generation:number;outcome?:'succeeded'|'failed'} | {type:'cancel_run';criterion:string}
 | {type:'edit_claim';target:string;claimId:string;text:string} | {type:'lock_claim';target:string;claimId:string;locked:boolean} | {type:'review_claim';target:string;claimId:string;supportStatus?:SupportStatus;reviewStatus?:ReviewStatus} | {type:'undo_claim';target:string;claimId:string}
 | {type:'manual_section';criterion:string;text:string} | {type:'compose';criteria:string[]} | {type:'forms';patch:Partial<Forms>};
export function currentResult(state:CaseState,criterion:string) {return state.runs[criterion]?.result??null;}
export function runBlockers(state:CaseState,criterion:string):string[] {
  const problems:string[]=[];
  if(!CRITERIA.some(c=>c.id===criterion))problems.push('This criterion module is unknown.');
  if(!state.criteria.includes(criterion))problems.push('Select this criterion first.');
  if(!state.profile.confirmed)problems.push('Confirm your profile facts before running this criterion.');
  const confirmed=state.documents.filter(d=>d.associations.some(a=>a.criterion===criterion&&a.status==='confirmed'));
  if(!confirmed.length)problems.push('Confirm at least one source-version association for this criterion.');
  if(confirmed.some(d=>d.status!=='ready'))problems.push('Associated sources must finish safety scanning and extraction first.');
  if(state.facts.some(f=>(f.status==='unresolved'||f.status==='issue')&&confirmed.some(d=>d.id===f.sourceId)))problems.push('Resolve the outstanding facts linked to this criterion’s confirmed sources.');
  if(state.mode==='personal')problems.push('Criterion processing is not connected yet. Your evidence and manual draft remain available.');
  return problems;
}
export function criterionReady(state:CaseState,criterion:string):boolean {
  const run=state.runs[criterion],r=run?.result;
  return !!r&&!r.stale&&run.status==='succeeded'&&r.claims.length>0&&r.claims.every(c=>c.supportStatus==='supported'&&c.reviewStatus!=='unreviewed'&&citationsCurrent(state,c,criterion,r.sourceVersions));
}
function citationsCurrent(state:CaseState,claim:Claim,criterion?:string,scope?:{id:string;version:number}[]){
  return claim.citations.length>0&&claim.citations.every(c=>state.documents.some(d=>d.id===c.sourceId&&d.version===c.sourceVersion&&d.status==='ready'&&(!criterion||d.associations.some(a=>a.criterion===criterion&&a.status==='confirmed'))&&(!scope||scope.some(v=>v.id===d.id&&v.version===d.version))));
}
function targetCitationsCurrent(state:CaseState,claim:Claim,target:string){
  if(target!=='composition'){const r=state.runs[target]?.result;return !!r&&citationsCurrent(state,claim,target,r.sourceVersions);}
  const selection=state.composition?.selected.find(x=>claim.id.startsWith(`${x.criterion}-`));
  if(!selection)return false;
  const r=state.runs[selection.criterion]?.result;
  return !!r&&!r.stale&&r.id===selection.resultId&&r.revision===selection.revision&&citationsCurrent(state,claim,selection.criterion,r.sourceVersions);
}
function markStale(s:CaseState,criteria:string[]){
  const set=new Set(criteria);
  for(const criterion of set){const r=s.runs[criterion]?.result;if(r){r.stale=true;for(const c of r.claims){c.supportStatus='needs_review';c.reviewStatus='unreviewed';}}}
  invalidateComposition(s,criteria);
}
function invalidateComposition(s:CaseState,criteria:string[]){
  if(s.composition?.selected.some(x=>criteria.includes(x.criterion))){
    s.composition.stale=true;
    for(const c of s.composition.claims)if(criteria.some(criterion=>c.id.startsWith(`${criterion}-`))){c.supportStatus='needs_review';c.reviewStatus='unreviewed';}
  }
}
function sourceDependents(s:CaseState,sourceId:string){return Object.values(s.runs).filter(r=>r.result?.sourceVersions.some(v=>v.id===sourceId)).map(r=>r.criterion);}
function activity(s:CaseState,title:string,detail:string){s.activities.unshift({id:uid('activity'),title,detail,at:now()});s.activities=s.activities.slice(0,50);}
function targetClaims(s:CaseState,target:string){return target==='composition'?s.composition?.claims:s.runs[target]?.result?.claims;}
function retainComposition(s:CaseState){if(s.composition){s.compositionHistory??=[];s.compositionHistory.unshift(structuredClone(s.composition));}}
function bumpTarget(s:CaseState,target:string){
  if(target==='composition'){if(s.composition)s.composition.version++;return;}
  const r=s.runs[target]?.result;if(r)r.revision++;
  invalidateComposition(s,[target]);
}
export function applyAction(state:CaseState,action:Action):CaseState {
  const s=structuredClone(state);s.updatedAt=now();
  switch(action.type){
    case 'complete_upload':{
      if(s.id!==action.caseId||s.mode!=='personal'||action.document.sample)break;
      return applyAction(s,action.replacementSourceId?{type:'replace_document',sourceId:action.replacementSourceId,document:action.document}:{type:'add_document',document:action.document});
    }
    case 'navigate':s.lastPage=action.page;break;
    case 'rename':s.name=action.name.trim()||s.name;break;
    case 'consent':s.consent=action.value;activity(s,action.value?'Processing consent recorded':'Processing consent withdrawn','Consent applies to future processing.');break;
    case 'profile':{
      const changed=Object.entries(action.patch).some(([k,v])=>k!=='confirmed'&&s.profile[k as keyof Profile]!==v);
      s.profile={...s.profile,...action.patch};
      if(changed){markStale(s,s.criteria);s.forms.reviewed=false;activity(s,'Profile updated','Dependent draft sections and form fields need review.');}
      break;
    }
    case 'professional':s.professional={...s.professional,...action.patch};markStale(s,s.criteria);s.forms.reviewed=false;break;
    case 'toggle_criterion':{
      if(!CRITERIA.some(c=>c.id===action.criterion))break;
      if(s.criteria.includes(action.criterion)){s.criteria=s.criteria.filter(c=>c!==action.criterion);markStale(s,[action.criterion]);}
      else{s.criteria.push(action.criterion);s.runs[action.criterion]??=emptyRun(action.criterion);}
      activity(s,'Criteria selection updated',`${action.criterion}: source documents are preserved.`);break;
    }
    case 'association':{
      const d=s.documents.find(d=>d.id===action.sourceId);if(!d||!CRITERIA.some(c=>c.id===action.criterion))break;
      const old=d.associations.find(a=>a.criterion===action.criterion);if(old?.status===action.status)break;
      d.associations=d.associations.filter(a=>a.criterion!==action.criterion);
      d.associations.push({criterion:action.criterion,status:action.status,actor:s.profile.fullName||'Applicant',revision:(old?.revision||0)+1});
      markStale(s,[action.criterion]);activity(s,'Evidence association updated',`${d.name} · ${action.criterion} · ${action.status}`);break;
    }
    case 'add_document':if(!s.documents.some(d=>d.id===action.document.id)&&!(s.mode==='personal'&&action.document.sample)){s.documents.unshift(action.document);activity(s,'Document added',action.document.name);}break;
    case 'replace_document':{
      const i=s.documents.findIndex(d=>d.id===action.sourceId);if(i<0)break;const old=s.documents[i];
      if(s.mode==='personal'&&action.document.sample)break;
      markStale(s,sourceDependents(s,old.id));
      s.documents[i]={...action.document,id:old.id,version:old.version+1,associations:old.associations.map(a=>({...a,status:a.status==='removed'?'removed':'proposed',revision:a.revision+1})),exhibit:old.exhibit,previousVersions:[...(old.previousVersions||[]),{version:old.version,name:old.name,excerpt:old.excerpt,status:old.status,at:now()}]};
      activity(s,'Source version replaced',`${old.name} · v${old.version+1}. Confirm associations for the new version.`);break;
    }
    case 'remove_document':markStale(s,sourceDependents(s,action.sourceId));s.documents=s.documents.filter(d=>d.id!==action.sourceId);activity(s,'Source removed from the case','Dependent results require source repair.');break;
    case 'fact':{
      const fact=s.facts.find(f=>f.id===action.id);if(!fact)break;
      const changed=action.value!==undefined&&action.value!==fact.value;
      if(action.value!==undefined)fact.value=action.value;fact.status=action.status;if(action.reason!==undefined)fact.reason=action.reason;
      if(changed||action.status==='issue'||action.status==='unresolved')markStale(s,sourceDependents(s,fact.sourceId));
      activity(s,'Fact review updated',`${fact.label} · ${fact.status}`);break;
    }
    case 'start_run':{
      const r=s.runs[action.criterion]??emptyRun(action.criterion);s.runs[action.criterion]=r;
      const problems=runBlockers(s,action.criterion);r.generation++;r.error=undefined;
      if(problems.length){r.status='failed';r.stage='Inputs need attention';r.error=problems.join(' ');break;}
      r.status='running';r.stage='Checking sample evidence';activity(s,'Sample criterion run started',`${action.criterion} · generation ${r.generation}`);break;
    }
    case 'cancel_run':{const r=s.runs[action.criterion];if(r&&(r.status==='running'||r.status==='queued')){r.status='canceled';r.stage='Canceled';r.generation++;}break;}
    case 'finish_run':{
      const r=s.runs[action.criterion];if(!r||r.generation!==action.generation||r.status!=='running')break;
      const problems=runBlockers(s,action.criterion);
      if(action.outcome==='failed'||problems.length){r.status='failed';r.stage='Needs attention';r.error=problems.join(' ')||'Sample processing was interrupted. Retry this criterion.';break;}
      const docs=s.documents.filter(d=>d.status==='ready'&&d.associations.some(a=>a.criterion===action.criterion&&a.status==='confirmed'));
      if(r.result)r.history.unshift(structuredClone(r.result));
      const prior=r.result;
      const scope=docs.map(d=>({id:d.id,version:d.version}));
      const claims=prior?.claims.map(c=>{
        const valid=citationsCurrent(s,c,action.criterion,scope);
        if(c.locked&&valid)return structuredClone(c);
        return {...structuredClone(c),supportStatus:(valid?'needs_review':'evidence_missing') as SupportStatus,reviewStatus:'unreviewed' as ReviewStatus,revision:c.revision+1};
      })||docs.map((d,i)=>makeClaim(`claim-${action.criterion}-${i}`,`Review the source “${d.name}” and write a claim supported by its text.`,d,1,d.excerpt,'unassessed'));
      r.result={id:uid(`result-${action.criterion}`),criterion:action.criterion,revision:(prior?.revision||0)+1,sourceVersions:docs.map(d=>({id:d.id,version:d.version})),claims,stale:false,createdAt:now(),moduleVersion:'sample-1.0',ruleVersion:'sample-guidance-1.0'};
      r.status='succeeded';r.stage='Sample run complete';r.error=undefined;
      invalidateComposition(s,[action.criterion]);
      activity(s,'Sample criterion run completed',`${action.criterion}. Evidence support and human review remain separate.`);break;
    }
    case 'edit_claim':{
      const c=targetClaims(s,action.target)?.find(c=>c.id===action.claimId);if(!c||c.locked||c.text===action.text)break;
      if(action.target==='composition')retainComposition(s);
      c.history.unshift({text:c.text,revision:c.revision,author:s.profile.fullName||'Applicant',at:now(),supportStatus:c.supportStatus,reviewStatus:c.reviewStatus});c.text=action.text;c.revision++;c.supportStatus='needs_review';c.reviewStatus='unreviewed';bumpTarget(s,action.target);activity(s,'Draft text revised','Evidence support and human review were reset for the changed claim.');break;
    }
    case 'undo_claim':{
      const c=targetClaims(s,action.target)?.find(c=>c.id===action.claimId);if(!c||c.locked||!c.history.length)break;
      if(action.target==='composition')retainComposition(s);
      const prior=c.history[0];c.history.unshift({text:c.text,revision:c.revision,author:s.profile.fullName||'Applicant',at:now(),supportStatus:c.supportStatus,reviewStatus:c.reviewStatus});c.text=prior.text;c.revision++;c.supportStatus='needs_review';c.reviewStatus='unreviewed';bumpTarget(s,action.target);break;
    }
    case 'lock_claim':{const c=targetClaims(s,action.target)?.find(c=>c.id===action.claimId);if(c)c.locked=action.locked;break;}
    case 'review_claim':{
      const c=targetClaims(s,action.target)?.find(c=>c.id===action.claimId);if(!c)break;
      const stale=action.target==='composition'?s.composition?.stale:s.runs[action.target]?.result?.stale;
      if(stale)break;
      if(action.supportStatus==='supported'&&!targetCitationsCurrent(s,c,action.target))break;
      const changedSupport=action.supportStatus!==undefined&&action.supportStatus!==c.supportStatus;
      const changedReview=action.reviewStatus!==undefined&&action.reviewStatus!=='attorney_reviewed'&&action.reviewStatus!==c.reviewStatus;
      if(!changedSupport&&!changedReview)break;
      if(action.target!=='composition'){
        const run=s.runs[action.target];
        if(run?.result)run.history.unshift(structuredClone(run.result));
      }else retainComposition(s);
      if(action.supportStatus)c.supportStatus=action.supportStatus;
      if(action.reviewStatus&&action.reviewStatus!=='attorney_reviewed')c.reviewStatus=action.reviewStatus;
      bumpTarget(s,action.target);
      activity(s,'Claim review recorded',`Support: ${c.supportStatus}; human review: ${c.reviewStatus}.`);break;
    }
    case 'manual_section':{
      if(!s.criteria.includes(action.criterion)||!action.text.trim())break;
      const r=s.runs[action.criterion]??emptyRun(action.criterion);s.runs[action.criterion]=r;
      const prior=r.result;if(prior)r.history.unshift(structuredClone(prior));
      const locked=prior?.claims.filter(c=>c.locked).map(c=>structuredClone(c))||[];
      const claim:Claim={id:uid(`claim-${action.criterion}`),text:action.text.trim(),citations:[],supportStatus:'evidence_missing',reviewStatus:'unreviewed',locked:false,revision:1,history:[]};
      r.generation++;r.status='succeeded';r.stage='Manual section prepared';r.error=undefined;
      r.result={id:uid(`result-${action.criterion}`),criterion:action.criterion,revision:(prior?.revision||0)+1,sourceVersions:prior?.sourceVersions||[],claims:[...locked,claim],stale:false,createdAt:now(),moduleVersion:'manual-1.0',ruleVersion:'not-assessed'};
      invalidateComposition(s,[action.criterion]);
      activity(s,'Manual section prepared',`${action.criterion}. The new claim needs documentary evidence and review.`);break;
    }
    case 'compose':{
      const selected=[...new Set(action.criteria)].filter(c=>s.criteria.includes(c)&&s.runs[c]?.result&&!s.runs[c].result!.stale&&s.runs[c].status==='succeeded');
      if(!selected.length)break;
      const results=selected.map(c=>s.runs[c].result!);
      retainComposition(s);
      s.composition={id:uid('composition'),version:(s.composition?.version||0)+1,selected:results.map(r=>({criterion:r.criterion,resultId:r.id,revision:r.revision})),claims:results.flatMap(r=>r.claims.map(c=>({...structuredClone(c),id:`${r.criterion}-${c.id}`}))),stale:false,createdAt:now()};
      activity(s,'Working draft assembled',`Composition v${s.composition.version} pins ${results.length} result revisions.`);break;
    }
    case 'forms':s.forms={...s.forms,...action.patch};break;
  }
  return s;
}
export function getBlockers(s:CaseState):Blocker[]{
  const out:Blocker[]=[];
  if(s.mode==='sample')out.push({id:'sample',title:'You are viewing a sample case',detail:'Fictional evidence is for exploring the workflow and cannot be used for filing.',page:'overview'});
  if(!s.profile.confirmed)out.push({id:'profile',title:'Confirm your profile',detail:'Identity and contact facts need your confirmation.',page:'profile'});
  if(!s.composition)out.push({id:'composition',title:'Assemble a working draft',detail:'Select current criterion result revisions for the petition.',page:'composition'});
  else{
    if(s.composition.stale||s.composition.selected.some(x=>{const r=s.runs[x.criterion]?.result;return !r||r.stale||r.id!==x.resultId||r.revision!==x.revision||!s.criteria.includes(x.criterion);}))out.push({id:'stale',title:'The composed draft needs an update',detail:'A selected result or dependency changed. Create a new composition.',page:'composition'});
    if(s.composition.claims.some(c=>c.supportStatus!=='supported'||c.reviewStatus==='unreviewed'||!targetCitationsCurrent(s,c,'composition')))out.push({id:'claims',title:'Review material claims',detail:'Every documentary claim needs current source links, evidence support, and human review.',page:'draft'});
    const omitted=s.criteria.filter(c=>!s.composition!.selected.some(x=>x.criterion===c));
    if(omitted.length)out.push({id:'omitted',title:`${omitted.length} selected criteria omitted`,detail:`Working draft gaps: ${omitted.join(', ')}. Review their treatment before finalization.`,page:'composition'});
  }
  if(s.facts.some(f=>f.status==='unresolved'||f.status==='issue'))out.push({id:'facts',title:'Resolve outstanding facts',detail:'Unconfirmed or conflicting facts remain in this case.',page:'facts'});
  if(!s.forms.reviewed)out.push({id:'forms',title:'Review form fields',detail:'Required field information must be reviewed before preparing an official form.',page:'forms'});
  out.push({id:'official-forms',title:'Official form templates are not connected',detail:'This release provides a field worksheet. Current official templates and mappings must be validated before final filing output.',page:'forms'});
  out.push({id:'final-service',title:'Final packet service is not connected',detail:'Download a clearly labeled working draft. Official form assembly, exhibit pagination, and immutable final-package approval are pending integration.',page:'final'});
  return out;
}
