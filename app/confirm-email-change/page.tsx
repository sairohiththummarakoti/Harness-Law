import AuthForm from '../auth-form';
import { Scale } from 'lucide-react';
import styles from '../entry.module.css';

export const metadata = { title: 'Confirm email change · Harness Law' };

export default function ConfirmEmailChange() {
  return (
    <div className={styles.entry}>
      <header className={styles.header}>
        <a className={styles.brand} href="/" aria-label="Harness Law home"><Scale size={28} /><span>Harness Law</span></a>
        <a className={styles.homeLink} href="/account">Account</a>
      </header>
      <main className={styles.authLayout}>
        <section className={styles.authContent} aria-labelledby="confirm-title">
          <div className={styles.cardHeading}>
            <h1 id="confirm-title">Confirm new email</h1>
            <a href="/account">Account</a>
          </div>
          <p className={styles.intro}>
            Review and confirm your new email address. Once confirmed, you will use it to log in.
          </p>
          <AuthForm mode="email-change" />
        </section>
      </main>
      <footer className={styles.footer}><span>Harness Law</span><span>Your story. Your next step.</span></footer>
    </div>
  );
}
