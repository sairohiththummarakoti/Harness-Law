import { z } from 'zod';
import { folderIntegrityError, MAX_EVIDENCE_FOLDERS, MAX_FOLDER_NAME } from './evidence-folders.ts';
import { getIntakeSteps, intakeCompletionError, intakeStepError } from './intake.ts';
import { VISA_IDS, type VisaType } from './intake-catalog.ts';
import { isBirthCountryCode, isCitizenshipCode } from './countries.ts';
const short=z.string().max(500);
const text=z.string().max(50000);
const id=z.string().min(1).max(150);
const criterion=z.enum(['C01','C02','C03','C04','C05','C06','C07','C08','C09','C10']);
const revision=z.number().int().min(0).max(2147483647);
const timestamp=z.string().datetime();
const support=z.enum(['unassessed','supported','needs_review','conflicting','evidence_missing']);
const review=z.enum(['unreviewed','applicant_reviewed','attorney_reviewed']);
const processing=z.enum(['ready','needs_attention','rejected']);
const citation=z.object({sourceId:id,sourceVersion:revision,page:z.number().int().min(1).max(10000),quote:text}).strict();
const claim=z.object({id,text,citations:z.array(citation).max(30),supportStatus:support,reviewStatus:review,locked:z.boolean(),revision,history:z.array(z.object({text,revision,author:short,at:timestamp,supportStatus:support.optional(),reviewStatus:review.optional()}).strict()).max(500)}).strict();
const result=z.object({id,criterion,revision,sourceVersions:z.array(z.object({id,version:revision}).strict()).max(200),claims:z.array(claim).max(100),stale:z.boolean(),createdAt:timestamp,moduleVersion:short,ruleVersion:short}).strict();
const composition=z.object({id,version:revision,selected:z.array(z.object({criterion,resultId:id,revision}).strict()).max(10),claims:z.array(claim).max(1000),stale:z.boolean(),createdAt:timestamp}).strict();
const onboarding=z.object({version:z.literal(1),step:z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4)]),goal:z.enum(['evidence','narrative','review']).optional(),completedAt:timestamp.optional()}).strict().superRefine((value,context)=>{
  if(value.step>=3&&!value.goal)context.addIssue({code:z.ZodIssueCode.custom,message:'A preparation goal is required after step two.'});
  if((value.step===4)!==!!value.completedAt)context.addIssue({code:z.ZodIssueCode.custom,message:'Only completed setup has a completion timestamp.'});
});
export const intakeSchema=z.object({
  version:z.literal(1),step:z.enum(['basics','visa','birth','citizenships','background','criteria','review']),
  answers:z.object({
    fullName:short,phone:z.string().max(100),helpFor:z.enum(['','myself','employees']),
    visaType:z.union([z.literal(''),z.enum(VISA_IDS as [VisaType,...VisaType[]])]),
    birthCountry:z.string().refine(value=>value===''||isBirthCountryCode(value),'Choose a valid country of birth.'),
    birthCountryOther:z.string().max(200),
    citizenships:z.array(z.string().refine(isCitizenshipCode,'Choose a valid citizenship.')).max(20),
    field:short,role:short,criteria:z.array(criterion).max(10),criteriaUnsure:z.boolean(),
    majorAward:z.enum(['','yes','no','unsure']),notes:z.string().max(3000),
  }).strict(),completedAt:timestamp.optional(),firstCompletedAt:timestamp.optional(),
}).strict().superRefine((value,context)=>{
  const issue=(message:string)=>context.addIssue({code:z.ZodIssueCode.custom,message});
  const answers=value.answers;
  if(new Set(answers.citizenships).size!==answers.citizenships.length)issue('Each citizenship can be selected only once.');
  if(answers.citizenships.includes('STATELESS')&&answers.citizenships.length>1)issue('Stateless cannot be combined with a citizenship.');
  if(new Set(answers.criteria).size!==answers.criteria.length)issue('Each criterion can be selected only once.');
  if(answers.criteriaUnsure&&answers.criteria.length)issue('Choose criteria or indicate that you are not sure yet.');
  if(answers.visaType!=='eb1a'&&(answers.criteria.length||answers.criteriaUnsure||answers.majorAward))issue('EB-1A experience answers require an EB-1A intake.');
  if(answers.birthCountry!=='OTHER'&&answers.birthCountryOther)issue('The additional country name is only used for another or historical place of birth.');
  const steps=getIntakeSteps(answers.visaType),index=steps.indexOf(value.step);
  if(index<0)issue('This intake step is not available for the selected visa.');
  else for(const step of steps.slice(0,index)){const error=intakeStepError(answers,step);if(error){issue(error);break;}}
  if(value.completedAt){
    if(value.step!=='review')issue('Completed intake must be on the review step.');
    const error=intakeCompletionError(answers);if(error)issue(error);
  }
});
export const evidenceSchema=z.object({id,folderId:id.nullable().optional(),name:short,version:revision,status:processing,language:short,pages:z.number().int().min(0).max(10000),bytes:z.number().int().min(0).max(20*1024*1024),kind:short,excerpt:text,associations:z.array(z.object({criterion,status:z.enum(['proposed','confirmed','removed']),actor:short,revision}).strict()).max(10),exhibit:short,uploadedAt:timestamp,sample:z.boolean(),objectId:id.optional(),issue:short.optional(),previousVersions:z.array(z.object({version:revision,name:short,excerpt:text,status:processing,at:timestamp}).strict()).max(100).optional()}).strict();
export const caseSchema=z.object({
  id,name:short,mode:z.enum(['sample','personal']),revision,
  profile:z.object({fullName:short,preferredName:short,email:short,phone:short,country:short,address:text,priorNames:text,confirmed:z.boolean()}).strict(),
  professional:z.object({field:short,role:short,organization:short,timeline:text,achievements:text,intendedWork:text}).strict(),
  criteria:z.array(criterion).max(10),documents:z.array(evidenceSchema).max(200),folders:z.array(z.object({id,name:z.string().min(1).max(MAX_FOLDER_NAME),parentId:id.nullable(),origin:z.enum(['upload','external']).optional(),connectionId:id.optional()}).strict()).max(MAX_EVIDENCE_FOLDERS).optional(),
  facts:z.array(z.object({id,label:short,value:text,originalValue:text,sourceId:id,page:z.number().int().min(1).max(10000),status:z.enum(['unresolved','confirmed','corrected','issue']),reason:text}).strict()).max(1000),
  runs:z.record(criterion,z.object({criterion,generation:revision,status:z.enum(['idle','queued','running','succeeded','failed','canceled']),stage:short,error:text.optional(),questions:z.array(text).max(100),result:result.nullable(),history:z.array(result).max(100)}).strict()),
  composition:composition.nullable(),compositionHistory:z.array(composition).max(500).optional(),
  forms:z.object({fullName:short,address:text,country:short,intendedWork:text,reviewed:z.boolean(),templateStatus:z.enum(['unverified','current'])}).strict(),
  activities:z.array(z.object({id,title:short,detail:text,at:timestamp}).strict()).max(100),consent:z.boolean(),lastPage:short,updatedAt:timestamp,
  onboarding:onboarding.optional(),intake:intakeSchema.optional(),
}).strict().superRefine((value,context)=>{
  const error=folderIntegrityError(value);if(error)context.addIssue({code:z.ZodIssueCode.custom,message:error,path:['folders']});
});
export const saveSchema=z.object({state:caseSchema,expectedRevision:revision}).strict();
export const MAX_CASE_BODY=1024*1024;
export const MAX_FILE_BYTES=20*1024*1024;
export function validUploadName(name:string):boolean{return /\.(pdf|docx|txt|md|markdown|csv|json|jpe?g|png)$/i.test(name)&&name.length>0&&name.length<=250&&!/[\x00-\x1F]/.test(name);}
export function safeFilename(name:string):string{return name.replace(/^.*[\\/]/,'').replace(/[\x00-\x1F]/g,'').slice(0,250);}
export async function readLimitedBody(request:Request,limit:number):Promise<Uint8Array|null>{
  if(!request.body)return new Uint8Array();
  const reader=request.body.getReader();const parts:Uint8Array[]=[];let length=0;
  try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>limit){await reader.cancel();return null;}parts.push(part.value);}}
  finally{reader.releaseLock();}
  const result=new Uint8Array(length);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.byteLength;}return result;
}
