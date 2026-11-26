import type { Metadata } from 'next';
import { BrandLogo } from '@/components/brand-logo';
import styles from '../admin/access.module.css';

export const metadata: Metadata = { title: 'Privacy & site analytics · Harness Law' };

export default function PrivacyPage() {
  return <main className={styles.shell}>
    <a className={styles.brand} href="/"><BrandLogo inverse /></a>
    <article className={styles.card}>
      <span className={styles.eyebrow}>YOUR INFORMATION</span>
      <h1>Privacy & site analytics</h1>
      <p>Your case information and uploaded evidence belong to your signed-in workspace.</p>
      <p>To understand how the site is used, Harness Law records page visits, activity times, browser and device categories, referring website names, and approximate country, region, or city when available. Signed-in activity is associated with your account name, email, and sign-in provider.</p>
      <p>These analytics are available only to the site owner and authorized admins. They do not include the contents of your case, uploaded documents, form answers, raw IP addresses, or precise location.</p>
      <p>Analytics reports cover up to 90 days. Older activity records are removed during routine site activity. The account directory retains first and most recent activity dates; admin access changes are kept in an audit log. Browser Do Not Track and Global Privacy Control signals disable analytics collection.</p>
      <a href="/">Return to Harness Law</a>
    </article>
  </main>;
}
