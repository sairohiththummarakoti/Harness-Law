import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { getAdminAccess, type AdminDatabase } from '../lib/admin/access.ts';
import { handleAdminMembersRequest, type AdminMembersData } from '../lib/admin/members.ts';
import type { AppUser } from '../lib/identity.ts';

const ownerEmail = 'owner@example.test';
const owner: AppUser = { userId: 'owner-subject', provider: 'chatgpt', email: ownerEmail, displayName: 'Site Owner', fullName: 'Site Owner' };
const applicant: AppUser = { userId: 'google:applicant', provider: 'google', email: 'applicant@example.test', displayName: 'Applicant', fullName: 'Applicant' };

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0003_puzzling_mephistopheles.sql', import.meta.url), 'utf8'));
  type Statement = { sql: string; args: (string | number | null)[]; bind(...args: (string | number | null)[]): Statement; first(): Promise<unknown>; run(): Promise<unknown>; all(): Promise<unknown> };
  const statement = (sql: string, args: (string | number | null)[] = []): Statement => ({
    sql, args,
    bind(...bound) { return statement(sql, bound); },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async run() { const result = sqlite.prepare(sql).run(...args); return { success: true, meta: { changes: Number(result.changes) } }; },
    async all() { return { success: true, results: sqlite.prepare(sql).all(...args) }; },
  });
  const db = {
    prepare: statement,
    async batch(statements: Statement[]) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const query of statements) results.push(await query.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } as unknown as AdminDatabase;
  function register(user: AppUser) {
    sqlite.prepare('INSERT INTO analytics_users (user_id, provider, email, display_name, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)').run(user.userId, user.provider, user.email, user.displayName, 1000, 1000);
  }
  async function request(user: AppUser | null, action?: unknown, headers: Record<string, string> = {}) {
    const req = new Request('https://site.example/api/admin/members', action === undefined
      ? { headers }
      : { method: 'POST', headers: { Origin: 'https://site.example', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(action) });
    return handleAdminMembersRequest(req, { db, getUser: async () => user, ownerEmail, now: () => 2000 });
  }
  return { sqlite, db, register, request };
}

test('only the configured verified identity can bootstrap the owner; subject binding survives email changes', async () => {
  const f = fixture();
  try {
    assert.equal(await getAdminAccess(f.db, null, ownerEmail), null);
    assert.equal(await getAdminAccess(f.db, applicant, ownerEmail), null);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS total FROM admin_owner').get()?.total, 0);
    assert.equal((await getAdminAccess(f.db, owner, ' OWNER@example.test '))?.role, 'owner');
    assert.equal((await getAdminAccess(f.db, { ...owner, email: 'new-address@example.test' }, ownerEmail))?.role, 'owner');
    assert.equal(await getAdminAccess(f.db, { ...owner, userId: 'another-subject' }, ownerEmail), null);
    assert.equal(await getAdminAccess(f.db, { ...owner, provider: 'google' }, ownerEmail), null);
    assert.equal((await getAdminAccess(f.db, owner, undefined))?.role, 'owner');
  } finally { f.sqlite.close(); }
});

test('missing or invalid owner configuration never promotes a first visitor', async () => {
  const f = fixture();
  try {
    for (const config of [null, undefined, '', 'invalid-address', {}, 42]) assert.equal(await getAdminAccess(f.db, owner, config), null);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS total FROM admin_owner').get()?.total, 0);
  } finally { f.sqlite.close(); }
});

test('concurrent bootstrap requests bind only one verified subject', async () => {
  const f = fixture();
  try {
    const second = { ...owner, userId: 'google:owner', provider: 'google' as const };
    const access = await Promise.all([getAdminAccess(f.db, owner, ownerEmail), getAdminAccess(f.db, second, ownerEmail)]);
    assert.equal(access.filter(item => item?.role === 'owner').length, 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS total FROM admin_owner').get()?.total, 1);
  } finally { f.sqlite.close(); }
});

test('admin membership data denies anonymous and ordinary users and is never cacheable', async () => {
  const f = fixture();
  try {
    const anonymous = await f.request(null);
    assert.equal(anonymous.status, 401);
    assert.match(anonymous.headers.get('cache-control') ?? '', /no-store/);
    assert.equal((await f.request(applicant)).status, 403);
    const own = await f.request(owner);
    assert.equal(own.status, 200);
    assert.equal((await own.json() as AdminMembersData).members[0].role, 'owner');
  } finally { f.sqlite.close(); }
});

test('grant and revoke are audited, idempotent, and enforced immediately on every access', async () => {
  const f = fixture();
  try {
    f.register(applicant);
    assert.equal((await f.request(owner, { action: 'grant', userId: applicant.userId })).status, 200);
    assert.equal((await getAdminAccess(f.db, applicant, ownerEmail))?.role, 'admin');
    assert.equal((await f.request(applicant)).status, 403);
    assert.equal((await f.request(applicant, { action: 'grant', userId: 'someone-else' })).status, 403);
    assert.equal((await f.request(owner, { action: 'grant', userId: applicant.userId })).status, 200);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS total FROM admin_audit').get()?.total, 1);
    assert.equal((await f.request(owner, { action: 'revoke', userId: applicant.userId })).status, 200);
    assert.equal(await getAdminAccess(f.db, applicant, ownerEmail), null);
    assert.equal((await f.request(owner, { action: 'revoke', userId: applicant.userId })).status, 200);
    const audit = f.sqlite.prepare('SELECT action, actor_email, target_email FROM admin_audit ORDER BY rowid').all();
    assert.deepEqual(audit.map(row => ({ ...row })), [
      { action: 'grant', actor_email: ownerEmail, target_email: applicant.email },
      { action: 'revoke', actor_email: ownerEmail, target_email: applicant.email },
    ]);
  } finally { f.sqlite.close(); }
});

test('membership belongs to the provider and subject rather than an email or display name', async () => {
  const f = fixture();
  try {
    f.register(applicant);
    await f.request(owner, { action: 'grant', userId: applicant.userId });
    assert.equal(await getAdminAccess(f.db, { ...applicant, userId: 'different-subject' }, ownerEmail), null);
    assert.equal(await getAdminAccess(f.db, { ...applicant, provider: 'chatgpt' }, ownerEmail), null);
    assert.equal((await getAdminAccess(f.db, { ...applicant, email: 'updated@example.test', displayName: 'Updated' }, ownerEmail))?.role, 'admin');
  } finally { f.sqlite.close(); }
});

test('owner is immutable and mutation accepts only existing registered users', async () => {
  const f = fixture();
  try {
    for (const action of ['grant', 'revoke']) assert.equal((await f.request(owner, { action, userId: owner.userId })).status, 409);
    assert.equal((await f.request(owner, { action: 'grant', userId: 'unregistered' })).status, 404);
    assert.equal((await getAdminAccess(f.db, owner, ownerEmail))?.role, 'owner');
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS total FROM admin_members').get()?.total, 0);
  } finally { f.sqlite.close(); }
});

test('cross-origin, stale-account and malformed or oversized mutations are rejected before changes', async () => {
  const f = fixture();
  try {
    f.register(applicant);
    const action = { action: 'grant', userId: applicant.userId };
    assert.equal((await f.request(owner, action, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await f.request(owner, action, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await f.request(owner, action, { 'X-Harness-Account': applicant.userId })).status, 401);
    assert.equal((await f.request(owner, { ...action, role: 'owner' })).status, 400);
    assert.equal((await f.request(owner, { action: 'grant', userId: 'x'.repeat(5000) })).status, 413);
    assert.equal((await f.request(owner, action, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS total FROM admin_members').get()?.total, 0);
  } finally { f.sqlite.close(); }
});

test('an audit storage failure rolls back the membership change', async () => {
  const f = fixture();
  try {
    f.register(applicant);
    f.sqlite.exec("CREATE TRIGGER fail_admin_audit BEFORE INSERT ON admin_audit BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    assert.equal((await f.request(owner, { action: 'grant', userId: applicant.userId })).status, 503);
    assert.equal(await getAdminAccess(f.db, applicant, ownerEmail), null);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS total FROM admin_audit').get()?.total, 0);
  } finally { f.sqlite.close(); }
});
