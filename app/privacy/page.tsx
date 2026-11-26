import type { Metadata } from 'next';
import { BrandLogo } from '@/components/brand-logo';
import styles from '../admin/access.module.css';

export const metadata: Metadata = { title: 'Privacy Policy & Site Analytics · Harness Law' };

export default function PrivacyPage() {
  return <main className={styles.shell}>
    <a className={styles.brand} href="/"><BrandLogo inverse /></a>
    <article className={styles.card}>
      <span className={styles.eyebrow}>YOUR INFORMATION</span>
      <h1>Privacy &amp; site analytics</h1>
      <p>Your case information and uploaded evidence belong to your signed-in workspace.</p>
      <p>To understand how the site is used, Harness Law records page visits, activity times, browser and device categories, referring website names, and approximate country, region, or city when available. Signed-in activity is associated with your account name, email, and sign-in provider.</p>
      <p>These analytics are available only to the site owner and authorized admins. They do not include the contents of your case, uploaded documents, form answers, raw IP addresses, or precise location.</p>
      <p>Analytics reports cover up to 90 days. Older activity records are removed during routine site activity. The account directory retains first and most recent activity dates; admin access changes are kept in an audit log. Browser Do Not Track and Global Privacy Control signals disable analytics collection.</p>
      <h2>Account &amp; workspace information</h2>
      <p><strong>Draft for owner and legal review before production use.</strong></p>
      <p>Account information may include your name, email address, password hash, and sign-in/session records. Workspace information may include intake answers, case details, and files you choose to upload.</p>
      <p>Information is used to provide account access and the preparation workspace. The application stores account and case records in Cloudflare D1 and uploaded files in configured object storage. Authentication emails are sent through the email service configured by the application.</p>
      <p>If you choose Google or ChatGPT sign-in, those providers process sign-in information under their own privacy terms. Harness Law does not request Gmail mailbox access.</p>
      <p>Uploaded evidence may remain quarantined when scanning and extraction are unavailable. Do not upload sensitive material until you understand the current processing configuration and have agreed to the final policy.</p>
      <p>Account deletion is intended to remove the account and associated workspace data, subject to applicable backups and provider retention. Before launch, the owner must specify retention periods, backup deletion timing, legal basis, user rights and request channel, subprocessors, jurisdiction, and effective date.</p>
      <a href="/">Return to Harness Law</a>
    </article>
  </main>;
}
