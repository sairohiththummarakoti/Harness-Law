import AuthForm from "../auth-form";
import { Scale } from "lucide-react";
import styles from "../entry.module.css";

export const dynamic = "force-dynamic";

export default function ResetPassword() {
  return (
    <div className={styles.entry}>
      <header className={styles.header}>
        <a className={styles.brand} href="/" aria-label="Harness Law home"><Scale size={28} /><span>Harness Law</span></a>
        <a className={styles.homeLink} href="/signin">Sign in</a>
      </header>
      <main className={styles.authLayout}>
        <section className={styles.authContent} aria-labelledby="reset-title">
          <div className={styles.cardHeading}>
            <h1 id="reset-title">Choose password</h1>
            <a href="/signin">Back to log in</a>
          </div>
          <p className={styles.intro}>
            Enter your 6-digit reset code or link token, and choose a new password of at least 8 characters.
          </p>
          <AuthForm mode="reset" />
        </section>
      </main>
      <footer className={styles.footer}><span>Harness Law</span><span>Your story. Your next step.</span></footer>
    </div>
  );
}
