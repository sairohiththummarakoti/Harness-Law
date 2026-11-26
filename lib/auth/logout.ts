// @ts-ignore Node's built-in test runner requires explicit TypeScript extensions.
import { handleLogoutRequest, type AuthEnv } from './google.ts';
// @ts-ignore Node's built-in test runner requires explicit TypeScript extensions.
import { authCookie, authJson, cookieSecurityForUrl, readTokenCookie, tokenHash } from './runtime.ts';

/** End every app session, then let hosted auth clear its own ChatGPT session. */
export async function handleAppLogout(request: Request, env: AuthEnv, development = process.env.NODE_ENV === 'development'): Promise<Response> {
  // This validates POST, same-origin and HTTPS before revoking Google state.
  // Preserve failures rather than disguising them as a successful redirect.
  const googleResponse = await handleLogoutRequest(request, env, { development });
  if (googleResponse.status !== 303) return googleResponse;

  const secure = cookieSecurityForUrl(request.url, development)!;
  const local = development && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname);
  const modes = local ? [true, false] : [secure];
  const cookies = request.headers.get('cookie') ?? '';
  const passwordName = (mode: boolean) => mode ? '__Host-harness_password_session' : 'harness_password_session_dev';
  const passwordTokens = new Set(modes.map(mode => readTokenCookie(cookies, passwordName(mode))).filter((token): token is string => !!token));
  try {
    if (passwordTokens.size && !env.DB) throw new Error('Storage unavailable');
    for (const token of passwordTokens) {
      await env.DB!.prepare('DELETE FROM password_sessions WHERE token_hash=?').bind(await tokenHash(token)).run();
    }
  } catch {
    return authJson({ code: 'auth_storage_unavailable', error: 'Sign-out could not be completed. Please retry.' }, 503);
  }

  const headers = new Headers(googleResponse.headers);
  for (const mode of modes) {
    headers.append('Set-Cookie', authCookie(passwordName(mode), '', 0, mode));
    headers.append('Set-Cookie', authCookie(mode ? '__Host-harness_oauth_state' : 'harness_oauth_state_dev', '', 0, mode));
    headers.append('Set-Cookie', authCookie(mode ? '__Host-harness_oauth_session' : 'harness_oauth_session_dev', '', 0, mode));
  }
  const redirectTo = googleResponse.headers.get('Location')!;
  const accept = (request.headers.get('accept') ?? '').toLowerCase();
  if (accept.includes('application/json') && !accept.includes('text/html')) {
    headers.delete('Location');
    return authJson({ ok: true, redirectTo }, 200, headers);
  }
  // A redirect to / alone leaves the platform-owned ChatGPT session alive.
  return new Response(null, { status: 303, headers });
}
