import type { AppUser } from '../identity.ts';
import { matchesExpectedAccount } from '../account-context.ts';
import { isSameOrigin } from '../auth/runtime.ts';
import { getAdminAccess, type AdminDatabase, type AdminPrincipalRow, type AdminRole } from './access.ts';

export interface AdminMember {
  userId: string;
  email: string;
  displayName: string;
  provider: AppUser['provider'];
  role: AdminRole;
  createdAt: number;
}
export interface AdminAuditEntry { id: string; action: 'grant' | 'revoke'; actorEmail: string; targetEmail: string; createdAt: number }
export interface AdminMembersData { members: AdminMember[]; audit: AdminAuditEntry[] }
export interface AdminMembersDependencies {
  db: AdminDatabase;
  getUser: () => Promise<AppUser | null>;
  ownerEmail: unknown;
  now?: () => number;
}

export function adminJson(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin', 'Referrer-Policy': 'no-referrer' } });
}

export async function readAdminMembers(db: AdminDatabase): Promise<AdminMembersData> {
  const [owner, members, audit] = await Promise.all([
    db.prepare("SELECT user_id, provider, email, display_name, created_at FROM admin_owner WHERE id = 'owner'").first<AdminPrincipalRow>(),
    db.prepare('SELECT user_id, provider, email, display_name, created_at FROM admin_members ORDER BY created_at ASC LIMIT 100').all<AdminPrincipalRow>(),
    db.prepare('SELECT id, action, actor_email, target_email, created_at FROM admin_audit ORDER BY created_at DESC, id DESC LIMIT 100').all<{ id: string; action: 'grant' | 'revoke'; actor_email: string; target_email: string; created_at: number }>(),
  ]);
  const mapMember = (row: AdminPrincipalRow, role: AdminRole): AdminMember => ({ userId: row.user_id, provider: row.provider, email: row.email, displayName: row.display_name, role, createdAt: row.created_at });
  return {
    members: [...(owner ? [mapMember(owner, 'owner')] : []), ...members.results.map(row => mapMember(row, 'admin'))],
    audit: audit.results.map(row => ({ id: row.id, action: row.action, actorEmail: row.actor_email, targetEmail: row.target_email, createdAt: row.created_at })),
  };
}

async function readMutation(request: Request): Promise<{ action: 'grant' | 'revoke'; userId: string } | Response> {
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return adminJson({ error: 'Send account access changes as JSON.' }, 415);
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 4096)) return adminJson({ error: 'The request is too large.' }, 413);
  if (!request.body) return adminJson({ error: 'An action and user are required.' }, 400);
  const reader = request.body.getReader();
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4096) { await reader.cancel(); return adminJson({ error: 'The request is too large.' }, 413); }
      parts.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== 2 || !('action' in data) || !['grant', 'revoke'].includes(String(data.action)) || !('userId' in data) || typeof data.userId !== 'string' || !data.userId || data.userId.length > 200 || /[\u0000-\u0020\u007f]/.test(data.userId)) return adminJson({ error: 'Choose a valid access action and signed-in user.' }, 400);
    return { action: data.action as 'grant' | 'revoke', userId: data.userId };
  } catch { return adminJson({ error: 'The access change could not be read.' }, 400); }
  finally { reader.releaseLock(); }
}

export async function handleAdminMembersRequest(request: Request, deps: AdminMembersDependencies): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') return adminJson({ error: 'Method not allowed.' }, 405);
  try {
    const user = await deps.getUser();
    if (!user) return adminJson({ error: 'Sign in to continue.', code: 'session_expired' }, 401);
    if (!matchesExpectedAccount(request, user.userId)) return adminJson({ error: 'Your account changed. Reload before continuing.', code: 'session_changed' }, 401);
    const access = await getAdminAccess(deps.db, user, deps.ownerEmail);
    if (access?.role !== 'owner') return adminJson({ error: 'Only the site owner can manage admin access.' }, 403);
    if (request.method === 'GET') return adminJson(await readAdminMembers(deps.db));
    if (!isSameOrigin(request)) return adminJson({ error: 'Submit access changes from this site.' }, 403);
    const mutation = await readMutation(request);
    if (mutation instanceof Response) return mutation;
    const owner = await deps.db.prepare("SELECT user_id FROM admin_owner WHERE id = 'owner'").first<{ user_id: string }>();
    if (mutation.userId === owner?.user_id) return adminJson({ error: 'The owner account cannot be changed or removed here.', code: 'owner_protected' }, 409);
    const now = deps.now?.() ?? Date.now();
    const id = crypto.randomUUID();
    if (mutation.action === 'grant') {
      const target = await deps.db.prepare('SELECT user_id, provider FROM analytics_users WHERE user_id = ?').bind(mutation.userId).first<{ user_id: string; provider: string }>();
      if (!target || !['google', 'chatgpt'].includes(target.provider)) return adminJson({ error: 'Choose an account that has already signed in to this site.' }, 404);
      const count = await deps.db.prepare('SELECT COUNT(*) AS total FROM admin_members').first<{ total: number }>();
      if ((count?.total ?? 0) >= 50) return adminJson({ error: 'This portal supports up to 50 additional admins.' }, 409);
      // D1 batches are atomic. changes() makes duplicate grants idempotent and
      // keeps audit entries tied to an actual membership change.
      await deps.db.batch([
        deps.db.prepare("INSERT OR IGNORE INTO admin_members (user_id, provider, email, display_name, created_at, created_by) SELECT user_id, provider, email, display_name, ?, ? FROM analytics_users WHERE user_id = ? AND NOT EXISTS (SELECT 1 FROM admin_owner WHERE user_id = ?) AND (SELECT COUNT(*) FROM admin_members) < 50")
          .bind(now, user.userId, mutation.userId, mutation.userId),
        deps.db.prepare("INSERT INTO admin_audit (id, action, actor_id, actor_email, target_id, target_email, created_at) SELECT ?, 'grant', ?, ?, user_id, email, ? FROM admin_members WHERE user_id = ? AND changes() = 1")
          .bind(id, user.userId, user.email, now, mutation.userId),
      ]);
    } else {
      await deps.db.batch([
        deps.db.prepare("INSERT INTO admin_audit (id, action, actor_id, actor_email, target_id, target_email, created_at) SELECT ?, 'revoke', ?, ?, user_id, email, ? FROM admin_members WHERE user_id = ? AND NOT EXISTS (SELECT 1 FROM admin_owner WHERE user_id = ?)")
          .bind(id, user.userId, user.email, now, mutation.userId, mutation.userId),
        deps.db.prepare('DELETE FROM admin_members WHERE user_id = ? AND NOT EXISTS (SELECT 1 FROM admin_owner WHERE user_id = ?)').bind(mutation.userId, mutation.userId),
      ]);
    }
    return adminJson(await readAdminMembers(deps.db));
  } catch { return adminJson({ error: 'Admin access storage is temporarily unavailable.', code: 'storage_unavailable' }, 503); }
}
