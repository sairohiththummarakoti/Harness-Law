import { getAppUser } from '@/app/auth';
import { matchesExpectedAccount } from '@/lib/account-context';
import { database, json, sameOrigin } from '@/lib/api';

export const dynamic = 'force-dynamic';

const VALID_PROVIDERS = new Set(['google_drive', 'onedrive', 'icloud', 'dropbox', 'box']);
const VALID_SCOPES = new Set(['folder', 'whole_drive']);

async function ensureTable() {
  const db = database();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS connected_drives (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      scope TEXT NOT NULL,
      folder_name TEXT,
      status TEXT NOT NULL DEFAULT 'connected',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();
  return db;
}

export async function GET(request: Request) {
  const user = await getAppUser();
  if (!user) return json({ error: 'Sign in to view connected drives.', code: 'session_expired' }, 401);
  if (!matchesExpectedAccount(request, user.userId)) return json({ error: 'Session mismatch.', code: 'session_changed' }, 401);

  try {
    const db = await ensureTable();
    const { results } = await db
      .prepare('SELECT id, provider, scope, folder_name, status, created_at, updated_at FROM connected_drives WHERE user_id = ? ORDER BY updated_at DESC')
      .bind(user.userId)
      .all();
    return json({ drives: results ?? [] });
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
    const body = await request.json() as { provider?: string; scope?: string; folderName?: string };
    const provider = typeof body.provider === 'string' ? body.provider.trim() : '';
    const scope = typeof body.scope === 'string' ? body.scope.trim() : '';
    const folderName = typeof body.folderName === 'string' ? body.folderName.trim().slice(0, 200) : '';

    if (!VALID_PROVIDERS.has(provider)) {
      return json({ error: 'Select a supported drive provider.' }, 422);
    }
    if (!VALID_SCOPES.has(scope)) {
      return json({ error: 'Select whether to grant read access to a specific folder or the whole drive.' }, 422);
    }
    if (scope === 'folder' && !folderName) {
      return json({ error: 'Enter a folder name or folder link for specific folder access.' }, 422);
    }

    const db = await ensureTable();
    const now = Math.floor(Date.now() / 1000);
    const existing = await db
      .prepare('SELECT id FROM connected_drives WHERE user_id = ? AND provider = ?')
      .bind(user.userId, provider)
      .first<{ id: string }>();

    const id = existing?.id || `drv-${crypto.randomUUID()}`;
    if (existing) {
      await db
        .prepare('UPDATE connected_drives SET scope = ?, folder_name = ?, status = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .bind(scope, scope === 'folder' ? folderName : null, 'connected', now, id, user.userId)
        .run();
    } else {
      await db
        .prepare('INSERT INTO connected_drives (id, user_id, provider, scope, folder_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, user.userId, provider, scope, scope === 'folder' ? folderName : null, 'connected', now, now)
        .run();
    }

    const { results } = await db
      .prepare('SELECT id, provider, scope, folder_name, status, created_at, updated_at FROM connected_drives WHERE user_id = ? ORDER BY updated_at DESC')
      .bind(user.userId)
      .all();

    return json({ ok: true, id, drives: results ?? [] });
  } catch {
    return json({ error: 'Could not save drive connection.' }, 500);
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

    const db = await ensureTable();
    await db.prepare('DELETE FROM connected_drives WHERE id = ? AND user_id = ?').bind(id, user.userId).run();

    const { results } = await db
      .prepare('SELECT id, provider, scope, folder_name, status, created_at, updated_at FROM connected_drives WHERE user_id = ? ORDER BY updated_at DESC')
      .bind(user.userId)
      .all();

    return json({ ok: true, drives: results ?? [] });
  } catch {
    return json({ error: 'Could not disconnect drive.' }, 500);
  }
}
