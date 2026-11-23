import { env } from 'cloudflare:workers';
import { handleChatGPTRequest, type AuthEnv } from '@/lib/auth/google';
export const dynamic = 'force-dynamic';
export function POST(request: Request) { return handleChatGPTRequest(request, env as AuthEnv); }
