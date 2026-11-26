import { env } from 'cloudflare:workers';
import { getAppUser } from '@/app/auth';
import { handleAnalyticsRequest } from '@/lib/admin/analytics';
export const dynamic = 'force-dynamic';
export function POST(request: Request) { return handleAnalyticsRequest(request, env.DB, getAppUser); }
