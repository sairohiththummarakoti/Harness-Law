import type { Metadata } from 'next';
import { getChatGPTUser } from '../chatgpt-auth';
import Workspace from '../workspace';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your workspace · Harness Law' };

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ sample?: string }> }) {
  const [user, params] = await Promise.all([getChatGPTUser(), searchParams]);
  return <Workspace user={user ? { displayName: user.displayName, email: user.email } : null} forceSample={params.sample === '1'} />;
}
