import { env } from 'cloudflare:workers';
import { handleGoogleRequest, type AuthEnv } from '@/lib/auth/google';
export const dynamic = 'force-dynamic';

function getGoogleEnv(): AuthEnv {
  return {
    ...env,
    HARNESS_GOOGLE_CLIENT_ID: env.HARNESS_GOOGLE_CLIENT_ID || (typeof process !== 'undefined' ? process.env?.HARNESS_GOOGLE_CLIENT_ID : undefined),
  };
}

export function GET(request: Request) {
  const isDev = typeof process !== 'undefined' && process.env?.NODE_ENV === 'development';
  return handleGoogleRequest(request, getGoogleEnv(), { development: isDev });
}

export function POST(request: Request) {
  const isDev = typeof process !== 'undefined' && process.env?.NODE_ENV === 'development';
  return handleGoogleRequest(request, getGoogleEnv(), { development: isDev });
}
