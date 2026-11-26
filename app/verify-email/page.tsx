import AuthForm from '../auth-form';
import { BrandLogo } from "@/components/brand-logo";
import styles from '../entry.module.css';

export const metadata = { title: 'Verify your email · Harness Law' };

export default function VerifyEmail() {
  return (
    <div className={styles.entry}>
      <header className={styles.header}>
        <a className={styles.brand} href="/" aria-label="Harness Law home"><BrandLogo /></a>
        <a className={styles.homeLink} href="/signin">Sign in</a>
      </header>
      <main className={styles.authLayout}>
        <section className={styles.authContent} aria-labelledby="verify-title">
          <div className={styles.cardHeading}>
            <h1 id="verify-title">Verify email</h1>
            <a href="/signin">Sign in</a>
          </div>
          <p className={styles.intro}>
            Use the verification link or code sent to your email to finish setting up your account.
          </p>
          <AuthForm mode="verify" />
        </section>
      </main>
      <footer className={styles.footer}><span>© {new Date().getFullYear()} Harness Law</span><a href="/privacy">Privacy</a><a href="/terms">Terms</a></footer>
    </div>
  );
}
