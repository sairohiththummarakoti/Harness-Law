import AuthForm from "../auth-form";
import { Scale } from "lucide-react";
import styles from "../entry.module.css";

export const dynamic = "force-dynamic";

export default function ForgotPassword() {
  return (
    <div className={styles.entry}>
      <header className={styles.header}>
        <a className={styles.brand} href="/" aria-label="Harness Law home"><Scale size={28} /><span>Harness Law</span></a>
        <a className={styles.homeLink} href="/signin">Sign in</a>
      </header>
      <main className={styles.authLayout}>
        <section className={styles.authContent} aria-labelledby="forgot-title">
          <div className={styles.cardHeading}>
            <h1 id="forgot-title">Reset password</h1>
            <a href="/signin">Back to log in</a>
          </div>
          <p className={styles.intro}>
            Enter your account email. We will send you a 6-digit verification code and reset link.
          </p>
          <AuthForm mode="forgot" />
        </section>
      </main>
      <footer className={styles.footer}><span>Harness Law</span><span>Your story. Your next step.</span></footer>
    </div>
  );
}
