import { env } from 'cloudflare:workers';
import { handleLogoutRequest, type AuthEnv } from '@/lib/auth/google';
export const dynamic = 'force-dynamic';
export function POST(request: Request) { return handleLogoutRequest(request, env as AuthEnv); }
