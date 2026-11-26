import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import test from 'node:test';
import { createEmptyCase } from '../lib/model.ts';
import { createDriveRepository, type DriveAuthorization, type DriveConnection } from '../lib/drives/repository.ts';

const OWNER = 'test-owner', ID = 'drv-5fa2a8c6-fbd8-40cb-9f87-7b9b61c9d47b';
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of ['0000_same_leopardon.sql', '0010_thankful_midnight.sql']) sqlite.exec(readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), 'utf8'));
  const tracker = { failAt: -1 };
  type Statement = { bind(...args: SQLInputValue[]): Statement; first(): Promise<unknown>; run(): Promise<unknown>; all(): Promise<unknown> };
  const statement = (sql: string, args: SQLInputValue[] = []): Statement => ({
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
        for (const [index, query] of statements.entries()) {
          if (index === tracker.failAt) throw new Error('Injected transaction failure');
          results.push(await query.run());
        }
        sqlite.exec('COMMIT'); return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } as unknown as D1Database;
  const repository = createDriveRepository(db), state = createEmptyCase(); state.id = 'case-test';
  sqlite.prepare('INSERT INTO cases (owner_id,case_id,revision,state_json,updated_at) VALUES (?,?,?,?,?)').run(OWNER, state.id, state.revision, JSON.stringify(state), state.updatedAt);
  const row: DriveConnection = { id: ID, owner_id: OWNER, provider: 'google_drive', display_name: '', scope: 'whole_drive', root_id: 'root-id', root_name: 'My Drive', drive_id: null, account_id: 'google-account', account_label: 'owner@example.test', token_ciphertext: 'encrypted-placeholder', token_expires_at: 3000, status: 'pending', case_id: null, evidence_folder_id: null, created_at: 1000, updated_at: 1000 };
  return { sqlite, tracker, repository, state, row };
}
function selection(f: ReturnType<typeof fixture>) {
  const folder = { id: 'folder-external', name: 'Research', parentId: null, origin: 'external' as const, connectionId: ID };
  const next = { ...f.state, revision: 1, folders: [folder] };
  const connection: DriveConnection = { ...f.row, status: 'connected', scope: 'folder', display_name: folder.name, root_id: 'chosen-root', case_id: f.state.id, evidence_folder_id: folder.id, updated_at: 1001 };
  return { next, connection };
}

test('D1 connection finalization atomically saves case folder and root; injected failure rolls both back', async t => {
  const f = fixture(); t.after(() => f.sqlite.close()); await f.repository.insert(f.row);
  const { next, connection } = selection(f); f.tracker.failAt = 1;
  await assert.rejects(f.repository.saveConnectionCase(f.row, connection, next, 0), /Injected/);
  assert.equal((await f.repository.caseRead(OWNER))!.revision, 0);
  assert.equal((await f.repository.get(OWNER, ID))!.status, 'pending');
  f.tracker.failAt = -1;
  assert.equal(await f.repository.saveConnectionCase(f.row, connection, next, 0), true);
  assert.equal((await f.repository.caseRead(OWNER))!.folders![0].connectionId, ID);
  assert.equal((await f.repository.get(OWNER, ID))!.root_id, 'chosen-root');
});

test('stale case or changed connection cannot partially create an Evidence folder', async t => {
  const f = fixture(); t.after(() => f.sqlite.close()); await f.repository.insert(f.row);
  const { next, connection } = selection(f);
  f.sqlite.prepare('UPDATE cases SET revision=1 WHERE owner_id=?').run(OWNER);
  assert.equal(await f.repository.saveConnectionCase(f.row, connection, next, 0), false);
  assert.equal((await f.repository.get(OWNER, ID))!.status, 'pending');
  f.sqlite.prepare('UPDATE cases SET revision=0 WHERE owner_id=?').run(OWNER);
  await f.repository.markReconnect(OWNER, ID);
  assert.equal(await f.repository.saveConnectionCase(f.row, connection, next, 0), false);
  assert.equal((await f.repository.caseRead(OWNER))!.folders, undefined);
  assert.equal((await f.repository.get(OWNER, ID))!.status, 'reconnect_required');
});

test('D1 enforces owner isolation and token compare-and-swap without sharing provider credentials', async t => {
  const f = fixture(); t.after(() => f.sqlite.close()); await f.repository.insert(f.row);
  await f.repository.insert({ ...f.row, id: 'other-connection', token_ciphertext: 'other-token' });
  assert.equal(await f.repository.get('foreign-owner', ID), null);
  assert.deepEqual(await f.repository.list('foreign-owner'), []);
  assert.equal(await f.repository.delete('foreign-owner', ID), false);
  await f.repository.updateToken(f.row, 'renewed', 4000);
  await f.repository.updateToken(f.row, 'stale-refresh', 4500);
  await f.repository.markReconnect(OWNER, ID, f.row.token_ciphertext);
  assert.equal((await f.repository.get(OWNER, ID))!.token_ciphertext, 'renewed');
  assert.equal((await f.repository.get(OWNER, ID))!.status, 'pending', 'a stale failing refresh cannot revoke a newer successful refresh');
  assert.equal((await f.repository.get(OWNER, 'other-connection'))!.token_ciphertext, 'other-token');
});

test('OAuth authorization consumption is atomic, owner/browser-bound, expiring and one use', async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const now = Math.floor(Date.now() / 1000);
  const value: DriveAuthorization = { state_hash: 'hash', owner_id: OWNER, provider: 'google_drive', browser_hash: 'browser', verifier_ciphertext: 'ciphertext', return_to: '/evidence-setup', expires_at: now + 600 };
  assert.equal(await f.repository.authorizationStart(value), true);
  assert.equal(await f.repository.authorizationTake('hash', 'other', 'browser', now), null);
  assert.equal(await f.repository.authorizationTake('hash', OWNER, 'other-browser', now), null);
  assert.equal(await f.repository.authorizationTake('hash', OWNER, 'browser', now + 601), null);
  assert.equal((await f.repository.authorizationTake('hash', OWNER, 'browser', now))!.return_to, '/evidence-setup');
  assert.equal(await f.repository.authorizationTake('hash', OWNER, 'browser', now), null);
});

test('OAuth start limits pending authorizations per account and expires old attempts', async t => {
  const f = fixture(); t.after(() => f.sqlite.close()); const now = Math.floor(Date.now() / 1000);
  const value: DriveAuthorization = { state_hash: 'base', owner_id: OWNER, provider: 'google_drive', browser_hash: 'browser', verifier_ciphertext: 'ciphertext', return_to: '/evidence-setup', expires_at: now + 600 };
  for (let i = 0; i < 5; i++) assert.equal(await f.repository.authorizationStart({ ...value, state_hash: `hash-${i}` }), true);
  assert.equal(await f.repository.authorizationStart({ ...value, state_hash: 'sixth' }), false);
  assert.equal(await f.repository.authorizationStart({ ...value, state_hash: 'other-account', owner_id: 'other' }), true);
  f.sqlite.prepare('UPDATE cloud_drive_authorizations SET expires_at=0 WHERE state_hash=?').run('hash-0');
  assert.equal(await f.repository.authorizationStart({ ...value, state_hash: 'replacement' }), true);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS count FROM cloud_drive_authorizations WHERE owner_id=?').get(OWNER)!.count, 5);
});
