export const CHALLENGE_TTL_SECONDS = 10 * 60;
export const SESSION_TTL_SECONDS = 24 * 60 * 60;
export const PROVIDER_TTL_SECONDS = 400 * 24 * 60 * 60;
export const MAX_AUTH_BODY_BYTES = 16 * 1024;
export const MAX_OUTSTANDING_CHALLENGES = 10;

export function cookieNames(secure: boolean) {
  return secure
    ? { nonce: '__Host-harness_google_nonce', session: '__Host-harness_google_session', provider: '__Host-harness_auth_provider' }
    : { nonce: 'harness_google_nonce_dev', session: 'harness_google_session_dev', provider: 'harness_auth_provider_dev' };
}

/** Never infer security from a client-supplied forwarding header. */
export function cookieSecurityForUrl(value: string | URL, development = process.env.NODE_ENV === 'development'): boolean | null {
  try {
    const url = typeof value === 'string' ? new URL(value) : value;
    if (url.protocol === 'https:') return true;
    if (development && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return false;
  } catch { /* Invalid origins cannot receive authentication cookies. */ }
  return null;
}

export function validToken(value: string): boolean { return /^[A-Za-z0-9_-]{43}$/.test(value); }

export function readTokenCookie(header: string, name: string): string | null {
  const matches = header.split(';').map(part => part.trim()).filter(part => part.slice(0, part.indexOf('=')) === name);
  if (matches.length !== 1) return null;
  const value = matches[0].slice(matches[0].indexOf('=') + 1);
  return validToken(value) ? value : null;
}

export function challengeCookieName(nonce: string, secure: boolean): string {
  return `${cookieNames(secure).nonce}_${nonce.slice(0, 16)}`;
}

/** Cookie headers retain creation order for these identically scoped cookies. */
export function challengeCookies(header: string, secure: boolean): { name: string; nonce: string }[] {
  const legacyName = cookieNames(secure).nonce;
  const seen = new Set<string>();
  const result: { name: string; nonce: string }[] = [];
  for (const item of header.split(';')) {
    const part = item.trim(), separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator);
    if (seen.has(name) || (name !== legacyName && !name.startsWith(`${legacyName}_`))) continue;
    seen.add(name);
    const nonce = readTokenCookie(header, name);
    if (nonce && (name === legacyName || name === challengeCookieName(nonce, secure))) result.push({ name, nonce });
  }
  return result;
}

export function hasGoogleSessionCookie(header: string, secure: boolean): boolean {
  const name = cookieNames(secure).session;
  return header.split(';').some(part => part.trim().split('=', 1)[0] === name);
}

/** A provider choice outlives its session so expiry cannot select another account. */
export function hasSelectedGoogleProvider(header: string, secure: boolean): boolean {
  return header.split(';').some(part => part.trim() === `${cookieNames(secure).provider}=google`);
}

export function authCookie(name: string, value: string, maxAge: number, secure: boolean): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function clearAuthCookies(headers: Headers, secure: boolean) {
  const names = cookieNames(secure);
  headers.append('Set-Cookie', authCookie(names.nonce, '', 0, secure));
  headers.append('Set-Cookie', authCookie(names.session, '', 0, secure));
  headers.append('Set-Cookie', authCookie(names.provider, '', 0, secure));
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function isSameOrigin(request: Request, challengeGet = false): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  const origin = request.headers.get('origin');
  if (!origin) return challengeGet && site === 'same-origin';
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

export function authJson(data: unknown, status = 200, headers = new Headers()): Response {
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('Referrer-Policy', 'no-referrer');
  return Response.json(data, { status, headers });
}

export async function readAuthBody(request: Request): Promise<string | null> {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_AUTH_BODY_BYTES)) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_AUTH_BODY_BYTES) { await reader.cancel(); return null; }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
