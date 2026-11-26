import { Check } from "lucide-react";
import type { AppUser } from "./auth";
import styles from "./entry.module.css";
import AuthForm from "./auth-form";
import OAuthProviders from "./oauth-providers";
import { BrandLogo } from "@/components/brand-logo";

export default function AuthEntry({ user, mode = "signup", googleEnabled = false }: { user: AppUser | null; mode?: "signup" | "signin"; googleEnabled?: boolean }) {
  const signingIn = mode === "signin";
  return <div className={styles.entry}>
    <header className={styles.header}>
      <a className={styles.brand} href="/" aria-label="Harness Law home"><BrandLogo /></a>
      <a className={styles.homeLink} href="/">Back to home</a>
    </header>
    <main className={styles.authLayout}>
      <section className={styles.authContent} aria-labelledby="entry-title">
        <div className={styles.cardHeading}>
          <h1 id="entry-title">{user ? "Welcome back" : signingIn ? "Sign in" : "Sign up"}</h1>
          {!user && <a href={signingIn ? "/signup" : "/signin"}>{signingIn ? "Create an account" : "I have an account"}</a>}
        </div>
        {user ? <>
          <div className={styles.signedIn}><Check size={18} /><span>Signed in as <strong>{user.displayName}</strong></span></div>
          <a className={styles.primary} href="/onboarding">Continue to my workspace</a>
          <form action="/api/auth/logout" method="post" target="_top" className={styles.switchAccount}><button type="submit">Use another account</button></form>
        </> : <>
          <AuthForm key={mode} mode={mode} providers={<OAuthProviders googleEnabled={googleEnabled} />}
            legalNotice={<p className={styles.legalNote}>By continuing, you agree to Harness Law’s <a href="/terms">Terms of Service</a> and <a href="/privacy">Privacy Policy</a>.</p>} />
        </>}
      </section>
    </main>
    <footer className={styles.footer}><span>© {new Date().getFullYear()} Harness Law</span><a href="/privacy">Privacy</a><a href="/terms">Terms</a></footer>
  </div>;
}
