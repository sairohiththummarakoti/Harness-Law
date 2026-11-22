import { Check, FileText, FolderOpen, Scale, ShieldCheck } from "lucide-react";
import type { AppUser } from "./auth";
import GoogleSignIn from "./google-signin";
import styles from "./entry.module.css";

export default function AuthEntry({ user, mode = "signup", googleEnabled = false }: { user: AppUser | null; mode?: "signup" | "signin"; googleEnabled?: boolean }) {
  const signingIn = mode === "signin";
  return <div className={styles.entry}>
    <header className={styles.header}>
      <a className={styles.brand} href="/" aria-label="Harness Law home"><Scale size={28} /><span>Harness Law</span></a>
      <div className={styles.headerAlternative}>{signingIn ? "New to Harness Law?" : "Already have a workspace?"} <a href={signingIn ? "/signup" : "/signin"}>{signingIn ? "Get started" : "Log in"}</a></div>
    </header>
    <main className={styles.authLayout}>
      <section className={styles.authContent} aria-labelledby="entry-title">
        <span className={styles.eyebrow}>{signingIn ? "WELCOME BACK" : "A CLEARER WAY TO PREPARE"}</span>
        <h1 id="entry-title">{user ? "Your next chapter starts here." : signingIn ? "Pick up where you left off." : "Bring your talent. Build your story."}</h1>
        <p className={styles.intro}>Your own space to organize EB-1A evidence, develop your narrative, and review a working draft.</p>
        {user && <div className={styles.signedIn}><Check size={18} /><span>Signed in {user.provider === "google" ? "with Google" : "with ChatGPT"} as <strong>{user.displayName}</strong></span></div>}
        {googleEnabled && user?.provider !== "google" && <>
          <GoogleSignIn />
          <p className={styles.providerNote}>Use your Google account to {signingIn ? "return to" : "create"} your workspace. No Gmail inbox access is requested.</p>
          <div className={styles.providerDivider}><span>{user ? "Or return to your current workspace" : "Or"}</span></div>
        </>}
        {user ? <a className={styles.primary} href="/onboarding">{googleEnabled && user.provider === "chatgpt" ? "Continue to your ChatGPT workspace" : "Continue to your workspace"}</a> : <>
          <form action="/api/auth/chatgpt" method="post" target="_top"><button className={googleEnabled ? `${styles.secondary} ${styles.providerAlternative}` : styles.primary} type="submit"><span className={styles.providerIcon} aria-hidden="true">✳</span>Continue with ChatGPT</button></form>
          {!googleEnabled && <p className={styles.authNote}>Use your ChatGPT account to securely {signingIn ? "return to" : "create"} your private workspace.</p>}
        </>}
        {user?.provider === "google" && <form action="/api/auth/logout" method="post" target="_top" className={styles.switchAccount}><button type="submit">Use another account</button></form>}
        {googleEnabled && user?.provider !== "google" && <p className={styles.providerNote}>Google and ChatGPT sign-ins have separate workspaces. Use the same sign-in method each time.</p>}
        <div className={styles.divider}><span>Or take a look first</span></div>
        <a className={styles.secondary} href="/workspace?sample=1"><FolderOpen size={18} />Explore the fictional sample</a>
        <p className={styles.smallNote}>No account needed to explore. Sample people, documents, and claims are fictional.</p>
      </section>
      <aside className={styles.authAside}>
        <div className={styles.asideHeading}><span className={styles.eyebrow}>FROM EXPERIENCE TO EVIDENCE</span><h2>A little structure.<br />A clearer next step.</h2></div>
        <div className={styles.preview}>
          <div className={styles.previewBar}><span className={styles.previewLogo}><Scale size={17} />Harness Law</span><span className={styles.previewBadge}>Workspace preview</span></div>
          <div className={styles.previewBody}><span className={styles.previewIcon}><FileText size={25} /></span><h3>My EB-1A preparation</h3><p>One place for the work ahead.</p>
            <ul className={styles.previewList}>
              <li><span>01</span><div><strong>Your professional profile</strong><small>The experience that tells your story</small></div></li>
              <li><span>02</span><div><strong>Your evidence, organized</strong><small>Documents connected to criteria</small></div></li>
              <li><span>03</span><div><strong>Your working draft</strong><small>Wording, sources, and review together</small></div></li>
            </ul>
          </div>
        </div>
        <p className={styles.asideNote}><ShieldCheck size={20} /><span>Your personal case is tied to your signed-in account. The sample stays separate.</span></p>
      </aside>
    </main>
    <footer className={styles.footer}><span>Harness Law</span><span>Built for thoughtful EB-1A preparation.</span></footer>
  </div>;
}
