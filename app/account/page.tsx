import { requireAppUser } from '../auth';
import AccountSettings from './settings';
import AccountDrives from './account-drives';
import OAuthDeleteAccount from './oauth-delete';
import { Scale } from 'lucide-react';
import styles from './account.module.css';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const user = await requireAppUser();

  return (
    <div className={styles.accountPage}>
      <header className={styles.header}>
        <a className={styles.brand} href="/" aria-label="Harness Law home">
          <Scale size={28} />
          <span>Harness Law</span>
        </a>
        <a className={styles.navLink} href="/workspace">Back to Workspace</a>
      </header>

      <main className={styles.container}>
        <div className={styles.headerBlock}>
          <h1>Account Management</h1>
          <div className={styles.userBadge}>
            <span>{user.email}</span>
            <span>•</span>
            <span style={{ textTransform: 'capitalize' }}>{user.provider} sign-in</span>
          </div>
        </div>

        <AccountDrives userId={user.userId} />

        {user.provider === 'password' ? (
          <AccountSettings email={user.email} />
        ) : (
          <>
            <div className={styles.card}>
              <h2>Managed by {user.provider}</h2>
              <p className={styles.cardDesc}>
                Your sign-in credentials and email address are managed through your {user.provider === 'google' ? 'Google' : 'ChatGPT'} account.
              </p>
            </div>
            <OAuthDeleteAccount provider={user.provider === 'google' ? 'Google' : 'ChatGPT'} />
          </>
        )}

        <div className={styles.signOutCard}>
          <div>
            <strong style={{ display: 'block', fontSize: 15, color: '#182f28' }}>Sign out</strong>
            <span style={{ fontSize: 13, color: '#55675c' }}>End your session on this device.</span>
          </div>
          <form action="/api/auth/logout" method="post">
            <button className={styles.btnSignOut}>Sign out</button>
          </form>
        </div>
      </main>
    </div>
  );
}
