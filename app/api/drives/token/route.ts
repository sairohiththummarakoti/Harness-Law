import { getAppUser } from '@/app/auth';
import { matchesExpectedAccount } from '@/lib/account-context';
import { json, sameOrigin } from '@/lib/api';
import { ensureDrivesTable } from '../route';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user) return json({ error: 'Sign in to authorize drive access.', code: 'session_expired' }, 401);
  if (!matchesExpectedAccount(request, user.userId)) return json({ error: 'Session mismatch.', code: 'session_changed' }, 401);
  if (!sameOrigin(request)) return json({ error: 'Invalid request origin.' }, 403);

  try {
    const body = await request.json() as {
      provider?: string;
      accessToken?: string;
      expiresIn?: number;
      scope?: string;
      folderName?: string;
      displayName?: string;
    };

    const provider = typeof body.provider === 'string' ? body.provider.trim() : '';
    const accessToken = typeof body.accessToken === 'string' ? body.accessToken.trim() : '';
    const expiresIn = typeof body.expiresIn === 'number' && body.expiresIn > 0 ? body.expiresIn : 3500;
    const scope = body.scope === 'folder' ? 'folder' : 'whole_drive';
    const folderName = typeof body.folderName === 'string' ? body.folderName.trim().slice(0, 200) : null;
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 120) : null;

    if (provider !== 'google_drive' || !accessToken || accessToken.length > 4096) {
      return json({ error: 'Valid Google Drive OAuth access token is required.' }, 422);
    }

    const db = await ensureDrivesTable();
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + expiresIn;

    const existing = await db
      .prepare('SELECT id FROM connected_drives WHERE user_id = ? AND provider = ?')
      .bind(user.userId, provider)
      .all<{ id: string }>();

    if (existing.results?.length) {
      await db
        .prepare('UPDATE connected_drives SET access_token = ?, token_expires_at = ?, status = ?, updated_at = ? WHERE user_id = ? AND provider = ?')
        .bind(accessToken, expiresAt, 'connected', now, user.userId, provider)
        .run();
      return json({ ok: true, id: existing.results[0].id, expiresAt });
    }

    const id = `drv-${crypto.randomUUID()}`;
    await db
      .prepare('INSERT INTO connected_drives (id, user_id, provider, display_name, scope, folder_name, status, access_token, token_expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, user.userId, provider, displayName, scope, folderName, 'connected', accessToken, expiresAt, now, now)
      .run();

    return json({ ok: true, id, expiresAt });
  } catch {
    return json({ error: 'Could not store OAuth drive token.' }, 500);
  }
}
