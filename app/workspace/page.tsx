import type { Metadata } from 'next';
import { getAppUser } from '../auth';
import Workspace from '../workspace';
import { env } from 'cloudflare:workers';
import { getAdminAccess } from '@/lib/admin/access';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your workspace · Harness Law' };

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ sample?: string }> }) {
  const [user, params] = await Promise.all([getAppUser(), searchParams]);
  let canAccessAdmin = false;
  try {
    const runtime = env as unknown as { DB?: D1Database; HARNESS_ADMIN_OWNER_EMAIL?: string };
    canAccessAdmin = !!(user && runtime.DB && await getAdminAccess(runtime.DB, user, runtime.HARNESS_ADMIN_OWNER_EMAIL));
  } catch { /* Admin availability must not prevent access to a personal workspace. */ }
  return <Workspace user={user ? { userId: user.userId, displayName: user.displayName, email: user.email } : null} forceSample={params.sample === '1'} canAccessAdmin={canAccessAdmin} />;
}
