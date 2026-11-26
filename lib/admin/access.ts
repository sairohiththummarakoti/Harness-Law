import type { AppUser } from '../identity.ts';

export type AdminDatabase = Pick<D1Database, 'prepare' | 'batch'>;
export type AdminRole = 'owner' | 'admin';
export interface AdminAccess {
  role: AdminRole;
  userId: string;
  email: string;
  displayName: string;
}
export interface AdminPrincipalRow {
  user_id: string;
  provider: AppUser['provider'];
  email: string;
  display_name: string;
  created_at: number;
}

export function normalizedOwnerEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** The email is a one-time bootstrap guard, never a grant supplied by the client.
 * Once bound, the owner is identified only by the verified provider and subject.
 * Do not call this helper with an identity constructed from request body fields.
 */
export async function getAdminAccess(db: AdminDatabase, user: AppUser | null, ownerEmail: unknown): Promise<AdminAccess | null> {
  if (!user || !user.userId || !['google', 'chatgpt'].includes(user.provider)) return null;
  let owner = await db.prepare("SELECT user_id, provider, email, display_name, created_at FROM admin_owner WHERE id = 'owner'").first<AdminPrincipalRow>();
  const expectedEmail = normalizedOwnerEmail(ownerEmail);
  if (!owner && expectedEmail && normalizedOwnerEmail(user.email) === expectedEmail) {
    await db.prepare("INSERT OR IGNORE INTO admin_owner (id, user_id, provider, email, display_name, created_at) VALUES ('owner', ?, ?, ?, ?, ?)")
      .bind(user.userId, user.provider, user.email, user.displayName, Date.now()).run();
    // Re-read: another request may have bound a different verified identity.
    owner = await db.prepare("SELECT user_id, provider, email, display_name, created_at FROM admin_owner WHERE id = 'owner'").first<AdminPrincipalRow>();
  }
  if (owner?.user_id === user.userId && owner.provider === user.provider) return { role: 'owner', userId: user.userId, email: user.email, displayName: user.displayName };
  const member = await db.prepare('SELECT user_id, provider FROM admin_members WHERE user_id = ? AND provider = ?').bind(user.userId, user.provider).first<{ user_id: string; provider: string }>();
  return member ? { role: 'admin', userId: user.userId, email: user.email, displayName: user.displayName } : null;
}
