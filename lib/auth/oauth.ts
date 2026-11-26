// @ts-ignore Node's built-in test runner requires explicit TypeScript extensions.
import { authCookie, authJson, cookieNames, cookieSecurityForUrl, isSameOrigin, randomToken, readAuthBody, readTokenCookie, tokenHash } from './runtime.ts';

export interface OAuthEnv { DB?: D1Database; FIREBASE_API_KEY?: string; fetch?: typeof fetch }
const endpoint = 'https://identitytoolkit.googleapis.com/v1/accounts:';
const providers = {
  google: { id: 'google.com', name: 'Google' },
  apple: { id: 'apple.com', name: 'Apple', oauthScope: 'email name', customParameter: { response_mode: 'form_post' } },
  microsoft: { id: 'microsoft.com', name: 'Microsoft' },
} as const;
type Provider = keyof typeof providers;
function providerConfig(value: string) {
  const key = value.toLowerCase();
  return Object.hasOwn(providers, key) ? providers[key as Provider] : null;
}
function names(secure: boolean) {
  return secure
    ? { state: '__Host-harness_oauth_state', session: '__Host-harness_oauth_session', password: '__Host-harness_password_session' }
    : { state: 'harness_oauth_state_dev', session: 'harness_oauth_session_dev', password: 'harness_password_session_dev' };
}
function clearTransaction(headers: Headers, secure: boolean) {
  headers.append('Set-Cookie', authCookie(names(secure).state, '', 0, secure));
  headers.append('Set-Cookie', authCookie(names(secure).session, '', 0, secure));
}
function redirect(request: Request, notice: string, secure: boolean): Response {
  const headers = new Headers({ Location: new URL(`/signin?oauth_notice=${encodeURIComponent(notice)}`, request.url).href });
  clearTransaction(headers, secure);
  return authJson(null, 303, headers);
}
async function stateDigest(state: string): Promise<string> {
  const hex = await tokenHash(state);
  return btoa(String.fromCharCode(...hex.match(/../g)!.map(value => parseInt(value, 16)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function validState(values: URLSearchParams): string | null {
  const states = values.getAll('state');
  return states.length === 1 && states[0].length > 0 && states[0].length <= 4096 ? states[0] : null;
}

export async function startOAuth(request: Request, provider: string, env: OAuthEnv, development = false): Promise<Response> {
  const config = providerConfig(provider);
  if (!config) return authJson({ error: 'Unsupported provider.' }, 400);
  if (request.method !== 'GET' && request.method !== 'POST') return authJson({ error: 'Method not allowed.' }, 405);
  if (request.method === 'POST' && !isSameOrigin(request)) return authJson({ error: 'Invalid origin.' }, 403);
  const secure = cookieSecurityForUrl(request.url, development);
  if (secure === null) return authJson({ error: 'A secure connection is required to sign in.' }, 403);
  const unavailable = () => redirect(request, `${config.name} sign-in is not available yet. Please choose another sign-in method.`, secure);
  if (!env.FIREBASE_API_KEY || !env.DB) return unavailable();
  const sessionId = randomToken();
  try {
    const response = await (env.fetch ?? fetch)(`${endpoint}createAuthUri?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        providerId: config.id,
        continueUri: `${new URL(request.url).origin}/api/auth/oauth/callback`,
        sessionId,
        ...('oauthScope' in config ? { oauthScope: config.oauthScope } : {}),
        ...('customParameter' in config ? { customParameter: config.customParameter } : {}),
      }),
    });
    const data = await response.json() as { authUri?: string; sessionId?: string; error?: { message?: string } };
    if (!response.ok && /^(OPERATION_NOT_ALLOWED|CONFIGURATION_NOT_FOUND|INVALID_IDP_ID)(?:\s|:|$)/.test(data.error?.message ?? '')) return unavailable();
    if (!response.ok || !data.authUri || data.sessionId !== sessionId) throw new Error('Invalid authorization response');
    const authUri = new URL(data.authUri), state = validState(authUri.searchParams);
    if (authUri.protocol !== 'https:' || authUri.username || authUri.password || !state) throw new Error('Invalid authorization URL');
    const headers = new Headers({ Location: authUri.href });
    headers.append('Set-Cookie', authCookie(names(secure).session, sessionId, 600, secure));
    headers.append('Set-Cookie', authCookie(names(secure).state, await stateDigest(state), 600, secure));
    return authJson(null, 303, headers);
  } catch { return redirect(request, `Could not start ${config.name} sign-in. Please try again.`, secure); }
}

function callbackBridge(postBody?: string): Response {
  const nonce = randomToken();
  // Apple returns a cross-site form POST, which does not carry Lax cookies.
  // Bridge from our document to a same-origin POST before reading the original
  // transaction cookies. No identity is trusted or session issued by this page.
  const payload = postBody === undefined
    ? 'location.hash.slice(1)'
    : JSON.stringify(postBody).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Completing sign-in…</title></head><body><p>Completing sign-in…</p><noscript>Enable JavaScript to finish signing in, then try again.</noscript><script nonce="${nonce}">(async()=>{const responseBody=${payload};history.replaceState(null,'',location.pathname);if(!responseBody){location.replace('/signin?oauth_notice=Sign-in+was+cancelled.');return;}try{const res=await fetch('/api/auth/oauth/callback',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({postBody:responseBody})});const data=await res.json();location.replace(data.redirectTo||'/signin');}catch{location.replace('/signin?oauth_notice=Could+not+complete+sign-in.');}})();</script></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'` } });
}

async function complete(request: Request, postBody: string | undefined, sessionId: string, env: OAuthEnv, secure: boolean): Promise<Headers> {
  const response = await (env.fetch ?? fetch)(`${endpoint}signInWithIdp?key=${encodeURIComponent(env.FIREBASE_API_KEY!)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
    body: JSON.stringify({ requestUri: request.url, ...(postBody !== undefined ? { postBody } : {}), sessionId, returnSecureToken: true }),
  });
  const data = await response.json() as { idToken?: string; localId?: string; email?: string; emailVerified?: boolean; displayName?: string; fullName?: string; firstName?: string; lastName?: string; needConfirmation?: boolean };
  if (!response.ok || !data.idToken || !data.localId || !data.email || data.emailVerified !== true || data.needConfirmation) throw new Error('Identity could not be verified');
  const email = data.email.trim().toLowerCase(), userId = `password:${data.localId}`, db = env.DB!;
  // Email ownership must never link an unrelated local/Firebase identity.
  const existing = await db.prepare('SELECT user_id, email, name, verified_at FROM password_accounts WHERE user_id=? OR email=?')
    .bind(userId, email).all<{ user_id: string; email: string; name: string; verified_at: number | null }>();
  if (existing.results.some(row => row.user_id !== userId || row.email !== email)) throw new Error('Account identity changed');
  const cleanName = (value: unknown) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 200) : '';
  // Apple may only supply the name on the first sign-in. Keep that name when
  // later responses omit it, and never manufacture one from an email address.
  const providerName = cleanName(data.displayName) || cleanName(data.fullName) ||
    cleanName([cleanName(data.firstName), cleanName(data.lastName)].filter(Boolean).join(' '));
  const name = providerName || cleanName(existing.results[0]?.name), now = Math.floor(Date.now() / 1000);
  if (existing.results.length) {
    await db.prepare('UPDATE password_accounts SET name=?, verified_at=?, password_hash=? WHERE user_id=?')
      .bind(name, existing.results[0].verified_at ?? now, `firebase:${data.localId}`, userId).run();
  } else {
    await db.prepare('INSERT INTO password_accounts (user_id,name,email,password_hash,verified_at,terms_accepted_at,terms_version,privacy_version,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(userId, name, email, `firebase:${data.localId}`, now, now, 'unspecified', 'unspecified', now).run();
  }
  const token = randomToken(), sessionTtl = 86400 * 30;
  await db.prepare('INSERT INTO password_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)')
    .bind(await tokenHash(token), userId, now + sessionTtl).run();
  const headers = new Headers();
  headers.append('Set-Cookie', authCookie(names(secure).password, token, sessionTtl, secure));
  headers.append('Set-Cookie', authCookie(cookieNames(secure).provider, 'password', sessionTtl, secure));
  clearTransaction(headers, secure);
  return headers;
}

export async function finishOAuth(request: Request, env: OAuthEnv, development = false): Promise<Response> {
  const secure = cookieSecurityForUrl(request.url, development);
  if (secure === null) return authJson({ error: 'A secure connection is required to sign in.' }, 403);
  if (request.method !== 'GET' && request.method !== 'POST') return authJson({ error: 'Method not allowed.' }, 405);
  if (request.method === 'POST' && request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() === 'application/x-www-form-urlencoded') {
    if (!secure || request.headers.get('origin') !== 'https://appleid.apple.com') return authJson({ error: 'Invalid origin.' }, 403);
    try {
      const text = await readAuthBody(request);
      if (text === null) return authJson({ error: 'OAuth response is too large.' }, 413);
      const values = new URLSearchParams(text);
      if (!validState(values)) return authJson({ error: 'Missing or invalid OAuth state.' }, 400);
      return callbackBridge(text);
    } catch { return authJson({ error: 'Invalid OAuth response.' }, 400); }
  }
  if (request.method === 'POST' && !isSameOrigin(request)) return authJson({ error: 'Invalid origin.' }, 403);
  if (!env.FIREBASE_API_KEY || !env.DB) return authJson({ error: 'Authentication service is unavailable.' }, 503);
  const cookieHeader = request.headers.get('cookie') ?? '';
  const sessionId = readTokenCookie(cookieHeader, names(secure).session), expectedState = readTokenCookie(cookieHeader, names(secure).state);
  const fail = (message: string, status = 401) => {
    if (request.method === 'GET') return redirect(request, message, secure);
    const headers = new Headers(); clearTransaction(headers, secure);
    return authJson({ redirectTo: `/signin?oauth_notice=${encodeURIComponent(message)}` }, status, headers);
  };
  if (!sessionId || !expectedState) return fail('OAuth session expired. Please sign in again.');
  const url = new URL(request.url);
  let values = url.searchParams, postBody: string | undefined;
  try {
    if (request.method === 'POST') {
      const text = await readAuthBody(request);
      if (text === null) return fail('OAuth response is too large.', 413);
      const body: unknown = JSON.parse(text);
      if (!body || typeof body !== 'object' || !('postBody' in body) || typeof body.postBody !== 'string') return fail('Missing OAuth response.', 400);
      postBody = body.postBody;
      values = new URLSearchParams(postBody);
    }
    if (request.method === 'GET' && !values.has('code') && !values.has('id_token') && !values.has('state')) {
      // Fragment credentials are bridged to POST; both transaction cookies and
      // the returned state are still validated before any credential exchange.
      return callbackBridge();
    }
    const state = validState(values);
    if (!state || await stateDigest(state) !== expectedState) return fail('OAuth session did not match. Please sign in again.');
    if (values.has('error')) return fail('Sign-in was cancelled. Please try again.');
    if ((!values.get('code') && !values.get('id_token')) || values.getAll('code').length > 1 || values.getAll('id_token').length > 1) return fail('Missing or invalid OAuth credentials.', 400);
    const headers = await complete(request, postBody, sessionId, env, secure);
    if (request.method === 'GET') { headers.set('Location', '/onboarding'); return authJson(null, 303, headers); }
    return authJson({ ok: true, redirectTo: '/onboarding' }, 200, headers);
  } catch { return fail('OAuth sign-in could not be verified. Please try again.'); }
}
