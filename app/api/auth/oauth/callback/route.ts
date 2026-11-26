import { env } from 'cloudflare:workers';
import { finishOAuth } from '@/lib/auth/oauth';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return finishOAuth(request, env, process.env.NODE_ENV === 'development');
}
export const POST = GET;
