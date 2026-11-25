export interface FirebaseAuthConfig {
  apiKey: string;
  projectId?: string;
  fetchFn?: typeof fetch;
}

export interface FirebaseSignUpResult {
  localId: string;
  email: string;
  idToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface FirebaseSignInResult {
  localId: string;
  email: string;
  idToken: string;
  refreshToken: string;
  expiresIn: string;
  registered: boolean;
}

export interface FirebaseUserRecord {
  localId: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
  disabled?: boolean;
}

export class FirebaseAuthError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'FirebaseAuthError';
    this.code = code;
    this.status = status;
  }
}

const FIREBASE_BASE = 'https://identitytoolkit.googleapis.com/v1';

async function firebasePost<T>(config: FirebaseAuthConfig, endpoint: string, payload: Record<string, unknown>): Promise<T> {
  const fetcher = config.fetchFn || fetch;
  const url = `${FIREBASE_BASE}/${endpoint}?key=${encodeURIComponent(config.apiKey)}`;
  const response = await fetcher(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });

  const body = await response.json() as { error?: { message?: string; code?: number } } & T;

  if (!response.ok || body.error) {
    const rawError = body.error?.message || 'UNKNOWN_FIREBASE_ERROR';
    const messageUpper = rawError.toUpperCase();

    if (messageUpper.includes('EMAIL_EXISTS')) {
      throw new FirebaseAuthError('email_exists', 'This email is already registered. Try logging in or resetting your password.', 409);
    }
    if (messageUpper.includes('EMAIL_NOT_FOUND') || messageUpper.includes('INVALID_PASSWORD') || messageUpper.includes('INVALID_LOGIN_CREDENTIALS')) {
      throw new FirebaseAuthError('login_failed', 'Email or password is incorrect.', 401);
    }
    if (messageUpper.includes('USER_DISABLED')) {
      throw new FirebaseAuthError('user_disabled', 'This account has been disabled. Contact support.', 403);
    }
    if (messageUpper.includes('TOO_MANY_ATTEMPTS_TRY_LATER')) {
      throw new FirebaseAuthError('rate_limited', 'Too many attempts. Please wait and try again.', 429);
    }
    if (messageUpper.includes('INVALID_OOB_CODE') || messageUpper.includes('EXPIRED_OOB_CODE')) {
      throw new FirebaseAuthError('invalid_token', 'Verification code or link is invalid or expired.', 400);
    }
    if (messageUpper.includes('OPERATION_NOT_ALLOWED')) {
      throw new FirebaseAuthError('auth_disabled', 'Email/password sign-in is not enabled in Firebase Console.', 503);
    }

    throw new FirebaseAuthError('auth_failed', `Authentication error: ${rawError}`, response.status || 400);
  }

  return body;
}

export async function firebaseSignUp(config: FirebaseAuthConfig, email: string, password: string): Promise<FirebaseSignUpResult> {
  return firebasePost<FirebaseSignUpResult>(config, 'accounts:signUp', {
    email,
    password,
    returnSecureToken: true,
  });
}

export async function firebaseSendEmailVerification(config: FirebaseAuthConfig, idToken: string): Promise<{ email: string }> {
  return firebasePost<{ email: string }>(config, 'accounts:sendOobCode', {
    requestType: 'VERIFY_EMAIL',
    idToken,
  });
}

export async function firebaseVerifyEmail(config: FirebaseAuthConfig, oobCode: string): Promise<{ localId: string; email: string }> {
  return firebasePost<{ localId: string; email: string }>(config, 'accounts:update', {
    oobCode,
  });
}

export async function firebaseSignIn(config: FirebaseAuthConfig, email: string, password: string): Promise<FirebaseSignInResult> {
  return firebasePost<FirebaseSignInResult>(config, 'accounts:signInWithPassword', {
    email,
    password,
    returnSecureToken: true,
  });
}

export async function firebaseLookupUser(config: FirebaseAuthConfig, idToken: string): Promise<{ users: FirebaseUserRecord[] }> {
  return firebasePost<{ users: FirebaseUserRecord[] }>(config, 'accounts:lookup', {
    idToken,
  });
}

export async function firebaseSendPasswordReset(config: FirebaseAuthConfig, email: string): Promise<{ email: string }> {
  return firebasePost<{ email: string }>(config, 'accounts:sendOobCode', {
    requestType: 'PASSWORD_RESET',
    email,
  });
}

export async function firebaseConfirmPasswordReset(config: FirebaseAuthConfig, oobCode: string, newPassword: string): Promise<{ email: string }> {
  return firebasePost<{ email: string }>(config, 'accounts:resetPassword', {
    oobCode,
    newPassword,
  });
}

export async function firebaseDeleteUser(config: FirebaseAuthConfig, idToken: string): Promise<void> {
  await firebasePost<unknown>(config, 'accounts:delete', {
    idToken,
  });
}

export async function firebaseUpdatePassword(config: FirebaseAuthConfig, idToken: string, newPassword: string): Promise<{ localId: string; email: string }> {
  return firebasePost<{ localId: string; email: string }>(config, 'accounts:update', {
    idToken,
    password: newPassword,
    returnSecureToken: true,
  });
}
