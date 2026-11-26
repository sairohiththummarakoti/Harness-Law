import { completeEvidenceSetup, getAccountFlow } from './intake-entry.ts';
import { readLimitedBody } from './validation.ts';

export interface EvidenceSetupDependencies {
  getUser: () => Promise<{ userId: string } | null>;
  database: () => D1Database;
}
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

/** Authenticated completion of the optional evidence invitation, including skip. */
export async function handleEvidenceSetupComplete(request: Request, deps: EvidenceSetupDependencies): Promise<Response> {
  const user = await deps.getUser();
  if (!user) return json({ error: 'Sign in to continue.', code: 'session_expired' }, 401);
  if (request.headers.get('X-Harness-Account') !== user.userId) return json({ error: 'Your session changed. Return to the account used in this window.', code: 'session_changed' }, 401);
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'This request did not originate from this app.', code: 'invalid_origin' }, 403);
  if (request.headers.get('content-type')?.split(';', 1)[0].trim() !== 'application/json') return json({ error: 'Send your choice as JSON.' }, 415);
  try {
    const bytes = await readLimitedBody(request, 1024);
    if (!bytes) return json({ error: 'This request is too large.' }, 413);
    let body: unknown;
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return json({ error: 'Choose Continue or Add later.' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || !['continue', 'skip'].includes(String((body as { choice?: unknown }).choice)) || Object.keys(body).some(key => key !== 'choice')) return json({ error: 'Choose Continue or Add later.' }, 400);
    const db = deps.database();
    if (await getAccountFlow(db, user.userId) === 'intake') return json({ error: 'Complete the first four intake steps before continuing.', code: 'intake_required', redirectTo: '/onboarding' }, 409);
    await completeEvidenceSetup(db, user.userId);
    return json({ ok: true, redirectTo: '/workspace?view=overview' });
  } catch { return json({ error: 'Your progress could not be saved. Please try again.', code: 'setup_save_failed' }, 503); }
}
