"use client";

import { useEffect, useState } from "react";
import GoogleSignIn from "./google-signin";
import styles from "./entry.module.css";

export default function OAuthProviders({ googleEnabled }: { googleEnabled?: boolean }) {
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { setNotice(new URLSearchParams(window.location.search).get("oauth_notice")); }, []);

  return <div className={styles.oauthContainer} aria-label="Sign-in options">
    {notice && <div className={styles.oauthNotice} role="alert"><p>{notice}</p><button type="button" onClick={() => setNotice(null)}>Dismiss</button></div>}
    {googleEnabled ? <GoogleSignIn /> : <a className={styles.oauthBtn} href="/api/auth/oauth/google">
      <svg className={styles.oauthIcon} viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
      </svg><span>Continue with Google</span>
    </a>}
    <a className={styles.oauthBtn} href="/api/auth/oauth/apple">
      <svg className={styles.oauthIcon} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.05 12.54c.03 3.06 2.69 4.08 2.72 4.09-.02.07-.43 1.46-1.4 2.9-.84 1.25-1.72 2.49-3.1 2.52-1.35.03-1.79-.81-3.34-.81s-2.03.79-3.31.84c-1.33.05-2.35-1.35-3.2-2.59-1.75-2.53-3.08-7.16-1.29-10.29.89-1.55 2.48-2.53 4.21-2.56 1.31-.02 2.55.89 3.35.89.8 0 2.3-1.11 3.88-.95.66.03 2.51.27 3.69 2.01-.1.06-2.21 1.29-2.19 3.95ZM14.5 4.88c.71-.86 1.19-2.05 1.06-3.24-1.02.04-2.26.68-2.99 1.54-.66.76-1.23 1.98-1.08 3.15 1.13.09 2.29-.58 3.01-1.45Z"/></svg>
      <span>Continue with Apple</span>
    </a>
    <a className={styles.oauthBtn} href="/api/auth/oauth/microsoft">
      <svg className={styles.oauthIcon} viewBox="0 0 24 24" aria-hidden="true"><path fill="#f25022" d="M1 1h10v10H1z"/><path fill="#7fba00" d="M13 1h10v10H13z"/><path fill="#00a4ef" d="M1 13h10v10H1z"/><path fill="#ffb900" d="M13 13h10v10H13z"/></svg>
      <span>Continue with Microsoft</span>
    </a>
    <form action="/api/auth/chatgpt" method="post" target="_top">
      <button className={styles.oauthBtn} type="submit">
        <svg className={styles.oauthIcon} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22.28 10.05a5.8 5.8 0 0 0-.5-4.76 5.88 5.88 0 0 0-6.33-2.82A5.8 5.8 0 0 0 11.08.5a5.88 5.88 0 0 0-5.6 4.06 5.8 5.8 0 0 0-3.86 2.82 5.88 5.88 0 0 0 .73 6.88 5.8 5.8 0 0 0 .5 4.76 5.88 5.88 0 0 0 6.33 2.82 5.8 5.8 0 0 0 4.37 1.97 5.88 5.88 0 0 0 5.6-4.06 5.8 5.8 0 0 0 3.86-2.82 5.88 5.88 0 0 0-.73-6.88ZM13.55 22.2a4.42 4.42 0 0 1-2.84-1.03l.14-.08 4.72-2.73a.77.77 0 0 0 .39-.67v-6.66l2 1.15v5.52a4.5 4.5 0 0 1-4.41 4.5ZM4.17 18.26a4.42 4.42 0 0 1-.53-2.98l.14.08 4.72 2.73a.77.77 0 0 0 .77 0l5.77-3.33v2.31l-4.78 2.76a4.5 4.5 0 0 1-6.09-1.57ZM2.94 8.14a4.42 4.42 0 0 1 2.32-1.95v5.62c0 .28.15.53.39.67l5.77 3.33-2 1.16-4.78-2.76a4.5 4.5 0 0 1-1.7-6.07Zm16.42 3.82-5.77-3.33 2-1.16 4.78 2.76a4.5 4.5 0 0 1-.61 8.02v-5.62a.77.77 0 0 0-.4-.67Zm1.99-2.99-.14-.08-4.72-2.73a.77.77 0 0 0-.77 0l-5.77 3.33V7.18l4.78-2.76a4.5 4.5 0 0 1 6.62 4.55ZM8.87 13.3l-2-1.15V6.63a4.5 4.5 0 0 1 7.25-3.47l-.14.08-4.72 2.73a.77.77 0 0 0-.39.67v6.66Zm1.53-.88v-2.65l2.3-1.33 2.3 1.33v2.65l-2.3 1.33-2.3-1.33Z"/></svg>
        <span>Continue with ChatGPT</span>
      </button>
    </form>
  </div>;
}
