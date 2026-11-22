import { getChatGPTUser } from '@/app/chatgpt-auth';
import { database, initialCase, json, parseCase, readCase, sameOrigin, validateEvidenceOwnership } from '@/lib/api';
import { MAX_CASE_BODY, readLimitedBody, saveSchema } from '@/lib/validation';
import type { CaseState } from '@/lib/model';
export const dynamic='force-dynamic';

export async function GET(){
  const user=await getChatGPTUser();if(!user)return json({error:'Sign in to open your saved case.',code:'session_expired'},401);
  try{const row=await readCase(user.userId);const state=row?parseCase(row):await initialCase(user.userId);return json({state,revision:state.revision});}
  catch{return json({error:'Case storage is temporarily unavailable. Your unsaved changes have not been marked saved.',code:'storage_unavailable'},503);}
}
export async function PUT(request:Request){
  const user=await getChatGPTUser();if(!user)return json({error:'Sign in again to save your changes.',code:'session_expired'},401);
  if(!sameOrigin(request))return json({error:'This save request did not originate from this app.'},403);
  if(!request.headers.get('content-type')?.includes('application/json'))return json({error:'Send case updates as JSON.'},415);
  const length=Number(request.headers.get('content-length')||0);if(length>MAX_CASE_BODY)return json({error:'This case is too large to save in one request.'},413);
  try{
    const bytes=await readLimitedBody(request,MAX_CASE_BODY);if(!bytes)return json({error:'This case is too large to save in one request.'},413);
    const body=new TextDecoder().decode(bytes);
    let decoded:unknown;try{decoded=JSON.parse(body);}catch{return json({error:'The case update contains invalid JSON.'},400);}
    const parsed=saveSchema.safeParse(decoded);if(!parsed.success)return json({error:'The case update has an invalid structure.',code:'invalid_state'},422);
    const {expectedRevision}=parsed.data;const state=parsed.data.state as CaseState;
    const previous=await readCase(user.userId);
    if(previous&&previous.revision!==expectedRevision)return json({error:'This case changed in another session. Compare your changes before saving again.',code:'revision_conflict',state:parseCase(previous),revision:previous.revision},409);
    if(!previous&&expectedRevision!==0)return json({error:'The saved case revision is unavailable. Reload before saving.',code:'revision_conflict'},409);
    if(state.revision!==expectedRevision)return json({error:'The case revision does not match the expected revision.',code:'invalid_revision'},422);
    const evidenceError=await validateEvidenceOwnership(user.userId,state);if(evidenceError)return json({error:evidenceError,code:'invalid_evidence'},422);
    state.revision=expectedRevision+1;state.updatedAt=new Date().toISOString();
    if(previous){
      const changed=await database().prepare('UPDATE cases SET case_id = ?, revision = ?, state_json = ?, updated_at = ? WHERE owner_id = ? AND revision = ?').bind(state.id,state.revision,JSON.stringify(state),state.updatedAt,user.userId,expectedRevision).run();
      if(changed.meta.changes!==1){const latest=await readCase(user.userId);return json({error:'A newer case revision was saved. Your local changes are preserved.',code:'revision_conflict',state:latest?parseCase(latest):undefined,revision:latest?.revision},409);}
    }else{
      const inserted=await database().prepare('INSERT OR IGNORE INTO cases (owner_id, case_id, revision, state_json, updated_at) VALUES (?, ?, ?, ?, ?)').bind(user.userId,state.id,state.revision,JSON.stringify(state),state.updatedAt).run();
      if(inserted.meta.changes!==1){const latest=await readCase(user.userId);return json({error:'A case was saved in another session. Compare changes before retrying.',code:'revision_conflict',state:latest?parseCase(latest):undefined,revision:latest?.revision},409);}
    }
    return json({state,revision:state.revision});
  }catch{return json({error:'The case could not be saved. Keep this page open and retry.',code:'save_failed'},503);}
}
