import type { CaseState } from './model';

export interface CaseRequestData {
  state?: CaseState;
  revision?: number;
  error?: string;
}

export interface CaseRequestResult {
  status: number;
  ok: boolean;
  data: CaseRequestData;
}

const TIMEOUT_MESSAGE = 'This request took too long. Your answers are still here. Please try again.';
const CANCELED_MESSAGE = 'This request was canceled. Your answers are still here. Please try again.';
const NETWORK_MESSAGE = 'We couldn’t connect to your case. Your answers are still here. Check your connection and try again.';

/** Keep HTTP failures classifiable, and bound both the request and its body read. */
export async function requestCase(
  options: RequestInit = {},
  timeoutMs = 15000,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<CaseRequestResult> {
  const callerSignal = options.signal;
  if (callerSignal?.aborted) throw new Error(CANCELED_MESSAGE);

  const controller = new AbortController();
  let timedOut = false;
  let canceled = false;
  let rejectStopped!: (error: Error) => void;
  const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject; });
  const cancel = () => {
    canceled = true;
    controller.abort();
    rejectStopped(new Error(CANCELED_MESSAGE));
  };
  callerSignal?.addEventListener('abort', cancel, { once: true });

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectStopped(new Error(TIMEOUT_MESSAGE));
  }, Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : 15000);

  try {
    // Recheck after subscribing so cancellation cannot be missed during setup.
    if (callerSignal?.aborted) cancel();
    const operation = (async (): Promise<CaseRequestResult> => {
      const response = await fetcher('/api/case', {
        credentials: 'same-origin',
        cache: 'no-store',
        ...options,
        signal: controller.signal,
      });
      const body = await response.text();
      let data: CaseRequestData = {};
      try {
        const parsed: unknown = JSON.parse(body);
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          data = parsed as CaseRequestData;
        }
      } catch {
        // Authentication and hosting failures can return HTML or an empty body.
        // Preserve their HTTP status instead of replacing it with a JSON error.
      }
      return { status: response.status, ok: response.ok, data };
    })();
    return await Promise.race([operation, stopped]);
  } catch {
    if (timedOut) throw new Error(TIMEOUT_MESSAGE);
    if (canceled || callerSignal?.aborted) throw new Error(CANCELED_MESSAGE);
    throw new Error(NETWORK_MESSAGE);
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', cancel);
  }
}
