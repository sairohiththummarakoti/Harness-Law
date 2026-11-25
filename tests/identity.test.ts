import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Explicit TypeScript extension for Node's test runner.
import { resolveIdentity } from '../lib/identity.ts';
// @ts-ignore Explicit TypeScript extension for Node's test runner.
import { cookieNames } from '../lib/auth/runtime.ts';

const native = { userId: 'existing-site-user', displayName: 'Applicant', email: 'applicant@example.test', fullName: null };
const google = { ...native, userId: 'google:123', provider: 'google' as const };
const unexpectedNative = async () => { throw new Error('A different account must not be selected'); };

test('existing ChatGPT ownership IDs are preserved exactly', async () => {
  assert.deepEqual(await resolveIdentity('', false, async () => null, async () => native), { ...native, provider: 'chatgpt' });
});

test('expired Google session cookie cannot fall back after the browser removes it', async () => {
  const marker = `${cookieNames(true).provider}=google`;
  assert.equal(await resolveIdentity(marker, false, async () => null, unexpectedNative), null);
  assert.equal(await resolveIdentity(marker, false, async () => { throw new Error('database unavailable'); }, unexpectedNative), null);
});

test('HTTPS development sessions and production sessions use secure cookies', async () => {
  const marker = `${cookieNames(true).provider}=google`;
  assert.deepEqual(await resolveIdentity(marker, true, async secure => { assert.equal(secure, true); return google; }, unexpectedNative), google);
  assert.deepEqual(await resolveIdentity(marker, false, async secure => { assert.equal(secure, true); return google; }, unexpectedNative), google);
});

test('production ignores development-only credentials while HTTP development accepts them', async () => {
  const marker = `${cookieNames(false).provider}=google`;
  assert.deepEqual(await resolveIdentity(marker, false, async () => { throw new Error('dev cookie trusted in production'); }, async () => native), { ...native, provider: 'chatgpt' });
  assert.deepEqual(await resolveIdentity(marker, true, async secure => { assert.equal(secure, false); return google; }, unexpectedNative), google);
});

test('password provider selection takes precedence over stale Google and hosted identities', async () => {
  const marker = `${cookieNames(true).provider}=password`;
  const password={...native,userId:'password:abc',provider:'password' as const};
  assert.deepEqual(await resolveIdentity(`${marker}; ${cookieNames(true).session}=ignored`,false,async()=>google,unexpectedNative,async()=>password),password);
  assert.equal(await resolveIdentity(marker,false,async()=>null,unexpectedNative,async()=>null),null);
});
