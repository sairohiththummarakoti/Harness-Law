import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { analyticsLocation, handleAnalyticsRequest, parseAnalyticsInput, parseOverviewQuery, readAdminOverview, recordAnalytics, type AnalyticsDatabase, type AnalyticsInput } from '../lib/admin/analytics.ts';
import type { AppUser } from '../lib/identity.ts';

const NOW = Date.parse('2026-11-25T15:00:00Z');
const MINUTE = 60_000, DAY = 86_400_000;
const user: AppUser = { userId: 'google:verified-user', provider: 'google', email: 'member@example.test', displayName: 'Member', fullName: 'Member' };
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0003_puzzling_mephistopheles.sql', import.meta.url), 'utf8'));
  function prepare(sql: string, args: (string | number | null)[] = []) {
    return { sql, args,
      bind(...values: (string | number | null)[]) { return prepare(sql, values); },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...args), success: true }; },
      async run() { const result = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) }, success: true }; },
    };
  }
  const db = { prepare, async batch(statements: ReturnType<typeof prepare>[]) {
    sqlite.exec('BEGIN');
    try {
      const results = statements.map(statement => { const result = sqlite.prepare(statement.sql).run(...statement.args); return { meta: { changes: Number(result.changes) }, success: true }; });
      sqlite.exec('COMMIT'); return results;
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } } as unknown as AnalyticsDatabase;
  return { db, sqlite };
}
function input(kind: AnalyticsInput['kind'] = 'pageview', page = 'workspace/dashboard'): AnalyticsInput { return { eventId: crypto.randomUUID(), page, kind, referrer: '' }; }
function request(body: unknown = input(), headers: Record<string, string> = {}) {
  return new Request('https://site.example/api/analytics', { method: 'POST', headers: { origin: 'https://site.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 Chrome/130.0 Safari/537.36', ...headers }, body: JSON.stringify(body) });
}
async function overview(db: AnalyticsDatabase, now = NOW, search = '') { return readAdminOverview(db, { role: 'owner', email: 'owner@example.test' }, { days: 7, page: 1, search }, now); }

test('collection accepts canonical pages only and rejects identity, location, full URLs, queries, and oversized referrers', () => {
  assert.ok(parseAnalyticsInput(input()));
  assert.ok(parseAnalyticsInput(input('pageview', 'workspace/sample')));
  assert.ok(parseAnalyticsInput(input('pageview', '/privacy')));
  assert.equal(parseAnalyticsInput({ ...input(), page: '/workspace?secret=case' }), null);
  assert.equal(parseAnalyticsInput({ ...input(), userId: 'owner' }), null);
  assert.equal(parseAnalyticsInput({ ...input(), country: 'US' }), null);
  assert.equal(parseAnalyticsInput({ ...input(), referrer: 'https://google.com/?secret=case' }), null);
  assert.equal(parseAnalyticsInput({ ...input(), eventId: 'not-a-uuid' }), null);
  assert.equal(parseOverviewQuery(new URL('https://site.example?days=365')), null);
  assert.equal(parseOverviewQuery(new URL('https://site.example?page=-1')), null);
});

test('location uses runtime metadata only; forged forwarding headers do not populate geography', () => {
  const forged = request(input(), { 'cf-ipcountry': 'US', 'x-forwarded-for': '1.2.3.4', 'x-city': 'New York' });
  assert.deepEqual(analyticsLocation(forged), { country: null, region: null, city: null });
  Object.defineProperty(forged, 'cf', { value: { country: 'US', region: 'Virginia', city: 'Ashburn', latitude: '38', longitude: '-77' } });
  assert.deepEqual(analyticsLocation(forged), { country: 'US', region: 'Virginia', city: 'Ashburn' });
});

test('origin, privacy signals, body limits, and server identity enforce ingestion boundaries', async () => {
  const { db, sqlite } = fixture(); let identities = 0;
  const resolve = async () => { identities++; return user; };
  try {
    assert.equal((await handleAnalyticsRequest(request(input(), { origin: 'https://evil.example' }), db, resolve)).status, 403);
    assert.equal((await handleAnalyticsRequest(request(input(), { dnt: '1' }), db, resolve)).status, 204);
    assert.equal((await handleAnalyticsRequest(request(input(), { 'sec-gpc': '1' }), db, resolve)).status, 204);
    assert.equal((await handleAnalyticsRequest(request({ ...input(), userId: 'owner' }), db, resolve)).status, 400);
    assert.equal((await handleAnalyticsRequest(request({ payload: 'x'.repeat(3000) }), db, resolve)).status, 400);
    assert.equal(identities, 0);
    assert.equal((await handleAnalyticsRequest(request(), db, resolve)).status, 204);
    assert.equal(sqlite.prepare('SELECT user_id FROM analytics_users').get()?.user_id, user.userId);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM analytics_users').get()?.n, 1);
  } finally { sqlite.close(); }
});

test('SQL deduplicates repeat views and concurrent-tab session starts; heartbeats preserve active users', async () => {
  const { db, sqlite } = fixture();
  try {
    const first = input();
    await recordAnalytics(db, request(), user, first, NOW);
    await recordAnalytics(db, request(), user, first, NOW);
    await recordAnalytics(db, request(), user, input(), NOW + 1000);
    await recordAnalytics(db, request(), user, input('heartbeat'), NOW + 4 * MINUTE);
    let result = await overview(db, NOW + 4 * MINUTE);
    assert.deepEqual({ ...result.metrics }, { totalUsers: 1, activeNow: 1, activeUsers: 1, newUsers: 1, sessions: 1, pageviews: 1 });
    await recordAnalytics(db, request(), user, input(), NOW + 35 * MINUTE);
    result = await overview(db, NOW + 35 * MINUTE);
    assert.equal(result.metrics.sessions, 2);
    assert.equal(result.metrics.pageviews, 2);
    assert.equal(result.users.items[0].lastSeen, NOW + 35 * MINUTE);
    assert.equal(result.trackingSince, NOW);
    assert.equal(result.sessions[0].email, user.email);
  } finally { sqlite.close(); }
});

test('daily active users include visible heartbeat activity across UTC midnight', async () => {
  const { db, sqlite } = fixture();
  try {
    const midnight = Date.parse('2026-11-26T00:00:00Z');
    await recordAnalytics(db, request(), user, input(), midnight - MINUTE);
    await recordAnalytics(db, request(), user, input('heartbeat'), midnight + MINUTE);
    const result = await overview(db, midnight + MINUTE);
    assert.equal(result.trend.at(-1)?.activeUsers, 1);
    assert.equal(result.trend.at(-1)?.pageviews, 0);
    assert.equal(result.metrics.sessions, 1);
  } finally { sqlite.close(); }
});

test('anonymous views create no user directory records, duplicate IDs are ignored, and ingestion is capped', async () => {
  const { db, sqlite } = fixture();
  try {
    const anonymous = input('pageview', '/');
    await recordAnalytics(db, request(), null, anonymous, NOW);
    await recordAnalytics(db, request(), null, anonymous, NOW);
    await recordAnalytics(db, request(), null, input('heartbeat', '/'), NOW);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM analytics_users').get()?.n, 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM analytics_events').get()?.n, 1);
    const insert = sqlite.prepare("INSERT INTO analytics_events VALUES (?, NULL, 'pageview', '/', NULL, NULL, NULL, 'Desktop', 'Chrome', 'Direct', ?)");
    for (let index = 0; index < 599; index++) insert.run(`anonymous-${index}`, NOW);
    await recordAnalytics(db, request(), null, input('pageview', '/'), NOW);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM analytics_events').get()?.n, 600);
  } finally { sqlite.close(); }
});

test('summary uses bounded date windows, exact search semantics, stable pagination, and bounded retention cleanup', async () => {
  const { db, sqlite } = fixture();
  try {
    await recordAnalytics(db, request(), user, input(), NOW - 8 * DAY);
    await recordAnalytics(db, request(), { ...user, userId: 'other', email: 'literal%name@example.test' }, input(), NOW);
    let result = await overview(db);
    assert.equal(result.metrics.totalUsers, 2);
    assert.equal(result.metrics.activeUsers, 1);
    assert.equal(result.trend.length, 7);
    result = await overview(db, NOW, '%');
    assert.equal(result.users.total, 1);
    assert.equal(result.users.items[0].email, 'literal%name@example.test');
    const insert = sqlite.prepare("INSERT INTO analytics_events VALUES (?, NULL, 'pageview', '/', NULL, NULL, NULL, 'Desktop', 'Chrome', 'Direct', ?)");
    for (let index = 0; index < 110; index++) insert.run(`expired-${index}`, NOW - 91 * DAY);
    await recordAnalytics(db, request(), null, input('pageview', '/'), NOW);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM analytics_events WHERE created_at < ?').get(NOW - 90 * DAY)?.n, 10);
    assert.equal((await overview(db)).metrics.pageviews, 2);
  } finally { sqlite.close(); }
});

test('user directory paginates deterministically and reports grants without leaking records outside the page', async () => {
  const { db, sqlite } = fixture();
  try {
    for (let index = 0; index < 23; index++) await recordAnalytics(db, request(), { ...user, userId: `user-${String(index).padStart(2, '0')}`, email: `member${index}@example.test` }, input(), NOW + index);
    sqlite.prepare("INSERT INTO admin_owner VALUES ('owner', 'user-22', 'google', 'member22@example.test', 'Owner', ?)").run(NOW);
    sqlite.prepare("INSERT INTO admin_members VALUES ('user-21', 'google', 'member21@example.test', 'Admin', ?, 'user-22')").run(NOW);
    const first = await readAdminOverview(db, { role: 'owner', email: 'member22@example.test' }, { days: 7, page: 1, search: '' }, NOW + MINUTE);
    const second = await readAdminOverview(db, { role: 'owner', email: 'member22@example.test' }, { days: 7, page: 99, search: '' }, NOW + MINUTE);
    assert.equal(first.users.total, 23);
    assert.equal(first.users.items.length, 20);
    assert.equal(first.users.items[0].role, 'owner');
    assert.equal(first.users.items[1].role, 'admin');
    assert.equal(second.users.page, 2);
    assert.equal(second.users.items.length, 3);
    assert.equal(new Set([...first.users.items, ...second.users.items].map(item => item.userId)).size, 23);
  } finally { sqlite.close(); }
});
