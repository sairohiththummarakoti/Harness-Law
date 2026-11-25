"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./entry.module.css";

export default function AuthForm({mode}:{mode:"signup"|"signin"|"forgot"|"reset"|"verify"|"email-change"}) {
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [errorCode,setErrorCode]=useState("");
  const [message,setMessage]=useState("");
  const [show,setShow]=useState(false);
  const [testOnlyLink,setTestOnlyLink]=useState("");
  const [enteredEmail,setEnteredEmail]=useState("");
  const [typedPassword,setTypedPassword]=useState("");
  const [tokenPrefilled,setTokenPrefilled]=useState(false);
  const [tokenValue,setTokenValue]=useState("");
  const [siteKey,setSiteKey]=useState("");
  const [captchaToken,setCaptchaToken]=useState("");
  const [captchaEnabled,setCaptchaEnabled]=useState(false);
  const captcha=useRef<HTMLDivElement>(null);
  const captchaId=useRef<string|undefined>(undefined);

  const needsCaptcha=["signup","signin","forgot","reset"].includes(mode);

  useEffect(()=>{
    let alive=true;
    fetch('/api/auth/email/captcha')
      .then(r=>r.json() as Promise<{siteKey?:string|null;enabled?:boolean}>)
      .then(v=>{if(alive){if(v.siteKey)setSiteKey(v.siteKey);setCaptchaEnabled(!!v.enabled);}})
      .catch(()=>{});
    return()=>{alive=false;};
  },[]);

  useEffect(()=>{
    if(typeof window==="undefined") return;
    const searchToken = new URLSearchParams(window.location.search).get("token");
    const hashToken = new URLSearchParams(window.location.hash.slice(1)).get("token");
    const detected = searchToken || hashToken || "";
    if(detected) {
      setTokenValue(detected);
      setTokenPrefilled(true);
    }
  },[mode]);

  useEffect(()=>{
    if(!siteKey||!captcha.current)return;
    let timer:number;
    const render=()=>{
      const api=(window as unknown as {turnstile?:{render:(el:HTMLElement,opts:Record<string,unknown>)=>string}}).turnstile;
      if(!api){timer=window.setTimeout(render,100);return;}
      captchaId.current=api.render(captcha.current!,{
        sitekey:siteKey,
        callback:(token:string)=>setCaptchaToken(token),
        'expired-callback':()=>setCaptchaToken(''),
        'error-callback':()=>setCaptchaToken('')
      });
    };
    if(!document.querySelector('script[data-turnstile]')){
      const script=document.createElement('script');
      script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async=true;
      script.defer=true;
      script.dataset.turnstile='1';
      script.onload=render;
      document.head.appendChild(script);
    } else render();
    return()=>window.clearTimeout(timer);
  },[siteKey]);

  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);setError("");setErrorCode("");setMessage("");setTestOnlyLink("");
    const form=new FormData(event.currentTarget);
    const data:Record<string,FormDataEntryValue|boolean>=Object.fromEntries(form.entries());
    const action=mode==="signup"?"register":mode==="signin"?"login":mode==="forgot"?"forgot":mode==="verify"?"verify":mode==="email-change"?"email-change":"reset";

    if(typeof data.email==='string') setEnteredEmail(data.email.trim());

    if(mode==="reset" || mode==="verify" || mode==="email-change") {
      const codeOrToken = (form.get("code") as string)?.trim() || tokenValue || "";
      data.token = codeOrToken;
    }
    if(mode==="signup") {
      data.acceptedTerms=form.get("acceptedTerms")==="on";
    }
    if(mode==="signin") {
      data.rememberMe=form.get("rememberMe")==="on";
    }
    if(captchaToken) data.turnstileToken=captchaToken;

    try {
      const response=await fetch(`/api/auth/email/${action}`,{
        method:"POST",
        credentials:"same-origin",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(data)
      });
      const result=await response.json() as {code?:string;error?:string;message?:string;redirectTo?:string;testOnlyLink?:string};
      if(!response.ok) {
        if(result.code) setErrorCode(result.code);
        throw new Error(result.error||"Please try again.");
      }
      if(result.redirectTo){
        location.assign(result.redirectTo);
        return;
      }
      setMessage(result.message||"Done.");
      setTestOnlyLink(result.testOnlyLink||"");
    } catch(e) {
      setError(e instanceof Error?e.message:"Request failed. Try again.");
    } finally {
      setBusy(false);
      setCaptchaToken('');
      const api=(window as unknown as {turnstile?:{reset:(id?:string)=>void}}).turnstile;
      if(captchaId.current) api?.reset(captchaId.current);
    }
  }

  async function resendVerification(targetEmail?: string) {
    const emailToUse = targetEmail || enteredEmail;
    if(!emailToUse) {
      setError("Please enter your email address to resend verification.");
      return;
    }
    setBusy(true);setError("");setErrorCode("");setMessage("");setTestOnlyLink("");
    try {
      const response = await fetch("/api/auth/email/resend", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailToUse, ...(captchaToken ? { turnstileToken: captchaToken } : {}) })
      });
      const data = await response.json() as { message?: string; error?: string; testOnlyLink?: string };
      if(!response.ok) throw new Error(data.error || "Unable to resend verification email.");
      setMessage(data.message || "Verification code and link resent. Please check your inbox.");
      setTestOnlyLink(data.testOnlyLink || "");
    } catch(e) {
      setError(e instanceof Error ? e.message : "Request failed. Try again.");
    } finally {
      setBusy(false);
      setCaptchaToken('');
      const api=(window as unknown as {turnstile?:{reset:(id?:string)=>void}}).turnstile;
      if(captchaId.current) api?.reset(captchaId.current);
    }
  }

  return <form className={styles.emailForm} onSubmit={submit}>
    {mode==="signup" && (
      <label>Name
        <input name="name" autoComplete="name" maxLength={200} required placeholder="Full Name" />
      </label>
    )}

    {!['reset','verify','email-change'].includes(mode) && (
      <label>Email address
        <input
          name="email"
          type="email"
          autoComplete="email"
          maxLength={320}
          required
          placeholder="name@example.com"
          defaultValue={enteredEmail}
          onChange={e=>setEnteredEmail(e.target.value)}
        />
      </label>
    )}

    {['verify','reset','email-change'].includes(mode) && (
      <label>{mode==="verify"?"Verification code or token":mode==="reset"?"Password reset code or token":"Confirmation code or token"}
        <input
          name="code"
          type="text"
          autoComplete="one-time-code"
          placeholder={tokenPrefilled ? "Link token detected (or enter 6-digit code)" : "Enter 6-digit code or link token"}
          value={tokenValue}
          onChange={e=>setTokenValue(e.target.value)}
          required
        />
        {tokenPrefilled && <span className={styles.fieldHint}>Verified link detected from URL. Click below to proceed.</span>}
      </label>
    )}

    {(mode==="signup"||mode==="signin"||mode==="reset") && (
      <label>Password
        <span className={styles.passwordField}>
          <input
            name="password"
            type={show?"text":"password"}
            autoComplete={mode==="signin"?"current-password":"new-password"}
            minLength={8}
            maxLength={1024}
            required
            placeholder="At least 8 characters"
            value={typedPassword}
            onChange={e=>setTypedPassword(e.target.value)}
          />
          <button type="button" onClick={()=>setShow(!show)} aria-pressed={show}>{show?"Hide":"Show"}</button>
        </span>
        {(mode==="signup"||mode==="reset") && typedPassword.length > 0 && (
          <div>
            {(() => {
              let score = 0;
              if (typedPassword.length >= 8) score++;
              if (typedPassword.length >= 10 && (/[A-Z]/.test(typedPassword) || /[^A-Za-z0-9]/.test(typedPassword))) score++;
              if (/[0-9]/.test(typedPassword) && /[a-zA-Z]/.test(typedPassword)) score++;
              const label = score <= 1 ? 'Weak' : score === 2 ? 'Fair' : 'Strong';
              const colorClass = score <= 1 ? styles.strengthWeak : score === 2 ? styles.strengthMedium : styles.strengthStrong;
              return (
                <div>
                  <div className={styles.strengthBar}>
                    <span className={`${styles.strengthSegment} ${score >= 1 ? colorClass : ''}`} />
                    <span className={`${styles.strengthSegment} ${score >= 2 ? colorClass : ''}`} />
                    <span className={`${styles.strengthSegment} ${score >= 3 ? colorClass : ''}`} />
                  </div>
                  <div className={styles.strengthLabel}>
                    <span>Strength: <strong>{label}</strong></span>
                    <span>Min 8 characters</span>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
        {mode==="signup" && !typedPassword && <span className={styles.fieldHint}>Minimum 8 characters. Supports password managers.</span>}
      </label>
    )}

    {mode==="signin" && (
      <div className={styles.rememberRow}>
        <label className={styles.rememberCheck}>
          <input type="checkbox" name="rememberMe" defaultChecked />
          <span>Remember me on this device</span>
        </label>
        <a className={styles.formLink} href="/forgot-password">Forgot password?</a>
      </div>
    )}

    {mode==="signup" && (
      <label className={styles.termsCheck}>
        <input type="checkbox" name="acceptedTerms" required />
        <span>I accept the <a href="/terms">Terms &amp; Conditions</a> and <a href="/privacy">Privacy Policy</a>.</span>
      </label>
    )}

    {needsCaptcha && captchaEnabled && siteKey && <div ref={captcha} aria-label="Security verification"/>}
    {needsCaptcha && captchaEnabled && !siteKey && <p role="alert" className={styles.formError}>Security verification is not configured. Contact support.</p>}

    {error && (
      <div role="alert" className={styles.formError}>
        <p style={{margin:0}}>{error}</p>
        {(errorCode === "email_unverified" || error.toLowerCase().includes("verify your email")) && (
          <div style={{marginTop: 8}}>
            <button
              type="button"
              className={styles.unverifiedBtn}
              disabled={busy}
              onClick={()=>resendVerification()}
            >
              Resend verification email {enteredEmail ? `to ${enteredEmail}` : ''}
            </button>
          </div>
        )}
      </div>
    )}

    {message && <p role="status" className={styles.formMessage}>{message}</p>}
    {testOnlyLink && <p role="status" className={styles.formMessage}>Development test link: <a href={testOnlyLink}>Continue the test flow</a></p>}

    <button className={styles.primary} disabled={busy||(needsCaptcha&&captchaEnabled&&(!siteKey||!captchaToken))}>
      {busy ? "Please wait…" :
        mode==="signup" ? "Create account" :
        mode==="signin" ? "Log in" :
        mode==="forgot" ? "Send verification code & link" :
        mode==="verify" ? "Verify email" :
        mode==="email-change" ? "Confirm email change" :
        "Reset password"}
    </button>

    {mode==="signup" && (
      <div className={styles.resendBox}>
        <button
          className={styles.textButton}
          type="button"
          disabled={busy||(captchaEnabled&&(!siteKey||!captchaToken))}
          onClick={async()=>{
            const form=document.querySelector("form");
            const email=form?new FormData(form).get("email") as string:null;
            if(!email){setError("Enter your email address above to resend verification.");return;}
            await resendVerification(email);
          }}
        >
          Already registered? Resend verification email
        </button>
      </div>
    )}

    {mode==="verify" && (
      <div className={styles.resendBox}>
        <p style={{fontSize: 13, color: '#52665a', margin: '4px 0'}}>Didn't receive an email or code expired?</p>
        <button
          className={styles.textButton}
          type="button"
          disabled={busy}
          onClick={async()=>{
            const email = prompt("Enter your account email to resend verification code:");
            if(email) await resendVerification(email);
          }}
        >
          Resend verification code / link
        </button>
      </div>
    )}

    {mode==="forgot" && (
      <div style={{textAlign: "center", marginTop: 8}}>
        <a className={styles.formLink} href="/signin">Back to log in</a>
      </div>
    )}

    {mode==="reset" && (
      <div style={{textAlign: "center", marginTop: 8}}>
        <a className={styles.formLink} href="/signin">Back to log in</a>
      </div>
    )}
  </form>;
}
