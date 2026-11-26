import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore
import { authCookie, cookieNames, cookieSecurityForUrl, isSameOrigin, randomToken, readTokenCookie, tokenHash } from '@/lib/auth/runtime';

interface CallbackEnv {
  DB?: D1Database;
  FIREBASE_API_KEY?: string;
  FIREBASE_PROJECT_ID?: string;
}

const sessionCookie = (secure: boolean) => secure ? '__Host-harness_password_session' : 'harness_password_session_dev';
const oauthStateCookie = (secure: boolean) => secure ? '__Host-harness_oauth_state' : 'harness_oauth_state_dev';

async function completeIdpSignIn(request: NextRequest, postBody: string, secure: boolean) {
  const url = new URL(request.url);
  const apiKey = (env as CallbackEnv).FIREBASE_API_KEY || (typeof process !== 'undefined' ? process.env.FIREBASE_API_KEY : '') || '';
  const db = (env as CallbackEnv).DB;
  if (!apiKey || !db) {
    return { error: 'Authentication service is unavailable.' };
  }

  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestUri: url.origin + url.pathname,
      postBody,
      returnSecureToken: true,
      returnIdpCredential: true,
    }),
  });

  const data = await res.json() as { idToken?: string; localId?: string; email?: string; displayName?: string; error?: { message?: string } };
  if (!res.ok || !data.idToken || !data.localId) {
    return { error: data.error?.message || 'OAuth sign-in could not be verified. Please try again.' };
  }

  const email = (data.email || `${data.localId}@oauth.harnesslaw.com`).trim().toLowerCase();
  const name = (data.displayName || email.split('@')[0]).trim().slice(0, 200);
  const now = Math.floor(Date.now() / 1000);
  const sessionTtl = 86400 * 30;

  // Link to existing account by email if present so cases/drives remain attached
  const existing = await db.prepare('SELECT user_id, verified_at FROM password_accounts WHERE email=?').bind(email).first<{ user_id: string; verified_at: number | null }>();
  const userId = existing ? existing.user_id : `password:${data.localId}`;

  if (existing) {
    await db.prepare('UPDATE password_accounts SET name=?, verified_at=? WHERE user_id=?')
      .bind(name, existing.verified_at ?? now, userId).run();
  } else {
    await db.prepare(
      'INSERT INTO password_accounts (user_id,name,email,password_hash,verified_at,terms_accepted_at,terms_version,privacy_version,created_at) VALUES (?,?,?,?,?,?,?,?,?)'
    ).bind(userId, name, email, 'oauth_account', now, now, 'local-draft', 'local-draft', now).run();
  }

  const token = randomToken();
  await db.prepare('INSERT INTO password_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)')
    .bind(await tokenHash(token), userId, now + sessionTtl).run();

  const headers = new Headers();
  headers.append('Set-Cookie', authCookie(sessionCookie(secure), token, sessionTtl, secure));
  headers.append('Set-Cookie', authCookie(cookieNames(secure).provider, 'password', sessionTtl, secure));
  headers.append('Set-Cookie', authCookie(oauthStateCookie(secure), '', 0, secure));
  headers.set('Cache-Control', 'no-store');
  return { headers };
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const secure = cookieSecurityForUrl(request.url, typeof process !== 'undefined' && process.env?.NODE_ENV === 'development');
  if (secure === null) {
    return NextResponse.redirect(new URL('/signin?oauth_notice=A+secure+connection+is+required.', request.url), 303);
  }

  const errorParam = url.searchParams.get('error') || url.searchParams.get('error_description');
  if (errorParam) {
    return NextResponse.redirect(new URL(`/signin?oauth_notice=${encodeURIComponent(errorParam)}`, request.url), 303);
  }

  const cookieHeader = request.headers.get('cookie') || '';
  const stateCookie = readTokenCookie(cookieHeader, oauthStateCookie(secure));
  if (!stateCookie) {
    return NextResponse.redirect(new URL('/signin?oauth_notice=OAuth+session+expired.+Please+try+signing+in+again.', request.url), 303);
  }

  const idToken = url.searchParams.get('id_token');
  const code = url.searchParams.get('code');

  if (idToken || code) {
    try {
      const result = await completeIdpSignIn(request, url.search.replace(/^\?/, ''), secure);
      if (result.headers) {
        result.headers.set('Location', '/onboarding');
        return new NextResponse(null, { status: 303, headers: result.headers });
      }
      return NextResponse.redirect(new URL(`/signin?oauth_notice=${encodeURIComponent(result.error || 'OAuth sign-in failed.')}`, request.url), 303);
    } catch {
      return NextResponse.redirect(new URL('/signin?oauth_notice=OAuth+sign-in+failed.+Please+try+again.', request.url), 303);
    }
  }

  // Implicit OAuth providers (e.g. Google via createAuthUri) return #id_token=... in the URL fragment,
  // which browsers do not send to the server. Bridge it safely via same-origin POST.
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Completing sign-in…</title></head><body><p style="font-family:sans-serif;padding:24px">Completing sign-in…</p><script>(async()=>{const hash=location.hash.replace(/^#/,'');if(!hash){location.replace('/signin?oauth_notice='+encodeURIComponent('Sign-in was cancelled or incomplete.'));return;}try{const res=await fetch('/api/auth/oauth/callback',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({postBody:hash})});const data=await res.json();location.replace(data.redirectTo||'/signin');}catch{location.replace('/signin?oauth_notice='+encodeURIComponent('Could not complete sign-in.'));}})();</script></body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  }
  const secure = cookieSecurityForUrl(request.url, typeof process !== 'undefined' && process.env?.NODE_ENV === 'development');
  if (secure === null) {
    return NextResponse.json({ redirectTo: '/signin?oauth_notice=HTTPS+required' }, { status: 403 });
  }

  const cookieHeader = request.headers.get('cookie') || '';
  const stateCookie = readTokenCookie(cookieHeader, oauthStateCookie(secure));
  if (!stateCookie) {
    return NextResponse.json({ redirectTo: '/signin?oauth_notice=OAuth+session+expired.+Please+try+again.' }, { status: 401 });
  }

  try {
    const body = await request.json() as { postBody?: string };
    const postBody = typeof body.postBody === 'string' ? body.postBody : '';
    if (!postBody) {
      return NextResponse.json({ redirectTo: '/signin?oauth_notice=Missing+OAuth+credentials.' }, { status: 400 });
    }
    const result = await completeIdpSignIn(request, postBody, secure);
    if (result.headers) {
      result.headers.set('Content-Type', 'application/json');
      return new NextResponse(JSON.stringify({ ok: true, redirectTo: '/onboarding' }), { status: 200, headers: result.headers });
    }
    return NextResponse.json({ redirectTo: `/signin?oauth_notice=${encodeURIComponent(result.error || 'OAuth sign-in failed.')}` }, { status: 401 });
  } catch {
    return NextResponse.json({ redirectTo: '/signin?oauth_notice=OAuth+sign-in+failed.' }, { status: 500 });
  }
}
