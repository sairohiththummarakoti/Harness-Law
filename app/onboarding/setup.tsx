"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, FileCheck2, FolderOpen, Loader2, PencilLine, Scale, ShieldCheck } from "lucide-react";
import type { CaseState } from "@/lib/model";
import { applyOnboardingStep, getOnboardingNextStep, getOnboardingRoute, ONBOARDING_GOALS } from "@/lib/onboarding";
import { hasUnsavedSetupAnswers, mergeAcceptedSetupAnswers, mergeCurrentStepAnswers, setupAnswersFromCase, setupConflictRows, type SetupAnswers as Answers, type SetupStep as Step } from "@/lib/onboarding-client";
import { requestCase } from "@/lib/case-request";
import styles from "./setup.module.css";

const steps = ["Your work", "Your focus", "Make it yours"];
const goalIcons = { evidence: FolderOpen, narrative: PencilLine, review: FileCheck2 };

export default function Onboarding({ initialName, signInPath, accountId }: { initialName: string; signInPath: string; accountId: string }) {
  const router = useRouter();
  const [caseState, setCaseState] = useState<CaseState | null>(null);
  const [answers, setAnswers] = useState<Answers>({ field: "", role: "", goal: "", fullName: initialName, preferredName: "" });
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [conflict, setConflict] = useState<CaseState | null>(null);
  const [conflictNeedsLoad, setConflictNeedsLoad] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [opening, setOpening] = useState(false);
  const saveInFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const savedAnswers = useRef<Answers | null>(null);
  const currentAnswers = useRef(answers);
  const setupComplete = useRef(false);
  currentAnswers.current = answers;
  setupComplete.current = completed;

  const answersFromCase = useCallback((state: CaseState): Answers => setupAnswersFromCase(state, initialName), [initialName]);

  const loadCase = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(""); setSessionExpired(false);
    try {
      const response = await requestCase({ credentials: "same-origin", cache: "no-store", headers: { "X-Harness-Account": accountId }, signal });
      const result = response.data;
      if (!response.ok || !result.state || result.revision === undefined) {
        if (response.status === 401) setSessionExpired(true);
        throw new Error(response.status === 401 ? "Your session has expired. Sign in again to continue your setup." : result.error || "We couldn’t open your saved case. Please try again.");
      }
      if (getOnboardingRoute(result.state) === "workspace") { setOpening(true); router.replace("/workspace"); return; }
      setCaseState({ ...result.state, revision: result.revision });
      savedAnswers.current = answersFromCase(result.state);
      setAnswers(savedAnswers.current);
      setStep(Math.min(result.state.onboarding?.step ?? 1, 3) as Step);
      setConflict(null);
    } catch (cause) {
      if (signal?.aborted) return;
      setError(cause instanceof Error ? cause.message : "We couldn’t open your saved case. Please try again.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [answersFromCase, router]);

  useEffect(() => {
    const controller = new AbortController();
    void loadCase(controller.signal);
    return () => controller.abort();
  }, [loadCase]);

  useEffect(() => {
    if (!loading && caseState) {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }, [step, completed, loading, !!caseState]);

  useEffect(() => {
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedSetupAnswers(currentAnswers.current, savedAnswers.current, saveInFlight.current, setupComplete.current)) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, []);

  const patchAnswer = <K extends keyof Answers>(key: K, value: Answers[K]) => {
    setAnswers(current => ({ ...current, [key]: value }));
  };

  async function loadLatestForComparison() {
    setConflictNeedsLoad(true); setSessionExpired(false);
    try {
      const response = await requestCase({ credentials: "same-origin", cache: "no-store", headers: { "X-Harness-Account": accountId } });
      const result = response.data;
      if (!response.ok || !result.state || result.revision === undefined) {
        if (response.status === 401) setSessionExpired(true);
        throw new Error(response.status === 401 ? "Sign in again to compare your saved answers. Your answers remain in this window." : "We couldn’t load the latest saved answers. Your answers remain here. Please retry.");
      }
      setConflict({ ...result.state, revision: result.revision }); setConflictNeedsLoad(false);
      setError("Review the latest saved answers below before continuing.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "We couldn’t load the latest saved answers. Please retry."); }
  }

  async function saveStep(event?: FormEvent, latest?: CaseState) {
    event?.preventDefault();
    const base = latest ?? caseState;
    if (!base || saveInFlight.current || conflictNeedsLoad || (conflict && !latest)) return;
    saveInFlight.current = true; setSaving(true); setError(""); setSessionExpired(false);
    try {
      const stepAnswers = step === 1 ? { field: answers.field, role: answers.role }
        : step === 2 ? { goal: answers.goal || undefined }
        : { fullName: answers.fullName, preferredName: answers.preferredName };
      const updated = applyOnboardingStep(base, step, stepAnswers);
      const response = await requestCase({
        method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Harness-Account": accountId },
        body: JSON.stringify({ state: updated, expectedRevision: base.revision }),
      });
      const result = response.data;
      if (response.status === 409) {
        if (result.state && result.revision !== undefined) setConflict({ ...result.state, revision: result.revision });
        setError("Your case changed in another window. Your answers are still here. Review the latest saved answers before continuing.");
        if (!result.state || result.revision === undefined) await loadLatestForComparison();
        return;
      }
      if (!response.ok || !result.state || result.revision === undefined) {
        if (response.status === 401) setSessionExpired(true);
        throw new Error(response.status === 401 ? "Your session has expired. Your answers are still here. Sign in again to continue." : result.error || "We couldn’t save this step. Your answers are still here. Please try again.");
      }
      const savedState = result.state;
      setCaseState({ ...savedState, revision: result.revision }); setConflict(null); setConflictNeedsLoad(false);
      const acceptedAnswers = answersFromCase(savedState);
      savedAnswers.current = acceptedAnswers;
      setAnswers(current => mergeAcceptedSetupAnswers(current, acceptedAnswers, step, !!latest));
      if (step === 3) setCompleted(true);
      else setStep((step + 1) as Step);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "We couldn’t save this step. Your answers are still here. Please try again."); }
    finally { saveInFlight.current = false; setSaving(false); }
  }

  function useLatestAnswers() {
    if (!conflict) return;
    if (getOnboardingRoute(conflict) === "workspace") { setOpening(true); router.replace("/workspace"); return; }
    setCaseState(conflict);
    const latestAnswers = answersFromCase(conflict);
    savedAnswers.current = latestAnswers;
    setAnswers(current => mergeCurrentStepAnswers(current, latestAnswers, step));
    setConflict(null); setConflictNeedsLoad(false); setError("");
  }

  const goal = answers.goal ? getOnboardingNextStep(answers.goal) : null;
  const savedGoal = caseState?.onboarding?.goal ? getOnboardingNextStep(caseState.onboarding.goal) : null;
  const showForm = !loading && !opening && caseState && !completed;
  const isRemoteInProgress = conflict ? getOnboardingRoute(conflict) === "workspace" : false;

  return <div className={styles.setup}>
    <header className={styles.header}>
      <a className={styles.brand} href="/" aria-label="Harness Law home"><Scale size={28} /><span>Harness Law</span></a>
      <a className={styles.quietLink} href="/workspace">Go to workspace</a>
    </header>
    <main className={styles.main}>
      <div className={styles.progressHeader}><span>YOUR WORKSPACE, YOUR WAY</span><span>{completed ? "Setup complete" : `Step ${step} of 3`}</span></div>
      <ol className={styles.progress} aria-label="Setup progress">{steps.map((label, index) => <li key={label} className={completed || step > index + 1 ? styles.done : step === index + 1 ? styles.current : ""} aria-current={!completed && step === index + 1 ? "step" : undefined}><span>{completed || step > index + 1 ? <Check size={14} aria-hidden="true" /> : index + 1}</span><strong>{label}</strong></li>)}</ol>

      {(loading || opening) && <section className={styles.loading} aria-live="polite"><Loader2 className={styles.spinner} size={28} /><h1>{opening ? "Opening your workspace…" : "Getting your workspace ready…"}</h1><p>Your saved case stays with you.</p></section>}

      {!loading && !opening && !caseState && <section className={styles.loadError}><h1>Let’s try that again.</h1><p role="alert">{error}</p>{sessionExpired ? <a className={styles.primary} href={signInPath} target="_top">Sign in to your account</a> : <button className={styles.primary} onClick={() => void loadCase()}>Retry loading your case</button>}<a className={styles.quietLink} href="/">Back to home</a></section>}

      {showForm && <form onSubmit={event => void saveStep(event)} className={styles.form}>
        <div className={styles.stepHeading}>
          <span className={styles.eyebrow}>{step === 1 ? "A LITTLE ABOUT YOUR WORK" : step === 2 ? "LET’S FIND YOUR STARTING POINT" : "YOUR PREPARATION STARTS WITH YOU"}</span>
          <h1 ref={heading} tabIndex={-1}>{step === 1 ? "What do you do best?" : step === 2 ? "Where would you like to begin?" : "Make this space your own."}</h1>
          <p>{step === 1 ? "Tell us your field and current role. You can add the details of your professional story later." : step === 2 ? "Choose your focus for now. We’ll open your workspace with a useful next step, and you can explore everything from there." : "Add your name and check your setup. You can edit these details in your profile anytime."}</p>
        </div>
        <fieldset className={styles.fields} disabled={saving}>
          <legend className={styles.srOnly}>{steps[step - 1]}</legend>
          {step === 1 && <>
            <label className={styles.field}><span>Professional field</span><input name="professional-field" autoComplete="off" list="professional-fields" required maxLength={500} value={answers.field} onChange={event => patchAnswer("field", event.target.value)} placeholder="e.g. Artificial intelligence" /><small>Use the field that best describes your work.</small></label>
            <datalist id="professional-fields"><option value="Science and research" /><option value="Technology and engineering" /><option value="Arts and creative work" /><option value="Business and entrepreneurship" /><option value="Education" /><option value="Athletics" /></datalist>
            <label className={styles.field}><span>Current or most recent role</span><input name="professional-role" autoComplete="organization-title" required maxLength={500} value={answers.role} onChange={event => patchAnswer("role", event.target.value)} placeholder="e.g. Research scientist" /></label>
          </>}
          {step === 2 && <div className={styles.goals}>{ONBOARDING_GOALS.map(option => {
            const Icon = goalIcons[option.id];
            return <label key={option.id} className={`${styles.goal} ${answers.goal === option.id ? styles.selected : ""}`}><input type="radio" name="preparation-goal" value={option.id} checked={answers.goal === option.id} onChange={() => patchAnswer("goal", option.id)} required /><span className={styles.goalIcon}><Icon size={23} /></span><span className={styles.goalCopy}><strong>{option.title}</strong><span>{option.description}</span></span><span className={styles.radio} aria-hidden="true">{answers.goal === option.id && <span />}</span></label>;
          })}</div>}
          {step === 3 && <>
            <div className={styles.nameFields}><label className={styles.field}><span>Full name</span><input name="full-name" autoComplete="name" required maxLength={500} value={answers.fullName} onChange={event => patchAnswer("fullName", event.target.value)} placeholder="Your full name" /></label><label className={styles.field}><span>What should we call you? <em>Optional</em></span><input name="preferred-name" autoComplete="nickname" maxLength={500} value={answers.preferredName} onChange={event => patchAnswer("preferredName", event.target.value)} placeholder="Your preferred name" /></label></div>
            <div className={styles.summary}><div className={styles.summaryHeading}><strong>Your starting point</strong><button type="button" disabled={!!conflict || conflictNeedsLoad} onClick={() => setStep(1)}>Edit</button></div><dl><div><dt>Field</dt><dd>{caseState.professional.field}</dd></div><div><dt>Role</dt><dd>{caseState.professional.role}</dd></div><div><dt>Focus</dt><dd>{savedGoal?.title}</dd></div></dl></div>
            <p className={styles.factNote}><ShieldCheck size={18} /><span>These details personalize your workspace. You’ll review and confirm your case facts separately.</span></p>
          </>}
        </fieldset>

        {error && <div className={styles.error} role="alert"><p>{error}</p>{sessionExpired && <><a href={signInPath} target="_blank" rel="noopener noreferrer">Sign in again (new tab)</a><p>Then return here and retry. Your unsaved answers stay in this window.</p></>}{conflictNeedsLoad && <button type="button" disabled={saving} onClick={() => void loadLatestForComparison()}>Load latest saved answers</button>}</div>}
        {conflict && <section className={styles.conflict} aria-label="Compare saved setup">
          {isRemoteInProgress ? <><h2>Your saved workspace is ready.</h2><p>Another session has already moved this case forward. Open the latest saved case to continue.</p><a className={styles.primary} href="/workspace">Open saved workspace</a></> : <>
            <h2>{step === 3 ? "Latest saved setup" : "Latest saved answers"}</h2><dl>{setupConflictRows(conflict, step).map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl><p>{step === 3 ? "Completing setup will use the saved field, role, and focus above with the names you choose. Your entered names remain in the fields above." : "Your answers remain in the fields above. Choose which answers to use for this step."}</p>
            <div className={styles.conflictActions}><button type="button" className={styles.secondary} disabled={saving} onClick={useLatestAnswers}>Use latest saved answers</button><button type="button" className={styles.primary} disabled={saving} onClick={() => void saveStep(undefined, conflict)}>Keep my answers and retry</button></div>
          </>}
        </section>}

        <div className={styles.actions}><button type="button" className={styles.back} disabled={saving || step === 1 || !!conflict || conflictNeedsLoad} onClick={() => { setStep((step - 1) as Step); setError(""); }}>Back</button><button type="submit" className={styles.primary} disabled={saving || !!conflict || conflictNeedsLoad}>{saving ? <><Loader2 className={styles.spinner} size={17} />Saving your answers…</> : step === 3 ? "Create my workspace" : error && !sessionExpired ? "Try saving again" : "Continue"}</button></div>
        <p className={styles.saveNote}>Your answers save when you continue.</p>
      </form>}

      {completed && <section className={styles.success}>
        <div className={styles.successIcon}><CheckCircle2 size={36} /></div><span className={styles.eyebrow}>A GOOD PLACE TO START</span><h1 ref={heading} tabIndex={-1}>You’re ready, {answers.preferredName.trim() || answers.fullName.trim().split(" ")[0]}.</h1><p>Your EB-1A workspace is set up around your work and what you want to do next.</p>
        {goal && <div className={styles.nextStep}><span>YOUR NEXT STEP</span><h2>{goal.title}</h2><p>{goal.description}</p><a href="/workspace" className={styles.primary}>{goal.action}</a></div>}
        <p className={styles.factNote}><ShieldCheck size={18} /><span>Your profile is saved. Case facts and evidence still need your review.</span></p>
      </section>}
    </main>
    <footer className={styles.footer}>A focused workspace for EB-1A preparation.</footer>
  </div>;
}
