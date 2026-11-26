"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import styles from "./entry.module.css";

type AuthMode = "signup" | "signin" | "forgot" | "reset" | "verify" | "email-change";
type CaptchaConfig =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; enabled: boolean; siteKey: string };
type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

function turnstile() {
  return (window as unknown as { turnstile?: Turnstile }).turnstile;
}

export default function AuthForm({ mode, providers, legalNotice }: { mode: AuthMode; providers?: ReactNode; legalNotice?: ReactNode }) {
  const passwordId = useId();
  const [step, setStep] = useState<"email" | "details">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [message, setMessage] = useState("");
  const [show, setShow] = useState(false);
  const [testOnlyLink, setTestOnlyLink] = useState("");
  const [enteredEmail, setEnteredEmail] = useState("");
  const [typedPassword, setTypedPassword] = useState("");
  const [signupComplete, setSignupComplete] = useState(false);
  const [tokenPrefilled, setTokenPrefilled] = useState(false);
  const [tokenValue, setTokenValue] = useState("");
  const [captchaConfig, setCaptchaConfig] = useState<CaptchaConfig>({ status: "loading" });
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaError, setCaptchaError] = useState("");
  const [captchaStatus, setCaptchaStatus] = useState("Loading security verification…");
  const [captchaAttempt, setCaptchaAttempt] = useState(0);
  const captcha = useRef<HTMLDivElement>(null);
  const captchaId = useRef<string | undefined>(undefined);
  const emailInput = useRef<HTMLInputElement>(null);
  const firstDetail = useRef<HTMLInputElement>(null);

  const progressive = mode === "signup" || mode === "signin";
  const emailStep = progressive && step === "email";
  const captchaRequired = ["signup", "signin", "forgot", "reset"].includes(mode) && !emailStep;
  const captchaBlocked = captchaRequired && (
    captchaConfig.status !== "ready" || (captchaConfig.enabled && !captchaToken)
  );
  const showPassword = !emailStep && !signupComplete && ["signup", "signin", "reset"].includes(mode);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const detected = params.get("token") || params.get("oobCode") ||
      new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    if (detected) {
      setTokenValue(detected);
      setTokenPrefilled(true);
    }
  }, [mode]);

  useEffect(() => {
    if (progressive && step === "details") firstDetail.current?.focus();
  }, [progressive, step]);

  useEffect(() => {
    if (!captchaRequired) return;
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    setCaptchaConfig({ status: "loading" });
    setCaptchaToken("");
    setCaptchaError("");
    setCaptchaStatus("Loading security verification…");

    async function loadConfig() {
      try {
        const response = await fetch("/api/auth/email/captcha", {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Unable to load security verification.");
        const config = await response.json() as { enabled?: boolean; siteKey?: string | null };
        if (typeof config.enabled !== "boolean") throw new Error("Unable to load security verification.");
        const siteKey = typeof config.siteKey === "string" ? config.siteKey.trim() : "";
        if (!active) return;
        if (config.enabled && !siteKey) {
          setCaptchaConfig({ status: "error", message: "Security verification is temporarily unavailable. Please try again." });
        } else {
          setCaptchaConfig({ status: "ready", enabled: config.enabled, siteKey });
        }
      } catch {
        if (active) setCaptchaConfig({ status: "error", message: "We couldn’t load the security check. Check your connection and try again." });
      } finally {
        window.clearTimeout(timeout);
      }
    }

    void loadConfig();
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [captchaRequired, captchaAttempt]);

  useEffect(() => {
    if (!captchaRequired || captchaConfig.status !== "ready" || !captchaConfig.enabled || !captcha.current) return;
    const container = captcha.current;
    const widgetSize = container.getBoundingClientRect().width < 300 ? "compact" : "normal";
    let active = true;
    let widgetId: string | undefined;
    let poll: number | undefined;
    let rendered = false;
    let script = document.querySelector<HTMLScriptElement>("script[data-turnstile]");
    if (script?.dataset.loadFailed === "true" && !turnstile()) {
      script.remove();
      script = null;
    }

    const fail = () => {
      if (!active) return;
      setCaptchaToken("");
      setCaptchaError("Security verification couldn’t load. Please try again.");
      window.clearTimeout(poll);
    };
    const scriptFailed = () => {
      if (script) script.dataset.loadFailed = "true";
      fail();
    };
    const timeout = window.setTimeout(() => {
      if (!rendered) scriptFailed();
    }, 15000);
    const render = () => {
      if (!active || rendered) return;
      const api = turnstile();
      if (!api) {
        poll = window.setTimeout(render, 100);
        return;
      }
      window.clearTimeout(timeout);
      try {
        rendered = true;
        widgetId = api.render(container, {
          sitekey: captchaConfig.siteKey,
          size: widgetSize,
          callback: (token: string) => {
            if (!active) return;
            setCaptchaToken(token);
            setCaptchaError("");
            setCaptchaStatus("Security check complete.");
          },
          "expired-callback": () => {
            if (!active) return;
            setCaptchaToken("");
            setCaptchaStatus("Your security check expired. Complete it again to continue.");
            if (widgetId) {
              try { api.reset(widgetId); } catch { fail(); }
            }
          },
          "error-callback": fail,
        });
        captchaId.current = widgetId;
        setCaptchaStatus("Complete the security check to continue.");
      } catch {
        fail();
      }
    };

    if (!script && !turnstile()) {
      script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset.turnstile = "1";
      script.addEventListener("error", scriptFailed);
      document.head.appendChild(script);
    } else {
      script?.addEventListener("error", scriptFailed);
    }
    render();

    const resizeObserver = new ResizeObserver(() => {
      if (!active) return;
      const nextSize = container.getBoundingClientRect().width < 300 ? "compact" : "normal";
      if (nextSize !== widgetSize) {
        active = false;
        resizeObserver.disconnect();
        setCaptchaToken("");
        setCaptchaAttempt(attempt => attempt + 1);
      }
    });
    resizeObserver.observe(container);

    return () => {
      active = false;
      resizeObserver.disconnect();
      window.clearTimeout(poll);
      window.clearTimeout(timeout);
      script?.removeEventListener("error", scriptFailed);
      if (widgetId) {
        try { turnstile()?.remove(widgetId); } catch { /* The provider may already have removed it. */ }
        if (captchaId.current === widgetId) captchaId.current = undefined;
      }
    };
  }, [captchaRequired, captchaConfig]);

  function clearFeedback() {
    setError("");
    setErrorCode("");
    setMessage("");
    setTestOnlyLink("");
  }

  function resetCaptcha() {
    setCaptchaToken("");
    if (captchaId.current) {
      setCaptchaStatus("Complete the security check to continue.");
      try { turnstile()?.reset(captchaId.current); } catch {
        setCaptchaError("Security verification couldn’t restart. Please try again.");
      }
    }
  }

  function changeEmail() {
    clearFeedback();
    setTypedPassword("");
    setShow(false);
    setCaptchaToken("");
    setCaptchaConfig({ status: "loading" });
    setStep("email");
    window.requestAnimationFrame(() => emailInput.current?.focus());
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (emailStep) {
      const value = new FormData(event.currentTarget).get("email");
      const email = typeof value === "string" ? value.trim() : "";
      if (email.length > 320 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(email)) {
        setError("Enter a valid email address.");
        emailInput.current?.focus();
        return;
      }
      setEnteredEmail(email);
      clearFeedback();
      setStep("details");
      return;
    }
    if (captchaBlocked) {
      setError("Complete security verification before continuing.");
      return;
    }
    if (signupComplete) return;

    const form = new FormData(event.currentTarget);
    const data: Record<string, FormDataEntryValue | boolean> = Object.fromEntries(form.entries());
    const action = mode === "signup" ? "register" : mode === "signin" ? "login" :
      mode === "forgot" ? "forgot" : mode === "verify" ? "verify" : mode === "email-change" ? "email-change" : "reset";
    if (typeof data.email === "string") {
      data.email = data.email.trim();
      setEnteredEmail(data.email);
    }
    if (typeof data.password === "string") setTypedPassword(data.password);
    if (["reset", "verify", "email-change"].includes(mode)) data.token = (form.get("code") as string)?.trim() || tokenValue || "";
    if (mode === "signup") data.acceptedTerms = form.get("acceptedTerms") === "on";
    if (mode === "signin") data.rememberMe = form.get("rememberMe") === "on";
    if (captchaToken) data.turnstileToken = captchaToken;
    setBusy(true);
    clearFeedback();

    try {
      const response = await fetch(`/api/auth/email/${action}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json() as { code?: string; error?: string; message?: string; redirectTo?: string; testOnlyLink?: string };
      if (!response.ok) {
        setErrorCode(result.code || "");
        throw new Error(result.error || "Please try again.");
      }
      if (result.redirectTo) {
        location.assign(result.redirectTo);
        return;
      }
      if (mode === "signup") setSignupComplete(true);
      setMessage(result.message || "Done.");
      setTestOnlyLink(result.testOnlyLink || "");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Request failed. Try again.");
    } finally {
      setBusy(false);
      resetCaptcha();
    }
  }

  async function resendVerification() {
    if (busy || captchaBlocked) return;
    const email = enteredEmail.trim();
    if (!email) {
      setError("Please enter your email address to resend verification.");
      return;
    }
    setBusy(true);
    clearFeedback();
    try {
      const response = await fetch("/api/auth/email/resend", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, ...(typedPassword ? { password: typedPassword } : {}), ...(captchaToken ? { turnstileToken: captchaToken } : {}) }),
      });
      const result = await response.json() as { code?: string; message?: string; error?: string; testOnlyLink?: string };
      if (!response.ok) {
        setErrorCode(result.code || "");
        throw new Error(result.code === "reauthentication_required" ?
          "Enter your email and password on the sign-in page, then choose Resend verification email." :
          result.error || "Unable to resend verification email.");
      }
      setMessage(result.message || "Verification code and link resent. Please check your inbox.");
      setTestOnlyLink(result.testOnlyLink || "");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Request failed. Try again.");
    } finally {
      setBusy(false);
      resetCaptcha();
    }
  }

  return <>
    {emailStep && providers && <>
      {providers}
      <div className={styles.providerDivider}><span>Or</span></div>
    </>}

    <form className={styles.emailForm} onSubmit={submit} aria-busy={busy}>
      {progressive && !emailStep && <>
        <div className={styles.emailSummary}>
          <div className={styles.emailSummaryText}><span>Email address</span><strong>{enteredEmail}</strong></div>
          {!signupComplete && <button className={styles.changeEmail} type="button" onClick={changeEmail} disabled={busy}>Change email</button>}
        </div>
        <input type="hidden" name="email" value={enteredEmail} />
        <p className={styles.authStepIntro}>
          {signupComplete ? "Check your inbox to verify your email address." : mode === "signup" ? "A few details to create your account." : "Enter your password to continue."}
        </p>
      </>}

      {(emailStep || mode === "forgot") && <label className={styles.fieldLabel}>
        Email address
        <input ref={emailInput} name="email" type="email" autoComplete="email" maxLength={320} required
          placeholder="you@example.com" value={enteredEmail} onChange={event => setEnteredEmail(event.target.value)} disabled={busy} />
      </label>}

      {mode === "signup" && !emailStep && !signupComplete && <label className={styles.fieldLabel}>
        Full name
        <input ref={firstDetail} name="name" autoComplete="name" maxLength={200} required placeholder="Your full name" disabled={busy} />
      </label>}

      {["verify", "reset", "email-change"].includes(mode) && <label className={styles.fieldLabel}>
        {mode === "verify" ? "Verification code" : mode === "reset" ? "Password reset code" : "Confirmation code"}
        <input name="code" type="text" autoComplete="one-time-code" placeholder="Enter your code or link token"
          value={tokenValue} onChange={event => setTokenValue(event.target.value)} required disabled={busy} />
        {tokenPrefilled && <span className={styles.fieldHint}>The code from your email link is ready. Continue below.</span>}
      </label>}

      {showPassword && <div className={styles.fieldLabel}>
        <label htmlFor={passwordId}>{mode === "reset" ? "New password" : "Password"}</label>
        <span className={styles.passwordField}>
          <input id={passwordId} ref={mode === "signin" ? firstDetail : undefined} name="password" type={show ? "text" : "password"}
            autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={8} maxLength={1024} required
            placeholder={mode === "signin" ? "Enter your password" : "Create a password"} value={typedPassword}
            aria-describedby={mode === "signin" ? undefined : `${passwordId}-hint`}
            onChange={event => setTypedPassword(event.target.value)} disabled={busy} />
          <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} disabled={busy}>{show ? "Hide" : "Show"}</button>
        </span>
        {mode !== "signin" && <span id={`${passwordId}-hint`} className={styles.fieldHint}>Use at least 8 characters. Password managers are welcome.</span>}
      </div>}

      {mode === "signin" && !emailStep && <div className={styles.rememberRow}>
        <label className={styles.rememberCheck}><input type="checkbox" name="rememberMe" defaultChecked disabled={busy} /><span>Remember me</span></label>
        <a className={styles.formLink} href="/forgot-password">Forgot password?</a>
      </div>}

      {mode === "signup" && !emailStep && !signupComplete && <label className={styles.termsCheck}>
        <input type="checkbox" name="acceptedTerms" required disabled={busy} />
        <span>I agree to the <a href="/terms">Terms &amp; Conditions</a> and <a href="/privacy">Privacy Policy</a>.</span>
      </label>}

      {captchaRequired && (captchaConfig.status !== "ready" || captchaConfig.enabled) && <div className={styles.captchaArea}>
        {captchaConfig.status === "loading" && <p className={styles.captchaStatus} role="status">Loading security verification…</p>}
        {captchaConfig.status === "ready" && captchaConfig.enabled && <>
          <div ref={captcha} aria-label="Security verification" />
          {!captchaError && <p className={styles.captchaStatus} role="status">{captchaStatus}</p>}
        </>}
        {(captchaConfig.status === "error" || captchaError) && <div className={styles.formError} role="alert">
          <p>{captchaConfig.status === "error" ? captchaConfig.message : captchaError}</p>
          <button className={styles.textButton} type="button" disabled={busy} onClick={() => setCaptchaAttempt(attempt => attempt + 1)}>Retry security check</button>
        </div>}
      </div>}

      {error && <div role="alert" className={styles.formError}>
        <p>{error}</p>
        {errorCode === "reauthentication_required" && mode !== "signin" && <a className={styles.formLink} href="/signin">Go to sign in</a>}
        {progressive && (errorCode === "email_unverified" || errorCode === "email_delivery_unavailable" || error.toLowerCase().includes("verify your email")) && <button
          type="button" className={styles.textButton} disabled={busy || captchaBlocked} onClick={() => void resendVerification()}>
          Resend verification email
        </button>}
      </div>}

      {message && <p role="status" className={styles.formMessage}>{message}</p>}
      {testOnlyLink && <p role="status" className={styles.formMessage}>Development test link: <a href={testOnlyLink}>Continue the test flow</a></p>}

      {!signupComplete && <button className={styles.primary} type="submit" disabled={busy || captchaBlocked}>
        {busy ? "Please wait…" : emailStep ? "Continue with email" : mode === "signup" ? "Agree and sign up" :
          mode === "signin" ? "Sign in" : mode === "forgot" ? "Send password reset email" :
            mode === "verify" ? "Verify email" : mode === "email-change" ? "Confirm email change" : "Reset password"}
      </button>}

      {signupComplete && <>
        <a className={styles.primary} href="/signin">Continue to sign in</a>
        <button className={styles.textButton} type="button" disabled={busy || captchaBlocked} onClick={() => void resendVerification()}>Resend verification email</button>
        <a className={styles.formLink} href="/verify-email">Have a verification code? Enter it here</a>
      </>}

      {mode === "verify" && <p className={styles.formFootnote}>Didn’t receive the email, or has your code expired? <a className={styles.formLink} href="/signin">Sign in to resend it</a>.</p>}
    </form>
    {emailStep && legalNotice}
  </>;
}
