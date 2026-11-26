import { env } from 'cloudflare:workers';
import type { CaseState, Evidence } from './model';
import { createEmptyCase, createSampleCase } from './model';

export function json(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
export function database(){if(!env.DB)throw new Error('Case storage is not configured.');return env.DB;}
export interface CaseRow {owner_id:string;case_id:string;revision:number;state_json:string;updated_at:string}
export async function readCase(ownerId:string):Promise<CaseRow|null>{return await database().prepare('SELECT owner_id, case_id, revision, state_json, updated_at FROM cases WHERE owner_id = ?').bind(ownerId).first<CaseRow>();}
export function parseCase(row:CaseRow):CaseState {const state=JSON.parse(row.state_json) as CaseState;state.revision=row.revision;return state;}
export async function initialCase(ownerId:string):Promise<CaseState>{
  const state=createEmptyCase();
  await database().prepare('INSERT OR IGNORE INTO cases (owner_id, case_id, revision, state_json, updated_at) VALUES (?, ?, ?, ?, ?)').bind(ownerId,state.id,0,JSON.stringify(state),state.updatedAt).run();
  const row=await readCase(ownerId);if(!row)throw new Error('Case could not be initialized.');return parseCase(row);
}
export function sameOrigin(request:Request):boolean {
  const origin=request.headers.get('origin');
  if(!origin)return false;
  try{return new URL(origin).origin===new URL(request.url).origin;}catch{return false;}
}

export async function userStorageFolder(userId: string, displayName?: string | null): Promise<string> {
  const rawName = (displayName || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'user';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId));
  const shortHash = Array.from(new Uint8Array(digest)).slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${rawName}-${shortHash}`;
}

export function sanitizeSubfolder(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .split(/[/\\]+/)
    .map(part => part.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(part => part && part !== '.' && part !== '..')
    .join('/')
    .slice(0, 120);
}

export function sanitizeFileSlug(filename: string): string {
  return filename.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100) || 'document';
}
export async function validateEvidenceOwnership(ownerId:string,state:CaseState):Promise<string|null>{
  const ids=new Set<string>();
  const samples=createSampleCase().documents;
  for(const doc of state.documents){
    if(ids.has(doc.id))return 'Duplicate source identities are not allowed.';ids.add(doc.id);
    if(doc.sample){
      const sample=samples.find(d=>d.id===doc.id);
      if(state.mode!=='sample'||doc.objectId||!sample||sample.excerpt!==doc.excerpt)return 'Sample evidence can only appear in the fictional sample case.';
      continue;
    }
    if(!doc.objectId)return 'Uploaded evidence must have a registered object identity.';
    const row=await database().prepare('SELECT metadata_json FROM evidence_objects WHERE id = ? AND owner_id = ? AND case_id = ? AND deleted_at IS NULL').bind(doc.objectId,ownerId,state.id).first<{metadata_json:string}>();
    if(!row)return 'An evidence object does not belong to this case.';
    const saved=JSON.parse(row.metadata_json) as Evidence;
    const keys=(['name','status','language','pages','bytes','kind','excerpt','uploadedAt','sample','objectId','issue'] as const);
    if(keys.some(k=>doc[k]!==saved[k]))return 'Upload processing metadata cannot be edited before server processing.';
    if(doc.previousVersions?.some(v=>v.excerpt||v.status==='ready'))return 'Quarantined evidence cannot contain processed source history.';
  }
  if(state.mode==='personal'){
    const outputs=Object.values(state.runs).flatMap(r=>[...(r.result?[r.result]:[]),...r.history]);
    if(outputs.some(r=>r.moduleVersion.startsWith('sample')))return 'Sample result bundles cannot be used in a personal case.';
    if(state.forms.templateStatus==='current')return 'Official form template validation is not connected yet.';
    const allClaims=[...outputs.flatMap(r=>r.claims),...(state.composition?.claims||[]),...(state.compositionHistory||[]).flatMap(c=>c.claims)];
    if(allClaims.some(c=>c.reviewStatus==='attorney_reviewed'||c.history.some(h=>h.reviewStatus==='attorney_reviewed')))return 'Attorney review requires an authorized engagement.';
  }
  return null;
}
