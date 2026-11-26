import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { parseUscisSourceDate, parseUscisSourceHtml, readUscisGuidanceMonitor, USCIS_CHECK_INTERVAL_MS, USCIS_MONITORED_SOURCES, type UscisMonitorDatabase } from '../lib/uscis-source-monitor.ts';

const NOW = Date.parse('2026-11-26T17:00:00Z');
const TEXT = [
  'Extraordinary Ability: Evidence of sustained national or international acclaim is considered in the context of the entire record.',
  'Authorship of scholarly articles in professional or major trade publications or other major media is one category of evidence.',
  'Evidence may include judging the work of others in the same or an allied field of specialization, either individually or on a panel.',
  'Memberships in associations requiring outstanding achievements must be evaluated using the applicable standard and supporting record.',
  'The overall record is evaluated separately from an initial count of the evidence categories. A selected category does not establish eligibility.',
  'Published material should relate to the person and their work. Relevant evidence identifies the publication, title, date, author, and context.',
  'Awards and other achievements should be considered with appropriate evidence about the selection criteria and recognition in the field.',
];
function html(extra = '', date = '01/24/2025', chrome = '') {
  return `<html><header>${chrome}</header><main><nav>${chrome}</nav><article><h1>Extraordinary Ability</h1>${TEXT.map(p => `<p>${p}</p>`).join('')}${extra}<div>Last Reviewed/Updated:</div><div>${date}</div><div>Current as of November 20, 2026</div></article></main><footer>${chrome}</footer><script>${chrome}</script></html>`;
}
function response(body = html(), status = 200) { return new Response(body, { status, headers: { 'content-type': 'text/html' } }); }
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0008_rare_mandarin.sql', import.meta.url), 'utf8'));
  function prepare(sql: string, args: (string | number | null)[] = []) {
    return {
      bind(...next: (string | number | null)[]) { return prepare(sql, next); },
      async first<T>() { return (sqlite.prepare(sql).get(...args) ?? null) as T | null; },
      async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }; },
    };
  }
  return { sqlite, db: { prepare } satisfies UscisMonitorDatabase };
}

test('the parser separates USCIS update and currency dates and excludes chrome and changing date metadata from content', () => {
  const first = parseUscisSourceHtml(html('', '01/24/2025', 'old navigation'), NOW);
  const second = parseUscisSourceHtml(html('', '11/24/2026', 'completely different navigation').replace('November 20, 2026', 'November 25, 2026'), NOW);
  assert.equal(first.sourceUpdatedAt, '2025-01-24');
  assert.equal(first.sourceCurrentAsOf, '2026-11-20');
  assert.equal(second.sourceCurrentAsOf, '2026-11-25');
  assert.equal(first.content, second.content);
  assert.ok(!first.content.includes('navigation'));
  assert.ok(!first.content.includes('01/24/2025'));
});

test('dates are actual valid nonfuture printed dates, not an arbitrary date elsewhere in the source', () => {
  assert.equal(parseUscisSourceDate('Last Reviewed/Updated: 02/30/2025', NOW), null);
  assert.equal(parseUscisSourceDate('Last Updated: 2027-01-01', NOW), null);
  assert.equal(parseUscisSourceDate('Published November 20, 2026', NOW), null);
  assert.equal(parseUscisSourceDate('Last Updated: October 2, 2024', NOW), '2024-10-02');
  assert.equal(parseUscisSourceDate('Last Reviewed: 2025-08-04', NOW), '2025-08-04');
  const footerDate = html().replace('<div>Last Reviewed/Updated:</div><div>01/24/2025</div>', '').replace('<footer>', '<footer>Last Reviewed/Updated: 01/24/2025');
  assert.equal(parseUscisSourceHtml(footerDate, NOW).sourceUpdatedAt, '2025-01-24');
});

test('an access denial, incomplete content, or a generic page cannot become a baseline', () => {
  assert.throws(() => parseUscisSourceHtml('<main><h1>Access Denied</h1><p>Verify you are human</p></main>', NOW));
  assert.throws(() => parseUscisSourceHtml('<main><p>Extraordinary Ability scholarly articles judging national</p></main>', NOW));
  assert.throws(() => parseUscisSourceHtml(`<main>${'general unrelated information '.repeat(100)}</main>`, NOW));
  assert.throws(() => parseUscisSourceHtml(TEXT.join(' '), NOW));
});

test('first successful checks establish baselines and all callers share the daily cache', async () => {
  const { sqlite, db } = fixture(); let calls = 0;
  const fetcher = (async () => { calls++; return response(); }) as typeof fetch;
  try {
    const first = await readUscisGuidanceMonitor(db, { now: NOW, fetcher });
    assert.equal(calls, 2);
    assert.ok(first.sources.every(source => source.status === 'baseline' && source.latestChange === null && source.version?.length === 64));
    assert.equal(first.mode, 'on_visit');
    const next = await readUscisGuidanceMonitor(db, { now: NOW + USCIS_CHECK_INTERVAL_MS - 1, fetcher });
    assert.equal(calls, 2);
    assert.deepEqual(next.sources, first.sources);
    const tomorrow = await readUscisGuidanceMonitor(db, { now: NOW + USCIS_CHECK_INTERVAL_MS, fetcher });
    assert.equal(calls, 4);
    assert.ok(tomorrow.sources.every(source => source.status === 'unchanged' && source.latestChange === null));
  } finally { sqlite.close(); }
});

test('changed text records bounded excerpts and version history; unchanged checks preserve the latest detected change', async () => {
  const { sqlite, db } = fixture(); let revision = 0;
  const fetcher = (async () => response(html(`<p>Additional evidence explanation with enough detail for a useful excerpt, revision ${revision}.</p>`))) as typeof fetch;
  try {
    await readUscisGuidanceMonitor(db, { now: NOW, fetcher });
    for (revision = 1; revision <= 7; revision++) {
      const result = await readUscisGuidanceMonitor(db, { now: NOW + revision * USCIS_CHECK_INTERVAL_MS, fetcher });
      const source = result.sources[0];
      assert.equal(source.status, 'changed');
      assert.ok(source.latestChange?.added[0].includes(`revision ${revision}`));
      assert.ok(source.latestChange?.removed[0].includes(`revision ${revision - 1}`));
      assert.notEqual(source.latestChange?.version, source.latestChange?.previousVersion);
    }
    revision = 7;
    const unchanged = await readUscisGuidanceMonitor(db, { now: NOW + 9 * USCIS_CHECK_INTERVAL_MS, fetcher });
    assert.equal(unchanged.sources[0].status, 'unchanged');
    assert.ok(unchanged.sources[0].latestChange?.added[0].includes('revision 7'));
    const row = sqlite.prepare('SELECT snapshot_json FROM uscis_source_snapshots WHERE source_id = ?').get(USCIS_MONITORED_SOURCES[0].id);
    assert.equal(JSON.parse(String(row?.snapshot_json)).changes.length, 5);
    assert.ok(!('content' in unchanged.sources[0]));
  } finally { sqlite.close(); }
});

test('a blocked check preserves the last readable snapshot and is rate limited even after failure', async () => {
  const { sqlite, db } = fixture(); let blocked = false, calls = 0;
  const fetcher = (async () => { calls++; return blocked ? response('Access Denied', 403) : response(); }) as typeof fetch;
  try {
    const baseline = await readUscisGuidanceMonitor(db, { now: NOW, fetcher });
    blocked = true;
    const failed = await readUscisGuidanceMonitor(db, { now: NOW + USCIS_CHECK_INTERVAL_MS, fetcher });
    assert.equal(failed.sources[0].status, 'unavailable');
    assert.equal(failed.sources[0].version, baseline.sources[0].version);
    assert.equal(failed.sources[0].lastSuccessfulAt, baseline.sources[0].lastSuccessfulAt);
    assert.notEqual(failed.sources[0].checkedAt, baseline.sources[0].checkedAt);
    await readUscisGuidanceMonitor(db, { now: NOW + USCIS_CHECK_INTERVAL_MS + 1000, fetcher });
    assert.equal(calls, 4);
  } finally { sqlite.close(); }
});

test('unapproved redirects and non-HTML bodies are rejected before a snapshot is stored', async () => {
  const { sqlite, db } = fixture(); const requested: string[] = [];
  const fetcher = (async input => {
    requested.push(String(input));
    return new Response('', { status: 302, headers: { location: 'https://untrusted.example/collect' } });
  }) as typeof fetch;
  try {
    const result = await readUscisGuidanceMonitor(db, { now: NOW, fetcher });
    assert.equal(requested.length, 2);
    assert.ok(requested.every(url => USCIS_MONITORED_SOURCES.some(source => source.url === url)));
    assert.ok(result.sources.every(source => source.status === 'unavailable' && source.version === null));
    const wrongType = await readUscisGuidanceMonitor(db, { now: NOW + USCIS_CHECK_INTERVAL_MS, fetcher: (async () => new Response(html(), { headers: { 'content-type': 'application/json' } })) as typeof fetch });
    assert.ok(wrongType.sources.every(source => source.status === 'unavailable' && source.version === null));
  } finally { sqlite.close(); }
});

test('oversized declared or streamed bodies cannot replace a baseline', async () => {
  const { sqlite, db } = fixture();
  try {
    const declared = await readUscisGuidanceMonitor(db, { now: NOW, fetcher: (async () => new Response(html(), { headers: { 'content-type': 'text/html', 'content-length': '10000000' } })) as typeof fetch });
    assert.ok(declared.sources.every(source => source.status === 'unavailable' && source.version === null));
    const streamed = await readUscisGuidanceMonitor(db, { now: NOW + USCIS_CHECK_INTERVAL_MS, fetcher: (async () => response(html('x'.repeat(800_000)))) as typeof fetch });
    assert.ok(streamed.sources.every(source => source.status === 'unavailable' && source.version === null));
  } finally { sqlite.close(); }
});

test('concurrent visits acquire one lease per source and do not multiply network checks', async () => {
  const { sqlite, db } = fixture(); let calls = 0;
  let release!: () => void;
  const pause = new Promise<void>(resolve => { release = resolve; });
  const fetcher = (async () => { calls++; await pause; return response(); }) as typeof fetch;
  try {
    const a = readUscisGuidanceMonitor(db, { now: NOW, fetcher });
    const b = readUscisGuidanceMonitor(db, { now: NOW, fetcher });
    await new Promise(resolve => setTimeout(resolve, 0));
    release();
    await Promise.all([a, b]);
    assert.equal(calls, 2);
  } finally { sqlite.close(); }
});
