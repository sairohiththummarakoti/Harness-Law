import type { Metadata } from 'next';
import { env } from 'cloudflare:workers';
import { getAppUser } from '@/app/auth';
import { getAdminAccess } from '@/lib/admin/access';
import { BrandLogo } from '@/components/brand-logo';
import AdminDashboard from './admin-dashboard';
import styles from './access.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Admin portal · Harness Law', robots: { index: false, follow: false } };

export default async function AdminPage() {
  const user = await getAppUser();
  let unavailable = false;
  try {
    const runtime = env as unknown as { DB?: D1Database; HARNESS_ADMIN_OWNER_EMAIL?: string };
    if (!runtime.DB) throw new Error('Storage unavailable');
    const access = user ? await getAdminAccess(runtime.DB, user, runtime.HARNESS_ADMIN_OWNER_EMAIL) : null;
    if (access) return <AdminDashboard viewer={{ userId: user!.userId, email: user!.email, displayName: user!.displayName, role: access.role }} />;
  } catch { unavailable = true; }
  return <main className={styles.shell}>
    <a className={styles.brand} href="/"><BrandLogo inverse /></a>
    <section className={styles.card}>
      <span className={styles.eyebrow}>HARNESS LAW ADMIN</span>
      <h1>{unavailable ? 'The portal is temporarily unavailable.' : user ? 'This account does not have admin access.' : 'Sign in to continue.'}</h1>
      <p>{unavailable ? 'Please try again in a moment. Your personal workspace is still available.' : user ? 'Admin access is limited to the site owner and the accounts they authorize.' : 'Use your authorized account to open the admin portal.'}</p>
      <a href={user ? '/workspace' : '/signin'}>{user ? 'Return to workspace' : 'Sign in'}</a>
    </section>
  </main>;
}
