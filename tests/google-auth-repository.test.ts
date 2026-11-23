import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
// @ts-ignore Explicit TypeScript extension for Node's test runner.
import { createAuthRepository, type AuthDatabase } from '../lib/auth/repository.ts';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0002_google_signin.sql', import.meta.url), 'utf8'));
  const database = {
    prepare(sql: string) {
      return {
        bind(...values: (string | number | null)[]) {
          return {
            async first() { return sqlite.prepare(sql).get(...values) ?? null; },
            async run() { return sqlite.prepare(sql).run(...values); },
          };
        },
      };
    },
  } as unknown as AuthDatabase;
  return { sqlite, repository: createAuthRepository(database) };
}

test('migration and production SQL enforce single-use, unexpired challenges', async () => {
  const { sqlite, repository } = fixture();
  try {
    await repository.addChallenge('active', 200);
    const outcomes = await Promise.all([repository.consumeChallenge('active', 100), repository.consumeChallenge('active', 100)]);
    assert.deepEqual(outcomes.sort(), [false, true]);
    await repository.addChallenge('expired', 100);
    assert.equal(await repository.consumeChallenge('expired', 100), false);
    assert.equal(await repository.consumeChallenge('missing', 100), false);
  } finally { sqlite.close(); }
});

test('session lookup respects expiration and server-side revocation', async () => {
  const { sqlite, repository } = fixture();
  try {
    const session = { token_hash: 'hash', user_id: 'google:stable-subject', email: 'applicant@example.test', full_name: null, expires_at: 200 };
    await repository.addSession(session);
    assert.deepEqual({ ...await repository.readSession('hash', 199) }, session);
    assert.equal(await repository.readSession('hash', 200), null);
    assert.equal(await repository.readSession('another-token', 199), null);
    await repository.deleteSession('hash');
    assert.equal(await repository.readSession('hash', 199), null);
  } finally { sqlite.close(); }
});

test('cleanup is bounded and retains live authentication records', async () => {
  const { sqlite, repository } = fixture();
  try {
    for (let index = 0; index < 110; index++) {
      await repository.addChallenge(`expired-${index}`, 99);
      await repository.addSession({ token_hash: `expired-${index}`, user_id: 'google:subject', email: 'user@example.test', full_name: 'User', expires_at: 99 });
    }
    await repository.addChallenge('live', 200);
    await repository.addSession({ token_hash: 'live', user_id: 'google:subject', email: 'user@example.test', full_name: 'User', expires_at: 200 });
    await repository.cleanupExpired(100);
    assert.equal(sqlite.prepare('SELECT count(*) AS total FROM auth_challenges').get()?.total, 11);
    assert.equal(sqlite.prepare('SELECT count(*) AS total FROM auth_sessions').get()?.total, 11);
    assert.equal(await repository.consumeChallenge('live', 100), true);
    assert.ok(await repository.readSession('live', 100));
  } finally { sqlite.close(); }
});
