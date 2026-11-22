import { z } from 'zod';
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
export const evidenceSchema=z.object({id,name:short,version:revision,status:processing,language:short,pages:z.number().int().min(0).max(10000),bytes:z.number().int().min(0).max(20*1024*1024),kind:short,excerpt:text,associations:z.array(z.object({criterion,status:z.enum(['proposed','confirmed','removed']),actor:short,revision}).strict()).max(10),exhibit:short,uploadedAt:timestamp,sample:z.boolean(),objectId:id.optional(),issue:short.optional(),previousVersions:z.array(z.object({version:revision,name:short,excerpt:text,status:processing,at:timestamp}).strict()).max(100).optional()}).strict();
export const caseSchema=z.object({
  id,name:short,mode:z.enum(['sample','personal']),revision,
  profile:z.object({fullName:short,preferredName:short,email:short,phone:short,country:short,address:text,priorNames:text,confirmed:z.boolean()}).strict(),
  professional:z.object({field:short,role:short,organization:short,timeline:text,achievements:text,intendedWork:text}).strict(),
  criteria:z.array(criterion).max(10),documents:z.array(evidenceSchema).max(200),
  facts:z.array(z.object({id,label:short,value:text,originalValue:text,sourceId:id,page:z.number().int().min(1).max(10000),status:z.enum(['unresolved','confirmed','corrected','issue']),reason:text}).strict()).max(1000),
  runs:z.record(criterion,z.object({criterion,generation:revision,status:z.enum(['idle','queued','running','succeeded','failed','canceled']),stage:short,error:text.optional(),questions:z.array(text).max(100),result:result.nullable(),history:z.array(result).max(100)}).strict()),
  composition:composition.nullable(),compositionHistory:z.array(composition).max(500).optional(),
  forms:z.object({fullName:short,address:text,country:short,intendedWork:text,reviewed:z.boolean(),templateStatus:z.enum(['unverified','current'])}).strict(),
  activities:z.array(z.object({id,title:short,detail:text,at:timestamp}).strict()).max(100),consent:z.boolean(),lastPage:short,updatedAt:timestamp,
}).strict();
export const saveSchema=z.object({state:caseSchema,expectedRevision:revision}).strict();
export const MAX_CASE_BODY=1024*1024;
export const MAX_FILE_BYTES=20*1024*1024;
export function validUploadName(name:string):boolean{return /\.(pdf|docx|txt|jpe?g|png)$/i.test(name)&&name.length>0&&name.length<=250&&!/[\x00-\x1F]/.test(name);}
export function safeFilename(name:string):string{return name.replace(/^.*[\\/]/,'').replace(/[\x00-\x1F]/g,'').slice(0,250);}
export async function readLimitedBody(request:Request,limit:number):Promise<Uint8Array|null>{
  if(!request.body)return new Uint8Array();
  const reader=request.body.getReader();const parts:Uint8Array[]=[];let length=0;
  try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>limit){await reader.cancel();return null;}parts.push(part.value);}}
  finally{reader.releaseLock();}
  const result=new Uint8Array(length);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.byteLength;}return result;
}
