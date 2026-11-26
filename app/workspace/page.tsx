import type { Metadata } from 'next';
import { getAppUser } from '../auth';
import Workspace from '../workspace';
import { env } from 'cloudflare:workers';
import { getAdminAccess } from '@/lib/admin/access';
import { redirect } from 'next/navigation';
import { getAccountFlow, type AccountFlow } from '@/lib/intake-entry';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your workspace · Harness Law' };

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ sample?: string; view?: string }> }) {
  const [user, params] = await Promise.all([getAppUser(), searchParams]);
  let accountFlow: AccountFlow = 'workspace';
  let flowUnavailable = false;
  if (user && params.sample !== '1') {
    try {
      if (!env.DB) throw new Error('Account storage is unavailable.');
      accountFlow = await getAccountFlow(env.DB, user.userId);
    } catch { flowUnavailable = true; }
  }
  if (flowUnavailable) return <main className="panel" style={{ margin: '48px auto', maxWidth: 640, padding: 32 }}><h1>We couldn’t open your workspace.</h1><p>Your saved information is unchanged. Please try again.</p><a className="button primary" href="/workspace">Try again</a></main>;
  if (accountFlow === 'intake') redirect('/onboarding');
  if (accountFlow === 'evidence') redirect('/evidence-setup');
  let canAccessAdmin = false;
  try {
    const runtime = env as unknown as { DB?: D1Database; HARNESS_ADMIN_OWNER_EMAIL?: string };
    canAccessAdmin = !!(user && runtime.DB && await getAdminAccess(runtime.DB, user, runtime.HARNESS_ADMIN_OWNER_EMAIL));
  } catch { /* Admin availability must not prevent access to a personal workspace. */ }
  return <Workspace user={user ? { userId: user.userId, displayName: user.displayName, email: user.email } : null} forceSample={params.sample === '1'} canAccessAdmin={canAccessAdmin} showOverview={params.view === 'overview'} initialPage={params.view === 'evidence' ? 'evidence' : undefined} />;
}
