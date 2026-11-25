import { env } from 'cloudflare:workers';
import { handleLogoutRequest, type AuthEnv } from '@/lib/auth/google';
import { handlePasswordAuth, type PasswordAuthEnv } from '@/lib/auth/email-password';
import { authCookie, clearAuthCookies, cookieSecurityForUrl } from '@/lib/auth/runtime';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const cookieHeader = request.headers.get('cookie') || '';
  const hasPassword = cookieHeader.split(';').some(part =>
    part.trim().startsWith('__Host-harness_password_session=') ||
    part.trim().startsWith('harness_password_session_dev=')
  );

  const authEnv = {
    ...env,
    FIREBASE_API_KEY: env.FIREBASE_API_KEY || (typeof process !== 'undefined' ? process.env?.FIREBASE_API_KEY : undefined),
    FIREBASE_PROJECT_ID: env.FIREBASE_PROJECT_ID || (typeof process !== 'undefined' ? process.env?.FIREBASE_PROJECT_ID : undefined),
  };

  let primaryResponse: Response | null = null;
  if (hasPassword) {
    primaryResponse = await handlePasswordAuth(request, authEnv as PasswordAuthEnv, 'logout');
  }
  const googleResponse = await handleLogoutRequest(request, authEnv as AuthEnv);
  const response = primaryResponse ?? googleResponse;

  const headers = new Headers(response.headers);
  const secure = cookieSecurityForUrl(request.url, process.env.NODE_ENV === 'development');
  if (secure !== null) {
    clearAuthCookies(headers, secure);
    const pwCookie = secure ? '__Host-harness_password_session' : 'harness_password_session_dev';
    headers.append('Set-Cookie', authCookie(pwCookie, '', 0, secure));
  }

  // If request explicitly expects JSON (e.g. programmatic API/tests), return JSON
  const accept = request.headers.get('accept') || '';
  if (accept.includes('application/json') && !accept.includes('text/html')) {
    return new Response(response.body, { status: response.status, headers });
  }

  // Browser form submission: redirect directly to main page (/) while preserving cookie-clearing headers
  headers.set('Location', '/');
  return new Response(null, { status: 303, headers });
}

export function GET(request: Request) {
  return Response.redirect(new URL('/', request.url), 303);
}
