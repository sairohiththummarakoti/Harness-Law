import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Node's built-in TS runner requires explicit extensions.
import { requestCase } from '../lib/case-request.ts';
// @ts-ignore Node's built-in TS runner requires explicit extensions.
import { createEmptyCase } from '../lib/model.ts';

test('a non-JSON authentication response keeps its 401 status', async () => {
  const result = await requestCase({}, 1000, async () => new Response('Sign in required', { status: 401 }));
  assert.deepEqual(result, { status: 401, ok: false, data: {} });
});

test('an HTML storage failure keeps its HTTP status without a parse exception', async () => {
  const result = await requestCase({}, 1000, async () => new Response('<html>Service unavailable</html>', { status: 503 }));
  assert.deepEqual(result, { status: 503, ok: false, data: {} });
});

test('successful saves and revision conflicts retain the server case and revision', async () => {
  const state = createEmptyCase();
  state.revision = 7;
  for (const status of [200, 409]) {
    const data = { state, revision: 7, ...(status === 409 ? { error: 'A newer revision exists.' } : {}) };
    const sent: { options?: RequestInit } = {};
    const result = await requestCase({ method: 'PUT', body: '{"test":true}' }, 1000, async (url, options) => {
      assert.equal(url, '/api/case');
      sent.options = options;
      return new Response(JSON.stringify(data), { status });
    });
    assert.deepEqual(result, { status, ok: status === 200, data });
    assert.equal(sent.options?.method, 'PUT');
    assert.equal(sent.options?.body, '{"test":true}');
    assert.equal(sent.options?.credentials, 'same-origin');
    assert.ok(sent.options?.signal);
  }
});

test('a hanging fetch settles at the deadline and aborts its signal', { timeout: 1000 }, async () => {
  const request: { signal?: AbortSignal | null } = {};
  const fetcher: typeof fetch = async (_url, options) => {
    request.signal = options?.signal;
    return new Promise<Response>(() => {});
  };
  await assert.rejects(requestCase({}, 15, fetcher), /took too long.*answers are still here.*try again/i);
  assert.equal(request.signal?.aborted, true);
});

test('a hanging response body is included in the request deadline', { timeout: 1000 }, async () => {
  let bodyController!: ReadableStreamDefaultController<Uint8Array>;
  const request: { signal?: AbortSignal | null } = {};
  const body = new ReadableStream<Uint8Array>({ start(controller) { bodyController = controller; } });
  const fetcher: typeof fetch = async (_url, options) => {
    request.signal = options?.signal;
    return new Response(body, { status: 200 });
  };
  try {
    await assert.rejects(requestCase({}, 15, fetcher), /took too long.*try again/i);
    assert.equal(request.signal?.aborted, true);
  } finally { bodyController.close(); }
});

test('caller cancellation settles even when a fetch implementation ignores abort', { timeout: 1000 }, async () => {
  const caller = new AbortController();
  const request: { signal?: AbortSignal | null } = {};
  const fetcher: typeof fetch = async (_url, options) => {
    request.signal = options?.signal;
    return new Promise<Response>(() => {});
  };
  const pending = requestCase({ signal: caller.signal }, 500, fetcher);
  caller.abort(new Error('Internal abort detail'));
  await assert.rejects(pending, /request was canceled.*answers are still here/i);
  assert.equal(request.signal?.aborted, true);
});

test('an already-canceled request does not call fetch', async () => {
  const caller = new AbortController();
  caller.abort();
  let called = false;
  await assert.rejects(requestCase({ signal: caller.signal }, 1000, async () => {
    called = true;
    return new Response('{}');
  }), /request was canceled/i);
  assert.equal(called, false);
});

test('network failures give a retry message without exposing internal errors', async () => {
  await assert.rejects(requestCase({}, 1000, async () => {
    throw new Error('Internal upstream details at private-host:1234');
  }), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /answers are still here.*connection.*try again/i);
    assert.doesNotMatch(error.message, /private-host|upstream|1234/);
    return true;
  });
});
