"use client";

import { useEffect, useState } from "react";
import GoogleSignIn from "./google-signin";
import styles from "./entry.module.css";

interface OAuthProvidersProps {
  googleEnabled?: boolean;
}

export default function OAuthProviders({ googleEnabled }: OAuthProvidersProps) {
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const oauthNotice = params.get("oauth_notice");
      if (oauthNotice) {
        setNotice(oauthNotice);
      }
    }
  }, []);

  const handleProvider = (provider: string) => {
    window.location.href = `/api/auth/oauth/${provider}`;
  };

  return (
    <div className={styles.oauthContainer}>
      {notice && (
        <div className={styles.oauthNotice} role="alert">
          <p>{notice}</p>
          <button type="button" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      {googleEnabled ? (
        <div className={styles.googleContainer}>
          <GoogleSignIn />
        </div>
      ) : (
        <button
          type="button"
          className={styles.oauthBtn}
          onClick={() => handleProvider("google")}
          title="Sign in with Google"
        >
          <svg className={styles.oauthIcon} viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
          </svg>
          <span>Continue with Google</span>
        </button>
      )}

      <form action="/api/auth/chatgpt" method="post" target="_top" style={{ width: "100%" }}>
        <button className={styles.oauthBtnChatGPT} type="submit">
          <span className={styles.providerIcon} aria-hidden="true">✳</span>
          <span>Continue with ChatGPT</span>
        </button>
      </form>
    </div>
  );
}
