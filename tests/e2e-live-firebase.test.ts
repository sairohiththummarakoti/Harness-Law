import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
// @ts-ignore
import { handlePasswordAuth, readPasswordUser } from '../lib/auth/email-password.ts';
// @ts-ignore
import { tokenHash } from '../lib/auth/runtime.ts';
// @ts-ignore
import { firebaseDeleteUser, firebaseSignIn } from '../lib/auth/firebase.ts';

const origin = 'https://harnesslaw.test';
const LIVE_FIREBASE_API_KEY = 'AIzaSyAhyv2Sx2w8jWOh0Ol0yq4taiuDAEU-Cf8';
const LIVE_PROJECT_ID = 'harness-ai-39545';

function liveFixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0003_password_accounts.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../drizzle/0004_account_policy_versions.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../drizzle/0000_same_leopardon.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../drizzle/0001_integration_cases.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../drizzle/0002_google_signin.sql', import.meta.url), 'utf8'));

  const db = {
    prepare(sql: string) {
      return {
        bind(...values: (string | number | null)[]) {
          return {
            async first<T>() { return (sqlite.prepare(sql).get(...values) as T | undefined) ?? null; },
            async all<T>() { return { results: sqlite.prepare(sql).all(...values) as T[] }; },
            async run() { return sqlite.prepare(sql).run(...values); },
          };
        }
      };
    },
    async batch(statements: { run(): Promise<unknown> }[]) {
      sqlite.exec('BEGIN');
      try {
        const result = [];
        for (const statement of statements) result.push(await statement.run());
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };

  const messages: { to: string; subject: string; text: string }[] = [];
  const env = {
    DB: db,
    FIREBASE_API_KEY: LIVE_FIREBASE_API_KEY,
    FIREBASE_PROJECT_ID: LIVE_PROJECT_ID,
    EMAIL: {
      async send(message: { to: string; subject: string; text: string }) {
        messages.push(message);
      }
    },
    HARNESS_MAIL_MODE: 'local',
    HARNESS_MAIL_FROM: 'Harness Law <no-reply@example.test>',
    HARNESS_TERMS_VERSION: 'test-terms-v1',
    HARNESS_PRIVACY_VERSION: 'test-privacy-v1',
    HARNESS_TURNSTILE_SITE_KEY: 'test-site',
    HARNESS_TURNSTILE_SECRET_KEY: 'test-secret',
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/siteverify')) {
        return Response.json({ success: true, hostname: 'harnesslaw.test' });
      }
      return fetch(input, init);
    }
  };

  return { sqlite, db, env, messages };
}

function req(action: string, method = 'POST', body?: unknown, token?: string) {
  return new Request(`${origin}/api/auth/email/${action}${token ? `?token=${token}` : ''}`, {
    method,
    headers: { origin, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
}

async function send(f: ReturnType<typeof liveFixture>, action: string, body: unknown, actor?: string) {
  const withBot = ['register', 'login', 'forgot', 'resend', 'reset'].includes(action)
    ? { ...(body as object), turnstileToken: 'test-turnstile' }
    : body;
  return handlePasswordAuth(req(action, 'POST', withBot), f.env as never, action as never, actor);
}

test('Comprehensive End-to-End Live Firebase Auth Requirements Verification', async () => {
  const f = liveFixture();
  const testEmail = `e2e_test_${Date.now()}@harnesslaw.test`;
  const testPassword = 'StrongPassword123!#';
  let createdFirebaseIdToken = '';

  try {
    // ----------------------------------------------------
    // Requirement 1: Sign-Up validation & unique email check
    // ----------------------------------------------------
    // Missing required fields rejection
    const invalidName = await send(f, 'register', { name: '', email: testEmail, password: testPassword, acceptedTerms: true });
    assert.equal(invalidName.status, 422, 'Empty name must be rejected');

    const invalidTerms = await send(f, 'register', { name: 'E2E User', email: testEmail, password: testPassword, acceptedTerms: false });
    assert.equal(invalidTerms.status, 422, 'Unaccepted terms must be rejected');

    const shortPassword = await send(f, 'register', { name: 'E2E User', email: testEmail, password: 'short', acceptedTerms: true });
    assert.equal(shortPassword.status, 422, 'Password < 8 chars must be rejected');

    // Valid Sign-Up with Firebase Auth-as-a-Service
    const regRes = await send(f, 'register', { name: 'E2E Applicant', email: testEmail, password: testPassword, acceptedTerms: true });
    assert.equal(regRes.status, 202, 'Registration must return 202 Accepted');
    const regJson = await regRes.json() as { ok: boolean; message: string };
    assert.equal(regJson.ok, true);

    // Duplicate email registration must be rejected with 409 Conflict
    const dupRes = await send(f, 'register', { name: 'Another Applicant', email: testEmail, password: testPassword, acceptedTerms: true });
    assert.equal(dupRes.status, 409, 'Duplicate email registration must return 409 Conflict');

    // ----------------------------------------------------
    // Requirement 2 & 3: Unverified Account blocked from login
    // ----------------------------------------------------
    const unverifiedLogin = await send(f, 'login', { email: testEmail, password: testPassword });
    assert.equal(unverifiedLogin.status, 403, 'Unverified account must be blocked with HTTP 403');
    const unverifiedJson = await unverifiedLogin.json() as { code: string };
    assert.equal(unverifiedJson.code, 'email_unverified');

    // Incorrect password must return 401
    const wrongPass = await send(f, 'login', { email: testEmail, password: 'WrongPassword123!' });
    assert.equal(wrongPass.status, 401, 'Wrong password must return HTTP 401');

    // ----------------------------------------------------
    // Verification simulation: Mark account verified
    // ----------------------------------------------------
    // Get user id from local DB
    const accountRow = await f.sqlite.prepare('SELECT user_id FROM password_accounts WHERE email=?').get(testEmail) as { user_id: string };
    assert.ok(accountRow?.user_id, 'Local user account must exist in D1');
    const now = Math.floor(Date.now() / 1000);
    await f.sqlite.prepare('UPDATE password_accounts SET verified_at=? WHERE email=?').run(now, testEmail);

    // Also get Firebase ID token to test authenticated actions and cleanup
    const fbSignIn = await firebaseSignIn({ apiKey: LIVE_FIREBASE_API_KEY }, testEmail, testPassword);
    assert.ok(fbSignIn.idToken, 'Firebase Auth sign-in must return ID token');
    createdFirebaseIdToken = fbSignIn.idToken;

    // ----------------------------------------------------
    // Requirement 3: Verified Login with Remember Me (30 days vs 24 hours)
    // ----------------------------------------------------
    // Login with Remember Me = true
    const loginWithRemember = await send(f, 'login', { email: testEmail, password: testPassword, rememberMe: true });
    assert.equal(loginWithRemember.status, 200, 'Verified login must return 200 OK');
    const rememberCookie = loginWithRemember.headers.getSetCookie().find(c => c.startsWith('__Host-harness_password_session='));
    assert.ok(rememberCookie, 'Session cookie must be set');
    assert.match(rememberCookie!, /Max-Age=2592000/, 'Remember me must set 30-day session (2,592,000s)');

    // Login with Remember Me = false
    const loginStandard = await send(f, 'login', { email: testEmail, password: testPassword, rememberMe: false });
    assert.equal(loginStandard.status, 200);
    const standardCookie = loginStandard.headers.getSetCookie().find(c => c.startsWith('__Host-harness_password_session='));
    assert.match(standardCookie!, /Max-Age=86400/, 'Standard login must set 24-hour session (86,400s)');

    // Verify session validity via readPasswordUser
    const sessionToken = standardCookie!.split(';', 1)[0].split('=')[1];
    const sessionUser = await readPasswordUser(f.db as never, `__Host-harness_password_session=${sessionToken}; __Host-harness_auth_provider=password`, true);
    assert.ok(sessionUser, 'readPasswordUser must authenticate active session');
    assert.equal(sessionUser!.email, testEmail);

    // ----------------------------------------------------
    // Requirement 3: Logout
    // ----------------------------------------------------
    const logoutRes = await handlePasswordAuth(
      new Request(`${origin}/api/auth/email/logout`, {
        method: 'POST',
        headers: { origin, cookie: `__Host-harness_password_session=${sessionToken}` }
      }),
      f.env as never,
      'logout'
    );
    assert.equal(logoutRes.status, 200, 'Logout must succeed with HTTP 200');
    assert.equal(await readPasswordUser(f.db as never, `__Host-harness_password_session=${sessionToken}`, true), null, 'Session must be revoked after logout');

    // ----------------------------------------------------
    // Requirement 5: Rate Limiting
    // ----------------------------------------------------
    const rateLimitPromises = [];
    for (let i = 0; i < 15; i++) {
      rateLimitPromises.push(send(f, 'login', { email: testEmail, password: 'any' }));
    }
    const rateLimitResults = await Promise.all(rateLimitPromises);
    const has429 = rateLimitResults.some(r => r.status === 429);
    assert.ok(has429, 'Excessive login requests must trigger HTTP 429 Rate Limited');

    // ----------------------------------------------------
    // Requirement 6: Account Deletion (Self-cleanup)
    // ----------------------------------------------------
    const actorId = accountRow.user_id;
    const deleteRes = await send(f, 'delete-account', { password: testPassword }, actorId);
    assert.equal(deleteRes.status, 200, 'Account deletion must return 200 OK');

    const remainingAccounts = await f.sqlite.prepare('SELECT count(*) as count FROM password_accounts WHERE user_id=?').get(actorId) as { count: number };
    assert.equal(remainingAccounts.count, 0, 'Account must be fully deleted from D1');

    createdFirebaseIdToken = ''; // deleted by delete-account
  } finally {
    // If test failed before account deletion, clean up test user in Firebase Auth
    if (createdFirebaseIdToken) {
      try {
        await firebaseDeleteUser({ apiKey: LIVE_FIREBASE_API_KEY }, createdFirebaseIdToken);
      } catch {}
    }
    f.sqlite.close();
  }
});
