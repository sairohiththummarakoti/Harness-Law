import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCaseRepository, type CaseEnvelope } from '../lib/integrations/repository.ts';
import { createIntegrationCase } from '../lib/integrations/domain.ts';
import { ApiError, mutateCase, updateWorkerCase } from '../lib/integrations/transactions.ts';

test('applicant record capacity preserves room for worker failure recovery', async () => {
  const repository = new MemoryCaseRepository(), now = '2026-11-22T12:00:00.000Z';
  const envelope: CaseEnvelope = { state: createIntegrationCase('capacity-case', 'owner', now), receipts: {
    retained: { operation: 'fixture', hash: 'fixture', created_at: now, response: { status: 200, data: 'x'.repeat(23 * 1024 * 1024 - 100_000) } },
  } };
  await repository.insert(envelope);
  await assert.rejects(mutateCase(repository, 'owner', 'capacity-case', { key: 'capacity-fixture', operation: 'fixture', payload: {}, now }, async draft => {
    draft.provider_attempts = [];
    return { status: 200, data: 'x'.repeat(150_000) };
  }), (error: unknown) => error instanceof ApiError && error.code === 'case_capacity');
  assert.equal((await repository.find('owner', 'capacity-case'))!.state.revision, 0);
  await updateWorkerCase(repository, 'capacity-case', async draft => {
    draft.provider_attempts = [{ job_id: 'fixture-job', operation: 'model', attempt: 1, outcome: 'failed', occurred_at: now }];
  });
  const saved = (await repository.find('owner', 'capacity-case'))!;
  assert.equal(saved.state.revision, 1); assert.equal(saved.provider_attempts?.[0].outcome, 'failed');
  assert.equal(Object.keys(saved.receipts).length, 1);
});
