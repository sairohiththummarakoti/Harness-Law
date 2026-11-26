import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore
import { authCookie, cookieSecurityForUrl, randomToken } from '@/lib/auth/runtime';

interface OAuthEnv {
  FIREBASE_API_KEY?: string;
  FIREBASE_PROJECT_ID?: string;
}

const PROVIDER_MAP: Record<string, string> = {
  google: 'google.com',
};

const oauthStateCookie = (secure: boolean) => secure ? '__Host-harness_oauth_state' : 'harness_oauth_state_dev';

export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const pKey = provider.toLowerCase();
  const providerId = PROVIDER_MAP[pKey];
  if (!providerId) {
    return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });
  }

  const apiKey = (env as OAuthEnv).FIREBASE_API_KEY || (typeof process !== 'undefined' ? process.env.FIREBASE_API_KEY : '') || '';
  if (!apiKey) {
    return NextResponse.json({ error: 'OAuth is not configured yet. Please configure Firebase API key.' }, { status: 503 });
  }

  const secure = cookieSecurityForUrl(request.url, typeof process !== 'undefined' && process.env?.NODE_ENV === 'development');
  if (secure === null) {
    return NextResponse.json({ error: 'A secure connection is required to sign in.' }, { status: 403 });
  }

  const url = new URL(request.url);
  const continueUri = `${url.origin}/api/auth/oauth/callback`;
  const csrfToken = randomToken();

  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId,
        continueUri,
        sessionId: csrfToken,
      }),
    });

    const data = await res.json() as { authUri?: string; error?: { message?: string } };
    if (data.authUri) {
      const response = NextResponse.redirect(data.authUri, 303);
      response.headers.append('Set-Cookie', authCookie(oauthStateCookie(secure), csrfToken, 600, secure));
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }

    const friendlyName = pKey.charAt(0).toUpperCase() + pKey.slice(1);
    if (data.error?.message?.includes('OPERATION_NOT_ALLOWED')) {
      const msg = `${friendlyName} sign-in needs to be enabled in Firebase Console (Authentication > Sign-in method > Add provider > ${friendlyName}).`;
      return NextResponse.redirect(new URL(`/signin?oauth_notice=${encodeURIComponent(msg)}`, request.url), 303);
    }

    const err = data.error?.message || 'Unable to start OAuth authorization';
    return NextResponse.redirect(new URL(`/signin?oauth_notice=${encodeURIComponent(err)}`, request.url), 303);
  } catch {
    return NextResponse.redirect(new URL(`/signin?oauth_notice=${encodeURIComponent('Failed to connect to authentication provider.')}`, request.url), 303);
  }
}

export function POST(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  return GET(request, context);
}
