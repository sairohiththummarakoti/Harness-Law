import type { CaseState, Evidence } from './model';

export class EvidenceRequestError extends Error {
  constructor(message: string, public status: number, public state?: CaseState, public revision?: number) { super(message); }
}

const uploadIds = new WeakMap<File, Map<string, string>>();
export function uploadIdentity(file: File, scope: string): string {
  let identities = uploadIds.get(file);
  if (!identities) { identities = new Map(); uploadIds.set(file, identities); }
  let id = identities.get(scope);
  if (!id) { id = crypto.randomUUID(); identities.set(scope, id); }
  return id;
}

/** The server retains and attaches the file before this promise succeeds. */
export async function uploadEvidenceFile(file: File, accountId: string, state: CaseState, folderId: string | null = null, replacementSourceId: string | null = null): Promise<{ document: Evidence; state: CaseState; revision: number; replayed: boolean }> {
  const body = new FormData();
  body.append('file', file);
  body.append('caseId', state.id);
  body.append('expectedRevision', String(state.revision));
  body.append('uploadId', uploadIdentity(file, `${accountId}:${state.id}:${replacementSourceId ?? ''}`));
  if (folderId) body.append('folderId', folderId);
  if (replacementSourceId) body.append('replacementSourceId', replacementSourceId);
  // Canceling local parsing cannot undo a storage commit. Always settle retention.
  const response = await fetch('/api/evidence', { method: 'POST', body, credentials: 'same-origin', headers: { 'X-Harness-Account': accountId }, signal: AbortSignal.timeout(90000) });
  let data: { error?: string; document?: Evidence; state?: CaseState; revision?: number } = {};
  try { data = await response.json(); } catch { /* Preserve auth/HTTP status. */ }
  if (!response.ok || !data.document || !data.state || data.revision === undefined) {
    throw new EvidenceRequestError(data.error || (response.status === 401 ? 'Your session changed or expired. Sign in to the same account again.' : 'The file could not be saved. Retry the same file to check its upload.'), response.status, data.state, data.revision);
  }
  return { document: data.document, state: data.state, revision: data.revision, replayed: response.status === 200 };
}

export async function readEvidenceFile(document: Evidence, accountId: string | null, caseId: string, signal?: AbortSignal): Promise<File> {
  if (signal?.aborted) throw new DOMException('Canceled', 'AbortError');
  if (document.sample) return new File([document.excerpt], document.name.replace(/\.[^.]+$/, '') + '.txt', { type: 'text/plain' });
  if (!accountId || !document.objectId) throw new Error('Sign in to your personal case to use this file.');
  const query = new URLSearchParams({ caseId, objectId: document.objectId });
  const response = await fetch(`/api/evidence?${query}`, { credentials: 'same-origin', cache: 'no-store', headers: { 'X-Harness-Account': accountId }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
  if (!response.ok) {
    let message = response.status === 401 ? 'Your session changed or expired. Sign in to the same account again.' : 'This file could not be opened. Refresh your case and try again.';
    try { const data = await response.json() as { error?: unknown }; if (typeof data.error === 'string') message = data.error; } catch { /* Preserve safe fallback. */ }
    throw new EvidenceRequestError(message, response.status);
  }
  const blob = await response.blob();
  if (blob.size > 20 * 1024 * 1024 || blob.size !== document.bytes) throw new Error('The saved file size did not match its record. Please try again.');
  return new File([blob], document.name, { type: 'application/octet-stream' });
}
