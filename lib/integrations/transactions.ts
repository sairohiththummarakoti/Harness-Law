import type { CaseEnvelope, CaseRepository, SavedResponse } from './repository.ts';
import { MAX_CASE_RECORD_BYTES } from './repository.ts';
import { canonicalHash } from './security.ts';

export class ApiError extends Error {
  status: number; code: string; retryable: boolean; currentRevision?: number;
  constructor(status: number, code: string, message: string, retryable = false, currentRevision?: number) {
    super(message); this.status = status; this.code = code; this.retryable = retryable; this.currentRevision = currentRevision;
  }
}
export const unavailable = () => new ApiError(404, 'unavailable', 'This resource is unavailable.');

export function requestKey(request: Request): string {
  const key = request.headers.get('Idempotency-Key') || '';
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new ApiError(422, 'idempotency_key_required', 'Supply an Idempotency-Key of 8 to 128 letters, digits, dots, colons, underscores or hyphens.');
  return key;
}

export async function mutateCase(
  repository: CaseRepository, ownerId: string, caseId: string,
  request: { key: string; operation: string; payload: unknown; now: string },
  action: (envelope: CaseEnvelope) => Promise<SavedResponse>,
): Promise<SavedResponse> {
  const receiptKey = await canonicalHash({ actor: ownerId, key: request.key, operation: request.operation });
  const payloadHash = await canonicalHash(request.payload);
  for (let attempt = 0; attempt < 4; attempt++) {
    const envelope = await repository.find(ownerId, caseId); if (!envelope) throw unavailable();
    const receipt = envelope.receipts[receiptKey];
    if (receipt) {
      if (receipt.hash !== payloadHash) throw new ApiError(409, 'idempotency_conflict', 'This idempotency key was used with different inputs.');
      return structuredClone(receipt.response);
    }
    // Bound aggregate growth. Receipts are never silently dropped, since that would
    // permit an old retried request to mutate the case twice.
    if (Object.keys(envelope.receipts).length >= 10_000) throw new ApiError(429, 'case_operation_limit', 'This case has reached its operation limit. Contact support.', false);
    const revision = envelope.state.revision;
    const response = await action(envelope);
    envelope.state.revision = revision + 1; envelope.state.updated_at = request.now;
    envelope.receipts[receiptKey] = { operation: request.operation, hash: payloadHash, response: structuredClone(response), created_at: request.now };
    if (new TextEncoder().encode(JSON.stringify(envelope)).byteLength > MAX_CASE_RECORD_BYTES - 1024 * 1024) throw new ApiError(413, 'case_capacity', 'This case exceeds the supported applicant record capacity. Worker recovery space is reserved.');
    if (await repository.compareAndSwap(envelope, revision)) return response;
  }
  throw new ApiError(409, 'revision_conflict', 'The case changed during this request. Retry using the same idempotency key.', true);
}

export async function updateWorkerCase<T>(repository: CaseRepository, caseId: string, action: (envelope: CaseEnvelope) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const envelope = await repository.findForWorker(caseId); if (!envelope) throw unavailable();
    const revision = envelope.state.revision;
    const result = await action(envelope);
    if (new TextEncoder().encode(JSON.stringify(envelope)).byteLength > MAX_CASE_RECORD_BYTES - 256 * 1024) throw new ApiError(413, 'case_capacity', 'The processing output exceeds the supported case capacity. Failure recovery space is reserved.');
    envelope.state.revision = revision + 1; envelope.state.updated_at = new Date().toISOString();
    if (await repository.compareAndSwap(envelope, revision)) return result;
  }
  throw new ApiError(409, 'revision_conflict', 'The case changed while processing. Retry the pinned job.', true);
}
