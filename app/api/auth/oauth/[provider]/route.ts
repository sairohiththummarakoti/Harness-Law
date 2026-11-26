import { env } from 'cloudflare:workers';
import { startOAuth } from '@/lib/auth/oauth';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  return startOAuth(request, (await params).provider, env, process.env.NODE_ENV === 'development');
}
export const POST = GET;
