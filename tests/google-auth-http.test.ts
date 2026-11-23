import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
// @ts-ignore Node's built-in TS runner requires explicit extensions.
import { getGoogleClientId, handleChatGPTRequest, handleGoogleRequest, handleLogoutRequest, hasGoogleSessionCookie, hasSelectedGoogleProvider, readGoogleUser } from '../lib/auth/google.ts';
// @ts-ignore Node's built-in TS runner requires explicit extensions.
import { challengeCookieName, challengeCookies, MAX_OUTSTANDING_CHALLENGES, cookieNames, cookieSecurityForUrl, randomToken, readTokenCookie, tokenHash, SESSION_TTL_SECONDS, PROVIDER_TTL_SECONDS } from '../lib/auth/runtime.ts';
// @ts-ignore Node's built-in TS runner requires explicit extensions.
import { createAuthRepository, type AuthDatabase, type AuthRepository, type SessionRecord } from '../lib/auth/repository.ts';

const origin = 'https://harnesslaw.example';
const endpoint = `${origin}/api/auth/google`;
const clientId = 'test-client.apps.googleusercontent.com';
const env = { HARNESS_GOOGLE_CLIENT_ID: clientId };
const now = Math.floor(Date.now() / 1000);
const keys = await generateKeyPair('RS256', { extractable: true });
const publicJWK = { ...await exportJWK(keys.publicKey), kid: 'auth-http-test', alg: 'RS256', use: 'sig' };
const jwks = createLocalJWKSet({ keys: [publicJWK] });
const names = cookieNames(true);

class MemoryRepository implements AuthRepository {
  challenges = new Map<string, number>();
  sessions = new Map<string, SessionRecord>();
  async addChallenge(hash: string, expiresAt: number) { this.challenges.set(hash, expiresAt); }
  async readChallengeExpiry(hash: string) { return this.challenges.get(hash) ?? null; }
  async consumeChallenge(hash: string, time: number) {
    const expiration = this.challenges.get(hash);
    if (!expiration || expiration <= time) return false;
    this.challenges.delete(hash); return true;
  }
  async deleteChallenge(hash: string) { this.challenges.delete(hash); }
  async addSession(session: SessionRecord) { this.sessions.set(session.token_hash, session); }
  async readSession(hash: string, time: number) { const value = this.sessions.get(hash); return value && value.expires_at > time ? value : null; }
  async deleteSession(hash: string) { this.sessions.delete(hash); }
  async cleanupExpired(time: number) {
    for (const [key, expires] of [...this.challenges].filter(([, expires]) => expires <= time).slice(0, 100)) this.challenges.delete(key);
    for (const [key] of [...this.sessions].filter(([, value]) => value.expires_at <= time).slice(0, 100)) this.sessions.delete(key);
  }
}

function deps(repository: AuthRepository, time = now) { return { repository, jwks, now: () => time }; }
function request(method = 'GET', cookie = '', body?: unknown, headers: Record<string, string> = {}) {
  return new Request(endpoint, { method, headers: { origin, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
async function challenge(store: MemoryRepository, cookie = '', time = now) {
  const response = await handleGoogleRequest(request('GET', cookie), env, deps(store, time));
  assert.equal(response.status, 200);
  const data = await response.json() as { clientId: string; nonce: string };
  const name = challengeCookieName(data.nonce, true);
  return { ...data, name, response, cookie: `${name}=${data.nonce}` };
}
function signed(nonce: string, sub = '123456789012345678901', email = 'person@example.com') {
  return new SignJWT({ sub, email, email_verified: true, nonce, name: 'Alex Example' })
    .setProtectedHeader({ alg: 'RS256', kid: publicJWK.kid }).setIssuer('https://accounts.google.com').setAudience(clientId)
    .setIssuedAt(now).setExpirationTime(now + 3600).sign(keys.privateKey);
}
function responseCookie(response: Response, name: string) {
  return response.headers.getSetCookie().find(value => value.startsWith(`${name}=`))?.split(';', 1)[0] ?? '';
}
function updateCookieJar(header: string, response: Response): string {
  const jar = new Map(header.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const split = part.indexOf('='); return [part.slice(0, split), part.slice(split + 1)] as const;
  }));
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';', 1)[0], split = pair.indexOf('='), name = pair.slice(0, split);
    if (cookie.includes('Max-Age=0')) jar.delete(name);
    else jar.set(name, pair.slice(split + 1));
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

test('challenge is same-origin only, uncached, random, hashed in storage and protected by a host cookie', async () => {
  const store = new MemoryRepository();
  for (const bad of [
    new Request(endpoint), request('GET', '', undefined, { origin: 'https://attacker.example' }),
    request('GET', '', undefined, { 'sec-fetch-site': 'cross-site' }),
  ]) assert.equal((await handleGoogleRequest(bad, env, deps(store))).status, 403);
  const browserGet = new Request(endpoint, { headers: { 'sec-fetch-site': 'same-origin' } });
  const response = await handleGoogleRequest(browserGet, env, deps(store));
  const data = await response.json() as { clientId: string; nonce: string };
  assert.equal(data.clientId, clientId); assert.match(data.nonce, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(store.challenges.get(await tokenHash(data.nonce)), now + 600);
  assert.equal(store.challenges.has(data.nonce), false);
  const cookie = response.headers.get('set-cookie')!;
  assert.ok(cookie.startsWith(`${challengeCookieName(data.nonce, true)}=${data.nonce};`));
  for (const value of ['__Host-', 'HttpOnly', 'Secure', 'Path=/', 'SameSite=Lax', 'Max-Age=600']) assert.ok(cookie.includes(value));
  assert.ok(!cookie.includes('Domain=')); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.notEqual((await challenge(new MemoryRepository())).nonce, data.nonce);
});

test('verified login creates a distinct subject-based 24-hour session without returning the token', async () => {
  const store = new MemoryRepository(); const start = await challenge(store);
  const credential = await signed(start.nonce);
  const response = await handleGoogleRequest(request('POST', start.cookie, { credential, nonce: start.nonce }), env, deps(store));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, redirectTo: '/onboarding' });
  assert.equal(store.challenges.size, 0); assert.equal(store.sessions.size, 1);
  const cookie = responseCookie(response, names.session);
  const raw = readTokenCookie(cookie, names.session)!;
  assert.match(raw, /^[A-Za-z0-9_-]{43}$/);
  const saved = store.sessions.get(await tokenHash(raw))!;
  assert.equal(saved.user_id, 'google:123456789012345678901'); assert.equal(saved.email, 'person@example.com');
  assert.equal(saved.expires_at, now + SESSION_TTL_SECONDS); assert.ok(!store.sessions.has(raw));
  assert.ok(response.headers.getSetCookie().some(value => value.startsWith(`${start.name}=`) && value.includes('Max-Age=0')));
  const marker = responseCookie(response, names.provider);
  assert.equal(marker, `${names.provider}=google`);
  assert.equal(hasSelectedGoogleProvider(marker, true), true);
  assert.equal(hasGoogleSessionCookie(marker, true), false);
  assert.ok(PROVIDER_TTL_SECONDS > SESSION_TTL_SECONDS);
  assert.ok(response.headers.getSetCookie().some(value => value.startsWith(`${names.provider}=google`) && value.includes(`Max-Age=${400 * 24 * 60 * 60}`) && value.includes('Secure') && value.includes('HttpOnly')));
});

test('concurrent and repeated submissions can consume a challenge only once', async () => {
  const store = new MemoryRepository(); const start = await challenge(store); const credential = await signed(start.nonce);
  const responses = await Promise.all([1, 2].map(() => handleGoogleRequest(request('POST', start.cookie, { credential, nonce: start.nonce }), env, deps(store))));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 401]);
  assert.equal(store.sessions.size, 1);
  assert.equal((await handleGoogleRequest(request('POST', start.cookie, { credential, nonce: start.nonce }), env, deps(store))).status, 401);
});

test('simultaneous fresh challenges coexist and complete independently in a combined cookie jar', async () => {
  const store = new MemoryRepository();
  const [first, second] = await Promise.all([challenge(store), challenge(store)]);
  assert.notEqual(first.nonce, second.nonce); assert.notEqual(first.name, second.name);
  const jar = updateCookieJar(updateCookieJar('', first.response), second.response);
  assert.equal(challengeCookies(jar, true).length, 2);
  const responses = await Promise.all([first, second].map(async start => handleGoogleRequest(
    request('POST', jar, { credential: await signed(start.nonce), nonce: start.nonce }), env, deps(store),
  )));
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  assert.equal(store.challenges.size, 0); assert.equal(store.sessions.size, 2);
  for (const [index, response] of responses.entries()) {
    const used = index === 0 ? first : second, other = index === 0 ? second : first;
    const cleared = response.headers.getSetCookie().filter(cookie => cookie.includes('Max-Age=0'));
    assert.equal(cleared.length, 1);
    assert.ok(cleared[0].startsWith(`${used.name}=`));
    assert.ok(!response.headers.getSetCookie().some(cookie => cookie.startsWith(`${other.name}=`)));
    assert.equal((await handleGoogleRequest(request('POST', jar, { credential: await signed(used.nonce), nonce: used.nonce }), env, deps(store))).status, 401);
  }
});

test('missing, mismatched and expired nonce challenges cannot establish sessions', async () => {
  const store = new MemoryRepository(); const start = await challenge(store); const credential = await signed(start.nonce);
  assert.equal((await handleGoogleRequest(request('POST', '', { credential, nonce: start.nonce }), env, deps(store))).status, 401);
  assert.equal((await handleGoogleRequest(request('POST', start.cookie, { credential }), env, deps(store))).status, 400);
  assert.equal((await handleGoogleRequest(request('POST', start.cookie, { credential, nonce: 'short' }), env, deps(store))).status, 400);
  assert.equal((await handleGoogleRequest(request('POST', `${start.name}=${randomToken()}`, { credential, nonce: start.nonce }), env, deps(store))).status, 401);
  assert.equal((await handleGoogleRequest(request('POST', `${names.nonce}=${start.nonce}`, { credential, nonce: start.nonce }), env, deps(store))).status, 401);
  assert.equal((await handleGoogleRequest(request('POST', `${start.cookie}; ${start.cookie}`, { credential, nonce: start.nonce }), env, deps(store))).status, 401);
  const other = await challenge(store);
  assert.equal((await handleGoogleRequest(request('POST', start.cookie, { credential, nonce: other.nonce }), env, deps(store))).status, 401);
  assert.equal((await handleGoogleRequest(request('POST', `${start.cookie}; ${other.cookie}`, { credential, nonce: other.nonce }), env, deps(store))).status, 401);
  assert.equal((await handleGoogleRequest(request('POST', start.cookie, { credential, nonce: start.nonce }), env, deps(store, now + 600))).status, 401);
  assert.equal(store.sessions.size, 0);
});

test('challenge expiration is checked at consumption after token verification finishes', async () => {
  const store = new MemoryRepository(); const start = await challenge(store);
  let clockReads = 0;
  const response = await handleGoogleRequest(request('POST', start.cookie, { credential: await signed(start.nonce), nonce: start.nonce }), env, {
    repository: store, jwks, now: () => clockReads++ === 0 ? now : now + 601,
  });
  assert.equal(response.status, 401);
  assert.equal(store.sessions.size, 0);
});

test('POST rejects cross-origin requests, wrong media type, malformed JSON and oversized bodies', async () => {
  const store = new MemoryRepository(); const start = await challenge(store);
  assert.equal((await handleGoogleRequest(request('POST', start.cookie, { credential: 'x'.repeat(100), nonce: start.nonce }, { origin: 'https://attacker.example' }), env, deps(store))).status, 403);
  assert.equal((await handleGoogleRequest(request('POST', start.cookie, {}, { 'content-type': 'text/plain' }), env, deps(store))).status, 415);
  const malformed = new Request(endpoint, { method: 'POST', headers: { origin, cookie: start.cookie, 'content-type': 'application/json' }, body: '{' });
  assert.equal((await handleGoogleRequest(malformed, env, deps(store))).status, 400);
  assert.equal((await handleGoogleRequest(request('POST', start.cookie, { credential: 'x'.repeat(17000), nonce: start.nonce }), env, deps(store))).status, 413);
  assert.equal((await handleGoogleRequest(request('POST', start.cookie, { credential: 'x'.repeat(100), nonce: start.nonce, userId: 'forged' }), env, deps(store))).status, 400);
  assert.equal(store.sessions.size, 0);
});

test('same email does not link different Google subject identities', async () => {
  const store = new MemoryRepository();
  for (const subject of ['subject-one', 'subject-two']) {
    const start = await challenge(store);
    const response = await handleGoogleRequest(request('POST', start.cookie, { credential: await signed(start.nonce, subject), nonce: start.nonce }), env, deps(store));
    assert.equal(response.status, 200);
  }
  assert.deepEqual([...store.sessions.values()].map(session => session.user_id).sort(), ['google:subject-one', 'google:subject-two']);
});

test('a new login rotates the current session without invalidating another pending attempt', async () => {
  const store = new MemoryRepository(); const first = await challenge(store);
  const login = await handleGoogleRequest(request('POST', first.cookie, { credential: await signed(first.nonce), nonce: first.nonce }), env, deps(store));
  const sessionCookie = responseCookie(login, names.session); const previousToken = readTokenCookie(sessionCookie, names.session)!;
  const second = await challenge(store);
  const thirdResponse = await handleGoogleRequest(request('GET', second.cookie), env, deps(store));
  const third = await thirdResponse.json() as { nonce: string };
  assert.notEqual(third.nonce, second.nonce);
  assert.equal(store.challenges.get(await tokenHash(second.nonce)), now + 600);
  assert.equal(store.challenges.size, 2);
  const thirdCookie = `${challengeCookieName(third.nonce, true)}=${third.nonce}`;
  const next = await handleGoogleRequest(request('POST', `${sessionCookie}; ${second.cookie}; ${thirdCookie}`, { credential: await signed(third.nonce, 'another-person'), nonce: third.nonce }), env, deps(store));
  assert.equal(next.status, 200); assert.equal(store.sessions.size, 1);
  assert.equal(store.sessions.has(await tokenHash(previousToken)), false);
  assert.equal(store.challenges.has(await tokenHash(second.nonce)), true);
});

test('fresh attempts have independent deadlines and expired attempts are cleaned up', async () => {
  const store = new MemoryRepository(); const start = await challenge(store);
  const second = await challenge(store, start.cookie, now + 100);
  assert.notEqual(second.nonce, start.nonce);
  assert.ok(second.response.headers.get('set-cookie')!.includes('Max-Age=600'));
  assert.equal(store.challenges.get(await tokenHash(start.nonce)), now + 600);
  assert.equal(store.challenges.get(await tokenHash(second.nonce)), now + 700);
  const renewed = await challenge(store, `${start.cookie}; ${second.cookie}`, now + 600);
  assert.notEqual(renewed.nonce, start.nonce);
  assert.notEqual(renewed.nonce, second.nonce);
  assert.equal(store.challenges.has(await tokenHash(start.nonce)), false);
  assert.equal(store.challenges.has(await tokenHash(second.nonce)), true);
});

test('challenge creation bounds the browser to ten attempts and revokes the oldest first', async () => {
  assert.equal(MAX_OUTSTANDING_CHALLENGES, 10);
  const store = new MemoryRepository(); const attempts: Awaited<ReturnType<typeof challenge>>[] = [];
  let jar = '';
  for (let index = 0; index < MAX_OUTSTANDING_CHALLENGES; index++) {
    const start = await challenge(store, jar, now + index);
    attempts.push(start); jar = updateCookieJar(jar, start.response);
  }
  assert.equal(challengeCookies(jar, true).length, 10); assert.equal(store.challenges.size, 10);
  const newest = await challenge(store, jar, now + 10);
  jar = updateCookieJar(jar, newest.response);
  assert.equal(challengeCookies(jar, true).length, 10); assert.equal(store.challenges.size, 10);
  assert.equal(store.challenges.has(await tokenHash(attempts[0].nonce)), false);
  assert.ok(newest.response.headers.getSetCookie().some(cookie => cookie.startsWith(`${attempts[0].name}=`) && cookie.includes('Max-Age=0')));
  for (const retained of attempts.slice(1)) assert.equal(store.challenges.has(await tokenHash(retained.nonce)), true);
  assert.equal(store.challenges.has(await tokenHash(newest.nonce)), true);
});

test('logout and explicit ChatGPT switching revoke Google state and redirect through hosted auth', async () => {
  for (const [handler, location] of [[handleLogoutRequest, '/signout-with-chatgpt?return_to=%2Fsignin'], [handleChatGPTRequest, '/signin-with-chatgpt?return_to=%2Fonboarding']] as const) {
    const store = new MemoryRepository(); const start = await challenge(store);
    const login = await handleGoogleRequest(request('POST', start.cookie, { credential: await signed(start.nonce), nonce: start.nonce }), env, deps(store));
    const pending = await Promise.all([challenge(store), challenge(store)]);
    const legacy = randomToken(); await store.addChallenge(await tokenHash(legacy), now + 600);
    const cookie = `${responseCookie(login, names.session)}; ${responseCookie(login, names.provider)}; ${pending.map(attempt => attempt.cookie).join('; ')}; ${names.nonce}=${legacy}`;
    assert.equal((await handler(request('GET', cookie), env, deps(store))).status, 405);
    assert.equal((await handler(request('POST', cookie, undefined, { origin: 'https://attacker.example' }), env, deps(store))).status, 403);
    assert.equal(store.sessions.size, 1); assert.equal(store.challenges.size, 3);
    const response = await handler(request('POST', cookie), env, deps(store));
    assert.equal(response.status, 303); assert.equal(response.headers.get('location'), location); assert.equal(store.sessions.size, 0);
    assert.equal(store.challenges.size, 0);
    assert.equal(response.headers.getSetCookie().length, 5);
    assert.ok(response.headers.getSetCookie().every(value => value.includes('Max-Age=0') && value.includes('Secure')));
    assert.ok(response.headers.getSetCookie().some(value => value.startsWith(`${names.provider}=`)));
    for (const name of [names.nonce, ...pending.map(attempt => attempt.name)]) assert.ok(response.headers.getSetCookie().some(value => value.startsWith(`${name}=`)));
  }
});

test('logout and provider switching revoke every attempt, legacy nonce, and session in both development modes', async () => {
  for (const handler of [handleLogoutRequest, handleChatGPTRequest]) {
    const store = new MemoryRepository(); const jar: string[] = []; const expectedCleared: string[] = [];
    for (const secure of [true, false]) {
      const modeNames = cookieNames(secure), token = randomToken(), legacy = randomToken();
      await store.addSession({ token_hash: await tokenHash(token), user_id: 'google:subject', email: 'person@example.com', full_name: null, expires_at: now + 300 });
      await store.addChallenge(await tokenHash(legacy), now + 600);
      jar.push(`${modeNames.session}=${token}`, `${modeNames.provider}=google`, `${modeNames.nonce}=${legacy}`);
      expectedCleared.push(modeNames.session, modeNames.provider, modeNames.nonce);
      for (let attempt = 0; attempt < 2; attempt++) {
        const nonce = randomToken(), name = challengeCookieName(nonce, secure);
        await store.addChallenge(await tokenHash(nonce), now + 600);
        jar.push(`${name}=${nonce}`); expectedCleared.push(name);
      }
    }
    assert.equal(store.challenges.size, 6);
    const localRequest = new Request('https://localhost:5173/api/auth/chatgpt', { method: 'POST', headers: { origin: 'https://localhost:5173', cookie: jar.join('; ') } });
    const response = await handler(localRequest, env, { ...deps(store), development: true });
    assert.equal(response.status, 303); assert.equal(store.sessions.size, 0); assert.equal(store.challenges.size, 0);
    assert.equal(response.headers.getSetCookie().length, 10);
    assert.ok(response.headers.getSetCookie().every(value => value.includes('Max-Age=0')));
    for (const name of expectedCleared) assert.ok(response.headers.getSetCookie().some(value => value.startsWith(`${name}=`)));
  }
});

test('unconfigured or unavailable storage never creates a successful login or claims a revocation', async () => {
  assert.equal(getGoogleClientId({ HARNESS_GOOGLE_CLIENT_ID: 'not-a-client' }), null);
  assert.equal(getGoogleClientId({ HARNESS_GOOGLE_CLIENT_ID: clientId }), clientId);
  assert.equal((await handleGoogleRequest(request(), {}, {})).status, 503);
  assert.equal((await handleGoogleRequest(request(), env)).status, 503);
  const store = new MemoryRepository(); const start = await challenge(store);
  store.addSession = async () => { throw new Error('private storage detail'); };
  const failed = await handleGoogleRequest(request('POST', start.cookie, { credential: await signed(start.nonce), nonce: start.nonce }), env, deps(store));
  assert.equal(failed.status, 503); assert.equal(failed.headers.get('set-cookie'), null);
  assert.doesNotMatch(await failed.text(), /private storage detail/);
  const tokenCookie = `${names.session}=${randomToken()}`;
  const logout = await handleLogoutRequest(request('POST', tokenCookie), env);
  assert.equal(logout.status, 503); assert.equal(logout.headers.get('set-cookie'), null);
  assert.equal((await handleLogoutRequest(request('POST'), {})).status, 303);
});

test('secure cookie selection rejects downgrade and duplicate tokens while permitting explicit local development only', () => {
  assert.equal(cookieSecurityForUrl('https://harnesslaw.example'), true);
  assert.equal(cookieSecurityForUrl('http://harnesslaw.example', true), null);
  assert.equal(cookieSecurityForUrl('http://localhost:5173', false), null);
  assert.equal(cookieSecurityForUrl('http://localhost:5173', true), false);
  assert.equal(cookieSecurityForUrl('http://127.0.0.1:5173', true), false);
  const secureToken = randomToken(), local = cookieNames(false).session;
  assert.equal(hasGoogleSessionCookie(`${names.session}=malformed`, true), true);
  assert.equal(hasGoogleSessionCookie(`${local}=${secureToken}`, true), false);
  assert.equal(hasSelectedGoogleProvider(`${cookieNames(false).provider}=google`, true), false);
  assert.equal(hasSelectedGoogleProvider(`${names.provider}=google`, true), true);
  assert.equal(readTokenCookie(`${names.session}=${secureToken}; ${names.session}=${secureToken}`, names.session), null);
  assert.equal(readTokenCookie(`${names.session}=short`, names.session), null);
});

test('session lookup uses its hashed token, expiry and provider namespace', async () => {
  const token = randomToken(), hash = await tokenHash(token);
  let record: SessionRecord | null = { token_hash: hash, user_id: 'google:verified-sub', email: 'person@example.com', full_name: 'Alex Example', expires_at: now + 300 };
  const db = { prepare(sql: string) { assert.match(sql, /auth_sessions/); return { bind(actualHash: string, time: number) { assert.equal(actualHash, hash); return { async first() { return record && record.expires_at > time ? record : null; } }; } }; } } as unknown as AuthDatabase;
  assert.deepEqual(await readGoogleUser(db, `${names.session}=${token}`, true), { userId: 'google:verified-sub', email: 'person@example.com', fullName: 'Alex Example', displayName: 'Alex Example', provider: 'google' });
  record = { ...record!, expires_at: now - 1 };
  assert.equal(await readGoogleUser(db, `${names.session}=${token}`, true), null);
  assert.equal(await readGoogleUser(db, `${names.nonce}=${token}`, true), null);
  assert.equal(await readGoogleUser(db, `${cookieNames(false).session}=${token}`, true), null);
});

test('D1 repository consumes nonce with atomic DELETE RETURNING and bounds each cleanup query', async () => {
  const queries: string[] = [];
  const db = { prepare(sql: string) { queries.push(sql); return { bind(...values: unknown[]) { return { async first() { assert.deepEqual(values, ['nonce-hash', now]); return { nonce_hash: 'nonce-hash' }; }, async run() { return {}; } }; } }; } } as unknown as AuthDatabase;
  const repository = createAuthRepository(db);
  assert.equal(await repository.consumeChallenge('nonce-hash', now), true);
  assert.match(queries[0], /^DELETE .*expires_at > \? RETURNING nonce_hash$/);
  await repository.cleanupExpired(now);
  assert.equal(queries.slice(1).length, 2);
  assert.ok(queries.slice(1).every(query => query.includes('LIMIT 100')));
});
