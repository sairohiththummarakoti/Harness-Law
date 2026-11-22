import { env } from 'cloudflare:workers';
import { handleGoogleRequest, type AuthEnv } from '@/lib/auth/google';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return handleGoogleRequest(request, env as AuthEnv); }
export function POST(request: Request) { return handleGoogleRequest(request, env as AuthEnv); }
