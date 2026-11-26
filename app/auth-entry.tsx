import { Check } from "lucide-react";
import type { AppUser } from "./auth";
import styles from "./entry.module.css";
import AuthForm from "./auth-form";
import OAuthProviders from "./oauth-providers";
import { BrandLogo } from "@/components/brand-logo";
import { accountGreeting } from "@/lib/account-greeting";

export default function AuthEntry({ user, mode = "signup", googleEnabled = false }: { user: AppUser | null; mode?: "signup" | "signin"; googleEnabled?: boolean }) {
  const signingIn = mode === "signin";
  return <div className={`${styles.entry} ${styles.splitEntry}`}>
    <aside className={styles.authStory} aria-labelledby="auth-story-title">
      <a className={styles.storyBrand} href="/" aria-label="Harness Law home"><BrandLogo inverse /></a>
      <img className={styles.storyArtwork} src="/images/harness-horizon.webp" alt="" width={1254} height={1254} />
      <div className={styles.storyCopy}>
        <p className={styles.storyEyebrow}>YOUR NEXT CHAPTER</p>
        <h2 id="auth-story-title">Build with<br /><span>confidence.</span></h2>
        <p>Bring your experience, achievements, and evidence together. Take the next step toward a case that tells your story.</p>
      </div>
      <p className={styles.storyFoot}>Build. Evaluate. Improve. Prepare.</p>
    </aside>
    <div className={styles.authSide}>
    <header className={styles.header}>
      <a className={styles.homeLink} href="/">Back to home</a>
    </header>
    <main className={styles.authLayout}>
      <section className={styles.authContent} aria-labelledby="entry-title">
        <div className={styles.cardHeading}>
          <h1 id="entry-title">{user ? accountGreeting(user.fullName || user.displayName) : signingIn ? "Sign in" : "Sign up"}</h1>
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
    </div>
  </div>;
}
