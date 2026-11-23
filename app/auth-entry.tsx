import { Check, CheckCircle2, FileText, FolderOpen, Scale, ShieldCheck } from "lucide-react";
import type { AppUser } from "./auth";
import GoogleSignIn from "./google-signin";
import styles from "./entry.module.css";

export default function AuthEntry({ user, mode = "signup", googleEnabled = false }: { user: AppUser | null; mode?: "signup" | "signin"; googleEnabled?: boolean }) {
  const signingIn = mode === "signin";
  return <div className={styles.entry}>
    <header className={styles.header}>
      <a className={styles.brand} href="/" aria-label="Harness Law home"><Scale size={28} /><span>Harness Law</span></a>
      <a className={styles.homeLink} href="/">Back to home</a>
    </header>
    <main className={styles.authLayout}>
      <div className={styles.backdrop} aria-hidden="true">
        <div className={styles.backdropNav}><Scale size={25} /> Harness Law <span>Your immigration journey</span></div>
        <div className={styles.backdropContent}><h2>Your next chapter<br />starts with a clear plan.</h2><div className={styles.backdropCards}><div><FileText size={30} /><strong>Your background</strong><p>A place for your story.</p></div><div><CheckCircle2 size={30} /><strong>Your preparation</strong><p>One step at a time.</p></div><div><FolderOpen size={30} /><strong>Your evidence</strong><p>Everything together.</p></div></div></div>
      </div>
      <section className={styles.authContent} aria-labelledby="entry-title">
        <div className={styles.cardHeading}><h1 id="entry-title">{signingIn ? "Log in" : "Sign up"}</h1><a href={signingIn ? "/signup" : "/signin"}>{signingIn ? "Create an account" : "I have an account"}</a></div>
        <p className={styles.intro}>{signingIn ? "Welcome back. Continue your saved immigration intake and preparation." : "A few questions. A clearer starting point for your immigration journey."}</p>
        {user && <div className={styles.signedIn}><Check size={18} /><span>Signed in {user.provider === "google" ? "with Google" : "with ChatGPT"} as <strong>{user.displayName}</strong></span></div>}
        {googleEnabled && user?.provider !== "google" && <>
          <GoogleSignIn />
          <div className={styles.providerDivider}><span>{user ? "Or use your current account" : "Or"}</span></div>
        </>}
        {user ? <a className={styles.primary} href="/onboarding">{googleEnabled && user.provider === "chatgpt" ? "Continue with my ChatGPT account" : signingIn ? "Continue to my portal" : "Let’s get started"}</a> : <>
          <form action="/api/auth/chatgpt" method="post" target="_top"><button className={googleEnabled ? [styles.secondary, styles.providerAlternative].join(" ") : styles.primary} type="submit"><span className={styles.providerIcon} aria-hidden="true">✳</span>Continue with ChatGPT</button></form>
          {!googleEnabled && <p className={styles.authNote}>Create your account using ChatGPT to save your answers.</p>}
        </>}
        {user?.provider === "google" && <form action="/api/auth/logout" method="post" target="_top" className={styles.switchAccount}><button type="submit">Use another account</button></form>}
        {googleEnabled && user?.provider !== "google" && <p className={styles.providerNote}>Google and ChatGPT sign-ins have separate workspaces. Use the same method each time.</p>}
        <div className={styles.whatNext}><span>AFTER YOU SIGN UP</span><p>Tell us about your visa plans, your background, and the evidence you may have.</p><div><ShieldCheck size={17} /><span>Your progress is saved to your account.</span></div></div>
        <div className={styles.divider}><span>Take a look first</span></div>
        <a className={styles.sampleLink} href="/workspace?sample=1"><FolderOpen size={17} />Explore the EB-1A sample</a>
        <p className={styles.smallNote}>No account needed. All sample people and documents are fictional.</p>
      </section>
    </main>
    <footer className={styles.footer}><span>Harness Law</span><span>Your story. Your next step.</span></footer>
  </div>;
}

