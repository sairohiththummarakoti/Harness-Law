import { Check, FolderOpen, ShieldCheck } from "lucide-react";
import type { AppUser } from "./auth";
import styles from "./entry.module.css";
import AuthForm from "./auth-form";
import OAuthProviders from "./oauth-providers";
import { BrandLogo } from "@/components/brand-logo";

export default function AuthEntry({ user, mode = "signup", googleEnabled = false }: { user: AppUser | null; mode?: "signup" | "signin"; googleEnabled?: boolean }) {
  const signingIn = mode === "signin";
  return <div className={styles.entry}>
    <header className={styles.header}>
      <a className={styles.brand} href="/" aria-label="Harness Law home"><BrandLogo inverse /></a>
      <a className={styles.homeLink} href="/">Back to home</a>
    </header>
    <main className={styles.authLayout}>
      <aside className={styles.storyPanel} aria-label="Your immigration journey">
        <img className={styles.storyArtwork} src="/images/harness-horizon.webp" alt="" width="1254" height="1254" />
        <div className={styles.storyCopy}><p className={styles.eyebrow}>YOUR IMMIGRATION JOURNEY</p><h2>Your next chapter.<br /><span>A clearer beginning.</span></h2><p>Your background, your preparation, and your evidence. Together in one thoughtful workspace.</p></div>
        <p className={styles.storyFoot}>YOUR EXPERIENCE. YOUR EVIDENCE. YOUR STORY.</p>
      </aside>
      <section className={styles.authContent} aria-labelledby="entry-title">
        <div className={styles.cardHeading}><h1 id="entry-title">{signingIn ? "Log in" : "Sign up"}</h1><a href={signingIn ? "/signup" : "/signin"}>{signingIn ? "Create an account" : "I have an account"}</a></div>
        <p className={styles.intro}>{signingIn ? "Welcome back. Continue your saved immigration intake and preparation." : "A few questions. A clearer starting point for your immigration journey."}</p>
        <AuthForm mode={signingIn?"signin":"signup"} />
        <div className={styles.providerDivider}><span>Or continue with OAuth</span></div>
        {user && <div className={styles.signedIn}><Check size={18} /><span>Signed in {user.provider === "google" ? "with Google" : user.provider === "password" ? "with email" : "with ChatGPT"} as <strong>{user.displayName}</strong></span></div>}
        {user ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <a className={styles.primary} href="/onboarding">{signingIn ? "Continue to my portal" : "Let’s get started"}</a>
            <form action="/api/auth/logout" method="post" target="_top" className={styles.switchAccount}><button type="submit">Use another account</button></form>
          </div>
        ) : (
          <OAuthProviders googleEnabled={googleEnabled} />
        )}
        <div className={styles.whatNext}><span>AFTER YOU SIGN UP</span><p>Tell us about your visa plans, your background, and the evidence you may have.</p><div><ShieldCheck size={17} /><span>Your progress is saved to your account.</span></div></div>
        <div className={styles.divider}><span>Take a look first</span></div>
        <a className={styles.sampleLink} href="/workspace?sample=1"><FolderOpen size={17} />Explore the EB-1A sample</a>
        <p className={styles.smallNote}>No account needed. All sample people and documents are fictional.</p>
      </section>
    </main>
    <footer className={styles.footer}><BrandLogo className={styles.footerBrand} /><span>Your story. Your next step.</span></footer>
  </div>;
}

