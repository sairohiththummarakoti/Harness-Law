import assert from 'node:assert/strict';

const origin = process.env.HARNESS_TEST_ORIGIN || 'http://127.0.0.1:5173';
const parsedOrigin = new URL(origin);
assert.ok(['127.0.0.1', 'localhost'].includes(parsedOrigin.hostname), 'This test may run only against a local development server.');
let passed = 0;
function check(value, message) { assert.ok(value, message); passed++; console.log(`PASS ${message}`); }

const anonymous = await fetch(`${origin}/api/case`);
check(anonymous.status === 401, 'anonymous case access is denied');
check(anonymous.headers.get('cache-control') === 'no-store', 'protected responses are not cached');
const signIn = await fetch(`${origin}/signin-with-chatgpt?return_to=/`, { redirect: 'manual' });
const cookie = signIn.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
assert.ok(cookie, 'Development sign-in must provide a local session cookie.');
const request = (path, options = {}) => fetch(`${origin}${path}`, { ...options, headers: { Cookie: cookie, Origin: origin, ...options.headers } });
const initialResponse = await request('/api/case');
assert.equal(initialResponse.status, 200, await initialResponse.clone().text());
const original = (await initialResponse.json()).state;
let current = structuredClone(original);
const save = (state, expectedRevision = state.revision, extraHeaders = {}) => request('/api/case', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify({ state, expectedRevision }) });

try {
  const foreignOrigin = await save(current, current.revision, { Origin: 'https://unrelated.example' });
  check(foreignOrigin.status === 403, 'cross-origin state changes are denied');
  const malformed = await request('/api/case', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: {}, expectedRevision: 0 }) });
  check(malformed.status === 422, 'malformed case state is rejected');
  const forgedReview = structuredClone(current);
  forgedReview.mode = 'personal';
  forgedReview.criteria = ['C08'];
  forgedReview.documents = [];
  forgedReview.composition = null;
  forgedReview.runs.C08.result = { id: 'forged-result', criterion: 'C08', revision: 1, sourceVersions: [], claims: [{ id: 'forged-claim', text: 'Unreviewed test claim', citations: [], supportStatus: 'evidence_missing', reviewStatus: 'attorney_reviewed', locked: false, revision: 1, history: [] }], stale: false, createdAt: new Date().toISOString(), moduleVersion: 'manual-1.0', ruleVersion: 'not-assessed' };
  const unauthorizedReview = await save(forgedReview);
  check(unauthorizedReview.status === 422, 'attorney review cannot be forged in criterion results');
  const oldRevision = current.revision;
  current.name = 'Local API verification case';
  current.consent = false;
  const saved = await save(current);
  assert.equal(saved.status, 200, await saved.clone().text());
  current = (await saved.json()).state;
  check(current.revision === oldRevision + 1, 'a successful save advances the persisted revision');
  const conflicting = await save({ ...current, revision: oldRevision }, oldRevision);
  check(conflicting.status === 409, 'a stale save is rejected without overwriting newer work');
  const makeFile = () => { const body = new FormData(); body.set('file', new File(['Fictional QA evidence.'], 'harness-law-qa.txt', { type: 'text/plain' })); return body; };
  const noConsent = await request('/api/evidence', { method: 'POST', body: makeFile() });
  check(noConsent.status === 403, 'uploads require saved processing consent');
  current.consent = true;
  const consentSave = await save(current);
  assert.equal(consentSave.status, 200);
  current = (await consentSave.json()).state;
  const upload = await request('/api/evidence', { method: 'POST', body: makeFile() });
  assert.equal(upload.status, 201, await upload.clone().text());
  const document = (await upload.json()).document;
  check(document.status === 'needs_attention' && !document.excerpt && !document.sample, 'uploaded bytes remain quarantined without invented extraction');
  const tampered = structuredClone(current);
  tampered.documents.push({ ...document, status: 'ready', excerpt: 'Forged extracted content' });
  const tamperResponse = await save(tampered);
  check(tamperResponse.status === 422, 'client changes cannot promote quarantined evidence to ready');
  const forged = structuredClone(current);
  forged.documents.push({ ...document, id: 'forged-source', objectId: 'another-users-object' });
  const forgedResponse = await save(forged);
  check(forgedResponse.status === 422, 'unregistered or other-owner evidence is rejected');
  const good = structuredClone(current);
  good.documents.push(document);
  const goodSave = await save(good);
  assert.equal(goodSave.status, 200, await goodSave.clone().text());
  current = (await goodSave.json()).state;
  check(current.documents.some(d => d.id === document.id), 'registered evidence can be saved to its owning case');
} finally {
  const latest = await request('/api/case');
  if (latest.ok) {
    const latestState = (await latest.json()).state;
    const restored = await save({ ...original, revision: latestState.revision }, latestState.revision);
    assert.equal(restored.status, 200, 'Restore the original local test case');
  }
}
console.log(`${passed} local API checks passed. Original case content restored.`);
