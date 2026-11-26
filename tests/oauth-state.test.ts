import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
// @ts-ignore Explicit TypeScript extension for Node's test runner.
import { finishOAuth, startOAuth } from '../lib/auth/oauth.ts';

const origin = 'https://harnesslaw.test';
const state = 'opaque-firebase-state/with+characters';
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0006_password_accounts.sql', '0007_account_policy_versions.sql']) sqlite.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), 'utf8'));
  const db = { prepare(sql: string) { return { bind(...values: (string | number | null)[]) { return {
    async first<T>() { return (sqlite.prepare(sql).get(...values) as T | undefined) ?? null; },
    async all<T>() { return { results: sqlite.prepare(sql).all(...values) as T[] }; },
    async run() { return sqlite.prepare(sql).run(...values); },
  }; } }; } };
  const calls: { endpoint: string; body: Record<string, unknown> }[] = [];
  let identity = { idToken: 'firebase-token', localId: 'firebase-user', email: 'applicant@example.com', emailVerified: true, displayName: 'Applicant' };
  let mismatchSession = false;
  const env = { DB: db as unknown as D1Database, FIREBASE_API_KEY: 'test-only', fetch: (async (input, init) => {
    const endpoint = String(input), body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ endpoint, body });
    if (endpoint.includes('createAuthUri')) return Response.json({ authUri: `https://accounts.google.com/o/oauth2/auth?state=${encodeURIComponent(state)}`, sessionId: mismatchSession ? 'mismatch' : body.sessionId });
    if (endpoint.includes('signInWithIdp')) return Response.json(identity);
    throw new Error('Unexpected external request');
  }) as typeof fetch };
  return { sqlite, env, calls, setVerified(value: boolean) { identity = { ...identity, emailVerified: value }; }, mismatchSession() { mismatchSession = true; } };
}
async function begin(f: ReturnType<typeof fixture>) {
  const response = await startOAuth(new Request(`${origin}/api/auth/oauth/google`), 'google', f.env);
  assert.equal(response.status, 303);
  assert.match(response.headers.get('Location')!, /^https:\/\/accounts\.google\.com/);
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  for (const cookie of cookies) assert.match(cookie, /HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
  return cookies.map(cookie => cookie.split(';')[0]).join('; ');
}
function callback(cookie: string, values: URLSearchParams, method = 'POST') {
  return new Request(`${origin}/api/auth/oauth/callback${method === 'GET' ? `?${values}` : ''}`, {
    method, headers: { cookie, origin, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify({ postBody: values.toString() }) } : {}),
  });
}

test('OAuth transaction exchanges only the matching state and original Firebase session ID', async () => {
  const f = fixture(); try {
    const cookie = await begin(f);
    const response = await finishOAuth(callback(cookie, new URLSearchParams({ state, id_token: 'provider-token' })), f.env);
    assert.equal(response.status, 200);
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].body.sessionId, f.calls[0].body.sessionId);
    assert.equal(new URLSearchParams(f.calls[1].body.postBody as string).get('state'), state);
    assert.equal(f.calls[1].body.requestUri, `${origin}/api/auth/oauth/callback`);
    const row = f.sqlite.prepare('SELECT user_id,password_hash FROM password_accounts').get() as { user_id: string; password_hash: string };
    assert.equal(row.user_id, 'password:firebase-user'); assert.equal(row.password_hash, 'firebase:firebase-user');
    assert.ok(response.headers.getSetCookie().some(value => value.startsWith('__Host-harness_password_session=')));
    assert.equal(response.headers.getSetCookie().filter(value => /harness_oauth_.*Max-Age=0/.test(value)).length, 2);
  } finally { f.sqlite.close(); }
});

test('OAuth rejects missing, mismatched, duplicate state and missing transaction cookies before exchange', async () => {
  const f = fixture(); try {
    const cookie = await begin(f);
    const cases = [new URLSearchParams({ id_token: 'token' }), new URLSearchParams({ state: 'attacker-state', id_token: 'token' }), new URLSearchParams([['state', state], ['state', state], ['id_token', 'token']])];
    for (const values of cases) assert.equal((await finishOAuth(callback(cookie, values), f.env)).status, 401);
    const valid = new URLSearchParams({ state, id_token: 'token' });
    assert.equal((await finishOAuth(callback('', valid), f.env)).status, 401);
    assert.equal((await finishOAuth(callback(cookie.split('; ')[0], valid), f.env)).status, 401);
    assert.equal((await finishOAuth(callback(`${cookie}; ${cookie.split('; ')[0]}`, valid), f.env)).status, 401);
    assert.equal(f.calls.length, 1);
    assert.equal((f.sqlite.prepare('SELECT COUNT(*) n FROM password_sessions').get() as { n: number }).n, 0);
  } finally { f.sqlite.close(); }
});

test('OAuth code callback preserves the complete request URI and validates state', async () => {
  const f = fixture(); try {
    const cookie = await begin(f), request = callback(cookie, new URLSearchParams({ state, code: 'authorization-code' }), 'GET');
    const response = await finishOAuth(request, f.env);
    assert.equal(response.status, 303); assert.equal(response.headers.get('Location'), '/onboarding');
    assert.equal(f.calls[1].body.requestUri, request.url);
    assert.equal(f.calls[1].body.sessionId, f.calls[0].body.sessionId);
    assert.equal(f.calls[1].body.postBody, undefined);
  } finally { f.sqlite.close(); }
});

test('OAuth fragment bridge requires a transaction and keeps credentials out of referrers', async () => {
  const f = fixture(); try {
    const cookie = await begin(f);
    const response = await finishOAuth(new Request(`${origin}/api/auth/oauth/callback`, { headers: { cookie } }), f.env);
    assert.equal(response.status, 200); assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
    assert.match(response.headers.get('Content-Security-Policy')!, /default-src 'none'/);
    assert.match(await response.text(), /history\.replaceState/); assert.equal(f.calls.length, 1);
  } finally { f.sqlite.close(); }
});

test('OAuth cannot claim another account by matching email or use an unverified identity', async () => {
  const f = fixture(); try {
    const cookie = await begin(f);
    f.setVerified(false);
    assert.equal((await finishOAuth(callback(cookie, new URLSearchParams({ state, id_token: 'token' })), f.env)).status, 401);
    f.setVerified(true);
    f.sqlite.prepare('INSERT INTO password_accounts(user_id,name,email,password_hash,verified_at,terms_accepted_at,created_at) VALUES(?,?,?,?,?,?,?)').run('password:existing-local', 'Existing', 'applicant@example.com', 'native-password-hash', 1, 1, 1);
    assert.equal((await finishOAuth(callback(cookie, new URLSearchParams({ state, id_token: 'token' })), f.env)).status, 401);
    const row = f.sqlite.prepare('SELECT user_id,password_hash FROM password_accounts').get() as { user_id: string; password_hash: string };
    assert.equal(row.user_id, 'password:existing-local'); assert.equal(row.password_hash, 'native-password-hash');
    assert.equal((f.sqlite.prepare('SELECT COUNT(*) n FROM password_sessions').get() as { n: number }).n, 0);
  } finally { f.sqlite.close(); }
});

test('OAuth fails closed for a mismatched Firebase start session, cross-origin POST and oversized response', async () => {
  const f = fixture(); try {
    f.mismatchSession();
    const response = await startOAuth(new Request(`${origin}/api/auth/oauth/google`), 'google', f.env);
    assert.match(response.headers.get('Location')!, /\/signin\?/);
    assert.ok(response.headers.getSetCookie().every(cookie => cookie.includes('Max-Age=0')));
    const crossOrigin = new Request(`${origin}/api/auth/oauth/callback`, { method: 'POST', headers: { origin: 'https://elsewhere.test' }, body: '{}' });
    assert.equal((await finishOAuth(crossOrigin, f.env)).status, 403);
    const cookie = '__Host-harness_oauth_state=' + 'a'.repeat(43) + '; __Host-harness_oauth_session=' + 'b'.repeat(43);
    const oversized = callback(cookie, new URLSearchParams({ state, id_token: 'x'.repeat(17000) }));
    assert.equal((await finishOAuth(oversized, f.env)).status, 413);
  } finally { f.sqlite.close(); }
});
