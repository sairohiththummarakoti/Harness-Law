import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createEmptyCase } from '../lib/model.ts';

// Browser modules use constructor parameter properties. Compile them as the
// app does while keeping these tests independent from browser/auth services.
function compiled(source: string) {
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const evidenceUrl = compiled(readFileSync(new URL('../lib/evidence-client.ts', import.meta.url), 'utf8'));
const clientUrl = compiled(readFileSync(new URL('../lib/drive-client.ts', import.meta.url), 'utf8').replace("'./evidence-client.ts'", JSON.stringify(evidenceUrl)));
const { EvidenceRequestError } = await import(evidenceUrl);
const { requestDrive, DriveRequestError, driveCallback } = await import(clientUrl);

test('drive requests preserve the signed-in account and return accepted state', async t => {
  const state = createEmptyCase(); state.revision = 4;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    assert.equal(headers.get('X-Harness-Account'), 'account-a');
    assert.equal(headers.get('content-type'), 'application/json');
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.method, 'POST');
    return Response.json({ state, revision: state.revision });
  });
  const result = await requestDrive('/api/drives', 'account-a', { method: 'POST', body: JSON.stringify({ displayName: 'Research' }) });
  assert.deepEqual(result, { state, revision: 4 });
});

test('drive conflicts retain the latest state for the workspace compare flow', async t => {
  const state = createEmptyCase(); state.revision = 8;
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'A newer case exists.', code: 'revision_conflict', state, revision: 8 }, { status: 409 }));
  await assert.rejects(() => requestDrive('/api/drives', 'account-a'), (error: unknown) => {
    assert.ok(error instanceof EvidenceRequestError);
    assert.ok(error instanceof DriveRequestError);
    const typed = error as { status: number; code: string; state: unknown; revision: number };
    assert.equal(typed.status, 409); assert.equal(typed.code, 'revision_conflict');
    assert.deepEqual(typed.state, state); assert.equal(typed.revision, 8);
    return true;
  });
});

test('expired provider authorization and non-JSON failures preserve HTTP meaning', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Reconnect your drive.', code: 'drive_reconnect_required', needsReauth: true }, { status: 401 }));
  await assert.rejects(() => requestDrive('/api/drives/browse', 'account-a'), (error: unknown) => {
    const typed = error as { status: number; code: string; needsReauth: boolean };
    assert.equal(typed.status, 401); assert.equal(typed.code, 'drive_reconnect_required'); assert.equal(typed.needsReauth, true); return true;
  });
  mock.mock.mockImplementation(async () => new Response('Service unavailable', { status: 503 }));
  await assert.rejects(() => requestDrive('/api/drives', 'account-a'), (error: unknown) => {
    assert.ok(error instanceof EvidenceRequestError);
    assert.equal((error as { status: number }).status, 503); return true;
  });
});

test('OAuth callback selects a valid pending connection and preserves unrelated routing', () => {
  const id = 'drv-12345678-1234-1234-1234-123456789abc';
  const result = driveCallback(new URL(`https://harnesslaw.ai/workspace?view=evidence&driveConnection=${id}#files`));
  assert.equal(result.connectionId, id); assert.equal(result.error, null);
  assert.equal(result.cleanUrl, '/workspace?view=evidence#files'); assert.equal(result.present, true);
  const failed = driveCallback(new URL('https://harnesslaw.ai/evidence-setup?driveError=Connection%20cancelled.&view=evidence'));
  assert.match(failed.error, /Connection cancelled/); assert.equal(failed.cleanUrl, '/evidence-setup?view=evidence');
  const invalid = driveCallback(new URL('https://harnesslaw.ai/workspace?driveConnection=unexpected'));
  assert.equal(invalid.connectionId, null); assert.match(invalid.error, /invalid/);
  const plain = driveCallback(new URL('https://harnesslaw.ai/workspace?view=evidence'));
  assert.equal(plain.present, false); assert.equal(plain.cleanUrl, '/workspace?view=evidence');
});
