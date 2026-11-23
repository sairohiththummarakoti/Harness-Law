export type AuthDatabase = Pick<D1Database, 'prepare'>;
export interface SessionRecord { token_hash: string; user_id: string; email: string; full_name: string | null; expires_at: number }
export interface AuthRepository {
  addChallenge(hash: string, expiresAt: number): Promise<void>;
  readChallengeExpiry(hash: string): Promise<number | null>;
  consumeChallenge(hash: string, now: number): Promise<boolean>;
  deleteChallenge(hash: string): Promise<void>;
  addSession(session: SessionRecord): Promise<void>;
  readSession(hash: string, now: number): Promise<SessionRecord | null>;
  deleteSession(hash: string): Promise<void>;
  cleanupExpired(now: number): Promise<void>;
}

export function createAuthRepository(db: AuthDatabase): AuthRepository {
  return {
    async addChallenge(hash, expiresAt) {
      await db.prepare('INSERT INTO auth_challenges (nonce_hash, expires_at) VALUES (?, ?)').bind(hash, expiresAt).run();
    },
    async readChallengeExpiry(hash) {
      const row = await db.prepare('SELECT expires_at FROM auth_challenges WHERE nonce_hash = ?').bind(hash).first<{ expires_at: number }>();
      return row?.expires_at ?? null;
    },
    async consumeChallenge(hash, now) {
      const used = await db.prepare('DELETE FROM auth_challenges WHERE nonce_hash = ? AND expires_at > ? RETURNING nonce_hash').bind(hash, now).first<{ nonce_hash: string }>();
      return !!used;
    },
    async deleteChallenge(hash) { await db.prepare('DELETE FROM auth_challenges WHERE nonce_hash = ?').bind(hash).run(); },
    async addSession(session) {
      await db.prepare('INSERT INTO auth_sessions (token_hash, user_id, email, full_name, expires_at) VALUES (?, ?, ?, ?, ?)')
        .bind(session.token_hash, session.user_id, session.email, session.full_name, session.expires_at).run();
    },
    async readSession(hash, now) {
      return db.prepare('SELECT token_hash, user_id, email, full_name, expires_at FROM auth_sessions WHERE token_hash = ? AND expires_at > ?').bind(hash, now).first<SessionRecord>();
    },
    async deleteSession(hash) { await db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(hash).run(); },
    async cleanupExpired(now) {
      await db.prepare('DELETE FROM auth_challenges WHERE nonce_hash IN (SELECT nonce_hash FROM auth_challenges WHERE expires_at <= ? ORDER BY expires_at LIMIT 100)').bind(now).run();
      await db.prepare('DELETE FROM auth_sessions WHERE token_hash IN (SELECT token_hash FROM auth_sessions WHERE expires_at <= ? ORDER BY expires_at LIMIT 100)').bind(now).run();
    },
  };
}
