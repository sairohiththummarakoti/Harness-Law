import type { CaseState } from '../model.ts';
import type { DriveProvider } from './config.ts';

export interface DriveConnection {
  id: string; owner_id: string; provider: DriveProvider; display_name: string; scope: 'folder' | 'whole_drive'; root_id: string; root_name: string; drive_id: string | null;
  account_id: string; account_label: string; token_ciphertext: string; token_expires_at: number; status: 'pending' | 'connected' | 'reconnect_required';
  case_id: string | null; evidence_folder_id: string | null; created_at: number; updated_at: number;
}
export interface DriveAuthorization { state_hash: string; owner_id: string; provider: DriveProvider; browser_hash: string; verifier_ciphertext: string; return_to: string; expires_at: number }
export interface DriveRepository {
  list(owner: string): Promise<DriveConnection[]>;
  get(owner: string, id: string): Promise<DriveConnection | null>;
  insert(connection: DriveConnection): Promise<void>;
  delete(owner: string, id: string): Promise<boolean>;
  updateToken(connection: DriveConnection, ciphertext: string, expiresAt: number): Promise<void>;
  markReconnect(owner: string, id: string, expectedCiphertext?: string): Promise<void>;
  authorizationStart(value: DriveAuthorization): Promise<boolean>;
  authorizationTake(stateHash: string, owner: string, browserHash: string, now: number): Promise<DriveAuthorization | null>;
  caseRead(owner: string): Promise<CaseState | null>;
  saveConnectionCase(previous: DriveConnection, next: DriveConnection, state: CaseState, expectedRevision: number): Promise<boolean>;
}
export function publicConnection(row: DriveConnection, now = Math.floor(Date.now() / 1000)) {
  return { id: row.id, provider: row.provider, displayName: row.display_name, scope: row.scope, rootId: row.root_id, rootName: row.root_name, accountLabel: row.account_label,
    status: row.status === 'pending' && now - row.created_at > 1800 ? 'reconnect_required' : row.status, caseId: row.case_id, evidenceFolderId: row.evidence_folder_id, createdAt: row.created_at, updatedAt: row.updated_at };
}
export function createDriveRepository(db: D1Database): DriveRepository {
  return {
    async list(owner) { return (await db.prepare('SELECT * FROM cloud_drive_connections WHERE owner_id=? ORDER BY created_at DESC').bind(owner).all<DriveConnection>()).results; },
    get(owner, id) { return db.prepare('SELECT * FROM cloud_drive_connections WHERE owner_id=? AND id=?').bind(owner, id).first<DriveConnection>(); },
    async insert(row) { await db.prepare('INSERT INTO cloud_drive_connections (id,owner_id,provider,display_name,scope,root_id,root_name,drive_id,account_id,account_label,token_ciphertext,token_expires_at,status,case_id,evidence_folder_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(row.id,row.owner_id,row.provider,row.display_name,row.scope,row.root_id,row.root_name,row.drive_id,row.account_id,row.account_label,row.token_ciphertext,row.token_expires_at,row.status,row.case_id,row.evidence_folder_id,row.created_at,row.updated_at).run(); },
    async delete(owner, id) { return !!(await db.prepare('DELETE FROM cloud_drive_connections WHERE owner_id=? AND id=?').bind(owner,id).run()).meta.changes; },
    async updateToken(row, ciphertext, expiresAt) { await db.prepare('UPDATE cloud_drive_connections SET token_ciphertext=?,token_expires_at=?,updated_at=? WHERE owner_id=? AND id=? AND token_ciphertext=?').bind(ciphertext,expiresAt,Math.floor(Date.now()/1000),row.owner_id,row.id,row.token_ciphertext).run(); },
    async markReconnect(owner,id,expectedCiphertext) { await db.prepare("UPDATE cloud_drive_connections SET status='reconnect_required',updated_at=? WHERE owner_id=? AND id=? AND (? IS NULL OR token_ciphertext=?)").bind(Math.floor(Date.now()/1000),owner,id,expectedCiphertext??null,expectedCiphertext??null).run(); },
    async authorizationStart(row) {
      await db.prepare('DELETE FROM cloud_drive_authorizations WHERE expires_at<=?').bind(Math.floor(Date.now()/1000)).run();
      const saved = await db.prepare('INSERT INTO cloud_drive_authorizations (state_hash,owner_id,provider,browser_hash,verifier_ciphertext,return_to,expires_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT count(*) FROM cloud_drive_authorizations WHERE owner_id=?)<5').bind(row.state_hash,row.owner_id,row.provider,row.browser_hash,row.verifier_ciphertext,row.return_to,row.expires_at,row.owner_id).run();
      return !!saved.meta.changes;
    },
    authorizationTake(hash,owner,browserHash,now) { return db.prepare('DELETE FROM cloud_drive_authorizations WHERE state_hash=? AND owner_id=? AND browser_hash=? AND expires_at>? RETURNING *').bind(hash,owner,browserHash,now).first<DriveAuthorization>(); },
    async caseRead(owner) { const row=await db.prepare('SELECT state_json, revision FROM cases WHERE owner_id=?').bind(owner).first<{state_json:string;revision:number}>(); return row ? { ...JSON.parse(row.state_json), revision:row.revision } as CaseState : null; },
    async saveConnectionCase(previous,next,state,expectedRevision) {
      const serialized=JSON.stringify(state);
      const results=await db.batch([
        db.prepare('UPDATE cases SET state_json=?,revision=?,updated_at=? WHERE owner_id=? AND case_id=? AND revision=? AND EXISTS (SELECT 1 FROM cloud_drive_connections WHERE owner_id=? AND id=? AND status=? AND updated_at=?)').bind(serialized,state.revision,state.updatedAt,previous.owner_id,state.id,expectedRevision,previous.owner_id,previous.id,previous.status,previous.updated_at),
        db.prepare('UPDATE cloud_drive_connections SET display_name=?,scope=?,root_id=?,root_name=?,drive_id=?,status=?,case_id=?,evidence_folder_id=?,updated_at=? WHERE owner_id=? AND id=? AND EXISTS (SELECT 1 FROM cases WHERE owner_id=? AND case_id=? AND revision=? AND state_json=?)').bind(next.display_name,next.scope,next.root_id,next.root_name,next.drive_id,next.status,next.case_id,next.evidence_folder_id,next.updated_at,previous.owner_id,previous.id,previous.owner_id,state.id,state.revision,serialized),
      ]);
      return results[0].meta.changes === 1 && results[1].meta.changes === 1;
    },
  };
}
