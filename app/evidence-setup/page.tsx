import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { env } from 'cloudflare:workers';
import { getAppUser } from '../auth';
import { getAccountFlow } from '@/lib/intake-entry';
import Workspace from '../workspace';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Add your evidence · Harness Law' };

export default async function EvidenceSetupPage() {
  const user = await getAppUser();
  if (!user) redirect('/signin');
  if (!env.DB) return <main className="panel" style={{ margin: '48px auto', maxWidth: 640, padding: 32 }}><h1>Your workspace is temporarily unavailable.</h1><p>Your saved information is unchanged.</p><a href="/evidence-setup" className="button primary">Try again</a></main>;
  const flow = await getAccountFlow(env.DB, user.userId);
  if (flow === 'intake') redirect('/onboarding');
  if (flow === 'workspace') redirect('/workspace?view=overview');
  return <Workspace user={{ userId: user.userId, displayName: user.displayName, email: user.email }} evidenceSetup initialPage="evidence" />;
}
