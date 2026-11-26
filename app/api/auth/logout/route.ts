import { env } from 'cloudflare:workers';
import { handleAppLogout } from '@/lib/auth/logout';

export const dynamic = 'force-dynamic';

export function POST(request: Request) {
  return handleAppLogout(request, env);
}

export const GET = POST;
