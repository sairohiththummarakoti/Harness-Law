import { authCookie, authJson, cookieNames, cookieSecurityForUrl, isSameOrigin, randomToken, readAuthBody, tokenHash } from './runtime.ts';
import { createR2Store, createS3Store } from '../integrations/providers.ts';
import { createConfiguredEvidenceBlobStore } from '../evidence-blob-store.ts';
import { createEvidenceObjectCatalog } from '../evidence-d1.ts';
import type { ObjectStore } from '../integrations/provider-contracts.ts';
// @ts-ignore Node's built-in test runner requires explicit TypeScript extensions.
import { firebaseSignUp, firebaseSendEmailVerification, firebaseVerifyEmail, firebaseSignIn, firebaseLookupUser, firebaseSendPasswordReset, firebaseConfirmPasswordReset, firebaseDeleteUser, firebaseUpdatePassword, FirebaseAuthError, type FirebaseAuthConfig } from './firebase.ts';

type DB = Pick<D1Database, 'prepare' | 'batch'>;
export interface PasswordAuthEnv {
  DB?: DB;
  fetch?: typeof fetch;
  BUCKET?: R2Bucket;
  FIREBASE_API_KEY?: string;
  FIREBASE_PROJECT_ID?: string;
  HARNESS_FIREBASE_API_KEY?: string;
  HARNESS_FIREBASE_PROJECT_ID?: string;
  EMAIL?: { send(message: { from: string; to: string; subject: string; text: string }): Promise<unknown> };
  HARNESS_MAIL_API_URL?: string;
  HARNESS_MAIL_API_KEY?: string;
  HARNESS_MAIL_FROM?: string;
  HARNESS_MAIL_MODE?: string;
  HARNESS_TURNSTILE_SITE_KEY?: string;
  HARNESS_TURNSTILE_SECRET_KEY?: string;
  HARNESS_TERMS_VERSION?: string;
  HARNESS_PRIVACY_VERSION?: string;
  HARNESS_S3_BUCKET?: string;
  HARNESS_S3_REGION?: string;
  HARNESS_S3_ACCESS_KEY_ID?: string;
  HARNESS_S3_SECRET_ACCESS_KEY?: string;
  HARNESS_S3_SESSION_TOKEN?: string;
}
const VERIFY_TTL = 600;
const SESSION_TTL = 86400;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u;
const GENERIC = 'If the address can receive this request, instructions will be sent.';
const sessionCookie = (secure: boolean) => secure ? '__Host-harness_password_session' : 'harness_password_session_dev';
const DUMMY_PASSWORD_HASH = 'pbkdf2-sha256$310000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function randomOtp() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(100000 + (buf[0] % 900000));
}

function getFirebaseConfig(env: PasswordAuthEnv): FirebaseAuthConfig | null {
  const envProc = typeof process !== 'undefined' ? process.env : undefined;
  const apiKey = (env.FIREBASE_API_KEY || env.HARNESS_FIREBASE_API_KEY || envProc?.FIREBASE_API_KEY || '').trim();
  if (!apiKey || apiKey.includes('your-firebase')) return null;
  return {
    apiKey,
    projectId: (env.FIREBASE_PROJECT_ID || env.HARNESS_FIREBASE_PROJECT_ID || envProc?.FIREBASE_PROJECT_ID || '').trim(),
    fetchFn: env.fetch,
  };
}

async function passwordDigest(password: string, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 310000 }, key, 256);
  return `pbkdf2-sha256$310000$${btoa(String.fromCharCode(...salt))}$${btoa(String.fromCharCode(...new Uint8Array(bits)))}`;
}

async function verifyPassword(password: string, saved: string) {
  const [algorithm, rounds, encodedSalt, encodedHash] = saved.split('$');
  if (algorithm !== 'pbkdf2-sha256' || rounds !== '310000' || !encodedSalt || !encodedHash) return false;
  const salt = Uint8Array.from(atob(encodedSalt), c => c.charCodeAt(0));
  const actual = await passwordDigest(password, salt);
  const a = new TextEncoder().encode(actual), b = new TextEncoder().encode(saved);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i % a.length] || 0) ^ (b[i % b.length] || 0);
  return diff === 0;
}

async function sendMail(env: PasswordAuthEnv, to: string, subject: string, text: string) {
  const local = env.HARNESS_MAIL_MODE === 'local';
  const from = env.HARNESS_MAIL_FROM || (local ? 'Harness Law <no-reply@example.test>' : '');
  if (env.EMAIL) {
    if (!from) throw new Error('mail_unconfigured');
    await env.EMAIL.send({ from, to, subject, text });
    return;
  }
  if (local) throw new Error('local_email_binding_unavailable');
  if (env.HARNESS_MAIL_API_URL && env.HARNESS_MAIL_API_KEY) {
    if (!from) throw new Error('mail_unconfigured');
    const response = await fetch(env.HARNESS_MAIL_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.HARNESS_MAIL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text }),
      signal: AbortSignal.timeout(10000),
      redirect: 'error'
    });
    if (!response.ok) throw new Error('mail_delivery_failed');
    return;
  }
  throw new Error('mail_unconfigured');
}

async function verifyBot(env: PasswordAuthEnv, data: Record<string, unknown>, request: Request) {
  if (!env.HARNESS_TURNSTILE_SECRET_KEY) return true;
  const token = typeof data.turnstileToken === 'string' ? data.turnstileToken : '';
  if (!token) return false;
  const form = new URLSearchParams({ secret: env.HARNESS_TURNSTILE_SECRET_KEY, response: token });
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) form.set('remoteip', ip);
  try {
    const response = await (env.fetch || fetch)('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(5000)
    });
    const result = await response.json() as { success?: boolean; hostname?: string };
    return response.ok && result.success === true && (!result.hostname || result.hostname === new URL(request.url).hostname);
  } catch {
    return false;
  }
}

function canRegister(env: PasswordAuthEnv) {
  const firebaseReady = !!(env.FIREBASE_API_KEY || env.HARNESS_FIREBASE_API_KEY);
  const mailReady = firebaseReady || !!(env.EMAIL || (env.HARNESS_MAIL_API_URL && env.HARNESS_MAIL_API_KEY) || env.HARNESS_MAIL_MODE === 'local');
  if (process.env.NODE_ENV === 'development') return mailReady;
  return !!(env.HARNESS_TERMS_VERSION && env.HARNESS_PRIVACY_VERSION && mailReady && env.HARNESS_TURNSTILE_SITE_KEY && env.HARNESS_TURNSTILE_SECRET_KEY);
}

type PasswordAccount = { user_id: string; email: string; name: string; password_hash: string; verified_at: number | null };
const isFirebaseAccount = (account: Pick<PasswordAccount, 'password_hash'>) => account.password_hash.startsWith('firebase:') || account.password_hash === 'oauth_account';
const firebaseAccountHash = (localId: string) => `firebase:${localId}`;

async function authenticateFirebase(config: FirebaseAuthConfig, email: string, password: string, requireVerified = true) {
  const signedIn = await firebaseSignIn(config, email, password);
  const lookup = await firebaseLookupUser(config, signedIn.idToken);
  const user = lookup.users?.find(candidate => candidate.localId === signedIn.localId);
  if (!user || user.disabled || !user.email || user.email.trim().toLowerCase() !== email || signedIn.email.trim().toLowerCase() !== email) {
    throw new FirebaseAuthError('login_failed', 'Email or password is incorrect.', 401);
  }
  if (requireVerified && user.emailVerified !== true) {
    throw new FirebaseAuthError('email_unverified', 'Verify your email before logging in.', 403);
  }
  return { ...signedIn, user };
}

const testLinkEnabled = (env: PasswordAuthEnv) => env.HARNESS_MAIL_MODE === 'local' && process.env.NODE_ENV === 'development';

export async function readPasswordUser(db: DB, cookieHeader: string, secure = true) {
  const name = sessionCookie(secure);
  const token = cookieHeader.split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await db.prepare('SELECT a.user_id,a.email,a.name FROM password_sessions s JOIN password_accounts a ON a.user_id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND a.verified_at IS NOT NULL')
    .bind(await tokenHash(token), Math.floor(Date.now() / 1000)).first<{ user_id: string; email: string; name: string }>();
  return row ? { userId: row.user_id, email: row.email, displayName: row.name.trim() || row.email, fullName: row.name.trim() || null, provider: 'password' as const } : null;
}

async function rateLimit(db: DB, key: string, limit: number, window: number, now: number) {
  await db.prepare('DELETE FROM auth_rate_limits WHERE bucket IN (SELECT bucket FROM auth_rate_limits WHERE window_started_at<? ORDER BY window_started_at LIMIT 100)').bind(now - 86400).run();
  const row = await db.prepare(`INSERT INTO auth_rate_limits (bucket,window_started_at,attempts) VALUES (?,?,1)
    ON CONFLICT(bucket) DO UPDATE SET
      window_started_at=CASE WHEN excluded.window_started_at-auth_rate_limits.window_started_at>=? THEN excluded.window_started_at ELSE auth_rate_limits.window_started_at END,
      attempts=CASE WHEN excluded.window_started_at-auth_rate_limits.window_started_at>=? THEN 1 ELSE auth_rate_limits.attempts+1 END
    WHERE excluded.window_started_at-auth_rate_limits.window_started_at>=? OR auth_rate_limits.attempts<?
    RETURNING attempts`).bind(key, now, window, window, window, limit).first<{ attempts: number }>();
  return !!row;
}

function jsonError(code: string, message: string, status: number) {
  return authJson({ code, error: message }, status);
}

async function body(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return null;
  const raw = await readAuthBody(request);
  if (raw === null) return null;
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
}

export async function handlePasswordAuth(request: Request, env: PasswordAuthEnv, action: 'register' | 'verify' | 'resend' | 'login' | 'logout' | 'forgot' | 'reset' | 'change-email' | 'email-change' | 'delete-account' | 'change-password', actorId?: string) {
  if (!env.DB) return jsonError('auth_unavailable', 'Account service is unavailable.', 503);
  const fbConfig = getFirebaseConfig(env);

  if (action === 'logout') {
    if (request.method !== 'POST' || !isSameOrigin(request)) return jsonError('invalid_request', 'Submit sign out from this app.', 403);
    const secure = cookieSecurityForUrl(request.url);
    if (secure === null) return jsonError('https_required', 'A secure connection is required.', 403);
    const name = sessionCookie(secure), cookie = request.headers.get('cookie') || '';
    const token = cookie.split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1);
    if (token) await env.DB.prepare('DELETE FROM password_sessions WHERE token_hash=?').bind(await tokenHash(token)).run();
    const headers = new Headers();
    headers.append('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`);
    headers.append('Set-Cookie', `${cookieNames(secure).provider}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`);
    return authJson({ ok: true }, 200, headers);
  }

  if (action === 'verify' && request.method === 'GET') {
    const url = new URL(request.url), token = url.searchParams.get('token') || url.searchParams.get('oobCode') || '';
    if (!token) return Response.redirect(new URL('/verify-email?invalid=1', request.url), 303);
    return Response.redirect(new URL(`/verify-email#token=${encodeURIComponent(token)}`, request.url), 303);
  }

  if (action === 'email-change' && request.method === 'GET') {
    const token = new URL(request.url).searchParams.get('token') || new URL(request.url).searchParams.get('oobCode') || '';
    if (!token) return Response.redirect(new URL('/confirm-email-change?invalid=1', request.url), 303);
    return Response.redirect(new URL(`/confirm-email-change#token=${encodeURIComponent(token)}`, request.url), 303);
  }

  if (action === 'reset' && request.method === 'GET') {
    const token = new URL(request.url).searchParams.get('token') || new URL(request.url).searchParams.get('oobCode') || '';
    if (!token) return Response.redirect(new URL('/forgot-password?invalid=1', request.url), 303);
    return Response.redirect(new URL(`/reset-password?token=${encodeURIComponent(token)}`, request.url), 303);
  }

  if (request.method !== 'POST' || !isSameOrigin(request)) return jsonError('invalid_request', 'Submit this request from the app.', 403);
  const secure = cookieSecurityForUrl(request.url);
  if (secure === null) return jsonError('https_required', 'A secure connection is required.', 403);
  const data = await body(request);
  if (!data) return jsonError('invalid_request', 'Check the form and try again.', 400);
  if (['register', 'login', 'forgot', 'resend', 'reset'].includes(action) && !await verifyBot(env, data, request)) {
    return jsonError('bot_check_failed', 'Complete the security check, then try again.', 403);
  }

  const now = Math.floor(Date.now() / 1000);
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const isDev = typeof process !== 'undefined' && process.env?.NODE_ENV === 'development';

  if (!await rateLimit(env.DB, `ip:${ip}:${action}`, isDev ? 100 : (action === 'login' ? 20 : 8), 900, now)) {
    return jsonError('rate_limited', 'Too many attempts. Please wait and try again.', 429);
  }
  if (['register', 'login', 'forgot', 'resend'].includes(action) && !EMAIL.test(email)) {
    return jsonError('invalid_email', 'Enter a valid email address.', 422);
  }

  if (action === 'register') {
    if (!canRegister(env)) return jsonError('registration_not_configured', 'Registration is not enabled until approved policy versions, email delivery, or Firebase authentication are configured.', 503);
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    const password = typeof data.password === 'string' ? data.password : '';
    if (name.length < 1 || name.length > 200 || password.length < 8 || password.length > 1024 || data.acceptedTerms !== true) {
      return jsonError('invalid_fields', 'Enter your name, a password of at least 8 characters, and accept the Terms and Privacy Policy.', 422);
    }
    if (!await rateLimit(env.DB, `email:${await tokenHash(email)}:register`, isDev ? 100 : 3, 3600, now)) {
      return jsonError('rate_limited', 'Too many attempts. Please try later.', 429);
    }

    const termsVersion = env.HARNESS_TERMS_VERSION || 'local-draft';
    const privacyVersion = env.HARNESS_PRIVACY_VERSION || 'local-draft';

    if (fbConfig) {
      const existingLocal = await env.DB.prepare('SELECT user_id FROM password_accounts WHERE email=?').bind(email).first<{ user_id: string }>();
      if (existingLocal) {
        return jsonError('email_exists', 'This email is already registered. Try logging in or resetting your password.', 409);
      }
      try {
        const fbUser = await firebaseSignUp(fbConfig, email, password);
        await firebaseSendEmailVerification(fbConfig, fbUser.idToken);
        const userId = `password:${fbUser.localId}`;
        const hash = firebaseAccountHash(fbUser.localId);
        try {
          await env.DB.prepare('INSERT INTO password_accounts (user_id,name,email,password_hash,verified_at,terms_accepted_at,terms_version,privacy_version,created_at) VALUES (?,?,?,?,NULL,?,?,?,?)')
            .bind(userId, name, email, hash, now, termsVersion, privacyVersion, now).run();
        } catch {
          return jsonError('email_exists', 'This email is already registered. Try logging in or resetting your password.', 409);
        }
        return authJson({ ok: true, message: 'Check your email for a verification link from Firebase.' }, 202);
      } catch (err) {
        if (err instanceof FirebaseAuthError) return jsonError(err.code, err.message, err.status);
        return jsonError('registration_failed', 'Registration failed. Please try again.', 500);
      }
    }

    // Local / fallback registration
    const id = `password:${crypto.randomUUID()}`, hash = await passwordDigest(password);
    try {
      await env.DB.prepare('INSERT INTO password_accounts (user_id,name,email,password_hash,verified_at,terms_accepted_at,terms_version,privacy_version,created_at) VALUES (?,?,?,?,NULL,?,?,?,?)')
        .bind(id, name, email, hash, now, termsVersion, privacyVersion, now).run();
    } catch {
      return jsonError('registration_unavailable', 'This address may already have an account. Try logging in or resetting the password.', 409);
    }
    const token = randomToken(), otp = randomOtp();
    const tokenDigest = await tokenHash(token), otpDigest = await tokenHash(`otp:${otp}`);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO email_challenges (token_hash,user_id,purpose,expires_at,created_at) VALUES (?,?,?,?,?)').bind(tokenDigest, id, 'verify', now + VERIFY_TTL, now),
      env.DB.prepare('INSERT INTO email_challenges (token_hash,user_id,purpose,expires_at,created_at) VALUES (?,?,?,?,?)').bind(otpDigest, id, 'verify', now + VERIFY_TTL, now)
    ]);
    const verificationUrl = new URL(`/api/auth/email/verify?token=${token}`, request.url).toString();
    try {
      await sendMail(env, email, 'Verify your Harness Law account', `Your verification code is: ${otp}\n\nOpen this link within 10 minutes: ${verificationUrl}`);
    } catch {
      return jsonError('email_delivery_unavailable', 'Account created but verification email could not be delivered. Use resend verification after setting up email delivery.', 503);
    }
    return authJson({ ok: true, message: 'Check your email for a verification code or link.', ...(testLinkEnabled(env) ? { testOnlyLink: verificationUrl, testOnlyOtp: otp } : {}) }, 202);
  }

  if (action === 'verify') {
    const input = typeof data.token === 'string' ? data.token.trim() : (typeof data.code === 'string' ? data.code.trim() : '');
    if (!input) return jsonError('invalid_token', 'Verification code or link is invalid or expired.', 400);
    const candidateHashes = [await tokenHash(input)];
    if (/^\d{6}$/.test(input)) candidateHashes.push(await tokenHash(`otp:${input}`));
    let row: { user_id: string } | null = null;
    for (const digest of candidateHashes) {
      row = await env.DB.prepare("SELECT c.user_id FROM email_challenges c JOIN password_accounts a ON a.user_id=c.user_id WHERE c.token_hash=? AND c.purpose='verify' AND c.expires_at>? AND a.password_hash LIKE 'pbkdf2-sha256$%'").bind(digest, now).first<{ user_id: string }>();
      if (row) break;
    }
    if (row) {
      await env.DB.batch([
        env.DB.prepare('UPDATE password_accounts SET verified_at=? WHERE user_id=?').bind(now, row.user_id),
        env.DB.prepare("DELETE FROM email_challenges WHERE user_id=? AND purpose='verify'").bind(row.user_id)
      ]);
      return authJson({ ok: true, message: 'Email verified. You can now log in.', redirectTo: '/signin?verified=1' });
    }
    if (fbConfig) {
      try {
        const verified = await firebaseVerifyEmail(fbConfig, input);
        await env.DB.prepare("UPDATE password_accounts SET verified_at=? WHERE user_id=? AND email=? AND (password_hash LIKE 'firebase:%' OR password_hash='oauth_account')")
          .bind(now, `password:${verified.localId}`, verified.email.toLowerCase()).run();
        return authJson({ ok: true, message: 'Email verified. You can now log in.', redirectTo: '/signin?verified=1' });
      } catch (err) {
        if (err instanceof FirebaseAuthError) return jsonError(err.code, err.message, err.status);
        return jsonError('auth_unavailable', 'Verification is temporarily unavailable. Please try again.', 503);
      }
    }
    return jsonError('invalid_token', 'Verification code or link is invalid or expired.', 400);
  }

  if (action === 'email-change') {
    const input = typeof data.token === 'string' ? data.token.trim() : (typeof data.code === 'string' ? data.code.trim() : '');
    if (!input) return jsonError('invalid_token', 'Email confirmation code or link is invalid or expired.', 400);

    const candidateHashes = [await tokenHash(input)];
    if (/^\d{6}$/.test(input)) candidateHashes.push(await tokenHash(`otp:${input}`));
    let row: { user_id: string; pending_email: string } | null = null;
    for (const digest of candidateHashes) {
      row = await env.DB.prepare("SELECT c.user_id,a.pending_email FROM email_challenges c JOIN password_accounts a ON a.user_id=c.user_id WHERE c.token_hash=? AND c.purpose='email-change' AND c.expires_at>? AND a.pending_email IS NOT NULL AND a.password_hash LIKE 'pbkdf2-sha256$%'").bind(digest, now).first<{ user_id: string; pending_email: string }>();
      if (row) break;
    }
    if (!row) return jsonError('invalid_token', 'Email confirmation link is invalid or expired.', 400);
    try {
      await env.DB.batch([
        env.DB.prepare('UPDATE password_accounts SET email=pending_email,pending_email=NULL WHERE user_id=?').bind(row.user_id),
        env.DB.prepare("DELETE FROM email_challenges WHERE user_id=? AND purpose='email-change'").bind(row.user_id),
        env.DB.prepare('DELETE FROM password_sessions WHERE user_id=?').bind(row.user_id)
      ]);
    } catch {
      return jsonError('email_unavailable', 'That address is no longer available. Your current email remains active.', 409);
    }
    return authJson({ ok: true, message: 'Email address updated. Please log in again.', redirectTo: '/signin?emailChanged=1' });
  }

  if (action === 'login') {
    const password = typeof data.password === 'string' ? data.password : '';
    if (!await rateLimit(env.DB, `login-email:${await tokenHash(email)}`, isDev ? 100 : 8, 900, now)) {
      return jsonError('rate_limited', 'Too many sign-in attempts. Wait 15 minutes and try again.', 429);
    }

    const rememberMe = data.rememberMe === true || data.rememberMe === 'on' || data.rememberMe === 'true';
    const sessionTtl = rememberMe ? 30 * 86400 : SESSION_TTL;

    const account = await env.DB.prepare('SELECT user_id,email,name,password_hash,verified_at FROM password_accounts WHERE email=?').bind(email).first<PasswordAccount>();
    // Native password accounts keep their own credentials. A matching email is
    // never permission to replace them with an unrelated Firebase identity.
    if (!account || isFirebaseAccount(account)) {
      if (!fbConfig) {
        if (account) return jsonError('auth_unavailable', 'Account sign-in is temporarily unavailable.', 503);
      } else {
        try {
          const firebase = await authenticateFirebase(fbConfig, email, password);
          const userId = `password:${firebase.localId}`;
          if (account && account.user_id !== userId) {
            return jsonError('account_conflict', 'This sign-in does not match the saved account. Use its original sign-in method.', 409);
          }
          if (!account) {
            const byId = await env.DB.prepare('SELECT user_id FROM password_accounts WHERE user_id=?').bind(userId).first<{ user_id: string }>();
            if (byId) return jsonError('account_conflict', 'This sign-in does not match the saved account email.', 409);
            await env.DB.prepare('INSERT INTO password_accounts (user_id,name,email,password_hash,verified_at,terms_accepted_at,terms_version,privacy_version,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
              .bind(userId, firebase.user.displayName || email.split('@')[0], email, firebaseAccountHash(firebase.localId), now, now, env.HARNESS_TERMS_VERSION || 'local-draft', env.HARNESS_PRIVACY_VERSION || 'local-draft', now).run();
          } else {
            await env.DB.prepare('UPDATE password_accounts SET verified_at=?,password_hash=? WHERE user_id=?').bind(now, firebaseAccountHash(firebase.localId), userId).run();
          }
          const token = randomToken(), expires = now + sessionTtl;
          await env.DB.prepare('INSERT INTO password_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await tokenHash(token), userId, expires).run();
          const headers = new Headers();
          headers.append('Set-Cookie', authCookie(sessionCookie(secure), token, sessionTtl, secure));
          headers.append('Set-Cookie', authCookie(cookieNames(secure).provider, 'password', rememberMe ? 30 * 86400 : 400 * 24 * 60 * 60, secure));
          return authJson({ ok: true, redirectTo: '/onboarding' }, 200, headers);
        } catch (err) {
          if (err instanceof FirebaseAuthError) return jsonError(err.code, err.message, err.status);
          return jsonError('login_failed', 'Email or password is incorrect.', 401);
        }
      }
    }

    // Native authentication remains available when Firebase is configured.
    const valid = await verifyPassword(password, account?.password_hash || DUMMY_PASSWORD_HASH);
    if (!account || !valid) return jsonError('login_failed', 'Email or password is incorrect.', 401);
    if (!account.verified_at) return jsonError('email_unverified', 'Verify your email before logging in.', 403);
    const token = randomToken(), expires = now + sessionTtl;
    await env.DB.prepare('INSERT INTO password_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await tokenHash(token), account.user_id, expires).run();
    const headers = new Headers();
    headers.append('Set-Cookie', authCookie(sessionCookie(secure), token, sessionTtl, secure));
    headers.append('Set-Cookie', authCookie(cookieNames(secure).provider, 'password', rememberMe ? 30 * 86400 : 400 * 24 * 60 * 60, secure));
    return authJson({ ok: true, redirectTo: '/onboarding' }, 200, headers);
  }

  if (action === 'resend' || action === 'forgot') {
    const account = await env.DB.prepare('SELECT user_id,email,password_hash,verified_at FROM password_accounts WHERE email=?').bind(email).first<PasswordAccount>();
    if (!await rateLimit(env.DB, `email:${await tokenHash(email)}:${action}`, isDev ? 100 : 3, 3600, now)) {
      return jsonError('rate_limited', 'Too many requests. Please wait and try again.', 429);
    }
    if ((!account || isFirebaseAccount(account)) && fbConfig) {
      if (action === 'forgot') {
        try { await firebaseSendPasswordReset(fbConfig, email); } catch {}
        return authJson({ ok: true, message: GENERIC }, 202);
      }
      const password = typeof data.password === 'string' ? data.password : '';
      if (!password) return jsonError('reauthentication_required', 'Enter your password to resend your verification email.', 422);
      try {
        const firebase = await authenticateFirebase(fbConfig, email, password, false);
        if (account && account.user_id !== `password:${firebase.localId}`) return jsonError('account_conflict', 'This sign-in does not match the saved account.', 409);
        if (!firebase.user.emailVerified) await firebaseSendEmailVerification(fbConfig, firebase.idToken);
        return authJson({ ok: true, message: GENERIC }, 202);
      } catch (err) {
        if (err instanceof FirebaseAuthError) return jsonError(err.code, err.message, err.status);
        return jsonError('email_delivery_unavailable', 'Verification email could not be sent. Please try again.', 503);
      }
    }
    if (account && isFirebaseAccount(account)) return jsonError('auth_unavailable', 'Account sign-in is temporarily unavailable.', 503);

    let testOnlyLink: string | undefined, testOnlyOtp: string | undefined;
    if (account && !(action === 'resend' && account.verified_at)) {
      const purpose = action === 'resend' ? 'verify' : 'reset';
      const token = randomToken(), otp = randomOtp();
      const tokenDigest = await tokenHash(token), otpDigest = await tokenHash(`otp:${otp}`);
      await env.DB.prepare('DELETE FROM email_challenges WHERE user_id=? AND purpose=?').bind(account.user_id, purpose).run();
      await env.DB.batch([
        env.DB.prepare('INSERT INTO email_challenges (token_hash,user_id,purpose,expires_at,created_at) VALUES (?,?,?,?,?)').bind(tokenDigest, account.user_id, purpose, now + VERIFY_TTL, now),
        env.DB.prepare('INSERT INTO email_challenges (token_hash,user_id,purpose,expires_at,created_at) VALUES (?,?,?,?,?)').bind(otpDigest, account.user_id, purpose, now + VERIFY_TTL, now)
      ]);
      try {
        const url = new URL(`/api/auth/email/${purpose === 'verify' ? 'verify' : 'reset'}?token=${token}`, request.url);
        testOnlyLink = url.toString(); testOnlyOtp = otp;
        const isVerify = purpose === 'verify';
        const emailSubject = isVerify ? 'Verify your Harness Law account' : 'Reset your Harness Law password';
        const emailBody = isVerify
          ? `Your verification code is: ${otp}\n\nOpen this link within 10 minutes: ${url}`
          : `Your password reset code is: ${otp}\n\nOpen this link within 10 minutes: ${url}`;
        await sendMail(env, email, emailSubject, emailBody);
      } catch {
        return jsonError('email_delivery_unavailable', 'Email delivery is not configured yet.', 503);
      }
    }
    return authJson({ ok: true, message: GENERIC, ...(testOnlyLink && testLinkEnabled(env) ? { testOnlyLink, testOnlyOtp } : {}) }, 202);
  }

  if (action === 'reset') {
    const input = typeof data.token === 'string' ? data.token.trim() : (typeof data.code === 'string' ? data.code.trim() : '');
    const password = typeof data.password === 'string' ? data.password : '';
    if (password.length < 8 || password.length > 1024) return jsonError('invalid_password', 'Use a password of at least 8 characters.', 422);
    if (!input) return jsonError('invalid_token', 'Reset code or link is invalid or expired.', 400);

    const candidateHashes = [await tokenHash(input)];
    if (/^\d{6}$/.test(input)) candidateHashes.push(await tokenHash(`otp:${input}`));
    let row: { user_id: string } | null = null;
    for (const digest of candidateHashes) {
      row = await env.DB.prepare("SELECT c.user_id FROM email_challenges c JOIN password_accounts a ON a.user_id=c.user_id WHERE c.token_hash=? AND c.purpose='reset' AND c.expires_at>? AND a.password_hash LIKE 'pbkdf2-sha256$%'").bind(digest, now).first<{ user_id: string }>();
      if (row) break;
    }
    if (!row) {
      if (fbConfig) {
        try {
          const resetRes = await firebaseConfirmPasswordReset(fbConfig, input, password);
          const account = await env.DB.prepare('SELECT user_id,email,password_hash FROM password_accounts WHERE email=?').bind(resetRes.email.toLowerCase()).first<PasswordAccount>();
          if (account && isFirebaseAccount(account)) {
            const firebase = await firebaseSignIn(fbConfig, resetRes.email.toLowerCase(), password);
            if (account.user_id !== `password:${firebase.localId}` || firebase.email.toLowerCase() !== resetRes.email.toLowerCase()) return jsonError('account_conflict', 'This reset does not match the saved account.', 409);
            await env.DB.prepare('DELETE FROM password_sessions WHERE user_id=?').bind(account.user_id).run();
          }
          return authJson({ ok: true, message: 'Password updated. Log in with your new password.', redirectTo: '/signin?passwordReset=1' });
        } catch (err) {
          if (err instanceof FirebaseAuthError) return jsonError(err.code, err.message, err.status);
          return jsonError('auth_unavailable', 'Password reset is temporarily unavailable. Please try again.', 503);
        }
      }
  
        return jsonError('invalid_token', 'Reset link is invalid or expired.', 400);
    }
    await env.DB.batch([
      env.DB.prepare('UPDATE password_accounts SET password_hash=? WHERE user_id=?').bind(await passwordDigest(password), row.user_id),
      env.DB.prepare("DELETE FROM email_challenges WHERE user_id=? AND purpose='reset'").bind(row.user_id),
      env.DB.prepare('DELETE FROM password_sessions WHERE user_id=?').bind(row.user_id)
    ]);
    try {
      const account = await env.DB.prepare('SELECT email FROM password_accounts WHERE user_id=?').bind(row.user_id).first<{ email: string }>();
      if (account) await sendMail(env, account.email, 'Your Harness Law password changed', 'Your password was changed. If this was not you, contact support.');
    } catch {}
    return authJson({ ok: true, message: 'Password updated. Log in with your new password.', redirectTo: '/signin?passwordReset=1' });
  }

  if (action === 'change-email') {
    if (!actorId?.startsWith('password:')) return jsonError('authentication_required', 'Log in with your email account to change its address.', 401);
    const next = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    if (!EMAIL.test(next)) return jsonError('invalid_email', 'Enter a valid new email address.', 422);
    const account = await env.DB.prepare('SELECT email,password_hash FROM password_accounts WHERE user_id=?').bind(actorId).first<{ email: string; password_hash: string }>();
    if (!account) return jsonError('account_unavailable', 'Account is unavailable.', 404);
    if (isFirebaseAccount(account)) return jsonError('provider_managed_email', 'Email changes for this sign-in method must be handled through your authentication provider. Your current email remains unchanged.', 409);
    if (next === account.email) return jsonError('same_email', 'Enter a different email address.', 422);
    try {
      await env.DB.prepare('UPDATE password_accounts SET pending_email=? WHERE user_id=?').bind(next, actorId).run();
    } catch {
      return jsonError('email_unavailable', 'That email address is already in use or has a pending change.', 409);
    }
    const token = randomToken(), otp = randomOtp();
    const tokenDigest = await tokenHash(token), otpDigest = await tokenHash(`otp:${otp}`);
    await env.DB.prepare("DELETE FROM email_challenges WHERE user_id=? AND purpose='email-change'").bind(actorId).run();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO email_challenges (token_hash,user_id,purpose,expires_at,created_at) VALUES (?,?,?,?,?)').bind(tokenDigest, actorId, 'email-change', now + VERIFY_TTL, now),
      env.DB.prepare('INSERT INTO email_challenges (token_hash,user_id,purpose,expires_at,created_at) VALUES (?,?,?,?,?)').bind(otpDigest, actorId, 'email-change', now + VERIFY_TTL, now)
    ]);
    const emailChangeUrl = new URL(`/api/auth/email/email-change?token=${token}`, request.url).toString();
    try {
      await sendMail(env, next, 'Confirm your new Harness Law email', `Your confirmation code is: ${otp}\n\nConfirm this email change within 10 minutes: ${emailChangeUrl}`);
    } catch {
      return jsonError('email_delivery_unavailable', 'The confirmation email could not be delivered. Your current email remains active.', 503);
    }
    return authJson({ ok: true, message: 'Check the new address to confirm the change.', ...(testLinkEnabled(env) ? { testOnlyLink: emailChangeUrl, testOnlyOtp: otp } : {}) }, 202);
  }

  if (action === 'change-password') {
    if (!actorId?.startsWith('password:')) return jsonError('authentication_required', 'Log in with your email account to change its password.', 401);
    const current = typeof data.currentPassword === 'string' ? data.currentPassword : '';
    const next = typeof data.password === 'string' ? data.password : '';
    if (next.length < 8 || next.length > 1024) return jsonError('invalid_password', 'Use a password of at least 8 characters.', 422);
    const account = await env.DB.prepare('SELECT email,password_hash FROM password_accounts WHERE user_id=? AND verified_at IS NOT NULL').bind(actorId).first<{ email: string; password_hash: string }>();
    if (!account) return jsonError('account_unavailable', 'Account not found.', 404);

    if (isFirebaseAccount(account)) {
      if (!fbConfig) return jsonError('auth_unavailable', 'Account sign-in is temporarily unavailable.', 503);
      try {
        const signinRes = await authenticateFirebase(fbConfig, account.email, current);
        if (`password:${signinRes.localId}` !== actorId) return jsonError('account_conflict', 'This sign-in does not match the saved account.', 409);
        await firebaseUpdatePassword(fbConfig, signinRes.idToken, next);
      } catch (err) {
        if (err instanceof FirebaseAuthError) return jsonError('reauthentication_required', 'Your current password is incorrect.', 403);
        return jsonError('auth_unavailable', 'Unable to verify your current password. Please try again.', 503);
      }
    } else {
      if (!await verifyPassword(current, account.password_hash)) return jsonError('reauthentication_required', 'Your current password is incorrect.', 403);
    }

    await env.DB.batch([
      env.DB.prepare('UPDATE password_accounts SET password_hash=? WHERE user_id=?').bind(isFirebaseAccount(account) ? firebaseAccountHash(actorId.slice('password:'.length)) : await passwordDigest(next), actorId),
      env.DB.prepare('DELETE FROM password_sessions WHERE user_id=?').bind(actorId)
    ]);
    try {
      await sendMail(env, account.email, 'Your Harness Law password changed', 'Your password was changed. If this was not you, use Forgot password to secure your account.');
    } catch {}
    return authJson({ ok: true, redirectTo: '/signin?passwordChanged=1' });
  }

  if (action === 'delete-account') {
    if (!actorId?.startsWith('password:')) return jsonError('authentication_required', 'Log in with your email account to delete it.', 401);
    const password = typeof data.password === 'string' ? data.password : '';
    const account = await env.DB.prepare('SELECT email, password_hash FROM password_accounts WHERE user_id=?').bind(actorId).first<{ email: string; password_hash: string }>();
    if (!account) return jsonError('account_unavailable', 'Account not found.', 404);

    if (isFirebaseAccount(account)) {
      if (!fbConfig) return jsonError('auth_unavailable', 'Account sign-in is temporarily unavailable.', 503);
      try {
        const signinRes = await authenticateFirebase(fbConfig, account.email, password);
        if (`password:${signinRes.localId}` !== actorId) return jsonError('account_conflict', 'This sign-in does not match the saved account.', 409);
        await firebaseDeleteUser(fbConfig, signinRes.idToken);
      } catch (err) {
        if (err instanceof FirebaseAuthError) return jsonError('reauthentication_required', 'Enter your current password to confirm account deletion.', 403);
        return jsonError('auth_unavailable', 'Unable to verify your current password. No account data was deleted.', 503);
      }
    } else {
      if (!await verifyPassword(password, account.password_hash)) return jsonError('reauthentication_required', 'Enter your current password to confirm account deletion.', 403);
    }

    const legacy = await env.DB.prepare('SELECT object_key FROM evidence_objects WHERE owner_id=?').bind(actorId).all<{ object_key: string }>();
    const s3Configured = !!(env.HARNESS_S3_BUCKET || env.HARNESS_S3_REGION || env.HARNESS_S3_ACCESS_KEY_ID || env.HARNESS_S3_SECRET_ACCESS_KEY || env.HARNESS_S3_SESSION_TOKEN);
    if (legacy.results.length && !env.BUCKET && !s3Configured) return jsonError('storage_unavailable', 'Account data storage is unavailable. No account data was deleted.', 503);
    try {
      let integrationStore: ObjectStore | undefined;
      if (s3Configured) {
        if (!env.HARNESS_S3_BUCKET || !env.HARNESS_S3_REGION || !env.HARNESS_S3_ACCESS_KEY_ID || !env.HARNESS_S3_SECRET_ACCESS_KEY) {
          return jsonError('storage_unavailable', 'S3 storage configuration is incomplete. Account was retained.', 503);
        }
        integrationStore = createS3Store({
          bucket: env.HARNESS_S3_BUCKET,
          region: env.HARNESS_S3_REGION,
          accessKeyId: env.HARNESS_S3_ACCESS_KEY_ID,
          secretAccessKey: env.HARNESS_S3_SECRET_ACCESS_KEY,
          ...(env.HARNESS_S3_SESSION_TOKEN ? { sessionToken: env.HARNESS_S3_SESSION_TOKEN } : {}),
          requireVersionId: true
        });
      } else if (env.BUCKET) {
        integrationStore = createR2Store(env.BUCKET);
      }

      const integration = await env.DB.prepare('SELECT case_id FROM integration_cases WHERE owner_id=?').bind(actorId).first<{ case_id: string }>();
      if (integration) {
        const chunks = await env.DB.prepare('SELECT payload FROM integration_case_chunks WHERE case_id=? ORDER BY chunk_index').bind(integration.case_id).all<{ payload: string }>();
        const envelope = JSON.parse(chunks.results.map(x => x.payload).join('')) as { upload_objects?: Record<string, { key: string; version?: string }>; state?: unknown };
        const keys = new Map<string, string | undefined>();
        const visit = (value: unknown) => {
          if (!value || typeof value !== 'object') return;
          if (Array.isArray(value)) { value.forEach(visit); return; }
          const object = value as Record<string, unknown>;
          for (const [field, v] of Object.entries(object)) {
            if (typeof v === 'string' && /(?:storage_)?key$/i.test(field) && /^(quarantine|renditions|extractions|exports)\//.test(v)) {
              const version = object.storage_version_id || object.rendition_storage_version_id || object.version_id || object.version;
              keys.set(v, typeof version === 'string' ? version : undefined);
            }
          }
          for (const child of Object.values(object)) visit(child);
        };
        visit(envelope);
        for (const value of Object.values(envelope.upload_objects || {})) {
          if (value?.key) keys.set(value.key, value.version);
        }
        if (keys.size && !integrationStore) return jsonError('storage_unavailable', 'Integration object storage cleanup needs configuration. Account was retained.', 503);
        for (const [key, version] of keys) await integrationStore!.delete(key, version);
      }

      const evidenceStore = createConfiguredEvidenceBlobStore(env as unknown as Record<string, unknown>, createEvidenceObjectCatalog(env.DB));
      if (legacy.results.length) {
        if (!evidenceStore?.delete) throw new Error('Evidence storage cleanup is unavailable.');
        await evidenceStore.delete(legacy.results.map(row => row.object_key));
      }
      const statements = [
        env.DB.prepare('DELETE FROM cloud_drive_authorizations WHERE owner_id=?').bind(actorId),
        env.DB.prepare('DELETE FROM cloud_drive_connections WHERE owner_id=?').bind(actorId),
        env.DB.prepare('DELETE FROM email_challenges WHERE user_id=?').bind(actorId),
        env.DB.prepare('DELETE FROM password_sessions WHERE user_id=?').bind(actorId),
        env.DB.prepare('DELETE FROM evidence_objects WHERE owner_id=?').bind(actorId),
        env.DB.prepare('DELETE FROM cases WHERE owner_id=?').bind(actorId),
      ];
      if (integration) {
        statements.push(
          env.DB.prepare('DELETE FROM integration_case_chunks WHERE case_id=?').bind(integration.case_id),
          env.DB.prepare('DELETE FROM integration_cases WHERE case_id=? AND owner_id=?').bind(integration.case_id, actorId)
        );
      }
      statements.push(env.DB.prepare('DELETE FROM password_accounts WHERE user_id=?').bind(actorId));
      await env.DB.batch(statements);
      try { await env.DB.prepare('DELETE FROM connected_drives WHERE user_id=?').bind(actorId).run(); } catch {}
      const headers = new Headers();
      headers.append('Set-Cookie', `${sessionCookie(secure)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`);
      headers.append('Set-Cookie', `${cookieNames(secure).provider}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`);
      return authJson({ ok: true, redirectTo: '/' }, 200, headers);
    } catch {
      return jsonError('deletion_failed', 'Account deletion could not finish. Contact support before retrying.', 503);
    }
  }

  return jsonError('not_implemented', 'This account action is being configured.', 501);
}
