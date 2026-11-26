import { env } from 'cloudflare:workers';
import { getAppUser } from '@/app/auth';
import { matchesExpectedAccount } from '@/lib/account-context';
import { database, json, parseCase, readCase, sameOrigin, sanitizeFileSlug, sanitizeSubfolder, userStorageFolder } from '@/lib/api';
import { createS3Store } from '@/lib/integrations/providers';
import type { Evidence } from '@/lib/model';
import { MAX_FILE_BYTES, safeFilename, validUploadName } from '@/lib/validation';
import { ensureDrivesTable } from '../route';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user) return json({ error: 'Sign in to import files.', code: 'session_expired' }, 401);
  if (!matchesExpectedAccount(request, user.userId)) return json({ error: 'Session mismatch.', code: 'session_changed' }, 401);
  if (!sameOrigin(request)) return json({ error: 'Invalid request origin.' }, 403);

  try {
    const body = await request.json() as {
      provider?: string;
      fileId?: string;
      fileName?: string;
      mimeType?: string;
      folderPath?: string;
    };

    const provider = typeof body.provider === 'string' ? body.provider.trim() : 'google_drive';
    const fileId = typeof body.fileId === 'string' ? body.fileId.trim() : '';
    const rawName = typeof body.fileName === 'string' ? body.fileName.trim() : 'document.pdf';
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType.trim() : '';

    if (provider !== 'google_drive' || !/^[A-Za-z0-9_-]{1,128}$/.test(fileId)) {
      return json({ error: 'Invalid Google Drive file reference.' }, 422);
    }

    const row = await readCase(user.userId);
    if (!row) return json({ error: 'Create and save a case before importing.' }, 409);
    const state = parseCase(row);
    if (!state.consent) return json({ error: 'Save your processing consent in Settings before importing documents.', code: 'consent_required' }, 403);

    const db = await ensureDrivesTable();
    const driveRow = await db
      .prepare('SELECT access_token, token_expires_at FROM connected_drives WHERE user_id = ? AND provider = ?')
      .bind(user.userId, provider)
      .first<{ access_token: string | null; token_expires_at: number | null }>();

    const now = Math.floor(Date.now() / 1000);
    if (!driveRow?.access_token || (driveRow.token_expires_at && driveRow.token_expires_at <= now)) {
      return json({ error: 'Google Drive authorization expired. Re-authorize and try again.', needsReauth: true }, 401);
    }

    const isGoogleDoc = mimeType.startsWith('application/vnd.google-apps.');
    const downloadUrl = isGoogleDoc
      ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=application/pdf`
      : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;

    const driveRes = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${driveRow.access_token}` },
      signal: AbortSignal.timeout(30_000),
    });

    if (driveRes.status === 401 || driveRes.status === 403) {
      return json({ error: 'Google Drive authorization expired or permission denied.', needsReauth: true }, 401);
    }
    if (!driveRes.ok) {
      return json({ error: 'Could not download file from Google Drive.' }, 502);
    }

    const fileBytes = new Uint8Array(await driveRes.arrayBuffer());
    if (fileBytes.byteLength === 0) return json({ error: 'The selected Drive file is empty.' }, 422);
    if (fileBytes.byteLength > MAX_FILE_BYTES) return json({ error: 'Each imported document must be 20 MB or smaller.' }, 413);

    const effectiveName = isGoogleDoc && !/\.pdf$/i.test(rawName) ? `${rawName}.pdf` : rawName;
    const name = safeFilename(effectiveName);
    if (!validUploadName(name)) {
      return json({ error: 'Supported files: PDF, DOCX, TXT, JPG, and PNG (Google Docs are exported as PDF).' }, 415);
    }

    const procEnv = typeof process !== 'undefined' ? process.env : undefined;
    const s3Bucket = env.HARNESS_S3_BUCKET || procEnv?.HARNESS_S3_BUCKET;
    const s3Region = env.HARNESS_S3_REGION || procEnv?.HARNESS_S3_REGION;
    const s3Key = env.HARNESS_S3_ACCESS_KEY_ID || procEnv?.HARNESS_S3_ACCESS_KEY_ID;
    const s3Secret = env.HARNESS_S3_SECRET_ACCESS_KEY || procEnv?.HARNESS_S3_SECRET_ACCESS_KEY;
    const s3Token = env.HARNESS_S3_SESSION_TOKEN || procEnv?.HARNESS_S3_SESSION_TOKEN;
    const s3Ready = !!(s3Bucket && s3Region && s3Key && s3Secret);
    if (!s3Ready && !env.BUCKET) return json({ error: 'Evidence storage is not configured.' }, 503);

    const id = `upload-${crypto.randomUUID()}`;
    const userFolder = await userStorageFolder(user.userId, user.fullName || user.displayName || user.email);
    const subFolder = sanitizeSubfolder(body.folderPath);
    const safeFilePart = sanitizeFileSlug(name);
    const key = subFolder ? `users/${userFolder}/${subFolder}/${id}-${safeFilePart}` : `users/${userFolder}/${id}-${safeFilePart}`;
    const uploadedAt = new Date().toISOString();

    const document: Evidence = {
      id,
      objectId: id,
      name,
      version: 1,
      status: 'needs_attention',
      language: 'Not extracted',
      pages: 0,
      bytes: fileBytes.byteLength,
      kind: name.split('.').pop()!.toUpperCase(),
      excerpt: '',
      associations: [],
      exhibit: '',
      uploadedAt,
      sample: false,
      issue: 'Imported from Google Drive into private storage. Safety scanning and text extraction are not connected yet.',
      previousVersions: [],
    };

    let s3Version: string | undefined;
    if (s3Ready) {
      const s3 = createS3Store({
        bucket: s3Bucket!,
        region: s3Region!,
        accessKeyId: s3Key!,
        secretAccessKey: s3Secret!,
        sessionToken: s3Token,
        requireVersionId: true,
      });
      const stored = await s3.put(key, fileBytes, 'application/octet-stream');
      s3Version = stored.version;
    } else {
      await env.BUCKET!.put(key, fileBytes, {
        httpMetadata: { contentType: 'application/octet-stream' },
        customMetadata: { owner: userFolder, caseId: state.id, status: 'quarantine' },
      });
    }

    try {
      await database()
        .prepare('INSERT INTO evidence_objects (id, owner_id, case_id, object_key, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, user.userId, state.id, key, JSON.stringify(document), uploadedAt)
        .run();
    } catch {
      if (s3Ready) {
        const s3 = createS3Store({
          bucket: s3Bucket!,
          region: s3Region!,
          accessKeyId: s3Key!,
          secretAccessKey: s3Secret!,
          sessionToken: s3Token,
          requireVersionId: true,
        });
        await s3.delete(key, s3Version).catch(() => {});
      } else {
        await env.BUCKET!.delete(key);
      }
      throw new Error('Import metadata could not be saved.');
    }

    return json({ ok: true, document, objectKey: key }, 201);
  } catch {
    return json({ error: 'Could not import file from cloud drive.' }, 503);
  }
}
