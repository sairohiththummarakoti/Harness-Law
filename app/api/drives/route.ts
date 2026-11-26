import { getAppUser } from '@/app/auth';
import { matchesExpectedAccount } from '@/lib/account-context';
import { database, json, sameOrigin } from '@/lib/api';

export const dynamic = 'force-dynamic';

const VALID_PROVIDERS = new Set(['google_drive', 'onedrive', 'icloud', 'dropbox']);
const VALID_SCOPES = new Set(['folder', 'whole_drive']);

export async function ensureDrivesTable() {
  const db = database();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS connected_drives (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      display_name TEXT,
      scope TEXT NOT NULL,
      folder_name TEXT,
      status TEXT NOT NULL DEFAULT 'connected',
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();
  for (const col of [
    'ALTER TABLE connected_drives ADD COLUMN display_name TEXT',
    'ALTER TABLE connected_drives ADD COLUMN access_token TEXT',
    'ALTER TABLE connected_drives ADD COLUMN refresh_token TEXT',
    'ALTER TABLE connected_drives ADD COLUMN token_expires_at INTEGER',
  ]) {
    try { await db.prepare(col).run(); } catch { /* column already exists */ }
  }
  return db;
}

async function listDrives(db: D1Database, userId: string) {
  const { results } = await db
    .prepare('SELECT id, provider, display_name, scope, folder_name, status, access_token, token_expires_at, created_at, updated_at FROM connected_drives WHERE user_id = ? ORDER BY updated_at DESC')
    .bind(userId)
    .all<{
      id: string;
      provider: string;
      display_name: string | null;
      scope: string;
      folder_name: string | null;
      status: string;
      access_token: string | null;
      token_expires_at: number | null;
      created_at: number;
      updated_at: number;
    }>();
  const now = Math.floor(Date.now() / 1000);
  return (results ?? []).map(r => ({
    id: r.id,
    provider: r.provider,
    display_name: r.display_name,
    scope: r.scope,
    folder_name: r.folder_name,
    status: r.status,
    hasToken: !!r.access_token && (!r.token_expires_at || r.token_expires_at > now),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export async function GET(request: Request) {
  const user = await getAppUser();
  if (!user) return json({ error: 'Sign in to view connected drives.', code: 'session_expired' }, 401);
  if (!matchesExpectedAccount(request, user.userId)) return json({ error: 'Session mismatch.', code: 'session_changed' }, 401);

  try {
    const db = await ensureDrivesTable();
    return json({ drives: await listDrives(db, user.userId) });
  } catch {
    return json({ error: 'Unable to load connected drives.', code: 'storage_unavailable' }, 503);
  }
}

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user) return json({ error: 'Sign in to connect a drive.', code: 'session_expired' }, 401);
  if (!matchesExpectedAccount(request, user.userId)) return json({ error: 'Session mismatch.', code: 'session_changed' }, 401);
  if (!sameOrigin(request)) return json({ error: 'Invalid request origin.' }, 403);

  try {
    const body = await request.json() as { provider?: string; displayName?: string; scope?: string; folderName?: string };
    const provider = typeof body.provider === 'string' ? body.provider.trim() : '';
    const scope = typeof body.scope === 'string' ? body.scope.trim() : '';
    const folderName = typeof body.folderName === 'string' ? body.folderName.trim().slice(0, 200) : '';
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 120) : '';

    if (!VALID_PROVIDERS.has(provider)) {
      return json({ error: 'Select a supported drive provider.' }, 422);
    }
    if (!VALID_SCOPES.has(scope)) {
      return json({ error: 'Select whether to grant read access to a specific folder or the whole drive.' }, 422);
    }
    if (scope === 'folder' && !folderName) {
      return json({ error: 'Enter a folder name or folder link for specific folder access.' }, 422);
    }

    const db = await ensureDrivesTable();
    const now = Math.floor(Date.now() / 1000);

    // Reuse existing valid OAuth token for this provider if the user already authorized it
    const tokenRow = await db
      .prepare('SELECT access_token, token_expires_at FROM connected_drives WHERE user_id = ? AND provider = ? AND access_token IS NOT NULL ORDER BY updated_at DESC LIMIT 1')
      .bind(user.userId, provider)
      .first<{ access_token: string | null; token_expires_at: number | null }>();

    const id = `drv-${crypto.randomUUID()}`;
    await db
      .prepare('INSERT INTO connected_drives (id, user_id, provider, display_name, scope, folder_name, status, access_token, token_expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(
        id,
        user.userId,
        provider,
        displayName || null,
        scope,
        scope === 'folder' ? folderName : null,
        'connected',
        tokenRow?.access_token ?? null,
        tokenRow?.token_expires_at ?? null,
        now,
        now,
      )
      .run();

    return json({ ok: true, id, drives: await listDrives(db, user.userId) });
  } catch {
    return json({ error: 'Could not save drive connection.' }, 500);
  }
}

export async function PATCH(request: Request) {
  const user = await getAppUser();
  if (!user) return json({ error: 'Sign in to rename a drive.', code: 'session_expired' }, 401);
  if (!matchesExpectedAccount(request, user.userId)) return json({ error: 'Session mismatch.', code: 'session_changed' }, 401);
  if (!sameOrigin(request)) return json({ error: 'Invalid request origin.' }, 403);

  try {
    const body = await request.json() as { id?: string; displayName?: string };
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 120) : '';
    if (!id) return json({ error: 'Drive ID is required.' }, 400);
    if (!displayName) return json({ error: 'Enter a name for this drive or folder.' }, 422);

    const db = await ensureDrivesTable();
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare('UPDATE connected_drives SET display_name = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .bind(displayName, now, id, user.userId)
      .run();

    return json({ ok: true, drives: await listDrives(db, user.userId) });
  } catch {
    return json({ error: 'Could not rename drive connection.' }, 500);
  }
}

export async function DELETE(request: Request) {
  const user = await getAppUser();
  if (!user) return json({ error: 'Sign in to manage drives.', code: 'session_expired' }, 401);
  if (!matchesExpectedAccount(request, user.userId)) return json({ error: 'Session mismatch.', code: 'session_changed' }, 401);
  if (!sameOrigin(request)) return json({ error: 'Invalid request origin.' }, 403);

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id') || '';
    if (!id) return json({ error: 'Drive ID is required.' }, 400);

    const db = await ensureDrivesTable();
    await db.prepare('DELETE FROM connected_drives WHERE id = ? AND user_id = ?').bind(id, user.userId).run();

    return json({ ok: true, drives: await listDrives(db, user.userId) });
  } catch {
    return json({ error: 'Could not disconnect drive.' }, 500);
  }
}
