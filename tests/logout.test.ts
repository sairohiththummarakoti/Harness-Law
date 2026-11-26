import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
// @ts-ignore Node's built-in test runner requires explicit TypeScript extensions.
import { handleAppLogout } from '../lib/auth/logout.ts';
// @ts-ignore Node's built-in test runner requires explicit TypeScript extensions.
import { challengeCookieName, cookieNames, randomToken, tokenHash } from '../lib/auth/runtime.ts';

const origin = 'https://harnesslaw.test';
const hostedLogout = '/signout-with-chatgpt?return_to=%2Fsignin';
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0002_google_signin.sql', '0006_password_accounts.sql']) {
    sqlite.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), 'utf8'));
  }
  sqlite.prepare('INSERT INTO password_accounts (user_id,name,email,password_hash,verified_at,terms_accepted_at,created_at) VALUES (?,?,?,?,?,?,?)')
    .run('password:applicant', 'Applicant', 'applicant@example.test', 'firebase:applicant', 1, 1, 1);
  let failTable = '';
  const db = { prepare(sql: string) {
    if (failTable && sql.includes(failTable)) throw new Error('Private database failure');
    return { bind(...values: (string | number | null)[]) { return {
      async run() { return sqlite.prepare(sql).run(...values); },
    }; } };
  } } as unknown as D1Database;
  async function seed(secure = true) {
    const google = randomToken(), password = randomToken(), nonce = randomToken();
    sqlite.prepare('INSERT INTO auth_sessions (token_hash,user_id,email,full_name,expires_at) VALUES (?,?,?,?,?)')
      .run(await tokenHash(google), 'google:applicant', 'applicant@example.test', 'Applicant', 9999999999);
    sqlite.prepare('INSERT INTO password_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)')
      .run(await tokenHash(password), 'password:applicant', 9999999999);
    sqlite.prepare('INSERT INTO auth_challenges (nonce_hash,expires_at) VALUES (?,?)').run(await tokenHash(nonce), 9999999999);
    const names = cookieNames(secure), passwordName = secure ? '__Host-harness_password_session' : 'harness_password_session_dev';
    return {
      cookie: `${names.session}=${google}; ${names.provider}=password; ${passwordName}=${password}; ${challengeCookieName(nonce, secure)}=${nonce}`,
      passwordCookie: `${passwordName}=${password}`,
      expectedNames: [names.session, names.provider, names.nonce, passwordName, challengeCookieName(nonce, secure), secure ? '__Host-harness_oauth_state' : 'harness_oauth_state_dev', secure ? '__Host-harness_oauth_session' : 'harness_oauth_session_dev'],
    };
  }
  const count = (table: string) => Number(sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get()!.count);
  return { sqlite, env: { DB: db }, seed, count, fail(table: string) { failTable = table; } };
}
function request(cookie = '', accept = 'text/html', method = 'POST', base = origin, requestOrigin = base) {
  return new Request(`${base}/api/auth/logout`, { method, headers: { origin: requestOrigin, cookie, accept } });
}

test('ChatGPT-only form logout delegates to hosted logout before returning to sign-in', async () => {
  const response = await handleAppLogout(request(), {});
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), hostedLogout);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('mixed provider logout revokes both stored sessions and retains every clearing cookie', async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const session = await f.seed();
  const response = await handleAppLogout(request(session.cookie), f.env);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), hostedLogout);
  for (const table of ['auth_sessions', 'password_sessions', 'auth_challenges']) assert.equal(f.count(table), 0);
  const cleared = response.headers.getSetCookie();
  for (const name of session.expectedNames) assert.ok(cleared.some(cookie => cookie.startsWith(`${name}=`) && cookie.includes('Max-Age=0')));
  assert.ok(cleared.every(cookie => cookie.includes('HttpOnly') && cookie.includes('Secure')));
});

test('JSON logout returns the required hosted redirect and revokes password sessions', async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const session = await f.seed();
  const response = await handleAppLogout(request(session.passwordCookie, 'application/json'), f.env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, redirectTo: hostedLogout });
  assert.equal(response.headers.get('Location'), null);
  assert.equal(f.count('password_sessions'), 0);
  assert.ok(response.headers.getSetCookie().some(cookie => cookie.startsWith('__Host-harness_password_session=') && cookie.includes('Max-Age=0')));
});

test('invalid logout requests neither revoke sessions nor masquerade as successful redirects', async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const session = await f.seed();
  for (const [req, status] of [
    [request(session.cookie, 'text/html', 'GET'), 405],
    [request(session.cookie, 'text/html', 'POST', origin, 'https://attacker.test'), 403],
    [request(session.cookie, 'text/html', 'POST', 'http://harnesslaw.test'), 403],
  ] as const) {
    const response = await handleAppLogout(req, f.env);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('Location'), null);
    assert.equal(response.headers.get('Set-Cookie'), null);
  }
  assert.equal(f.count('password_sessions'), 1);
  assert.equal(f.count('auth_sessions'), 1);
});

test('storage failures stay failures for either provider, without leaking database details', async t => {
  for (const table of ['auth_sessions', 'password_sessions']) {
    const f = fixture(); t.after(() => f.sqlite.close());
    const session = await f.seed(); f.fail(table);
    const response = await handleAppLogout(request(session.cookie), f.env);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Location'), null);
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.doesNotMatch(await response.text(), /Private database failure/);
  }
});

test('local sign-out clears both cookie modes, while stale malformed cookies cannot block hosted sign-out', async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const secure = await f.seed(true), local = await f.seed(false);
  const response = await handleAppLogout(request(`${secure.cookie}; ${local.cookie}`, 'text/html', 'POST', 'http://localhost:5173'), f.env, true);
  assert.equal(response.status, 303);
  for (const table of ['auth_sessions', 'password_sessions', 'auth_challenges']) assert.equal(f.count(table), 0);
  const cleared = response.headers.getSetCookie();
  for (const name of [...secure.expectedNames, ...local.expectedNames]) assert.ok(cleared.some(cookie => cookie.startsWith(`${name}=`) && cookie.includes('Max-Age=0')));
  const stale = await handleAppLogout(request('__Host-harness_password_session=malformed; __Host-harness_auth_provider=password'), {});
  assert.equal(stale.status, 303);
  assert.equal(stale.headers.get('Location'), hostedLogout);
  assert.ok(stale.headers.getSetCookie().some(cookie => cookie.startsWith('__Host-harness_password_session=')));
});
