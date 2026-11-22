import { matchesExpectedAccount } from '@/lib/account-context';
import { env } from 'cloudflare:workers';
import { getAppUser } from '@/app/auth';
import { database, json, parseCase, readCase, sameOrigin } from '@/lib/api';
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
    if(!env.BUCKET)return json({error:'Evidence storage is not configured.'},503);
    const body=await readLimitedBody(request,MAX_FILE_BYTES+65536);if(!body)return json({error:'Each document must be 20 MB or smaller.'},413);
    const form=await new Response(body.buffer as ArrayBuffer,{headers:{'Content-Type':request.headers.get('content-type')!}}).formData();const file=form.get('file');
    if(!file||typeof file==='string'||typeof file.arrayBuffer!=='function')return json({error:'Choose one document to upload.'},400);
    if(file.size===0)return json({error:'The document is empty. Choose a file containing evidence.'},422);
    if(file.size>MAX_FILE_BYTES)return json({error:'Each document must be 20 MB or smaller.'},413);
    const name=safeFilename(file.name);if(!validUploadName(name))return json({error:'Supported files: PDF, DOCX, TXT, JPG, and PNG.'},415);
    const id=`upload-${crypto.randomUUID()}`;
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(user.userId));
    const owner=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
    const key=`quarantine/${owner}/${id}`;
    const uploadedAt=new Date().toISOString();
    const document:Evidence={id,objectId:id,name,version:1,status:'needs_attention',language:'Not extracted',pages:0,bytes:file.size,kind:name.split('.').pop()!.toUpperCase(),excerpt:'',associations:[],exhibit:'',uploadedAt,sample:false,issue:'Stored in quarantine. Safety scanning and text extraction are not connected yet; preview and criterion processing are unavailable.',previousVersions:[]};
    await env.BUCKET.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:'application/octet-stream'},customMetadata:{owner,caseId:state.id,status:'quarantine'}});
    try{await database().prepare('INSERT INTO evidence_objects (id, owner_id, case_id, object_key, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id,user.userId,state.id,key,JSON.stringify(document),uploadedAt).run();}
    catch{await env.BUCKET.delete(key);throw new Error('Upload metadata could not be saved.');}
    return json({document},201);
  }catch{return json({error:'The upload could not be completed. Retry this file; other documents are unchanged.',code:'upload_failed'},503);}
}
