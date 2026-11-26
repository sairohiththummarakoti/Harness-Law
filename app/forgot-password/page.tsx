import AuthForm from "../auth-form";
import { BrandLogo } from "@/components/brand-logo";
import styles from "../entry.module.css";

export const dynamic = "force-dynamic";

export default function ForgotPassword() {
  return (
    <div className={styles.entry}>
      <header className={styles.header}>
        <a className={styles.brand} href="/" aria-label="Harness Law home"><BrandLogo /></a>
        <a className={styles.homeLink} href="/signin">Sign in</a>
      </header>
      <main className={styles.authLayout}>
        <section className={styles.authContent} aria-labelledby="forgot-title">
          <div className={styles.cardHeading}>
            <h1 id="forgot-title">Reset password</h1>
            <a href="/signin">Back to sign in</a>
          </div>
          <p className={styles.intro}>
            Enter your account email to receive password reset instructions.
          </p>
          <AuthForm mode="forgot" />
        </section>
      </main>
      <footer className={styles.footer}><span>© {new Date().getFullYear()} Harness Law</span><a href="/privacy">Privacy</a><a href="/terms">Terms</a></footer>
    </div>
  );
}
