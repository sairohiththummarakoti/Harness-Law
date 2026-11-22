import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Explicit TypeScript extension for Node's test runner.
import { matchesExpectedAccount } from '../lib/account-context.ts';

test('stale Google and ChatGPT tabs cannot operate under a different account', () => {
  const request = (account: string) => new Request('https://harnesslaw.ai/api/case', { headers: { 'X-Harness-Account': account } });
  assert.equal(matchesExpectedAccount(request('google:123'), 'google:123'), true);
  assert.equal(matchesExpectedAccount(request('google:123'), 'chatgpt-account'), false);
  assert.equal(matchesExpectedAccount(request('chatgpt-account'), 'google:123'), false);
  assert.equal(matchesExpectedAccount(request('google:123'), 'google:456'), false);
  assert.equal(matchesExpectedAccount(request(''), 'google:123'), false);
  assert.equal(matchesExpectedAccount(new Request('https://harnesslaw.ai/api/case'), 'google:123'), true);
});
