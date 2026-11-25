import AuthForm from '../auth-form';
import { Scale } from 'lucide-react';
import styles from '../entry.module.css';

export const metadata = { title: 'Verify your email · Harness Law' };

export default function VerifyEmail() {
  return (
    <div className={styles.entry}>
      <header className={styles.header}>
        <a className={styles.brand} href="/" aria-label="Harness Law home"><Scale size={28} /><span>Harness Law</span></a>
        <a className={styles.homeLink} href="/signin">Sign in</a>
      </header>
      <main className={styles.authLayout}>
        <section className={styles.authContent} aria-labelledby="verify-title">
          <div className={styles.cardHeading}>
            <h1 id="verify-title">Verify email</h1>
            <a href="/signin">Log in</a>
          </div>
          <p className={styles.intro}>
            Enter the 6-digit verification code sent to your email, or verify via the link you received. Links and codes expire after 10 minutes.
          </p>
          <AuthForm mode="verify" />
        </section>
      </main>
      <footer className={styles.footer}><span>Harness Law</span><span>Your story. Your next step.</span></footer>
    </div>
  );
}
