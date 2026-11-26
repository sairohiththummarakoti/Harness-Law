import assert from 'node:assert/strict';
import test from 'node:test';
import { handleEvidenceSetupComplete } from '../lib/onboarding-evidence.ts';
import { getAccountFlow } from '../lib/intake-entry.ts';
import { coreCase, flowFixture } from './helpers/account-flow-fixture.ts';

function request(choice = 'skip', overrides: HeadersInit = {}) {
  return new Request('https://harnesslaw.ai/api/onboarding/evidence', {method:'POST', headers:{'Content-Type':'application/json', Origin:'https://harnesslaw.ai', 'X-Harness-Account':'owner', ...overrides}, body:JSON.stringify({choice})});
}

test('Continue and Add later each persist completion without requiring an uploaded file', async t => {
  for (const choice of ['continue','skip']) {
    const f=flowFixture(); t.after(()=>f.sqlite.close());
    await getAccountFlow(f.db,'owner'); f.saveCase('owner',coreCase());
    const response=await handleEvidenceSetupComplete(request(choice),{getUser:async()=>({userId:'owner'}),database:()=>f.db});
    assert.equal(response.status,200);
    assert.equal(((await response.json()) as {redirectTo:string}).redirectTo,'/workspace?view=overview');
    assert.equal(await getAccountFlow(f.db,'owner'),'workspace');
  }
});

test('an unfinished first-four introduction cannot be skipped through the evidence endpoint', async t => {
  const f=flowFixture(); t.after(()=>f.sqlite.close());
  const response=await handleEvidenceSetupComplete(request(),{getUser:async()=>({userId:'owner'}),database:()=>f.db});
  assert.equal(response.status,409);
  assert.equal(((await response.json()) as {code:string}).code,'intake_required');
  assert.equal(await getAccountFlow(f.db,'owner'),'intake');
});

test('evidence invitation requires the matching account and same-origin request', async t => {
  const f=flowFixture(); t.after(()=>f.sqlite.close());
  const deps={getUser:async()=>({userId:'owner'}),database:()=>f.db};
  assert.equal((await handleEvidenceSetupComplete(request(),{...deps,getUser:async()=>null})).status,401);
  assert.equal((await handleEvidenceSetupComplete(request('skip',{'X-Harness-Account':'different'}),deps)).status,401);
  assert.equal((await handleEvidenceSetupComplete(request('skip',{Origin:'https://other.example'}),deps)).status,403);
  assert.equal((await handleEvidenceSetupComplete(request('skip',{'Content-Type':'text/plain'}),deps)).status,415);
  assert.equal((await handleEvidenceSetupComplete(request('invalid'),deps)).status,400);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS count FROM account_intake_entries').get()?.count,0);
});

test('a failed evidence completion remains retryable and never claims success', async () => {
  const response=await handleEvidenceSetupComplete(request(),{getUser:async()=>({userId:'owner'}),database:()=>{throw new Error('Storage unavailable');}});
  assert.equal(response.status,503);
  assert.equal(((await response.json()) as {code:string}).code,'setup_save_failed');
});
