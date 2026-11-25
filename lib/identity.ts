// @ts-ignore Explicit TypeScript extension for Node's test runner.
import { cookieNames, hasGoogleSessionCookie, hasSelectedGoogleProvider } from './auth/runtime.ts';

export type AppUser = { userId: string; displayName: string; email: string; fullName: string | null; provider: 'google' | 'chatgpt' | 'password' };
type NativeUser = Omit<AppUser, 'provider'>;

export async function resolveIdentity(
  cookieHeader: string,
  development: boolean,
  readGoogle: (secure: boolean) => Promise<AppUser | null>,
  readChatGPT: () => Promise<NativeUser | null>,
  readPassword?: () => Promise<AppUser | null>,
): Promise<AppUser | null> {
  const passwordSelected=cookieHeader.split(';').some(part=>part.trim()===`${cookieNames(true).provider}=password`||part.trim()===`${cookieNames(false).provider}=password`);
  if(passwordSelected){try{return readPassword?await readPassword():null;}catch{return null;}}
  const secure = !development || hasGoogleSessionCookie(cookieHeader, true) || hasSelectedGoogleProvider(cookieHeader, true);
  if (hasSelectedGoogleProvider(cookieHeader, secure) || hasGoogleSessionCookie(cookieHeader, secure)) {
    // Provider choice outlives authentication. Expiry or storage failure must
    // never select a different retained account without the user's action.
    try { return await readGoogle(secure); } catch { return null; }
  }
  if (cookieHeader.split(';').some(part=>part.trim().startsWith('__Host-harness_password_session=')||part.trim().startsWith('harness_password_session_dev='))) {
    try { return readPassword ? await readPassword() : null; } catch { return null; }
  }
  const user = await readChatGPT();
  return user ? { ...user, provider: 'chatgpt' } : null;
}
