"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Check, CheckCircle2, ChevronDown, Loader2, Scale, Search, ShieldCheck, X } from "lucide-react";
import { CRITERIA, GUIDANCE_URL, type CaseState } from "@/lib/model";
import { applyIntakeStep, getIntakeSteps, intakeAnswersFromCase, mergeIntakeStepAnswers, INTAKE_STEP_FIELDS, type IntakeAnswers, type IntakeStep } from "@/lib/intake";
import { INTAKE_STEP_LABELS, VISA_OPTIONS } from "@/lib/intake-catalog";
import { BIRTH_COUNTRIES, CITIZENSHIP_OPTIONS, countryName } from "@/lib/countries";
import { requestCase } from "@/lib/case-request";
import styles from "./setup.module.css";

type Choice = { value: string; label: string; description?: string };
const blankAnswers: IntakeAnswers = { fullName: "", phone: "", helpFor: "", visaType: "", birthCountry: "", birthCountryOther: "", citizenships: [], field: "", role: "", criteria: [], criteriaUnsure: false, majorAward: "", notes: "" };
const headings: Record<IntakeStep, { title: string; description: string }> = {
  basics: { title: "Let’s start with you.", description: "A few details will help us shape your preparation around the right person." },
  visa: { title: "Which visa are you considering?", description: "Choose the option you have in mind. It’s okay if you’re still exploring." },
  birth: { title: "In what country were you born?", description: "Select your country of birth. We’ll ask about your citizenship separately." },
  citizenships: { title: "What is your country of citizenship?", description: "Select every country you are a citizen of, including dual or multiple citizenships." },
  background: { title: "Tell us about your work.", description: "Your field and role give context to your experience and the evidence you may collect." },
  criteria: { title: "Which EB-1A criteria do you think you can support?", description: "Select all that may match your experience. Your selections help organize your evidence; they do not determine eligibility." },
  review: { title: "Does everything look right?", description: "Review your answers before finishing. You can return and update them at any time." },
};
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const visaLabel = (value: string) => VISA_OPTIONS.find(option => option.id === value)?.label ?? "Not selected";
const awardLabel = (value: string) => value === "yes" ? "Yes" : value === "no" ? "No" : value === "unsure" ? "Not sure yet" : "Not answered";

function Picker({ label, placeholder, options, selected, multiple = false, disabled = false, onChoose }: { label: string; placeholder: string; options: Choice[]; selected: string[]; multiple?: boolean; disabled?: boolean; onChoose: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const summary = useRef<HTMLElement>(null);
  const searchId = useId();
  const optionId = useId();
  const chosen = options.filter(option => selected.includes(option.value));
  const filtered = options.filter(option => `${option.label} ${option.description ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  function choose(value: string) {
    onChoose(value);
    if (!multiple) { setOpen(false); setQuery(""); summary.current?.focus(); }
  }
  return <div className={styles.picker}>
    <span className={styles.pickerLabel}>{label}</span>
    <details open={open} onToggle={event => setOpen(event.currentTarget.open)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); summary.current?.focus(); } }}>
      <summary ref={summary} aria-disabled={disabled} aria-controls={optionId} onClick={event => { if (disabled) event.preventDefault(); }}><span>{chosen.length ? multiple ? `${chosen.length} selected` : chosen[0].label : placeholder}</span><ChevronDown size={20} aria-hidden="true" /></summary>
      <div className={styles.pickerPanel} id={optionId}>
        <div className={styles.search}><Search size={18} aria-hidden="true" /><label className={styles.srOnly} htmlFor={searchId}>Search {label.toLowerCase()}</label><input id={searchId} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${label.toLowerCase()}`} autoComplete="off" disabled={disabled} /></div>
        <div className={styles.pickerOptions} role="group" aria-label={label}>
          {filtered.map(option => <label key={option.value} className={`${styles.pickerOption} ${selected.includes(option.value) ? styles.pickerSelected : ""}`}>
            <input type={multiple ? "checkbox" : "radio"} name={optionId} checked={selected.includes(option.value)} onChange={() => choose(option.value)} disabled={disabled} />
            <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
          </label>)}
          {!filtered.length && <p className={styles.noResults}>No matches. Try a different search.</p>}
        </div>
        {multiple && <button className={styles.pickerDone} type="button" onClick={() => { setOpen(false); summary.current?.focus(); }}>Done selecting</button>}
      </div>
    </details>
    {multiple && chosen.length > 0 && <ul className={styles.chips} aria-label={`Selected ${label.toLowerCase()}`}>{chosen.map(option => <li key={option.value}><span>{option.label}</span><button type="button" disabled={disabled} aria-label={`Remove ${option.label}`} onClick={() => onChoose(option.value)}><X size={14} /></button></li>)}</ul>}
  </div>;
}

function summaryRows(answers: IntakeAnswers): { step: IntakeStep; label: string; value: string }[] {
  const rows: { step: IntakeStep; label: string; value: string }[] = [
    { step: "basics", label: "Name", value: answers.fullName || "Not added" },
    { step: "basics", label: "Phone", value: answers.phone || "Not added" },
    { step: "basics", label: "Immigration help for", value: answers.helpFor === "employees" ? "My employees" : answers.helpFor === "myself" ? "Myself or my family" : "Not selected" },
    { step: "visa", label: "Visa interest", value: visaLabel(answers.visaType) },
    { step: "birth", label: "Country of birth", value: answers.birthCountry === "OTHER" ? answers.birthCountryOther : countryName(answers.birthCountry) || "Not selected" },
    { step: "citizenships", label: "Citizenship", value: answers.citizenships.map(countryName).join(", ") || "Not selected" },
    { step: "background", label: "Professional field", value: answers.field || "Not added" },
    { step: "background", label: "Current or recent role", value: answers.role || "Not added" },
  ];
  if (answers.visaType === "eb1a") rows.push(
    { step: "criteria", label: "EB-1A criteria to explore", value: answers.criteriaUnsure ? "Not sure yet" : CRITERIA.filter(criterion => answers.criteria.includes(criterion.id)).map(criterion => criterion.title).join("; ") || "None selected" },
    { step: "criteria", label: "Major international award", value: awardLabel(answers.majorAward) },
  );
  if (answers.notes) rows.push({ step: "review", label: "Additional context", value: answers.notes });
  return rows;
}

export default function Onboarding({ initialName, initialEmail, signInPath, accountId }: { initialName: string; initialEmail: string; signInPath: string; accountId: string }) {
  const [caseState, setCaseState] = useState<CaseState | null>(null);
  const [answers, setAnswers] = useState<IntakeAnswers>({ ...blankAnswers, fullName: initialName });
  const [step, setStep] = useState<IntakeStep>("basics");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [conflict, setConflict] = useState<CaseState | null>(null);
  const [conflictNeedsLoad, setConflictNeedsLoad] = useState(false);
  const [completed, setCompleted] = useState(false);
  const saveInFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const savedAnswers = useRef<IntakeAnswers | null>(null);
  const currentAnswers = useRef(answers);
  const intakeComplete = useRef(false);
  currentAnswers.current = answers;
  intakeComplete.current = completed;

  const answersFromCase = useCallback((state: CaseState) => intakeAnswersFromCase(state, initialName), [initialName]);
  const adoptSaved = useCallback((state: CaseState) => {
    const saved = answersFromCase(state);
    setCaseState(state); savedAnswers.current = saved; setAnswers(saved);
    const savedStep = state.intake?.step ?? "basics";
    setStep(getIntakeSteps(saved.visaType).includes(savedStep) ? savedStep : "visa");
    setCompleted(!!state.intake?.completedAt); setConflict(null); setConflictNeedsLoad(false);
  }, [answersFromCase]);

  const loadCase = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(""); setSessionExpired(false);
    try {
      const response = await requestCase({ headers: { "X-Harness-Account": accountId }, signal });
      const result = response.data;
      if (!response.ok || !result.state || result.revision === undefined) {
        if (response.status === 401) setSessionExpired(true);
        throw new Error(response.status === 401 ? "Your session changed or expired. Sign in to this account again to continue." : result.error || "We couldn’t open your saved answers. Please try again.");
      }
      adoptSaved({ ...result.state, revision: result.revision });
    } catch (cause) {
      if (signal?.aborted) return;
      setError(cause instanceof Error ? cause.message : "We couldn’t open your saved answers. Please try again.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [accountId, adoptSaved]);

  useEffect(() => { const controller = new AbortController(); void loadCase(controller.signal); return () => controller.abort(); }, [loadCase]);
  useEffect(() => {
    if (!loading && caseState) { heading.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: "instant" }); }
  }, [step, completed, loading, !!caseState]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (intakeComplete.current || (!saveInFlight.current && (!savedAnswers.current || equal(currentAnswers.current, savedAnswers.current)))) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, []);

  function patch<K extends keyof IntakeAnswers>(key: K, value: IntakeAnswers[K]) { setAnswers(current => ({ ...current, [key]: value })); }
  function chooseVisa(value: IntakeAnswers["visaType"]) {
    setAnswers(current => ({ ...current, visaType: value, ...(value !== "eb1a" ? { criteria: [], criteriaUnsure: false, majorAward: "" as const } : {}) }));
  }
  function toggleCitizenship(value: string) {
    setAnswers(current => ({ ...current, citizenships: current.citizenships.includes(value) ? current.citizenships.filter(code => code !== value) : value === "STATELESS" ? [value] : [...current.citizenships.filter(code => code !== "STATELESS"), value] }));
  }
  function toggleCriterion(value: string) {
    setAnswers(current => ({ ...current, criteriaUnsure: false, criteria: current.criteria.includes(value) ? current.criteria.filter(code => code !== value) : [...current.criteria, value] }));
  }
  function editStep(value: IntakeStep) { if (saving || conflict || conflictNeedsLoad) return; setCompleted(false); setStep(value); setError(""); }

  async function loadLatestForComparison() {
    setConflictNeedsLoad(true); setSessionExpired(false);
    try {
      const response = await requestCase({ headers: { "X-Harness-Account": accountId } });
      const result = response.data;
      if (!response.ok || !result.state || result.revision === undefined) {
        if (response.status === 401) setSessionExpired(true);
        throw new Error(response.status === 401 ? "Sign in to this account again to compare saved answers. Your draft is still here." : "We couldn’t load the latest answers. Your draft is still here. Please retry.");
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
    const previousSaved = savedAnswers.current;
    try {
      const updated = applyIntakeStep(base, step, answers);
      const response = await requestCase({ method: "PUT", headers: { "Content-Type": "application/json", "X-Harness-Account": accountId }, body: JSON.stringify({ state: updated, expectedRevision: base.revision }) });
      const result = response.data;
      if (response.status === 409) {
        if (result.state && result.revision !== undefined) setConflict({ ...result.state, revision: result.revision });
        setError("Your case changed in another window. Your draft is still here. Compare the saved answers before continuing.");
        if (!result.state || result.revision === undefined) await loadLatestForComparison();
        return;
      }
      if (!response.ok || !result.state || result.revision === undefined) {
        if (response.status === 401) setSessionExpired(true);
        throw new Error(response.status === 401 ? "Your session changed or expired. Sign in to this account again. Your draft stays in this window." : result.error || "We couldn’t save this answer. Your draft is still here. Please try again.");
      }
      const acceptedState = { ...result.state, revision: result.revision };
      const accepted = answersFromCase(acceptedState);
      setCaseState(acceptedState); setConflict(null); setConflictNeedsLoad(false); savedAnswers.current = accepted;
      setAnswers(current => {
        if (step === "review") return accepted;
        let merged = { ...accepted };
        const owns = INTAKE_STEP_FIELDS[step] as readonly (keyof IntakeAnswers)[];
        for (const key of Object.keys(current) as (keyof IntakeAnswers)[]) {
          if (!owns.includes(key) && previousSaved && !equal(current[key], previousSaved[key])) Object.assign(merged, { [key]: current[key] });
        }
        merged = mergeIntakeStepAnswers(merged, accepted, step);
        if (merged.visaType !== "eb1a") { merged.criteria = []; merged.criteriaUnsure = false; merged.majorAward = ""; }
        return merged;
      });
      setCompleted(!!acceptedState.intake?.completedAt);
      if (step !== "review") {
        const sequence = getIntakeSteps(accepted.visaType);
        setStep(sequence[Math.min(sequence.indexOf(step) + 1, sequence.length - 1)]);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "We couldn’t save this answer. Your draft is still here. Please try again."); }
    finally { saveInFlight.current = false; setSaving(false); }
  }

  const sequence = getIntakeSteps(answers.visaType);
  const position = Math.max(sequence.indexOf(step), 0);
  const blocked = saving || !!conflict || conflictNeedsLoad;
  const conflictSteps = conflict ? getIntakeSteps(answersFromCase(conflict).visaType) : [];
  const conflictCanRetry = !!conflict && conflictSteps.includes(step)
    && conflictSteps.indexOf(step) <= conflictSteps.indexOf(conflict.intake?.step ?? "basics");
  const hasDraftChanges = !!savedAnswers.current && !equal(answers, savedAnswers.current);
  const savedReview = caseState ? answersFromCase(caseState) : answers;
  const activeRows = summaryRows(step === "review" ? { ...savedReview, notes: answers.notes } : answers);
  const selectedCriteria = CRITERIA.filter(criterion => answers.criteria.includes(criterion.id));
  const isEB1A = answers.visaType === "eb1a";

  return <div className={styles.setup}>
    <header className={styles.header}>
      <a className={styles.brand} href="/" aria-label="Harness Law home"><Scale size={27} /><span>Harness Law</span></a>
      <span className={styles.headerNote}><ShieldCheck size={17} /><span>Your private intake</span></span>
    </header>
    <main className={styles.main}>
      <div className={styles.progressHeader}><span>{completed ? "YOUR INTAKE" : "LET’S GET TO KNOW YOU"}</span><span>{completed ? "Answers saved" : `Step ${position + 1} of ${sequence.length}`}</span></div>
      <div className={styles.progressTrack} role="progressbar" aria-label="Intake progress" aria-valuemin={0} aria-valuemax={sequence.length} aria-valuenow={completed ? sequence.length : position + 1} aria-valuetext={completed ? "Intake complete" : `Step ${position + 1} of ${sequence.length}: ${INTAKE_STEP_LABELS[step]}`}><span style={{ width: `${completed ? 100 : ((position + 1) / sequence.length) * 100}%` }} /></div>

      {loading && <section className={styles.card}><div className={styles.loading} aria-live="polite"><Loader2 className={styles.spinner} size={28} /><h1>Getting your intake ready…</h1><p>We’ll pick up from your saved answers.</p></div></section>}
      {!loading && !caseState && <section className={`${styles.card} ${styles.loadError}`}><h1>Let’s try that again.</h1><p role="alert">{error}</p>{sessionExpired ? <a className={styles.primary} href={signInPath} target="_top">Sign in to your account</a> : <button className={styles.primary} onClick={() => void loadCase()}>Retry loading your answers</button>}<a className={styles.quietLink} href="/">Back to home</a></section>}

      {!loading && caseState && !completed && <form onSubmit={event => void saveStep(event)} className={styles.card}>
        <div className={styles.cardTop}><span className={styles.sectionLabel}>{INTAKE_STEP_LABELS[step]}</span><span className={styles.savedLabel}>{!hasDraftChanges && <Check size={14} />}{saving ? "Saving…" : hasDraftChanges ? "Unsaved answers" : caseState.intake ? "Progress saved" : "Signed in"}</span></div>
        <div className={styles.stepHeading}><h1 ref={heading} tabIndex={-1}>{headings[step].title}</h1><p>{headings[step].description}</p></div>
        <fieldset className={styles.fields} disabled={saving}>
          <legend className={styles.srOnly}>{INTAKE_STEP_LABELS[step]}</legend>
          {step === "basics" && <>
            <label className={styles.field}><span>Full name</span><input name="full-name" autoComplete="name" required maxLength={500} value={answers.fullName} onChange={event => patch("fullName", event.target.value)} placeholder="Applicant’s full name" /><small>Complete this intake for one applicant. You can enter an employee or family member’s name here.</small></label>
            <label className={styles.field}><span>Account email</span><input type="email" value={initialEmail} readOnly autoComplete="email" /><small>Connected to the account you used to sign in.</small></label>
            <label className={styles.field}><span>Phone number <em>Optional</em></span><input type="tel" name="phone" autoComplete="tel" maxLength={100} value={answers.phone} onChange={event => patch("phone", event.target.value)} placeholder="Include your country code" /></label>
            <div className={styles.questionLabel}>I need immigration help for…</div>
            <div className={styles.twoOptions}>{([{ id: "myself", label: "Myself or my family" }, { id: "employees", label: "My employees" }] as const).map(option => <label key={option.id} className={`${styles.choice} ${answers.helpFor === option.id ? styles.selected : ""}`}><input type="radio" name="help-for" required checked={answers.helpFor === option.id} onChange={() => patch("helpFor", option.id)} /><span>{option.label}</span></label>)}</div>
          </>}
          {step === "visa" && <div className={styles.visaOptions}>{VISA_OPTIONS.map(option => <label key={option.id} className={`${styles.choice} ${styles.visaChoice} ${answers.visaType === option.id ? styles.selected : ""}`}><input type="radio" name="visa-type" required checked={answers.visaType === option.id} onChange={() => chooseVisa(option.id)} /><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}</div>}
          {step === "birth" && <>
            <Picker key="birth-picker" label="Country of birth" placeholder="Select your country of birth" options={BIRTH_COUNTRIES.map(country => ({ value: country.code, label: country.name }))} selected={answers.birthCountry ? [answers.birthCountry] : []} disabled={saving} onChoose={value => { patch("birthCountry", value); if (value !== "OTHER") patch("birthCountryOther", ""); }} />
            {answers.birthCountry === "OTHER" && <label className={styles.field}><span>Country or territory as recorded at birth</span><input required maxLength={200} value={answers.birthCountryOther} onChange={event => patch("birthCountryOther", event.target.value)} placeholder="Enter the country or territory" /></label>}
          </>}
          {step === "citizenships" && <>
            <Picker key="citizenships-picker" label="Citizenships" placeholder="Select countries" options={CITIZENSHIP_OPTIONS.map(country => ({ value: country.code, label: country.name }))} selected={answers.citizenships} multiple disabled={saving} onChoose={toggleCitizenship} />
            <p className={styles.helpText}>Choose all that apply. If you have no citizenship, select “Stateless / no citizenship.”</p>
            {answers.visaType === "e1" && <aside className={styles.guidance}><strong>A note about E-1 treaty traders</strong><p>E-1 generally requires nationality of a treaty country and qualifying international trade. Select all your citizenships, even if your country is not listed. You can continue and save your answers.</p><a href="https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/fees/treaty.html" target="_blank" rel="noopener noreferrer">View the official E-1 treaty-country list and qualifications</a></aside>}
          </>}
          {step === "background" && <>
            <label className={styles.field}><span>Professional field</span><input name="professional-field" autoComplete="off" list="professional-fields" required maxLength={500} value={answers.field} onChange={event => patch("field", event.target.value)} placeholder="e.g. Technology and engineering" /></label>
            <datalist id="professional-fields"><option value="Science and research" /><option value="Technology and engineering" /><option value="Arts and creative work" /><option value="Business and entrepreneurship" /><option value="Education" /><option value="Athletics" /></datalist>
            <label className={styles.field}><span>Current or most recent role</span><input name="professional-role" autoComplete="organization-title" required maxLength={500} value={answers.role} onChange={event => patch("role", event.target.value)} placeholder="e.g. Software engineer" /><small>If you’re studying, between roles, or applying for someone else, tell us that here.</small></label>
          </>}
          {step === "criteria" && <>
            <Picker key="criteria-picker" label="EB-1A criteria" placeholder="Select the criteria that may apply" options={CRITERIA.map(criterion => ({ value: criterion.id, label: criterion.title, description: criterion.description }))} selected={answers.criteria} multiple disabled={saving} onChoose={toggleCriterion} />
            <label className={styles.unsure}><input type="checkbox" checked={answers.criteriaUnsure} onChange={event => setAnswers(current => ({ ...current, criteriaUnsure: event.target.checked, ...(event.target.checked ? { criteria: [] } : {}) }))} /><span>I’m not sure which criteria apply yet</span></label>
            <div className={styles.awardQuestion}><h2>Have you received a major, internationally recognized award?</h2><p>This is a separate evidence route, distinct from the ten criteria above.</p><div className={styles.awardOptions}>{([{ id: "yes", label: "Yes" }, { id: "no", label: "No" }, { id: "unsure", label: "Not sure" }] as const).map(option => <label key={option.id} className={`${styles.choice} ${answers.majorAward === option.id ? styles.selected : ""}`}><input type="radio" name="major-award" required checked={answers.majorAward === option.id} onChange={() => patch("majorAward", option.id)} /><span>{option.label}</span></label>)}</div></div>
            <p className={styles.helpText}>You can continue while you’re still exploring. <a href={GUIDANCE_URL} target="_blank" rel="noopener noreferrer">Read the USCIS EB-1A guidance</a>.</p>
          </>}
          {step === "review" && <>
            <dl className={styles.summary}>{activeRows.filter(row => row.step !== "review").map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd><button type="button" disabled={blocked} onClick={() => editStep(row.step)} aria-label={`Edit ${row.label.toLowerCase()}`}>Edit</button></div>)}</dl>
            <label className={styles.field}><span>Anything else we should know? <em>Optional</em></span><textarea rows={4} maxLength={3000} value={answers.notes} onChange={event => patch("notes", event.target.value)} placeholder="Your plans, timeline, or questions you want to explore" /><small>{answers.notes.length.toLocaleString()} / 3,000 characters</small></label>
            <p className={styles.factNote}><ShieldCheck size={18} /><span>Your answers personalize your preparation. Case facts and evidence still need review.</span></p>
          </>}
        </fieldset>
        {error && <div className={styles.error} role="alert"><p>{error}</p>{sessionExpired && <><a href={signInPath} target="_blank" rel="noopener noreferrer">Sign in again (new tab)</a><p>Then return here and retry. Use the same account and sign-in method.</p></>}{conflictNeedsLoad && <button type="button" disabled={saving} onClick={() => void loadLatestForComparison()}>Load latest saved answers</button>}</div>}
        {conflict && <section className={styles.conflict} aria-label="Compare saved intake"><h2>Latest saved answers</h2><dl>{summaryRows(answersFromCase(conflict)).map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl><p>{!conflictCanRetry ? "The saved visa choice or intake progress changed. Continue from the saved answers to answer the questions in the updated flow. Your draft remains above for you to copy before replacing it." : step === "review" ? "Finishing uses the saved answers above and the additional context you entered. Use saved answers to review them first, or finish with those answers." : "Your draft remains above. Retry saves only this question onto the latest case. Use saved answers replaces this window’s draft with the latest saved intake."}</p><div className={styles.conflictActions}><button type="button" className={styles.secondary} disabled={saving} onClick={() => { adoptSaved(conflict); setError(""); }}>Use saved answers</button>{conflictCanRetry && <button type="button" className={styles.primary} disabled={saving} onClick={() => void saveStep(undefined, conflict)}>{step === "review" ? "Finish with saved answers" : "Keep this answer and retry"}</button>}</div></section>}
        <div className={styles.actions}><button type="button" className={styles.back} disabled={blocked || position === 0} onClick={() => editStep(sequence[position - 1])}>Back</button><button type="submit" className={styles.primary} disabled={blocked}>{saving ? <><Loader2 className={styles.spinner} size={17} />Saving…</> : step === "review" ? "Finish my intake" : "Continue"}</button></div>
        <p className={styles.saveNote}>Your answers save when you continue.</p>
      </form>}

      {!loading && caseState && completed && <section className={`${styles.card} ${styles.success}`}>
        <div className={styles.successIcon}><CheckCircle2 size={32} /></div><span className={styles.sectionLabel}>A CLEARER STARTING POINT</span><h1 ref={heading} tabIndex={-1}>Your answers are saved.</h1><p>{isEB1A ? "Your EB-1A preparation can start with the experience you’ve shared." : `Your ${visaLabel(answers.visaType)} interest is saved here. The preparation workspace currently supports EB-1A.`}</p>
        <dl className={styles.summary}>{summaryRows(answers).map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd><button type="button" onClick={() => editStep(row.step)} aria-label={`Edit ${row.label.toLowerCase()}`}>Edit</button></div>)}</dl>
        {isEB1A && selectedCriteria.length > 0 && <section className={styles.evidenceNext}><h2>Useful evidence to gather</h2><p>A starting checklist for the criteria you chose.</p><ul>{selectedCriteria.map(criterion => <li key={criterion.id}><Check size={16} /><div><strong>{criterion.title}</strong><span>{criterion.examples.join(" · ")}</span></div></li>)}</ul></section>}
        {isEB1A && answers.majorAward === "yes" && <aside className={styles.guidance}><strong>Your major award</strong><p>Gather the award record and information about its international recognition. This evidence route needs its own review.</p></aside>}
        <div className={styles.completionActions}>{isEB1A ? <a className={styles.primary} href="/workspace">Open my EB-1A workspace</a> : <a className={styles.primary} href="/">Back to Harness Law</a>}<button className={styles.secondary} type="button" onClick={() => editStep("basics")}>Update my answers</button></div>
        {!isEB1A && <a className={styles.quietLink} href="/workspace?sample=1">Explore the fictional EB-1A sample</a>}
      </section>}
    </main>
    <footer className={styles.footer}>A thoughtful first step toward your next chapter.</footer>
  </div>;
}
