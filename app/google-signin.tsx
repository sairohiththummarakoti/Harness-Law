"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./entry.module.css";

type GoogleCredential = { credential?: string };
type GoogleIdentity = {
  initialize(options: {
    client_id: string;
    nonce: string;
    callback: (response: GoogleCredential) => void;
    auto_select: false;
    ux_mode: "popup";
  }): void;
  renderButton(element: HTMLElement, options: {
    type: "standard";
    theme: "outline";
    size: "large";
    text: "continue_with";
    shape: "rectangular";
    width: number;
  }): void;
};

declare global {
  interface Window { google?: { accounts?: { id?: GoogleIdentity } } }
}

const SCRIPT_ID = "harness-google-identity";
const TIMEOUT_MS = 15_000;
let scriptPromise: Promise<GoogleIdentity> | undefined;
let challengePromise: Promise<Record<string, unknown>> | undefined;

function loadGoogle(): Promise<GoogleIdentity> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<GoogleIdentity>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing || document.createElement("script");
    let timeout: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timeout);
      script.removeEventListener("load", loaded);
      script.removeEventListener("error", failed);
    };
    const loaded = () => {
      const google = window.google?.accounts?.id;
      if (!google) { failed(); return; }
      cleanup();
      resolve(google);
    };
    const failed = () => {
      cleanup();
      script.remove();
      reject(new Error("google_script_unavailable"));
    };
    script.addEventListener("load", loaded);
    script.addEventListener("error", failed);
    timeout = setTimeout(failed, TIMEOUT_MS);
    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }).catch((error: unknown) => { scriptPromise = undefined; throw error; });
  return scriptPromise;
}

async function authRequest(controller: AbortController, body?: { credential: string; nonce: string }) {
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch("/api/auth/google", {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(response.status === 503 ? "google_unavailable" : "google_signin_failed");
    return await response.json() as Record<string, unknown>;
  } finally { clearTimeout(timeout); }
}

function loadChallenge(): Promise<Record<string, unknown>> {
  // Strict Mode can remount before a response sets its nonce cookie. Share only
  // the pending request so those mounts cannot race different cookie values.
  // Its own timeout bounds it; an individual unmount must not abort this request.
  if (!challengePromise) {
    challengePromise = authRequest(new AbortController()).finally(() => {
      challengePromise = undefined;
    });
  }
  return challengePromise;
}

export default function GoogleSignIn() {
  const button = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "signing-in" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let submitting = false;
    let failed = false;
    let resize: ResizeObserver | undefined;
    const controllers = new Set<AbortController>();
    const controller = () => { const value = new AbortController(); controllers.add(value); return value; };
    const fail = (cause: unknown) => {
      if (!active) return;
      failed = true;
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "google_script_unavailable"
        ? "Google sign-in couldn’t load. Check your connection or browser settings, then try again."
        : code === "google_unavailable"
          ? "Google sign-in is temporarily unavailable. Please try again shortly."
          : "Google sign-in wasn’t completed. Please try again.");
      setStatus("error");
      button.current?.replaceChildren();
    };
    const prepare = async () => {
      setStatus("loading");
      setError("");
      try {
        const [google, challenge] = await Promise.all([loadGoogle(), loadChallenge()]);
        if (!active || !button.current) return;
        if (typeof challenge.clientId !== "string" || typeof challenge.nonce !== "string") throw new Error("google_signin_failed");
        google.initialize({
          client_id: challenge.clientId,
          nonce: challenge.nonce,
          auto_select: false,
          ux_mode: "popup",
          callback: (response) => {
            if (!active || failed || submitting) return;
            if (!response.credential) { fail(new Error("google_signin_failed")); return; }
            submitting = true;
            setStatus("signing-in");
            void authRequest(controller(), { credential: response.credential, nonce: challenge.nonce as string }).then((result) => {
              if (!active) return;
              // The destination is fixed rather than accepting an arbitrary URL.
              if (result.redirectTo !== "/onboarding") throw new Error("google_signin_failed");
              window.location.assign("/onboarding");
            }).catch(fail);
          },
        });
        let previousWidth = 0;
        const render = () => {
          const element = button.current;
          if (!active || failed || !element || submitting) return;
          const width = Math.min(400, Math.floor(element.clientWidth));
          if (width < 200 || width === previousWidth) return;
          previousWidth = width;
          element.replaceChildren();
          google.renderButton(element, { type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "rectangular", width });
        };
        render();
        resize = new ResizeObserver(render);
        resize.observe(button.current);
        setStatus("ready");
      } catch (cause) { fail(cause); }
    };
    void prepare();
    return () => {
      active = false;
      for (const request of controllers) request.abort();
      resize?.disconnect();
      button.current?.replaceChildren();
    };
  }, [attempt]);

  return <div className={styles.googleSignIn} aria-busy={status === "loading" || status === "signing-in"}>
    <div ref={button} className={`${styles.googleButton} ${status === "signing-in" ? styles.googleButtonBusy : ""}`} />
    {(status === "loading" || status === "signing-in") && <p className={styles.providerStatus} role="status">{status === "loading" ? "Loading Google sign-in…" : "Signing you in…"}</p>}
    {status === "error" && <div className={styles.providerError}>
      <p role="alert">{error}</p>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '12px', flexWrap: 'wrap' }}>
        <button className={styles.providerRetry} type="button" onClick={() => setAttempt((value) => value + 1)}>Retry Google One-Tap</button>
        <a className={styles.providerRetry} href="/api/auth/oauth/google" style={{ textDecoration: 'none' }}>Sign in with Google OAuth</a>
      </div>
    </div>}
  </div>;
}
