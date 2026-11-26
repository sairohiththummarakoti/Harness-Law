import { env } from 'cloudflare:workers';
import { readUscisGuidanceMonitor, unavailableUscisMonitor } from '@/lib/uscis-source-monitor';

export const dynamic = 'force-dynamic';

/** Only public, fixed USCIS sources are checked. No account or case data is sent. */
export async function GET() {
  const result = env.DB ? await readUscisGuidanceMonitor(env.DB) : unavailableUscisMonitor();
  return Response.json(result, { headers: {
    'Cache-Control': 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  } });
}
