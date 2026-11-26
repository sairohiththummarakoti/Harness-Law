import type { Metadata } from 'next';
import { getAppUser } from '../auth';
import Workspace from '../workspace';
import { env } from 'cloudflare:workers';
import { getAdminAccess } from '@/lib/admin/access';
import { redirect } from 'next/navigation';
import { needsFirstIntake } from '@/lib/intake-entry';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your workspace · Harness Law' };

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ sample?: string; view?: string }> }) {
  const [user, params] = await Promise.all([getAppUser(), searchParams]);
  let firstIntake = false;
  if (user && params.sample !== '1') {
    try { firstIntake = !!env.DB && await needsFirstIntake(env.DB, user.userId); }
    catch { /* Let the workspace show its normal retryable storage error. Never infer a new account from a failed read. */ }
  }
  if (firstIntake) redirect('/onboarding');
  let canAccessAdmin = false;
  try {
    const runtime = env as unknown as { DB?: D1Database; HARNESS_ADMIN_OWNER_EMAIL?: string };
    canAccessAdmin = !!(user && runtime.DB && await getAdminAccess(runtime.DB, user, runtime.HARNESS_ADMIN_OWNER_EMAIL));
  } catch { /* Admin availability must not prevent access to a personal workspace. */ }
  return <Workspace user={user ? { userId: user.userId, displayName: user.displayName, email: user.email } : null} forceSample={params.sample === '1'} canAccessAdmin={canAccessAdmin} showOverview={params.view === 'overview'} />;
}
