import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyCase, type CaseState } from '../lib/model.ts';
import { capabilities, providerConfig } from '../lib/drives/config.ts';
import { assertWithinRoot, downloadItem, DriveError, listChildren, readLimitedResponse } from '../lib/drives/providers.ts';
import { publicConnection, type DriveAuthorization, type DriveConnection, type DriveRepository } from '../lib/drives/repository.ts';
import { authorizedConnection, handleDriveBrowse, handleDriveCallback, handleDriveConnect, handleDriveDisconnect, handleDriveSave, type DriveDependencies } from '../lib/drives/service.ts';
import { handleDriveImport } from '../lib/drives/import.ts';
import { pkceChallenge, seal, unseal } from '../lib/drives/security.ts';
import { handleEvidenceUpload, type EvidenceObjectRow, type EvidenceStorageDependencies } from '../lib/evidence-storage.ts';

const OWNER = 'google:applicant';
const SECRET = 'mock-encryption-key-only-for-tests-32chars';
const ID = 'drv-5fa2a8c6-fbd8-40cb-9f87-7b9b61c9d47b';
const ID2 = 'drv-b5aa71a3-4c3c-4477-a032-c0bcb19f24d0';
const UPLOAD_ID = '4a752850-571d-4e35-a823-4ef193a7add0';
const env = { HARNESS_DRIVE_GOOGLE_CLIENT_ID: 'test-client', HARNESS_DRIVE_GOOGLE_CLIENT_SECRET: 'test-secret', HARNESS_DRIVE_MICROSOFT_CLIENT_ID: 'test-ms-client', HARNESS_DRIVE_MICROSOFT_CLIENT_SECRET: 'test-ms-secret', HARNESS_DRIVE_TOKEN_SECRET: SECRET };
const folder = (id: string, parent?: string) => ({ id, name: id, mimeType: 'application/vnd.google-apps.folder', parents: parent ? [parent] : [] });
const textFile = (id: string, parent: string) => ({ id, name: 'source.txt', mimeType: 'text/plain', size: 22, parents: [parent] });
const json = (data: unknown, status = 200) => Response.json(data, { status });
type RawItem = Record<string, unknown>;

function request(path: string, data?: unknown, options: { method?: string; account?: string; origin?: string; cookie?: string } = {}) {
  const headers = new Headers({ 'X-Harness-Account': options.account ?? OWNER });
  if (data !== undefined || options.method === 'DELETE') headers.set('Origin', options.origin ?? 'https://app.test');
  if (data !== undefined) headers.set('Content-Type', 'application/json');
  if (options.cookie) headers.set('Cookie', options.cookie);
  return new Request(`https://app.test${path}`, { method: options.method || (data === undefined ? 'GET' : 'POST'), headers, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
}
async function fixture(status: DriveConnection['status'] = 'connected') {
  let state = createEmptyCase(); state.id = 'case-current'; state.consent = true;
  state.folders = status === 'pending' ? [] : [{ id: 'folder-linked', name: 'Selected evidence', parentId: null, origin: 'external', connectionId: ID }];
  const now = Math.floor(Date.now() / 1000);
  const row: DriveConnection = { id: ID, owner_id: OWNER, provider: 'google_drive', display_name: status === 'pending' ? '' : 'Selected evidence', scope: status === 'pending' ? 'whole_drive' : 'folder', root_id: status === 'pending' ? 'root-id' : 'allowed', root_name: 'Selected', drive_id: null, account_id: 'provider-account', account_label: 'person@example.test', token_ciphertext: '', token_expires_at: now + 3600, status, case_id: status === 'pending' ? null : state.id, evidence_folder_id: status === 'pending' ? null : 'folder-linked', created_at: now, updated_at: now };
  row.token_ciphertext = await seal({ accessToken: 'test-access', refreshToken: 'test-refresh', expiresAt: row.token_expires_at }, SECRET, `drive:${OWNER}:${ID}`);
  const rows = new Map<string, DriveConnection>([[row.id, row]]), transactions = new Map<string, DriveAuthorization>();
  const raw = new Map<string, RawItem>([['root-id', folder('root-id')], ['allowed', folder('allowed', 'root-id')], ['nested', folder('nested', 'allowed')], ['outside', folder('outside', 'root-id')], ['file', textFile('file', 'nested')], ['other-file', textFile('other-file', 'outside')]]);
  const tracker = { user: OWNER as string | null, fetches: [] as string[], tokenExchanges: 0, failSave: false, uploads: 0, nextPage: null as string | null, onDownload: undefined as (() => void) | undefined, tokenStatus: 200, lastTokenBody: null as URLSearchParams | null };
  const repository: DriveRepository = {
    async list(owner) { return [...rows.values()].filter(r => r.owner_id === owner).map(r => structuredClone(r)); },
    async get(owner, id) { const r = rows.get(id); return r?.owner_id === owner ? structuredClone(r) : null; },
    async insert(r) { rows.set(r.id, structuredClone(r)); },
    async delete(owner, id) { if (rows.get(id)?.owner_id !== owner) return false; return rows.delete(id); },
    async updateToken(r, ciphertext, expires) { const current = rows.get(r.id); if (current?.owner_id === r.owner_id && current.token_ciphertext === r.token_ciphertext) { current.token_ciphertext = ciphertext; current.token_expires_at = expires; } },
    async markReconnect(owner, id, expected) { const current = rows.get(id); if (current?.owner_id === owner && (!expected || current.token_ciphertext === expected)) current.status = 'reconnect_required'; },
    async authorizationStart(value) { transactions.set(value.state_hash, structuredClone(value)); return true; },
    async authorizationTake(hash, owner, browser, now) { const value = transactions.get(hash); if (!value || value.owner_id !== owner || value.browser_hash !== browser || value.expires_at <= now) return null; transactions.delete(hash); return value; },
    async caseRead(owner) { return owner === OWNER ? structuredClone(state) : null; },
    async saveConnectionCase(previous, next, candidate, revision) { if (tracker.failSave || state.revision !== revision || rows.get(previous.id)?.status !== previous.status) return false; state = structuredClone(candidate); rows.set(next.id, structuredClone(next)); return true; },
  };
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); tracker.fetches.push(url.href);
    if (url.href === 'https://oauth2.googleapis.com/token') {
      tracker.tokenExchanges++; tracker.lastTokenBody = new URLSearchParams(String(init?.body));
      return tracker.tokenStatus === 200 ? json({ access_token: 'renewed-access', refresh_token: 'renewed-refresh', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/drive.readonly' }) : json({ error: 'invalid_grant' }, tracker.tokenStatus);
    }
    if (url.pathname === '/oauth2/v3/userinfo') return json({ sub: 'provider-account', email: 'person@example.test' });
    if (url.origin !== 'https://www.googleapis.com') throw new Error(`Unexpected origin ${url.origin}`);
    if (url.pathname === '/drive/v3/files') {
      const parent = url.searchParams.get('q')?.match(/^'([^']+)'/)?.[1];
      return json({ files: [...raw.values()].filter(item => Array.isArray(item.parents) && item.parents.includes(parent)), nextPageToken: tracker.nextPage });
    }
    const id = decodeURIComponent(url.pathname.split('/')[4] || '');
    if (url.searchParams.get('alt') === 'media' || url.pathname.endsWith('/export')) { tracker.onDownload?.(); return new Response('Applicant: Alex Example'); }
    return raw.has(id === 'root' ? 'root-id' : id) ? json(raw.get(id === 'root' ? 'root-id' : id)) : json({ error: 'missing' }, 404);
  }) as typeof fetch;
  const deps: DriveDependencies = { env, repository, getUser: async () => tracker.user ? { userId: tracker.user } : null, fetch: fetcher };
  return { deps, raw, rows, transactions, tracker, state: () => state, setState: (next: CaseState) => { state = structuredClone(next); } };
}

test('dedicated provider credentials are mandatory and capabilities reveal no secrets', () => {
  assert.equal(providerConfig({ HARNESS_GOOGLE_CLIENT_ID: 'wrong-project', HARNESS_GOOGLE_CLIENT_SECRET: 'old-secret', HARNESS_DRIVE_TOKEN_SECRET: SECRET }, 'google_drive'), null);
  assert.equal(providerConfig({ ...env, HARNESS_DRIVE_TOKEN_SECRET: 'short' }, 'google_drive'), null);
  const config = capabilities(env);
  assert.equal(config.providers.every(provider => provider.ready), true);
  assert.equal(JSON.stringify(config).includes('test-secret'), false);
  assert.deepEqual(config.icloud, { mode: 'device_import' });
  assert.match(providerConfig(env, 'onedrive')!.scope, /Files\.Read(?:\s|$)/);
  assert.doesNotMatch(providerConfig(env, 'onedrive')!.scope, /ReadWrite|Read\.All/);
});

test('token encryption binds each ciphertext to both owner and connection', async () => {
  const encrypted = await seal({ accessToken: 'private-token' }, SECRET, `drive:${OWNER}:${ID}`);
  assert.equal(encrypted.includes('private-token'), false);
  assert.deepEqual(await unseal(encrypted, SECRET, `drive:${OWNER}:${ID}`), { accessToken: 'private-token' });
  await assert.rejects(unseal(encrypted, SECRET, `drive:other:${ID}`));
  await assert.rejects(unseal(encrypted, SECRET, `drive:${OWNER}:${ID2}`));
  await assert.rejects(unseal(encrypted, `${SECRET}-rotated`, `drive:${OWNER}:${ID}`));
  assert.equal(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('OAuth start requires active same-account and same-origin session before recording state', async () => {
  const f = await fixture();
  f.tracker.user = null;
  assert.equal((await handleDriveConnect(request('/api/drives/connect', { provider: 'google_drive' }), f.deps)).status, 401);
  f.tracker.user = OWNER;
  assert.equal((await handleDriveConnect(request('/api/drives/connect', { provider: 'google_drive' }, { account: 'other' }), f.deps)).status, 401);
  assert.equal((await handleDriveConnect(request('/api/drives/connect', { provider: 'google_drive' }, { origin: 'https://attacker.test' }), f.deps)).status, 403);
  assert.equal(f.transactions.size, 0); assert.equal(f.tracker.fetches.length, 0);
});

test('OAuth callback binds browser, owner, one-use state and PKCE; keeps pending until named selection', async () => {
  const f = await fixture();
  const start = await handleDriveConnect(request('/api/drives/connect', { provider: 'google_drive', returnTo: '/evidence-setup' }), f.deps);
  const { authorizationUrl } = await start.json() as { authorizationUrl: string };
  const url = new URL(authorizationUrl), cookie = start.headers.get('set-cookie')!.split(';')[0];
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('client_id'), 'test-client');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://app.test/api/drives/callback');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(start.headers.get('set-cookie')!, /HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
  const callback = `/api/drives/callback?code=test-code&state=${url.searchParams.get('state')}`;
  const absent = await handleDriveCallback(request(callback), f.deps);
  assert.match(absent.headers.get('location')!, /driveError=/); assert.equal(f.transactions.size, 1);
  f.tracker.user = 'google:other';
  await handleDriveCallback(request(callback, undefined, { cookie, account: 'google:other' }), f.deps);
  assert.equal(f.transactions.size, 1); assert.equal(f.tracker.tokenExchanges, 0);
  f.tracker.user = OWNER;
  const done = await handleDriveCallback(request(callback, undefined, { cookie }), f.deps);
  const destination = new URL(done.headers.get('location')!);
  assert.equal(destination.pathname, '/evidence-setup'); assert.match(destination.searchParams.get('driveConnection')!, /^drv-/);
  const added = f.rows.get(destination.searchParams.get('driveConnection')!)!;
  assert.equal(added.status, 'pending'); assert.equal(added.case_id, null); assert.equal(f.state().folders!.length, 1);
  assert.equal(await pkceChallenge(f.tracker.lastTokenBody!.get('code_verifier')!), url.searchParams.get('code_challenge'));
  assert.equal(f.tracker.lastTokenBody!.get('client_secret'), 'test-secret');
  assert.equal(added.token_ciphertext.includes('renewed-access'), false);
  const replay = await handleDriveCallback(request(callback, undefined, { cookie }), f.deps);
  assert.match(replay.headers.get('location')!, /driveError=/); assert.equal(f.tracker.tokenExchanges, 1);
});

test('OAuth rejects expired state and cannot redirect away from the application', async () => {
  const f = await fixture();
  const start = await handleDriveConnect(request('/api/drives/connect', { provider: 'google_drive', returnTo: 'https://attacker.test' }), f.deps);
  const url = new URL((await start.json() as { authorizationUrl: string }).authorizationUrl), cookie = start.headers.get('set-cookie')!.split(';')[0];
  const transaction = [...f.transactions.values()][0]; assert.equal(transaction.return_to, '/workspace?view=evidence'); transaction.expires_at = 0;
  const response = await handleDriveCallback(request(`/api/drives/callback?state=${url.searchParams.get('state')}&code=x`, undefined, { cookie }), f.deps);
  assert.equal(new URL(response.headers.get('location')!).origin, 'https://app.test');
  assert.equal(f.tracker.tokenExchanges, 0);
});

test('saved roots reject outside files, shortcut escapes, path injection and parent cycles', async () => {
  const f = await fixture();
  assert.equal((await assertWithinRoot('google_drive', 'token', 'file', 'allowed', null, f.deps.fetch)).id, 'file');
  await assert.rejects(assertWithinRoot('google_drive', 'token', 'other-file', 'allowed', null, f.deps.fetch), (error: unknown) => error instanceof DriveError && error.code === 'outside_root');
  f.raw.set('shortcut', { ...textFile('shortcut', 'allowed'), mimeType: 'application/vnd.google-apps.shortcut', shortcutDetails: { targetId: 'other-file' } });
  await assert.rejects(assertWithinRoot('google_drive', 'token', 'shortcut', 'allowed', null, f.deps.fetch), /outside/);
  f.raw.set('cycle', folder('cycle', 'cycle'));
  await assert.rejects(assertWithinRoot('google_drive', 'token', 'cycle', 'allowed', null, f.deps.fetch), /outside/);
  const count = f.tracker.fetches.length;
  await assert.rejects(assertWithinRoot('google_drive', 'token', '../outside', 'allowed', null, f.deps.fetch), /Invalid/);
  assert.equal(f.tracker.fetches.length, count);
});

test('browse enforces ownership and folder boundary; encrypted pagination is connection and folder bound', async () => {
  const f = await fixture(); f.tracker.nextPage = 'provider-page-two';
  const first = await handleDriveBrowse(request(`/api/drives/browse?connectionId=${ID}`), f.deps);
  const page = await first.json() as { nextCursor: string; items: { id: string }[] };
  assert.equal(first.status, 200); assert.deepEqual(page.items.map(i => i.id), ['nested']); assert.equal(page.nextCursor.includes('provider-page-two'), false);
  const next = await handleDriveBrowse(request(`/api/drives/browse?connectionId=${ID}&cursor=${encodeURIComponent(page.nextCursor)}`), f.deps);
  assert.equal(next.status, 200); assert.match(f.tracker.fetches.at(-1)!, /pageToken=provider-page-two/);
  const crossFolder = await handleDriveBrowse(request(`/api/drives/browse?connectionId=${ID}&folderId=nested&cursor=${encodeURIComponent(page.nextCursor)}`), f.deps);
  assert.equal(crossFolder.status, 400);
  const outside = await handleDriveBrowse(request(`/api/drives/browse?connectionId=${ID}&folderId=outside`), f.deps); assert.equal(outside.status, 403);
  f.tracker.user = 'google:other';
  assert.equal((await handleDriveBrowse(request(`/api/drives/browse?connectionId=${ID}`, undefined, { account: 'google:other' }), f.deps)).status, 404);
});

test('OneDrive pagination cannot direct a credential-bearing request to another origin or folder', async () => {
  const fetcher = (async () => json({ value: [], '@odata.nextLink': 'https://attacker.test/steal?$skiptoken=x' })) as typeof fetch;
  await assert.rejects(listChildren('onedrive', 'secret', 'folder', 'drive', undefined, fetcher), /invalid next page/);
  const crossFolder = (async () => json({ value: [], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/drives/drive/items/other/children?$skiptoken=x' })) as typeof fetch;
  await assert.rejects(listChildren('onedrive', 'secret', 'folder', 'drive', undefined, crossFolder), /invalid next page/);
  const same = (async () => json({ value: [{ id: 'file', name: 'a.txt', file: { mimeType: 'text/plain' }, parentReference: { id: 'folder', driveId: 'drive' } }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/drives/drive/items/folder/children?$skiptoken=next' })) as typeof fetch;
  const page = await listChildren('onedrive', 'secret', 'folder', 'drive', undefined, same);
  assert.equal(page.nextPageToken, 'next'); assert.equal(page.items.length, 1);
});

test('OneDrive remote-item shortcuts and a different drive cannot cross the saved boundary', async () => {
  const remote = (async () => json({ id: 'file', name: 'a.txt', remoteItem: { id: 'foreign' }, parentReference: { id: 'folder', driveId: 'drive' } })) as typeof fetch;
  await assert.rejects(assertWithinRoot('onedrive', 'secret', 'file', 'folder', 'drive', remote), /outside/);
  const other = (async () => json({ id: 'folder', name: 'folder', folder: {}, parentReference: { driveId: 'other-drive' } })) as typeof fetch;
  await assert.rejects(assertWithinRoot('onedrive', 'secret', 'folder', 'folder', 'drive', other), /outside/);
});

test('named connection finalization creates one external Evidence folder with CAS; rename stays synchronized', async () => {
  const f = await fixture('pending');
  const input = { connectionId: ID, displayName: 'Research papers', scope: 'folder', rootId: 'allowed', caseId: f.state().id, expectedRevision: 0 };
  f.tracker.failSave = true;
  const conflict=await handleDriveSave(request('/api/drives', input), f.deps), conflictBody=await conflict.json() as {state:CaseState;revision:number};
  assert.equal(conflict.status, 409);assert.equal(conflictBody.state.id,f.state().id);assert.equal(conflictBody.revision,0);
  assert.equal(f.state().folders!.length, 0); assert.equal(f.rows.get(ID)!.status, 'pending');
  f.tracker.failSave = false;
  const saved = await handleDriveSave(request('/api/drives', input), f.deps), payload = await saved.json() as { revision: number; drives: unknown[]; state: CaseState };
  assert.equal(saved.status, 200); assert.equal(payload.revision, 1);
  assert.deepEqual(payload.state.folders![0], { id: f.rows.get(ID)!.evidence_folder_id, name: 'Research papers', parentId: null, origin: 'external', connectionId: ID });
  assert.equal(f.rows.get(ID)!.root_id, 'allowed'); assert.equal(f.rows.get(ID)!.status, 'connected');
  assert.equal(JSON.stringify(payload.drives).includes('token_ciphertext'), false);
  const stale=await handleDriveSave(request('/api/drives', input), f.deps);assert.equal(stale.status,409);assert.equal((await stale.json() as {revision:number}).revision,1);
  const renamed = await handleDriveSave(request('/api/drives', { id: ID, displayName: 'Published work', caseId: f.state().id, expectedRevision: 1 }, { method: 'PATCH' }), f.deps, true);
  assert.equal(renamed.status, 200); assert.equal(f.state().folders![0].name, 'Published work'); assert.equal(f.rows.get(ID)!.display_name, 'Published work');
});

test('connection finalization rejects stale case, file root, unsafe and duplicate folder names', async () => {
  const f = await fixture('pending');
  const input = { connectionId: ID, displayName: 'Papers', scope: 'folder', rootId: 'allowed', caseId: f.state().id, expectedRevision: 0 };
  assert.equal((await handleDriveSave(request('/api/drives', { ...input, caseId: 'foreign-case' }), f.deps)).status, 409);
  assert.equal((await handleDriveSave(request('/api/drives', { ...input, rootId: 'file' }), f.deps)).status, 422);
  assert.equal((await handleDriveSave(request('/api/drives', { ...input, displayName: '../papers' }), f.deps)).status, 422);
  f.state().folders!.push({ id: 'local', name: 'Papers', parentId: null });
  assert.equal((await handleDriveSave(request('/api/drives', input), f.deps)).status, 422);
  assert.equal(f.rows.get(ID)!.status, 'pending');
});

test('expired tokens refresh only the owned connection; revoked refresh marks reconnect', async () => {
  const f = await fixture(), current = f.rows.get(ID)!;
  current.token_ciphertext = await seal({ accessToken: 'expired', refreshToken: 'refresh', expiresAt: 1 }, SECRET, `drive:${OWNER}:${ID}`);
  const another = { ...current, id: ID2, token_ciphertext: 'untouched-connection' }; f.rows.set(ID2, another);
  const loaded = await authorizedConnection(request('/api/drives'), f.deps, ID);
  assert.equal(loaded.tokens.accessToken, 'renewed-access'); assert.equal(f.rows.get(ID2)!.token_ciphertext, 'untouched-connection');
  current.token_ciphertext = await seal({ accessToken: 'expired', refreshToken: 'revoked', expiresAt: 1 }, SECRET, `drive:${OWNER}:${ID}`);
  f.tracker.tokenStatus = 400;
  await assert.rejects(authorizedConnection(request('/api/drives'), f.deps, ID), /Reconnect/);
  assert.equal(f.rows.get(ID)!.status, 'reconnect_required');
});

test('disconnect deletes only the owned connection and preserves copied Evidence folders and state', async () => {
  const f = await fixture(), before = structuredClone(f.state());
  assert.equal((await handleDriveDisconnect(request(`/api/drives?id=${ID}`, undefined, { method: 'DELETE', origin: 'https://attacker.test' }), f.deps)).status, 403);
  assert.equal((await handleDriveDisconnect(request(`/api/drives?id=${ID}`, undefined, { method: 'DELETE' }), f.deps)).status, 200);
  assert.equal(f.rows.has(ID), false); assert.deepEqual(f.state(), before); assert.equal(f.tracker.fetches.length, 0);
});

test('rotated encryption keys and provider-revoked tokens report a reconnect state without leaking errors', async () => {
  const f = await fixture();
  const rotated = await handleDriveBrowse(request(`/api/drives/browse?connectionId=${ID}`), { ...f.deps, env: { ...env, HARNESS_DRIVE_TOKEN_SECRET: `${SECRET}-rotated` } });
  assert.equal(rotated.status, 401); assert.equal(f.rows.get(ID)!.status, 'reconnect_required');
  f.rows.get(ID)!.status = 'connected';
  const revoked = await handleDriveBrowse(request(`/api/drives/browse?connectionId=${ID}`), { ...f.deps, fetch: (async () => json({ error: 'provider private details' }, 401)) as typeof fetch });
  const result = await revoked.json() as { code: string; needsReauth: boolean };
  assert.equal(result.code, 'drive_reconnect_required'); assert.equal(result.needsReauth, true);
  assert.equal(f.rows.get(ID)!.status, 'reconnect_required'); assert.equal(JSON.stringify(result).includes('provider private'), false);
});

test('imports reject cross-case, outside folder, missing destination, stale account and external origins before uploads', async () => {
  const f = await fixture();
  const deps = { ...f.deps, upload: async () => { f.tracker.uploads++; return json({}); } };
  const input = { connectionId: ID, fileId: 'file', caseId: f.state().id, expectedRevision: 0, uploadId: UPLOAD_ID };
  assert.equal((await handleDriveImport(request('/api/drives/import', input, { account: 'other' }), deps)).status, 401);
  assert.equal((await handleDriveImport(request('/api/drives/import', input, { origin: 'https://attacker.test' }), deps)).status, 403);
  assert.equal((await handleDriveImport(request('/api/drives/import', { ...input, caseId: 'other-case' }), deps)).status, 409);
  assert.equal((await handleDriveImport(request('/api/drives/import', { ...input, fileId: 'other-file' }), deps)).status, 403);
  f.state().folders = [];
  assert.equal((await handleDriveImport(request('/api/drives/import', input), deps)).status, 409);
  assert.equal(f.tracker.uploads, 0);
});

test('a file moved outside the selected folder during download is not imported', async () => {
  const f = await fixture(); f.tracker.onDownload = () => f.raw.set('file', textFile('file', 'outside'));
  const response = await handleDriveImport(request('/api/drives/import', { connectionId: ID, fileId: 'file', caseId: f.state().id, expectedRevision: 0, uploadId: UPLOAD_ID }), { ...f.deps, upload: async () => { f.tracker.uploads++; return json({}); } });
  assert.equal(response.status, 403); assert.equal(f.tracker.uploads, 0);
});

test('cloud imports use the regular upload CAS/idempotency path and server-selected metadata and folder', async () => {
  const f = await fixture(), objects = new Map<string, EvidenceObjectRow>(), blobs = new Map<string, ArrayBuffer>();
  const storage: EvidenceStorageDependencies = { getUser: f.deps.getUser, repository: {
    readCase: async owner => owner === OWNER ? structuredClone(f.state()) : null,
    readObject: async (owner, caseId, id) => { const row = objects.get(id); return row?.ownerId === owner && row.caseId === caseId ? structuredClone(row) : null; },
    registerObject: async (row, revision) => { if (!objects.has(row.id) && f.state().revision === revision) objects.set(row.id, structuredClone(row)); return objects.get(row.id) ?? null; },
    saveCase: async (owner, caseId, revision, state) => { if (owner !== OWNER || f.state().id !== caseId || f.state().revision !== revision) return false; f.setState(state); return true; },
  }, store: { putIfAbsent: async (key, bytes) => { if (!blobs.has(key)) blobs.set(key, bytes); }, get: async () => null } };
  const deps = { ...f.deps, upload: (r: Request) => handleEvidenceUpload(r, storage) };
  const input = { connectionId: ID, fileId: 'file', caseId: f.state().id, expectedRevision: 0, uploadId: UPLOAD_ID, folderId: 'attacker-folder', name: 'forged.pdf', path: 'other-user/private' };
  const first = await handleDriveImport(request('/api/drives/import', input), deps), result = await first.json() as { revision: number; document: { name: string; folderId: string } };
  assert.equal(first.status, 201, JSON.stringify(result)); assert.equal(result.revision, 1); assert.equal(result.document.name, 'source.txt'); assert.equal(result.document.folderId, 'folder-linked');
  const retry = await handleDriveImport(request('/api/drives/import', input), deps);
  assert.equal(retry.status, 200); assert.equal(objects.size, 1); assert.equal(blobs.size, 1); assert.equal(f.state().documents.length, 1);
  assert.equal(f.tracker.fetches.every(url => new URL(url).origin === 'https://www.googleapis.com'), true);
});

test('provider downloads enforce bounded bytes and never forward OAuth tokens to signed download URLs', async () => {
  await assert.rejects(readLimitedResponse(new Response('too-large'), 3), /too large/);
  const calls: { url: string; authorization: string | null }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => { const url = String(input); calls.push({ url, authorization: new Headers(init?.headers).get('Authorization') }); return calls.length === 1 ? new Response(null, { status: 302, headers: { Location: 'https://tenant.sharepoint.com/download?signed=opaque' } }) : new Response('file contents'); }) as typeof fetch;
  const file = { id: 'file', name: 'source.txt', isFolder: false, mimeType: 'text/plain', size: 13, modifiedTime: null, parentId: 'folder', driveId: 'drive', shortcut: false };
  await downloadItem('onedrive', 'oauth-secret', file, 20, fetcher);
  assert.equal(calls[0].authorization, 'Bearer oauth-secret'); assert.equal(calls[1].authorization, null);
  const malicious = (async () => new Response(null, { status: 302, headers: { Location: 'https://attacker.test/private' } })) as typeof fetch;
  await assert.rejects(downloadItem('onedrive', 'oauth-secret', file, 20, malicious), /unsupported download location/);
});

test('public connection metadata omits provider account IDs and encrypted credentials', async () => {
  const f = await fixture(), view = publicConnection(f.rows.get(ID)!);
  assert.equal('token_ciphertext' in view, false); assert.equal('account_id' in view, false);
  assert.equal(view.evidenceFolderId, 'folder-linked'); assert.equal(view.accountLabel, 'person@example.test');
});
