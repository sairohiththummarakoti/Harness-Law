import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { handleIntegrationRequest } from '@/lib/integrations/http';
import { integrationRuntime } from '@/lib/integrations/runtime';

export const dynamic = 'force-dynamic';
async function route(request: Request) {
  const user = await getChatGPTUser();
  // Auth is checked before exposing configuration or database availability.
  if (!user && !request.headers.get('authorization')) return Response.json({ code: 'authentication_required', message: 'Sign in to access your case.', retryable: false, request_id: crypto.randomUUID() }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  try { return await handleIntegrationRequest(request, integrationRuntime(env, user?.userId)); }
  catch { return Response.json({ code: 'integration_configuration_required', message: 'The integration service needs configuration. Saved workspace data is unaffected.', retryable: false, request_id: crypto.randomUUID() }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
export const GET = route;
export const POST = route;
export const PUT = route;
export const PATCH = route;
export const DELETE = route;
