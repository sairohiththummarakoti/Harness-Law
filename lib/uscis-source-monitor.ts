/** Public-source monitoring only. A changed snapshot is not reviewed legal guidance. */
export const USCIS_MONITORED_SOURCES = [
  {
    id: 'eb1-overview',
    label: 'USCIS EB-1 overview',
    url: 'https://www.uscis.gov/working-in-the-united-states/permanent-workers/employment-based-immigration-first-preference-eb-1',
  },
  {
    id: 'eb1a-policy',
    label: 'USCIS Extraordinary Ability policy',
    url: 'https://www.uscis.gov/policy-manual/volume-6-part-f-chapter-2',
  },
] as const;

export const USCIS_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 768 * 1024;
const LEASE_MS = 30_000;
const MAX_HISTORY = 5;

export interface UscisSourceChange {
  detectedAt: string;
  previousVersion: string;
  version: string;
  added: string[];
  removed: string[];
}
export interface UscisSourceStatus {
  id: string;
  label: string;
  url: string;
  status: 'baseline' | 'unchanged' | 'changed' | 'unavailable';
  checkedAt: string | null;
  lastSuccessfulAt: string | null;
  /** Date printed by USCIS, never a request date or HTTP Date header. */
  sourceUpdatedAt: string | null;
  /** Policy Manual currency date, distinct from a policy publication/update date. */
  sourceCurrentAsOf: string | null;
  version: string | null;
  latestChange: UscisSourceChange | null;
  error: string | null;
}
export interface UscisGuidanceMonitor {
  sources: UscisSourceStatus[];
  checkIntervalHours: 24;
  mode: 'on_visit';
  checkedAt: string | null;
}
interface StoredSnapshot extends UscisSourceStatus {
  content: string | null;
  changes: UscisSourceChange[];
}
interface SnapshotRow { snapshot_json: string; checked_at: number; lease_until: number }
interface Statement {
  bind(...values: (string | number | null)[]): Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
export interface UscisMonitorDatabase { prepare(sql: string): Statement }
export interface UscisMonitorOptions { now?: number; fetcher?: typeof fetch }

function initialSnapshot(source: typeof USCIS_MONITORED_SOURCES[number], error: string): StoredSnapshot {
  return { ...source, status: 'unavailable', checkedAt: null, lastSuccessfulAt: null,
    sourceUpdatedAt: null, sourceCurrentAsOf: null, version: null, latestChange: null, error, content: null, changes: [] };
}
function publicStatus(snapshot: StoredSnapshot): UscisSourceStatus {
  const { content: _content, changes: _changes, ...status } = snapshot;
  return status;
}
function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…' };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, key: string) => {
    if (key[0] !== '#') return named[key.toLowerCase()] ?? entity;
    const numeric = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return numeric > 0 && numeric <= 0x10ffff ? String.fromCodePoint(numeric) : ' ';
  });
}
function textOnly(html: string): string {
  return decodeEntities(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' '))
    .replace(/[\t\r\n ]+/g, ' ').trim();
}
function validDate(year: number, month: number, day: number, now: number): string | null {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (year < 1990 || value.getUTCFullYear() !== year || value.getUTCMonth() + 1 !== month || value.getUTCDate() !== day || value.getTime() > now) return null;
  return value.toISOString().slice(0, 10);
}
export function parseUscisSourceDate(text: string, now = Date.now()): string | null {
  const match = text.match(/Last\s+(?:Reviewed\s*\/\s*Updated|Reviewed\s+or\s+Updated|Reviewed|Updated)\s*:?\s*((?:\d{1,2}\/\d{1,2}\/\d{4})|(?:\d{4}-\d{2}-\d{2})|(?:[A-Za-z]+\s+\d{1,2},?\s+\d{4}))/i);
  if (!match) return null;
  const raw = match[1];
  let date = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (date) return validDate(+date[3], +date[1], +date[2], now);
  date = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (date) return validDate(+date[1], +date[2], +date[3], now);
  const written = raw.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  return written ? validDate(+written[3], months.indexOf(written[1].toLowerCase()) + 1, +written[2], now) : null;
}

/** Isolate a page body; reject interstitials and incomplete responses instead of replacing a good snapshot. */
export function parseUscisSourceHtml(html: string, now = Date.now()): { content: string; sourceUpdatedAt: string | null; sourceCurrentAsOf: string | null } {
  const withoutChrome = html.replace(/<(script|style|nav|footer|header|aside|noscript|svg|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const main = withoutChrome.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i)?.[1];
  const article = (main ?? withoutChrome).match(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/i)?.[1];
  const body = article ?? main;
  if (!body) throw new Error('USCIS page content could not be verified.');
  const visible = textOnly(body);
  if (visible.length < 700 || !/extraordinary ability/i.test(visible)
      || !/scholarly articles/i.test(visible)
      || !/(?:national|international)/i.test(visible)
      || !/(?:judg(?:e|ing)|membership)/i.test(visible)) {
    throw new Error('USCIS page content could not be verified.');
  }
  // Date metadata sometimes sits beside the article or in its page footer.
  // Inspect visible document text for the explicit labels, not HTTP headers.
  const surroundingText = textOnly(html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ''));
  const sourceUpdatedAt = parseUscisSourceDate(surroundingText, now);
  const currency = surroundingText.match(/Current\s+as\s+of\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i)?.[1];
  const sourceCurrentAsOf = currency ? parseUscisSourceDate(`Last Updated: ${currency}`, now) : null;
  const lines = body.replace(/<(?:br|\/?(?:p|li|tr|h[1-6]|div|section|ul|ol|table))\b[^>]*>/gi, '\n')
    .split(/\n+/).map(textOnly)
    .filter(Boolean);
  const content = lines.filter((line, index) => {
    if (/^(?:Last\s+(?:Reviewed|Updated)|Current\s+as\s+of)/i.test(line)) return false;
    const dateOnly = /^(?:\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})$/.test(line);
    return !(dateOnly && /^(?:Last\s+(?:Reviewed|Updated).*|Current\s+as\s+of)\s*:?\s*$/i.test(lines[index - 1] ?? ''));
  })
    .join('\n')
    .replace(/\bLast\s+(?:Reviewed\s*\/\s*Updated|Reviewed\s+or\s+Updated|Reviewed|Updated)\s*:?\s*(?:\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})/gi, '')
    .replace(/\bCurrent\s+as\s+of\s+[A-Za-z]+\s+\d{1,2},?\s+\d{4}/gi, '')
    .trim();
  if (content.length < 700 || content.length > 500_000) throw new Error('USCIS page content could not be verified.');
  return { content, sourceUpdatedAt, sourceCurrentAsOf };
}

async function contentVersion(content: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
function excerpts(content: string, other: string): string[] {
  const previous = new Set(other.split('\n'));
  return [...new Set(content.split('\n'))].filter(line => line.length > 35 && !previous.has(line))
    .slice(0, 3).map(line => line.length > 320 ? `${line.slice(0, 317)}…` : line);
}
function allowedSourceUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if (parsed.search || parsed.hash || parsed.username || parsed.password) return false;
    return USCIS_MONITORED_SOURCES.some(source => source.url === parsed.href.replace(/\/$/, ''));
  } catch { return false; }
}
async function readBoundedHtml(response: Response): Promise<string> {
  if (!/\btext\/html\b/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel().catch(() => {});
    throw new Error('USCIS did not return a readable page.');
  }
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error('USCIS page exceeded the check limit.');
  }
  if (!response.body) throw new Error('USCIS returned an empty page.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, html = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error('USCIS page exceeded the check limit.');
      html += decoder.decode(chunk.value, { stream: true });
    }
    return html + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function fetchSource(url: string, fetcher: typeof fetch): Promise<string> {
  const signal = AbortSignal.timeout(8_000);
  let current = url;
  for (let redirects = 0; redirects <= 2; redirects++) {
    if (!allowedSourceUrl(current)) throw new Error('USCIS redirected outside the monitored sources.');
    const response = await fetcher(current, { method: 'GET', redirect: 'manual', signal, headers: { Accept: 'text/html' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => {});
      if (!location) throw new Error('USCIS returned an incomplete redirect.');
      current = new URL(location, current).href;
      continue;
    }
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error('USCIS is currently unavailable to the source checker.'); }
    return readBoundedHtml(response);
  }
  throw new Error('USCIS returned too many redirects.');
}

async function checkSource(db: UscisMonitorDatabase, source: typeof USCIS_MONITORED_SOURCES[number], now: number, fetcher: typeof fetch): Promise<UscisSourceStatus> {
  const initial = initialSnapshot(source, 'The first source check has not completed.');
  await db.prepare('INSERT OR IGNORE INTO uscis_source_snapshots (source_id, snapshot_json, checked_at, lease_until) VALUES (?, ?, 0, 0)').bind(source.id, JSON.stringify(initial)).run();
  const row = await db.prepare('SELECT snapshot_json, checked_at, lease_until FROM uscis_source_snapshots WHERE source_id = ?').bind(source.id).first<SnapshotRow>();
  if (!row) throw new Error('Source monitoring storage is unavailable.');
  const previous = JSON.parse(row.snapshot_json) as StoredSnapshot;
  if (row.checked_at > 0 && now - row.checked_at < USCIS_CHECK_INTERVAL_MS) return publicStatus(previous);
  const lease = now + LEASE_MS;
  const claim = await db.prepare('UPDATE uscis_source_snapshots SET lease_until = ? WHERE source_id = ? AND lease_until <= ? AND checked_at <= ?')
    .bind(lease, source.id, now, now - USCIS_CHECK_INTERVAL_MS).run();
  if (!claim.meta?.changes) return publicStatus(previous);
  const at = new Date(now).toISOString();
  let next: StoredSnapshot;
  try {
    const parsed = parseUscisSourceHtml(await fetchSource(source.url, fetcher), now);
    const version = await contentVersion(parsed.content);
    const changed = !!previous.version && previous.version !== version;
    const change: UscisSourceChange | null = changed ? {
      detectedAt: at, previousVersion: previous.version!, version,
      added: excerpts(parsed.content, previous.content ?? ''), removed: excerpts(previous.content ?? '', parsed.content),
    } : null;
    next = { ...previous, ...parsed, version, checkedAt: at, lastSuccessfulAt: at, error: null,
      status: changed ? 'changed' : previous.version ? 'unchanged' : 'baseline',
      latestChange: change ?? previous.latestChange,
      changes: change ? [change, ...previous.changes].slice(0, MAX_HISTORY) : previous.changes };
  } catch {
    next = { ...previous, checkedAt: at, status: 'unavailable', error: 'USCIS could not be checked. Use the official source for the latest text.' };
  }
  await db.prepare('UPDATE uscis_source_snapshots SET snapshot_json = ?, checked_at = ?, lease_until = 0 WHERE source_id = ? AND lease_until = ?')
    .bind(JSON.stringify(next), now, source.id, lease).run();
  return publicStatus(next);
}

export function unavailableUscisMonitor(): UscisGuidanceMonitor {
  return { mode: 'on_visit', checkIntervalHours: 24, checkedAt: null,
    sources: USCIS_MONITORED_SOURCES.map(source => publicStatus(initialSnapshot(source, 'Source checking is temporarily unavailable. Use the official source for the latest text.'))) };
}
export async function readUscisGuidanceMonitor(db: UscisMonitorDatabase, options: UscisMonitorOptions = {}): Promise<UscisGuidanceMonitor> {
  const now = options.now ?? Date.now();
  const sources = await Promise.all(USCIS_MONITORED_SOURCES.map(async source => {
    try { return await checkSource(db, source, now, options.fetcher ?? fetch); }
    catch { return publicStatus(initialSnapshot(source, 'Source checking is temporarily unavailable. Use the official source for the latest text.')); }
  }));
  const dates = sources.map(source => source.checkedAt).filter((value): value is string => !!value).sort();
  return { sources, mode: 'on_visit', checkIntervalHours: 24, checkedAt: dates.at(-1) ?? null };
}
