import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { D1CaseRepository, MAX_CASE_RECORD_BYTES, type CaseEnvelope } from '../lib/integrations/repository.ts';
import { createIntegrationCase } from '../lib/integrations/domain.ts';

/** Real SQLite execution with D1-shaped prepared statements and atomic batch. */
class SqliteD1 {
  readonly sqlite = new DatabaseSync(':memory:');
  failAtStatement: number | undefined;
  constructor() {
    this.sqlite.exec('PRAGMA foreign_keys = ON');
    this.sqlite.exec(readFileSync(new URL('../drizzle/0001_integration_cases.sql', import.meta.url), 'utf8'));
  }
  prepare(sql: string) { return new SqlitePrepared(this, sql); }
  async batch(statements: SqlitePrepared[]) {
    this.sqlite.exec('BEGIN');
    try {
      const results = statements.map((statement, index) => {
        if (this.failAtStatement === index) throw new Error('Injected batch failure');
        return statement.execute();
      });
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
  binding(): D1Database { return this as unknown as D1Database; }
  close() { this.sqlite.close(); }
}
class SqlitePrepared {
  private values: SQLInputValue[] = [];
  constructor(privateDatabase: SqliteD1, sql: string) { this.database = privateDatabase; this.sql = sql; }
  private readonly database: SqliteD1;
  private readonly sql: string;
  bind(...values: SQLInputValue[]) {
    for (const value of values) {
      if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') > 2_000_000) throw new Error('D1 individual value limit exceeded');
    }
    const statement = new SqlitePrepared(this.database, this.sql); statement.values = values; return statement;
  }
  execute() {
    const outcome = this.database.sqlite.prepare(this.sql).run(...this.values);
    return { success: true, results: [], meta: { changes: Number(outcome.changes) } };
  }
  async run() { return this.execute(); }
  async all() { return { success: true, results: this.database.sqlite.prepare(this.sql).all(...this.values), meta: {} }; }
  async first(column?: string) {
    const row = this.database.sqlite.prepare(this.sql).get(...this.values);
    return row ? column ? row[column] : row : null;
  }
}
function envelope(caseId = 'case-a', owner = 'owner-a'): CaseEnvelope {
  return { state: createIntegrationCase(caseId, owner, '2026-11-22T12:00:00Z'), processing_consent: true, receipts: {} };
}
function chunkRows(db: SqliteD1) {
  return db.sqlite.prepare('SELECT case_id, revision, chunk_index, payload FROM integration_case_chunks ORDER BY case_id, revision, chunk_index').all();
}

test('D1 chunk storage round-trips a multi-megabyte Unicode aggregate below per-value limits', async t => {
  const db = new SqliteD1(); t.after(() => db.close());
  const repository = new D1CaseRepository(db.binding()), value = envelope();
  const unicode = '💼漢'.repeat(400000);
  value.receipts.fixture = { operation: 'fixture', hash: 'a'.repeat(64), response: { status: 200, data: { unicode } }, created_at: value.state.updated_at };
  assert.ok(Buffer.byteLength(JSON.stringify(value)) > 2_000_000);
  assert.equal(await repository.insert(value), true);
  assert.deepEqual(await repository.find('owner-a', 'case-a'), value);
  assert.deepEqual(await repository.findForWorker('case-a'), value);
  const rows = chunkRows(db); assert.ok(rows.length > 2);
  for (const row of rows) {
    assert.ok(Buffer.byteLength(String(row.payload), 'utf8') < 1_000_000);
    assert.equal(String(row.payload).includes('\uFFFD'), false);
  }
});

test('duplicate owners, case collisions and cross-case reads cannot change stored chunks', async t => {
  const db = new SqliteD1(); t.after(() => db.close());
  const repository = new D1CaseRepository(db.binding()), original = envelope();
  assert.equal(await repository.insert(original), true);
  const before = chunkRows(db);
  assert.equal(await repository.insert(envelope('other-case', 'owner-a')), false);
  assert.equal(await repository.insert(envelope('case-a', 'other-owner')), false);
  assert.equal(await repository.find('other-owner', 'case-a'), null);
  assert.equal(await repository.find('owner-a', 'other-case'), null);
  const spoofed = envelope('case-a', 'other-owner'); spoofed.state.revision = 1;
  assert.equal(await repository.compareAndSwap(spoofed, 0), false);
  assert.deepEqual(chunkRows(db), before);
  assert.deepEqual(await repository.find('owner-a'), original);
});

test('a losing D1 CAS cannot insert phantom events, receipts or remove winning chunks', async t => {
  const db = new SqliteD1(); t.after(() => db.close());
  const repository = new D1CaseRepository(db.binding());
  await repository.insert(envelope());
  const winner = (await repository.find('owner-a'))!, loser = structuredClone(winner);
  winner.state.revision = 1; loser.state.revision = 1;
  winner.receipts.winner = { operation: 'test', hash: 'a'.repeat(64), response: { status: 200, data: 'winner' }, created_at: winner.state.updated_at };
  loser.receipts.loser = { operation: 'test', hash: 'b'.repeat(64), response: { status: 200, data: 'loser'.repeat(100000) }, created_at: loser.state.updated_at };
  loser.state.outbox.push({ event_id: 'phantom-event', schema_version: '1', case_id: 'case-a', type: 'test.changed', object_id: 'fake', object_revision: 1, occurred_at: loser.state.updated_at, correlation_id: 'test', causation_id: 'test' });
  assert.equal(await repository.compareAndSwap(winner, 0), true);
  const before = chunkRows(db);
  assert.equal(await repository.compareAndSwap(loser, 0), false);
  assert.deepEqual(chunkRows(db), before);
  assert.deepEqual(await repository.find('owner-a'), winner);
  assert.ok(chunkRows(db).every(row => row.revision === 1));
});

test('D1 transaction failures roll back the changed head and all partial chunks', async t => {
  const db = new SqliteD1(); t.after(() => db.close());
  const repository = new D1CaseRepository(db.binding()), original = envelope();
  await repository.insert(original);
  const next = structuredClone(original); next.state.revision = 1;
  next.receipts.large = { operation: 'test', hash: 'a'.repeat(64), response: { status: 200, data: 'x'.repeat(700000) }, created_at: next.state.updated_at };
  const before = chunkRows(db);
  db.failAtStatement = 2;
  await assert.rejects(repository.compareAndSwap(next, 0), /Injected batch failure/);
  assert.deepEqual(await repository.find('owner-a'), original); assert.deepEqual(chunkRows(db), before);
  await assert.rejects(repository.insert({ ...next, state: { ...next.state, case_id: 'case-b', owner_id: 'owner-b' } }), /Injected batch failure/);
  assert.equal(await repository.find('owner-b'), null); assert.deepEqual(chunkRows(db), before);
  db.failAtStatement = undefined;
  assert.equal(await repository.compareAndSwap(next, 0), true);
  assert.deepEqual(await repository.find('owner-a'), next);
});

test('due-job lookup respects backoff, active leases, terminal jobs and bounded result counts', async t => {
  const db = new SqliteD1(); t.after(() => db.close());
  const repository = new D1CaseRepository(db.binding());
  function withJob(name: string, state: 'queued' | 'running' | 'succeeded', when?: string) {
    const row = envelope(`case-${name}`, `owner-${name}`); row.state.updated_at = '2000-01-01T00:00:00Z';
    row.state.jobs.job = { job_id: 'job', kind: 'document', object_id: 'doc', state, stage: 'scanning', attempts: 0, max_attempts: 3, pipeline_version: '1', checkpoints: {}, created_at: row.state.updated_at,
      ...(state === 'running' ? { lease_expires_at: when } : { next_attempt_at: when }) };
    return row;
  }
  await repository.insert(withJob('due', 'queued'));
  await repository.insert(withJob('backoff', 'queued', '2999-01-01T00:00:00Z'));
  await repository.insert(withJob('lease', 'running', '2999-01-01T00:00:00Z'));
  await repository.insert(withJob('expired', 'running', '2001-01-01T00:00:00Z'));
  await repository.insert(withJob('terminal', 'succeeded'));
  assert.deepEqual(await repository.dueCases(20), ['case-due', 'case-expired']);
  assert.deepEqual(await repository.dueCases(1), ['case-due']);
  const completed = (await repository.find('owner-due'))!; completed.state.jobs.job.state = 'succeeded'; completed.state.revision++;
  await repository.compareAndSwap(completed, 0);
  assert.deepEqual(await repository.dueCases(20), ['case-expired']);
});

test('the aggregate byte ceiling rejects oversized Unicode before writing any state', async t => {
  const db = new SqliteD1(); t.after(() => db.close());
  const repository = new D1CaseRepository(db.binding()), oversized = envelope();
  oversized.receipts.large = { operation: 'test', hash: 'a'.repeat(64), response: { status: 200, data: '漢'.repeat(Math.ceil(MAX_CASE_RECORD_BYTES / 3)) }, created_at: oversized.state.updated_at };
  await assert.rejects(repository.insert(oversized), /capacity exceeded/);
  assert.equal(await repository.find('owner-a'), null); assert.deepEqual(chunkRows(db), []);
});
