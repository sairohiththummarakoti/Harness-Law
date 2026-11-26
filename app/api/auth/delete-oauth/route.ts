import { env } from 'cloudflare:workers';
import { getAppUser } from '@/app/auth';
import { database, json, sameOrigin } from '@/lib/api';
import { createS3Store } from '@/lib/integrations/providers';
import { authCookie, clearAuthCookies, cookieNames, cookieSecurityForUrl } from '@/lib/auth/runtime';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user) return json({ error: 'Sign in to delete your account.', code: 'session_expired' }, 401);
  if (!sameOrigin(request)) return json({ error: 'Invalid request origin.' }, 403);

  try {
    const body = await request.json() as { confirmation?: string };
    if (body.confirmation !== 'DELETE') {
      return json({ error: 'Type DELETE to confirm account deletion.' }, 422);
    }

    const db = database();
    const procEnv = typeof process !== 'undefined' ? process.env : undefined;
    const s3Bucket = env.HARNESS_S3_BUCKET || procEnv?.HARNESS_S3_BUCKET;
    const s3Region = env.HARNESS_S3_REGION || procEnv?.HARNESS_S3_REGION;
    const s3Key = env.HARNESS_S3_ACCESS_KEY_ID || procEnv?.HARNESS_S3_ACCESS_KEY_ID;
    const s3Secret = env.HARNESS_S3_SECRET_ACCESS_KEY || procEnv?.HARNESS_S3_SECRET_ACCESS_KEY;
    const s3Token = env.HARNESS_S3_SESSION_TOKEN || procEnv?.HARNESS_S3_SESSION_TOKEN;
    const s3Ready = !!(s3Bucket && s3Region && s3Key && s3Secret);
    const legacy = await db.prepare('SELECT object_key FROM evidence_objects WHERE owner_id = ?').bind(user.userId).all<{ object_key: string }>();
    if (legacy.results.length && !s3Ready && !env.BUCKET) {
      return json({ error: 'Account data storage is unavailable. No account data was deleted.' }, 503);
    }
    const s3 = s3Ready ? createS3Store({
      bucket: s3Bucket!,
      region: s3Region!,
      accessKeyId: s3Key!,
      secretAccessKey: s3Secret!,
      sessionToken: s3Token,
      requireVersionId: true,
    }) : null;
    for (const row of legacy.results) {
      if (s3) await s3.delete(row.object_key).catch(() => {});
      if (env.BUCKET) await env.BUCKET.delete(row.object_key).catch(() => {});
    }

    const integration = await db.prepare('SELECT case_id FROM integration_cases WHERE owner_id = ?').bind(user.userId).first<{ case_id: string }>();
    if (integration) {
      await db.prepare('DELETE FROM integration_case_chunks WHERE case_id = ?').bind(integration.case_id).run();
      await db.prepare('DELETE FROM integration_cases WHERE case_id = ? AND owner_id = ?').bind(integration.case_id, user.userId).run();
    }

    await db.prepare('DELETE FROM cases WHERE owner_id = ?').bind(user.userId).run();
    await db.prepare('DELETE FROM evidence_objects WHERE owner_id = ?').bind(user.userId).run();
    try {
      await db.prepare('DELETE FROM connected_drives WHERE user_id = ?').bind(user.userId).run();
    } catch { /* table may not exist yet */ }
    await db.prepare('DELETE FROM email_challenges WHERE user_id = ?').bind(user.userId).run();
    await db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(user.userId).run();
    await db.prepare('DELETE FROM password_sessions WHERE user_id = ?').bind(user.userId).run();
    await db.prepare('DELETE FROM password_accounts WHERE user_id = ?').bind(user.userId).run();

    const secure = cookieSecurityForUrl(request.url, process.env.NODE_ENV === 'development') ?? true;
    const headers = new Headers();
    clearAuthCookies(headers, secure);
    const pwCookie = secure ? '__Host-harness_password_session' : 'harness_password_session_dev';
    headers.append('Set-Cookie', authCookie(pwCookie, '', 0, secure));
    headers.append('Set-Cookie', authCookie(cookieNames(secure).provider, '', 0, secure));
    headers.set('Content-Type', 'application/json');
    headers.set('Cache-Control', 'no-store');
    return new Response(JSON.stringify({ ok: true, redirectTo: '/' }), { status: 200, headers });
  } catch {
    return json({ error: 'Could not delete account. Please try again.' }, 500);
  }
}
