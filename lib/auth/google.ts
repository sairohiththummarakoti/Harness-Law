import type { JWTVerifyGetKey } from 'jose';
// @ts-ignore Node's built-in test runner requires explicit TypeScript extensions.
import { createAuthRepository, type AuthDatabase, type AuthRepository } from './repository.ts';
// @ts-ignore Node's built-in test runner requires explicit TypeScript extensions.
import { authCookie, authJson, challengeCookieName, challengeCookies, CHALLENGE_TTL_SECONDS, clearAuthCookies, cookieNames, cookieSecurityForUrl, isSameOrigin, MAX_OUTSTANDING_CHALLENGES, PROVIDER_TTL_SECONDS, randomToken, readAuthBody, readTokenCookie, SESSION_TTL_SECONDS, tokenHash, validToken } from './runtime.ts';
// @ts-ignore Node's built-in test runner requires explicit TypeScript extensions.
import { verifyGoogleCredential } from './verify.ts';
// @ts-ignore Node's built-in test runner requires explicit TypeScript extensions.
export { hasGoogleSessionCookie, hasSelectedGoogleProvider, cookieSecurityForUrl } from './runtime.ts';

export interface GoogleUser { userId: string; email: string; displayName: string; fullName: string | null; provider: 'google' }
export interface AuthEnv { DB?: AuthDatabase; HARNESS_GOOGLE_CLIENT_ID?: unknown }
export interface AuthDependencies { repository?: AuthRepository; jwks?: JWTVerifyGetKey; now?: () => number; development?: boolean }

export function getGoogleClientId(env: Pick<AuthEnv, 'HARNESS_GOOGLE_CLIENT_ID'>): string | null {
  const value = env.HARNESS_GOOGLE_CLIENT_ID;
  return typeof value === 'string' && value.length <= 256 && /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value.trim()) ? value.trim() : null;
}

function repository(env: AuthEnv, deps: AuthDependencies): AuthRepository {
  if (deps.repository) return deps.repository;
  if (!env.DB) throw new Error('Authentication storage unavailable.');
  return createAuthRepository(env.DB);
}

function error(code: string, message: string, status: number, headers?: Headers) { return authJson({ error: message, code }, status, headers); }

export async function readGoogleUser(db: AuthDatabase, cookieHeader: string, secure: boolean): Promise<GoogleUser | null> {
  const token = readTokenCookie(cookieHeader, cookieNames(secure).session);
  if (!token) return null;
  const now = Math.floor(Date.now() / 1000);
  const saved = await createAuthRepository(db).readSession(await tokenHash(token), now);
  if (!saved || !Number.isSafeInteger(saved.expires_at) || saved.expires_at <= now || !saved.user_id.startsWith('google:') || !saved.email) return null;
  return { userId: saved.user_id, email: saved.email, fullName: saved.full_name, displayName: saved.full_name || saved.email, provider: 'google' };
}

export async function handleGoogleRequest(request: Request, env: AuthEnv, deps: AuthDependencies = {}): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') return error('method_not_allowed', 'Use the sign-in form to continue.', 405);
  if (!isSameOrigin(request, request.method === 'GET')) return error('invalid_origin', 'Start sign-in from this app.', 403);
  const secure = cookieSecurityForUrl(request.url, deps.development);
  if (secure === null) return error('https_required', 'A secure connection is required to sign in.', 403);
  const clientId = getGoogleClientId(env);
  if (!clientId) return error('google_unconfigured', 'Google sign-in is not configured yet. Continue with ChatGPT.', 503);
  const now = () => deps.now?.() ?? Math.floor(Date.now() / 1000);
  const names = cookieNames(secure);
  const cookies = request.headers.get('cookie') ?? '';
  try {
    const store = repository(env, deps);
    if (request.method === 'GET') {
      await store.cleanupExpired(now());
      const headers = new Headers();
      const pending = challengeCookies(cookies, secure);
      const oldest = pending.slice(0, Math.max(0, pending.length - MAX_OUTSTANDING_CHALLENGES + 1));
      for (const attempt of oldest) {
        await store.deleteChallenge(await tokenHash(attempt.nonce));
        headers.append('Set-Cookie', authCookie(attempt.name, '', 0, secure));
      }
      const nonce = randomToken();
      await store.addChallenge(await tokenHash(nonce), now() + CHALLENGE_TTL_SECONDS);
      headers.append('Set-Cookie', authCookie(challengeCookieName(nonce, secure), nonce, CHALLENGE_TTL_SECONDS, secure));
      return authJson({ clientId, nonce }, 200, headers);
    }
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return error('invalid_content_type', 'Send the sign-in credential as JSON.', 415);
    let decoded: unknown;
    try {
      const body = await readAuthBody(request);
      if (body === null) return error('request_too_large', 'The sign-in request is too large.', 413);
      decoded = JSON.parse(body);
    } catch { return error('invalid_request', 'The sign-in request could not be read. Please retry.', 400); }
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded) || Object.keys(decoded).length !== 2 || !('credential' in decoded) || typeof decoded.credential !== 'string' || decoded.credential.length > 15000 || decoded.credential.length < 100 || !('nonce' in decoded) || typeof decoded.nonce !== 'string' || !validToken(decoded.nonce)) return error('invalid_request', 'The sign-in credential or nonce is missing or invalid.', 400);
    const nonce = decoded.nonce;
    const nonceCookie = challengeCookieName(nonce, secure);
    if (readTokenCookie(cookies, nonceCookie) !== nonce) return error('challenge_required', 'Restart Google sign-in to get a fresh sign-in request.', 401);
    let identity;
    try { identity = await verifyGoogleCredential(decoded.credential, clientId, nonce, { jwks: deps.jwks, now: new Date(now() * 1000) }); }
    catch { return error('invalid_credential', 'Google sign-in could not be verified. Please start again.', 401); }
    if (!await store.consumeChallenge(await tokenHash(nonce), now())) return error('challenge_expired', 'This sign-in request expired or was already used. Please start again.', 401);
    const token = randomToken();
    const previousToken = readTokenCookie(cookies, names.session);
    if (previousToken) await store.deleteSession(await tokenHash(previousToken));
    await store.addSession({ token_hash: await tokenHash(token), user_id: `google:${identity.sub}`, email: identity.email, full_name: identity.fullName, expires_at: now() + SESSION_TTL_SECONDS });
    const headers = new Headers();
    headers.append('Set-Cookie', authCookie(names.session, token, SESSION_TTL_SECONDS, secure));
    headers.append('Set-Cookie', authCookie(names.provider, 'google', PROVIDER_TTL_SECONDS, secure));
    headers.append('Set-Cookie', authCookie(nonceCookie, '', 0, secure));
    return authJson({ ok: true, redirectTo: '/onboarding' }, 200, headers);
  } catch { return error('auth_storage_unavailable', 'Sign-in storage is temporarily unavailable. Please try again.', 503); }
}

async function endGoogleSession(request: Request, env: AuthEnv, redirectTo: string, deps: AuthDependencies): Promise<Response> {
  if (request.method !== 'POST') return error('method_not_allowed', 'Use the sign-out form to continue.', 405);
  if (!isSameOrigin(request)) return error('invalid_origin', 'Submit this request from the app.', 403);
  const secure = cookieSecurityForUrl(request.url, deps.development);
  if (secure === null) return error('https_required', 'A secure connection is required.', 403);
  const cookies = request.headers.get('cookie') ?? '';
  const development = deps.development ?? process.env.NODE_ENV === 'development';
  const localDevelopment = development && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname);
  const modes = localDevelopment ? [true, false] : [secure];
  const tokens = new Set(modes.map(mode => readTokenCookie(cookies, cookieNames(mode).session)).filter((value): value is string => !!value));
  const attempts = modes.flatMap(mode => challengeCookies(cookies, mode).map(attempt => ({ ...attempt, secure: mode })));
  const nonces = new Set(attempts.map(attempt => attempt.nonce));
  try {
    if (tokens.size || nonces.size) {
      const store = repository(env, deps);
      for (const token of tokens) await store.deleteSession(await tokenHash(token));
      for (const nonce of nonces) await store.deleteChallenge(await tokenHash(nonce));
    }
    const headers = new Headers({ Location: redirectTo, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    for (const mode of modes) clearAuthCookies(headers, mode);
    for (const attempt of attempts) {
      if (attempt.name !== cookieNames(attempt.secure).nonce) headers.append('Set-Cookie', authCookie(attempt.name, '', 0, attempt.secure));
    }
    return new Response(null, { status: 303, headers });
  } catch { return error('auth_storage_unavailable', 'Sign-out could not be completed. Please retry.', 503); }
}

export function handleLogoutRequest(request: Request, env: AuthEnv, deps: AuthDependencies = {}) {
  return endGoogleSession(request, env, '/signout-with-chatgpt?return_to=%2Fsignin', deps);
}

export function handleChatGPTRequest(request: Request, env: AuthEnv, deps: AuthDependencies = {}) {
  return endGoogleSession(request, env, '/signin-with-chatgpt?return_to=%2Fonboarding', deps);
}
