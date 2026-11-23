import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface GoogleIdentity {
  sub: string;
  email: string;
  fullName: string | null;
}

export interface GoogleVerificationOptions {
  jwks?: JWTVerifyGetKey;
  now?: Date;
}

const googleJWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), {
  timeoutDuration: 5000,
  cooldownDuration: 30000,
  cacheMaxAge: 600000,
});
const NONCE = /^[A-Za-z0-9_-]{43}$/;
const FAILURE = 'Google sign-in could not be verified. Please try again.';

function matchingNonce(actual: unknown, expected: string): boolean {
  if (typeof actual !== 'string' || actual.length !== 43 || expected.length !== 43 || !NONCE.test(actual) || !NONCE.test(expected)) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

/** Verify an ID token only; no authorization code, access token, or mailbox scope is used. */
export async function verifyGoogleCredential(
  credential: string,
  clientId: string,
  nonce: string,
  options: GoogleVerificationOptions = {},
): Promise<GoogleIdentity> {
  try {
    if (typeof credential !== 'string' || !credential || credential.length > 16384 || typeof nonce !== 'string' || nonce.length !== 43 || !NONCE.test(nonce)) throw new Error();
    if (typeof clientId !== 'string' || clientId.trim() !== clientId || !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId) || clientId.length > 500) throw new Error();
    const { payload } = await jwtVerify(credential, options.jwks ?? googleJWKS, {
      algorithms: ['RS256'],
      issuer: ['accounts.google.com', 'https://accounts.google.com'],
      audience: clientId,
      requiredClaims: ['exp', 'iat', 'sub', 'email', 'email_verified', 'nonce'],
      maxTokenAge: 600,
      clockTolerance: 30,
      currentDate: options.now,
    });
    if (!Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) || payload.exp! <= payload.iat!) throw new Error();
    if (Array.isArray(payload.aud) && (payload.aud.some(value => typeof value !== 'string') || (payload.aud.length > 1 && payload.azp !== clientId))) throw new Error();
    if (payload.azp !== undefined && payload.azp !== clientId) throw new Error();
    if (!matchingNonce(payload.nonce, nonce)) throw new Error();
    if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255 || /[\s\u0000-\u001f\u007f]/u.test(payload.sub)) throw new Error();
    if (payload.email_verified !== true || typeof payload.email !== 'string' || payload.email.trim() !== payload.email || payload.email.length > 320 || /[\u0000-\u001f\u007f]/.test(payload.email) || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(payload.email)) throw new Error();
    const name = typeof payload.name === 'string' ? payload.name.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
    return { sub: payload.sub, email: payload.email, fullName: name && name.length <= 500 ? name : null };
  } catch {
    // Do not expose JWT contents, provider claim errors, or JWKS/network details.
    throw new Error(FAILURE);
  }
}
