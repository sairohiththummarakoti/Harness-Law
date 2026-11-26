import type { AppUser } from '../identity.ts';
import { isSameOrigin, authJson } from '../auth/runtime.ts';
import type { AdminOverview, AdminViewer, AnalyticsRange, AnalyticsUser, AnalyticsSession, AnalyticsBreakdown } from './analytics-types.ts';

export type AnalyticsDatabase = Pick<D1Database, 'prepare' | 'batch'>;
export const ANALYTICS_RETENTION_DAYS = 90;
const MINUTE = 60_000, DAY = 86_400_000, SESSION_GAP = 30 * MINUTE;
const PAGES = new Set(['/', '/signin', '/signup', '/onboarding', '/privacy', 'workspace/sample', 'workspace/dashboard', 'workspace/profile', 'workspace/criteria', 'workspace/criterion', 'workspace/evidence', 'workspace/facts', 'workspace/composition', 'workspace/draft', 'workspace/forms', 'workspace/review', 'workspace/help', 'workspace/settings']);
export type AnalyticsInput = { page: string; kind: 'pageview' | 'heartbeat'; eventId: string; referrer: string };
type Location = { country: string | null; region: string | null; city: string | null };

export function parseAnalyticsInput(value: unknown): AnalyticsInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['page', 'kind', 'eventId', 'referrer'].includes(key))) return null;
  if (typeof input.page !== 'string' || !PAGES.has(input.page) || !['pageview', 'heartbeat'].includes(String(input.kind)) || typeof input.eventId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.eventId)) return null;
  if (input.referrer !== undefined && (typeof input.referrer !== 'string' || input.referrer.length > 253 || (input.referrer !== '' && !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(input.referrer)))) return null;
  return { page: input.page, kind: input.kind as AnalyticsInput['kind'], eventId: input.eventId, referrer: (input.referrer as string | undefined)?.toLowerCase() || 'Direct' };
}

/** Only the runtime-owned cf object is accepted. Client headers and payloads cannot supply location. */
export function analyticsLocation(request: Request): Location {
  const cf = (request as Request & { cf?: Record<string, unknown> }).cf;
  const text = (value: unknown) => typeof value === 'string' && value.length <= 100 && !/[\u0000-\u001f]/.test(value) && value.trim() ? value.trim() : null;
  const country = text(cf?.country);
  return { country: country && /^[A-Z]{2}$/.test(country) && !['XX', 'T1'].includes(country) ? country : null, region: text(cf?.region), city: text(cf?.city) };
}

export function analyticsDevice(userAgent: string) {
  const ua = userAgent.slice(0, 1024);
  const device = /bot|crawler|spider|headless/i.test(ua) ? 'Bot / automation' : /ipad|tablet/i.test(ua) ? 'Tablet' : /mobile|iphone|android/i.test(ua) ? 'Mobile' : ua ? 'Desktop' : 'Unknown';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  return { device, browser };
}

export async function recordAnalytics(db: AnalyticsDatabase, request: Request, user: AppUser | null, input: AnalyticsInput, now = Date.now()): Promise<void> {
  if (input.kind === 'heartbeat' && !user) return;
  const { country, region, city } = analyticsLocation(request);
  const { device, browser } = analyticsDevice(request.headers.get('user-agent') || '');
  if (device === 'Bot / automation') return;
  const referrer = input.referrer === new URL(request.url).hostname ? 'Internal' : input.referrer || 'Direct';
  const statements: D1PreparedStatement[] = [db.prepare("INSERT OR IGNORE INTO analytics_meta (key, value) VALUES ('tracking_since', ?)").bind(String(now))];
  if (user) {
    // The session decision and last-seen update are one D1 transaction, preventing concurrent tabs creating duplicate sessions.
    statements.push(db.prepare(`INSERT OR IGNORE INTO analytics_events (id, user_id, kind, page, country, region, city, device, browser, referrer, created_at)
      SELECT ?, ?, 'session', ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM analytics_users WHERE user_id = ? AND last_seen > ?)`)
      .bind(`session:${input.eventId}`, user.userId, input.page, country, region, city, device, browser, referrer, now, user.userId, now - SESSION_GAP));
    statements.push(db.prepare(`INSERT INTO analytics_users (user_id, provider, email, display_name, first_seen, last_seen, last_country, last_region, last_city)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET email=excluded.email, display_name=excluded.display_name,
        last_seen=MAX(analytics_users.last_seen, excluded.last_seen),
        last_country=CASE WHEN excluded.last_seen >= analytics_users.last_seen THEN excluded.last_country ELSE analytics_users.last_country END,
        last_region=CASE WHEN excluded.last_seen >= analytics_users.last_seen THEN excluded.last_region ELSE analytics_users.last_region END,
        last_city=CASE WHEN excluded.last_seen >= analytics_users.last_seen THEN excluded.last_city ELSE analytics_users.last_city END`)
      .bind(user.userId, user.provider, user.email, user.displayName, now, now, country, region, city));
    statements.push(db.prepare(`INSERT OR IGNORE INTO analytics_events (id, user_id, kind, page, country, region, city, device, browser, referrer, created_at)
      VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(`active:${user.userId}:${Math.floor(now / DAY)}`, user.userId, input.page, country, region, city, device, browser, referrer, now));
  }
  if (input.kind === 'pageview') {
    // The global anonymous cap bounds unauthenticated ingestion; authenticated repeat views are coalesced for one minute.
    statements.push(db.prepare(`INSERT OR IGNORE INTO analytics_events (id, user_id, kind, page, country, region, city, device, browser, referrer, created_at)
      SELECT ?, ?, 'pageview', ?, ?, ?, ?, ?, ?, ?, ?
      WHERE (? IS NOT NULL OR (SELECT COUNT(*) FROM analytics_events WHERE kind='pageview' AND user_id IS NULL AND created_at >= ?) < 600)
      AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM analytics_events WHERE kind='pageview' AND user_id=? AND page=? AND created_at >= ?))`)
      .bind(input.eventId, user?.userId ?? null, input.page, country, region, city, device, browser, referrer, now, user?.userId ?? null, now - MINUTE, user?.userId ?? null, user?.userId ?? null, input.page, now - MINUTE));
  }
  statements.push(db.prepare('DELETE FROM analytics_events WHERE id IN (SELECT id FROM analytics_events WHERE created_at < ? ORDER BY created_at LIMIT 100)').bind(now - ANALYTICS_RETENTION_DAYS * DAY));
  await db.batch(statements);
}

async function boundedJson(request: Request): Promise<unknown> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > 2048)) throw new Error('size');
  if (!request.body) throw new Error('body');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      size += item.value.length;
      if (size > 2048) { await reader.cancel(); throw new Error('size'); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
}

export async function handleAnalyticsRequest(request: Request, db: AnalyticsDatabase | undefined, resolveUser: () => Promise<AppUser | null>): Promise<Response> {
  if (request.method !== 'POST') return authJson({ error: 'POST required.' }, 405);
  if (!isSameOrigin(request)) return authJson({ error: 'Same-origin requests only.' }, 403);
  if (request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1') return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return authJson({ error: 'JSON required.' }, 415);
  let input: AnalyticsInput | null;
  try { input = parseAnalyticsInput(await boundedJson(request)); } catch { return authJson({ error: 'Invalid analytics request.' }, 400); }
  if (!input) return authJson({ error: 'Invalid analytics request.' }, 400);
  if (!db) return authJson({ error: 'Analytics temporarily unavailable.' }, 503);
  try { await recordAnalytics(db, request, await resolveUser(), input); }
  catch { return authJson({ error: 'Analytics temporarily unavailable.' }, 503); }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

export function parseOverviewQuery(url: URL): { days: AnalyticsRange; page: number; search: string } | null {
  const days = Number(url.searchParams.get('days') || '30');
  const page = Number(url.searchParams.get('page') || '1');
  const search = (url.searchParams.get('search') || '').trim();
  if (![7, 30, 90].includes(days) || !Number.isSafeInteger(page) || page < 1 || page > 10_000 || search.length > 100) return null;
  return { days: days as AnalyticsRange, page, search };
}

export async function readAdminOverview(db: AnalyticsDatabase, viewer: AdminViewer, query: { days: AnalyticsRange; page: number; search: string }, now = Date.now()): Promise<AdminOverview> {
  const start = Math.floor(now / DAY) * DAY - (query.days - 1) * DAY;
  const search = `%${query.search.replace(/[\\%_]/g, char => `\\${char}`)}%`;
  const where = `(email LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')`;
  const rows = async <T>(sql: string, ...args: (string | number)[]) => (await db.prepare(sql).bind(...args).all<T>()).results || [];
  const metricRow = db.prepare(`SELECT
    (SELECT COUNT(*) FROM analytics_users) AS totalUsers,
    (SELECT COUNT(*) FROM analytics_users WHERE last_seen >= ?) AS activeNow,
    (SELECT COUNT(DISTINCT user_id) FROM analytics_events WHERE user_id IS NOT NULL AND created_at >= ?) AS activeUsers,
    (SELECT COUNT(*) FROM analytics_users WHERE first_seen >= ?) AS newUsers,
    (SELECT COUNT(*) FROM analytics_events WHERE kind='session' AND created_at >= ?) AS sessions,
    (SELECT COUNT(*) FROM analytics_events WHERE kind='pageview' AND created_at >= ?) AS pageviews`).bind(now - 5 * MINUTE, start, start, start, start).first<AdminOverview['metrics']>();
  const [metrics, meta, rawTrend, locations, pages, devices, browsers, referrers, sessions, userCount] = await Promise.all([
    metricRow,
    db.prepare("SELECT value FROM analytics_meta WHERE key='tracking_since'").first<{ value: string }>(),
    rows<AdminOverview['trend'][number]>(`SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS date,
      SUM(CASE WHEN kind='pageview' THEN 1 ELSE 0 END) AS pageviews,
      SUM(CASE WHEN kind='session' THEN 1 ELSE 0 END) AS sessions, COUNT(DISTINCT user_id) AS activeUsers
      FROM analytics_events WHERE created_at >= ? GROUP BY date ORDER BY date`, start),
    rows<AdminOverview['locations'][number]>(`SELECT country, region, city, COUNT(*) AS count FROM analytics_events WHERE kind='session' AND created_at >= ? GROUP BY country, region, city ORDER BY count DESC LIMIT 15`, start),
    rows<AnalyticsBreakdown>(`SELECT page AS label, COUNT(*) AS count FROM analytics_events WHERE kind='pageview' AND created_at >= ? GROUP BY page ORDER BY count DESC LIMIT 20`, start),
    rows<AnalyticsBreakdown>(`SELECT device AS label, COUNT(*) AS count FROM analytics_events WHERE kind='pageview' AND created_at >= ? GROUP BY device ORDER BY count DESC LIMIT 10`, start),
    rows<AnalyticsBreakdown>(`SELECT browser AS label, COUNT(*) AS count FROM analytics_events WHERE kind='pageview' AND created_at >= ? GROUP BY browser ORDER BY count DESC LIMIT 10`, start),
    rows<AnalyticsBreakdown>(`SELECT referrer AS label, COUNT(*) AS count FROM analytics_events WHERE kind='pageview' AND created_at >= ? GROUP BY referrer ORDER BY count DESC LIMIT 10`, start),
    rows<AnalyticsSession>(`SELECT e.id, e.user_id AS userId, u.email, u.display_name AS displayName, u.provider,
      e.created_at AS createdAt, e.country, e.region, e.city, e.device, e.browser
      FROM analytics_events e JOIN analytics_users u ON u.user_id=e.user_id
      WHERE e.kind='session' AND e.created_at >= ? ORDER BY e.created_at DESC LIMIT 20`, start),
    db.prepare(`SELECT COUNT(*) AS total FROM analytics_users WHERE ${where}`).bind(search, search).first<{ total: number }>(),
  ]);
  const total = Number(userCount?.total || 0), pageSize = 20;
  const page = Math.min(query.page, Math.max(1, Math.ceil(total / pageSize)));
  const users = await rows<AnalyticsUser>(`SELECT u.user_id AS userId, u.provider, u.email, u.display_name AS displayName,
    u.first_seen AS firstSeen, u.last_seen AS lastSeen, u.last_country AS country, u.last_region AS region, u.last_city AS city,
    CASE WHEN EXISTS(SELECT 1 FROM admin_owner o WHERE o.user_id=u.user_id AND o.provider=u.provider) THEN 'owner'
      WHEN EXISTS(SELECT 1 FROM admin_members m WHERE m.user_id=u.user_id AND m.provider=u.provider) THEN 'admin' ELSE NULL END AS role
    FROM analytics_users u WHERE (u.email LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\')
    ORDER BY u.last_seen DESC, u.user_id LIMIT ? OFFSET ?`, search, search, pageSize, (page - 1) * pageSize);
  const byDate = new Map(rawTrend.map(row => [row.date, row]));
  const trend = Array.from({ length: query.days }, (_, index) => { const date = new Date(start + index * DAY).toISOString().slice(0, 10); return byDate.get(date) || { date, pageviews: 0, sessions: 0, activeUsers: 0 }; });
  return { viewer, days: query.days, generatedAt: now, trackingSince: meta && Number.isFinite(Number(meta.value)) ? Number(meta.value) : null,
    metrics: metrics || { totalUsers: 0, activeNow: 0, activeUsers: 0, newUsers: 0, sessions: 0, pageviews: 0 },
    trend, locations, pages, devices, browsers, referrers, sessions, users: { items: users, total, page, pageSize } };
}
