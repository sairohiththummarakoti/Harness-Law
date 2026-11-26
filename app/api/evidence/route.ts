import { matchesExpectedAccount } from '@/lib/account-context';
import { env } from 'cloudflare:workers';
import { getAppUser } from '@/app/auth';
import { database, json, parseCase, readCase, sameOrigin, sanitizeFileSlug, sanitizeSubfolder, userStorageFolder } from '@/lib/api';
import { createS3Store } from '@/lib/integrations/providers';
import { MAX_FILE_BYTES, readLimitedBody, safeFilename, validUploadName } from '@/lib/validation';
import type { Evidence } from '@/lib/model';
export const dynamic='force-dynamic';

export async function POST(request:Request){
  const user=await getAppUser();if(!user)return json({error:'Sign in to upload evidence.',code:'session_expired'},401);
  if(!matchesExpectedAccount(request,user.userId))return json({error:"Your session changed. Sign in to the account used in this tab before continuing.",code:"session_changed"},401);
  if(!sameOrigin(request))return json({error:'This upload request did not originate from this app.'},403);
  if(!request.headers.get('content-type')?.includes('multipart/form-data'))return json({error:'Use the document upload form.'},415);
  const contentLength=Number(request.headers.get('content-length')||0);
  if(contentLength>MAX_FILE_BYTES+65536)return json({error:'Each document must be 20 MB or smaller.'},413);
  try{
    const row=await readCase(user.userId);if(!row)return json({error:'Create and save a case before uploading.'},409);
    const state=parseCase(row);if(!state.consent)return json({error:'Save your processing consent before uploading documents.',code:'consent_required'},403);
    const procEnv=typeof process!=='undefined'?process.env:undefined;
    const s3Bucket=env.HARNESS_S3_BUCKET||procEnv?.HARNESS_S3_BUCKET;
    const s3Region=env.HARNESS_S3_REGION||procEnv?.HARNESS_S3_REGION;
    const s3Key=env.HARNESS_S3_ACCESS_KEY_ID||procEnv?.HARNESS_S3_ACCESS_KEY_ID;
    const s3Secret=env.HARNESS_S3_SECRET_ACCESS_KEY||procEnv?.HARNESS_S3_SECRET_ACCESS_KEY;
    const s3Token=env.HARNESS_S3_SESSION_TOKEN||procEnv?.HARNESS_S3_SESSION_TOKEN;
    const s3Ready=!!(s3Bucket&&s3Region&&s3Key&&s3Secret);
    if(!s3Ready&&!env.BUCKET)return json({error:'Evidence storage is not configured.'},503);
    const body=await readLimitedBody(request,MAX_FILE_BYTES+65536);if(!body)return json({error:'Each document must be 20 MB or smaller.'},413);
    const form=await new Response(body.buffer as ArrayBuffer,{headers:{'Content-Type':request.headers.get('content-type')!}}).formData();const file=form.get('file');
    if(!file||typeof file==='string'||typeof file.arrayBuffer!=='function')return json({error:'Choose one document to upload.'},400);
    if(file.size===0)return json({error:'The document is empty. Choose a file containing evidence.'},422);
    if(file.size>MAX_FILE_BYTES)return json({error:'Each document must be 20 MB or smaller.'},413);
    const name=safeFilename(file.name);if(!validUploadName(name))return json({error:'Supported files: PDF, DOCX, TXT, JPG, and PNG.'},415);
    const id=`upload-${crypto.randomUUID()}`;
    const userFolder=await userStorageFolder(user.userId,user.fullName||user.displayName||user.email);
    const subFolder=sanitizeSubfolder(form.get('folder'));
    const safeFilePart=sanitizeFileSlug(name);
    const key=subFolder?`users/${userFolder}/${subFolder}/${id}-${safeFilePart}`:`users/${userFolder}/${id}-${safeFilePart}`;
    const uploadedAt=new Date().toISOString();
    const document:Evidence={id,objectId:id,name,version:1,status:'needs_attention',language:'Not extracted',pages:0,bytes:file.size,kind:name.split('.').pop()!.toUpperCase(),excerpt:'',associations:[],exhibit:'',uploadedAt,sample:false,issue:'Stored in quarantine. Safety scanning and text extraction are not connected yet; preview and criterion processing are unavailable.',previousVersions:[]};
    const fileBytes=new Uint8Array(await file.arrayBuffer());
    let s3Version:string|undefined;
    if(s3Ready){
      const s3=createS3Store({bucket:s3Bucket!,region:s3Region!,accessKeyId:s3Key!,secretAccessKey:s3Secret!,sessionToken:s3Token,requireVersionId:true});
      const stored=await s3.put(key,fileBytes,'application/octet-stream');
      s3Version=stored.version;
    }else{
      await env.BUCKET!.put(key,fileBytes,{httpMetadata:{contentType:'application/octet-stream'},customMetadata:{owner:userFolder,caseId:state.id,status:'quarantine'}});
    }
    try{await database().prepare('INSERT INTO evidence_objects (id, owner_id, case_id, object_key, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id,user.userId,state.id,key,JSON.stringify(document),uploadedAt).run();}
    catch{if(s3Ready){const s3=createS3Store({bucket:s3Bucket!,region:s3Region!,accessKeyId:s3Key!,secretAccessKey:s3Secret!,sessionToken:s3Token,requireVersionId:true});await s3.delete(key,s3Version).catch(()=>{});}else{await env.BUCKET!.delete(key);}throw new Error('Upload metadata could not be saved.');}
    return json({document},201);
  }catch{return json({error:'The upload could not be completed. Retry this file; other documents are unchanged.',code:'upload_failed'},503);}
}
