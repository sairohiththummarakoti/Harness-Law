import type { Metadata } from 'next';
import { getAppUser } from '../auth';
import Workspace from '../workspace';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your workspace · Harness Law' };

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ sample?: string }> }) {
  const [user, params] = await Promise.all([getAppUser(), searchParams]);
  return <Workspace user={user ? { userId: user.userId, displayName: user.displayName, email: user.email } : null} forceSample={params.sample === '1'} />;
}
