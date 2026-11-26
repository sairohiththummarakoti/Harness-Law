import { getAppUser } from '@/app/auth';
import { matchesExpectedAccount } from '@/lib/account-context';
import { json } from '@/lib/api';
import { ensureDrivesTable } from '../route';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await getAppUser();
  if (!user) return json({ error: 'Sign in to browse your cloud drive.', code: 'session_expired' }, 401);
  if (!matchesExpectedAccount(request, user.userId)) return json({ error: 'Session mismatch.', code: 'session_changed' }, 401);

  const url = new URL(request.url);
  const provider = url.searchParams.get('provider') || 'google_drive';
  const rawFolderId = (url.searchParams.get('folderId') || 'root').trim();
  const folderId = /^[A-Za-z0-9_-]{1,128}$/.test(rawFolderId) ? rawFolderId : 'root';

  if (provider !== 'google_drive') {
    return json({ error: 'Remote cloud browsing is currently supported for Google Drive.', needsReauth: false }, 400);
  }

  try {
    const db = await ensureDrivesTable();
    const row = await db
      .prepare('SELECT access_token, token_expires_at FROM connected_drives WHERE user_id = ? AND provider = ?')
      .bind(user.userId, provider)
      .first<{ access_token: string | null; token_expires_at: number | null }>();

    const now = Math.floor(Date.now() / 1000);
    if (!row?.access_token || (row.token_expires_at && row.token_expires_at <= now)) {
      return json({ needsReauth: true, error: 'Authorize Google Drive to browse your cloud folders.' }, 401);
    }

    const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const driveUrl = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType,size,modifiedTime)&orderBy=folder,name&pageSize=100`;
    const res = await fetch(driveUrl, {
      headers: { Authorization: `Bearer ${row.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 401 || res.status === 403) {
      return json({ needsReauth: true, error: 'Google Drive authorization expired or lacks drive.readonly permission. Please re-authorize.' }, 401);
    }
    if (!res.ok) {
      return json({ error: 'Could not read folders from Google Drive.' }, 502);
    }

    const data = await res.json() as {
      files?: Array<{ id: string; name: string; mimeType: string; size?: string; modifiedTime?: string }>;
    };

    return json({
      folderId,
      items: (data.files ?? []).map(f => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        isFolder: f.mimeType === 'application/vnd.google-apps.folder',
        size: f.size ? Number(f.size) : 0,
        modifiedTime: f.modifiedTime || null,
      })),
    });
  } catch {
    return json({ error: 'Failed to browse cloud drive.' }, 503);
  }
}
