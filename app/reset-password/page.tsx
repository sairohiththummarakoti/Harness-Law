import AuthForm from "../auth-form";
import { BrandLogo } from "@/components/brand-logo";
import styles from "../entry.module.css";

export const dynamic = "force-dynamic";

export default function ResetPassword() {
  return (
    <div className={styles.entry}>
      <header className={styles.header}>
        <a className={styles.brand} href="/" aria-label="Harness Law home"><BrandLogo /></a>
        <a className={styles.homeLink} href="/signin">Sign in</a>
      </header>
      <main className={styles.authLayout}>
        <section className={styles.authContent} aria-labelledby="reset-title">
          <div className={styles.cardHeading}>
            <h1 id="reset-title">Choose password</h1>
            <a href="/signin">Back to sign in</a>
          </div>
          <p className={styles.intro}>
            Use the link or code from your reset email to choose a new password.
          </p>
          <AuthForm mode="reset" />
        </section>
      </main>
      <footer className={styles.footer}><span>© {new Date().getFullYear()} Harness Law</span><a href="/privacy">Privacy</a><a href="/terms">Terms</a></footer>
    </div>
  );
}
