import { env } from 'cloudflare:workers';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getChatGPTUser } from './chatgpt-auth';
import { getGoogleClientId, readGoogleUser } from '../lib/auth/google';
import { resolveIdentity, type AppUser } from '../lib/identity';
export type { AppUser } from '../lib/identity';

export function googleSignInEnabled(): boolean {
  return getGoogleClientId(env) !== null;
}

export async function getAppUser(): Promise<AppUser | null> {
  const requestHeaders = await headers();
  const cookieHeader = requestHeaders.get('cookie') ?? '';
  return resolveIdentity(cookieHeader, process.env.NODE_ENV === 'development',
    async secure => env.DB ? readGoogleUser(env.DB, cookieHeader, secure) : null,
    getChatGPTUser);
}

export async function requireAppUser(): Promise<AppUser> {
  const user = await getAppUser();
  if (!user) redirect('/signin');
  return user;
}
