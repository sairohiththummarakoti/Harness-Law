import type { CaseState } from './model';
import { EvidenceRequestError } from './evidence-client.ts';

type DriveErrorPayload = { error?: string; code?: string; needsReauth?: boolean; state?: CaseState; revision?: number };
export class DriveRequestError extends EvidenceRequestError {
  constructor(message: string, status: number, public code?: string, public needsReauth = false, state?: CaseState, revision?: number) {
    super(message, status, state, revision);
  }
}

export async function requestDrive<T>(path: string, accountId: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('X-Harness-Account', accountId);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin', cache: 'no-store', signal: init.signal ?? AbortSignal.timeout(90000) });
  const payload = await response.json().catch(() => ({})) as T & DriveErrorPayload;
  if (!response.ok) throw new DriveRequestError(payload.error || 'Could not complete this request. Please try again.', response.status, payload.code, payload.needsReauth, payload.state, payload.revision);
  return payload;
}

/** Preserve workspace routing while consuming only the provider callback fields. */
export function driveCallback(url: URL): { connectionId: string | null; error: string | null; cleanUrl: string; present: boolean } {
  const next = new URL(url);
  const present = next.searchParams.has('driveConnection') || next.searchParams.has('driveError');
  const candidate = next.searchParams.get('driveConnection');
  const detail = next.searchParams.get('driveError');
  const valid = candidate && /^drv-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate);
  next.searchParams.delete('driveConnection'); next.searchParams.delete('driveError');
  return {
    connectionId: valid ? candidate : null,
    error: detail !== null ? `Drive connection did not finish. ${detail.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 300)}`
      : candidate && !valid ? 'The connection response was invalid. Please connect the drive again.' : null,
    cleanUrl: next.pathname + next.search + next.hash,
    present,
  };
}
