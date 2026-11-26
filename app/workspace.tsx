"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDownToLine, ArrowLeft, Award, BookOpen, BriefcaseBusiness, Check, CheckCheck, CheckCircle2, ChevronRight, Circle, CircleHelp, Clock3, ExternalLink, FileCheck2, FileText, Fingerprint, FolderOpen, History, LayoutDashboard, ListChecks, Loader2, LockKeyhole, LogIn, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Search, Settings2, ShieldCheck, Upload, UserRound, UsersRound, X, AlertCircle, Link2, Trash2, Undo2, UnlockKeyhole, Scale, Quote, Eye, PencilLine } from "lucide-react";
import { CRITERIA, applyAction, createEmptyCase, createSampleCase, criterionReady, currentResult, getBlockers, runBlockers, type CaseState, type Claim, type Evidence, type Action } from "@/lib/model";
import { getOnboardingNextStep } from "@/lib/onboarding";
import { VISA_OPTIONS } from "@/lib/intake-catalog";
import { countryName } from "@/lib/countries";
import { FileFormImport } from "@/components/file-form-import";
import { CASE_NAME_IMPORT_FIELDS, DRAFT_IMPORT_FIELDS, PROFILE_IMPORT_FIELDS, PROFESSIONAL_IMPORT_FIELDS, WORKSHEET_IMPORT_FIELDS, factImportFields } from "@/lib/form-import-fields";
import type { ImportValue } from "@/lib/form-import";
import "./workspace-polish.css";
import { BrandLogo, BrandMark } from "@/components/brand-logo";
import { WorkspaceHelp } from "@/components/workspace-help";
import { EvidenceLibraryProvider } from "@/components/evidence-library-context";
import { EvidenceDrive } from "@/components/evidence-drive";
import { AnalyticsTracker } from "@/components/analytics-tracker";
import { EvidenceRequestError, uploadEvidenceFile, readEvidenceFile, deleteEvidenceItem } from "@/lib/evidence-client";
import { planEvidenceUpload } from "@/lib/evidence-upload-plan";
const importTextPatch = (patch: Record<string, ImportValue>): Record<string, string> => Object.fromEntries(Object.entries(patch).filter((entry): entry is [string, string] => typeof entry[1] === "string"));

type User = { userId: string; displayName: string; email: string } | null;
type SaveStatus = "loading" | "sample" | "saved" | "saving" | "error" | "conflict";
type ModalState = { kind: "source"; citation: Claim["citations"][number]; claim: string } | { kind: "evidence"; sourceId: string } | { kind: "history"; claim: Claim } | { kind: "reset" } | { kind: "consent" } | null;
const NAV = [
  { id: "dashboard", label: "Overview", icon: LayoutDashboard },
  { id: "profile", label: "Your profile", icon: UserRound },
  { id: "criteria", label: "Your criteria", icon: ListChecks },
  { id: "evidence", label: "Evidence library", icon: FolderOpen },
  { id: "composition", label: "Compose your case", icon: BookOpen },
  { id: "draft", label: "Working draft", icon: PencilLine },
  { id: "forms", label: "Application forms", icon: FileText },
  { id: "review", label: "Final review", icon: ShieldCheck },
];
const readable = (value: string) => value.replaceAll("_", " ").replace(/^./, s => s.toUpperCase());
const dateLabel = (value: string | number) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
function Pill({ children, tone = "gray" }: { children: ReactNode; tone?: string }) { return <span className={`pill ${tone}`}><span className="dot" />{children}</span>; }
function Field({ label, value, onChange, multiline, hint, type = "text" }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; hint?: string; type?: string }) {
  return <label className={`field ${multiline ? "full" : ""}`}><span className="field-label">{label}</span>{multiline ? <textarea className="textarea" rows={4} value={value} onChange={e => onChange(e.target.value)} /> : <input className="input" type={type} value={value} onChange={e => onChange(e.target.value)} />}{hint && <span className="field-help">{hint}</span>}</label>;
}
function EmptyState({ icon = <FolderOpen size={28} />, title, children, action }: { icon?: ReactNode; title: string; children: ReactNode; action?: ReactNode }) { return <div className="empty-state">{icon}<h3>{title}</h3><p>{children}</p>{action}</div>; }
function Dialog({ title, children, onClose, drawer = false }: { title: string; children: ReactNode; onClose: () => void; drawer?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    box.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key === "Tab") {
        const focusable = box.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]');
        if (!focusable?.length) { event.preventDefault(); return; }
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === box.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === box.current)) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", keyboard); opener?.focus(); };
  }, []);
  return <div className={`modal-backdrop ${drawer ? "drawer-backdrop" : ""}`} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="dialog-title" className={drawer ? "source-drawer" : "modal"}><div className="modal-header"><div><span className="eyebrow">HARNESS LAW WORKSPACE</span><h2 id="dialog-title">{title}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button></div><div className="modal-body">{children}</div></div></div>;
}

function ClaimCard({ claim, target, stale, dispatch, openSource, openHistory, notify, importDisabled, importContext }: { importDisabled: boolean; importContext: string; claim: Claim; target: string; stale: boolean; dispatch: (action: Action) => void; openSource: (citation: Claim["citations"][number], text: string) => void; openHistory: (claim: Claim) => void; notify: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(claim.text);
  return <article className="claim-card">
    <div className="claim-header"><span className="eyebrow">PARAGRAPH · REVISION {claim.revision}</span><div className="inline-actions"><button className="icon-button" title="Version history" aria-label="View paragraph version history" onClick={() => openHistory(claim)}><History size={16} /></button><button className="icon-button" aria-label={claim.locked ? "Unlock paragraph" : "Lock paragraph"} title={claim.locked ? "Unlock paragraph" : "Lock paragraph"} onClick={() => { dispatch({ type: "lock_claim", target, claimId: claim.id, locked: !claim.locked }); notify(claim.locked ? "Paragraph unlocked." : "Paragraph locked. Its text will be preserved during sample runs."); }}>{claim.locked ? <LockKeyhole size={16} /> : <UnlockKeyhole size={16} />}</button></div></div>
    {editing ? <div className="claim-edit"><FileFormImport fields={DRAFT_IMPORT_FIELDS} values={{ text }} contextKey={`${importContext}:${target}:${claim.id}:${claim.revision}`} disabled={importDisabled || claim.locked} saveNote="Apply fills your editor. Use Save revision to save it and reset evidence support and review." onApply={patch => { if (typeof patch.text === "string") setText(patch.text); }} /><label className="field"><span className="field-label">Edit paragraph</span><textarea className="textarea" rows={5} value={text} onChange={e => setText(e.target.value)} /></label><div className="inline-actions"><button className="button primary small" disabled={!text.trim() || claim.locked} onClick={() => { dispatch({ type: "edit_claim", target, claimId: claim.id, text }); setEditing(false); notify("New paragraph revision saved. Evidence support and human review need to be checked again."); }}>Save revision</button><button className="button ghost small" onClick={() => setEditing(false)}>Cancel</button></div></div> : <p className="claim-text">{claim.text}</p>}
    <div className="claim-citations">{claim.citations.map((citation, index) => <button key={`${citation.sourceId}-${index}`} className="citation" onClick={() => openSource(citation, claim.text)}><Quote size={13} /> Source {index + 1} · p. {citation.page}<ChevronRight size={12} /></button>)}{claim.citations.length === 0 && <span className="field-help">No supporting source attached</span>}</div>
    <div className="claim-footer"><div className="inline-actions"><Pill tone={claim.supportStatus === "supported" ? "green" : "amber"}>{readable(claim.supportStatus)}</Pill><Pill tone={claim.reviewStatus !== "unreviewed" ? "green" : "gray"}>{readable(claim.reviewStatus)}</Pill></div>{!editing && <button className="link-button" disabled={claim.locked} onClick={() => { setText(claim.text); setEditing(true); }}><PencilLine size={14} /> {claim.locked ? "Locked" : "Edit paragraph"}</button>}</div>
    <div className="review-controls"><label>Evidence support<select className="select" aria-label="Evidence support" value={claim.supportStatus} disabled={stale} onChange={e => { dispatch({ type: "review_claim", target, claimId: claim.id, supportStatus: e.target.value as Claim["supportStatus"] }); notify("Evidence-support decision recorded for this revision."); }}><option value="unassessed">Unassessed</option><option value="supported" disabled={!claim.citations.length}>Supported</option><option value="needs_review">Needs review</option><option value="conflicting">Conflicting</option><option value="evidence_missing">Evidence missing</option></select></label><button className="button secondary small" disabled={stale || claim.reviewStatus === "applicant_reviewed"} onClick={() => { dispatch({ type: "review_claim", target, claimId: claim.id, reviewStatus: "applicant_reviewed" }); notify("Your review is recorded on this paragraph revision."); }}><Check size={15} />{claim.reviewStatus === "applicant_reviewed" ? "Applicant reviewed" : "Mark applicant reviewed"}</button>{claim.history.length > 0 && <button className="link-button" disabled={claim.locked} onClick={() => { dispatch({ type: "undo_claim", target, claimId: claim.id }); notify("Previous wording restored as a new revision. Review is required again."); }}><Undo2 size={14} />Undo edit</button>}</div>
    {stale && <p className="field-help">This source result changed. Update the section before recording a new review.</p>}
  </article>;
}

function FactCard({ fact, document, dispatch, openSource, notify, importDisabled, importContext }: { importDisabled: boolean; importContext: string; fact: CaseState["facts"][number]; document?: Evidence; dispatch: (action: Action) => void; openSource: (citation: Claim["citations"][number], text: string) => void; notify: (text: string) => void }) {
  const [correcting, setCorrecting] = useState(false);
  const [value, setValue] = useState(fact.value);
  const [reason, setReason] = useState(fact.reason);
  return <article className="panel fact-card"><div className="panel-header"><h3>{fact.label}</h3><Pill tone={fact.status === "confirmed" || fact.status === "corrected" ? "green" : "amber"}>{readable(fact.status)}</Pill></div><div className="panel-body"><div className="field-grid"><div><span className="field-label">Source value</span><p className="fact-value">{fact.originalValue}</p></div><div><span className="field-label">Current value</span><p className="fact-value">{fact.value}</p></div></div><button className="citation fact-source" disabled={!document} onClick={() => document && openSource({ sourceId: document.id, sourceVersion: document.version, page: fact.page, quote: document.excerpt }, fact.label)}><FileText size={14} />{document?.name || "Source unavailable"} · p. {fact.page}</button><p className="field-help">{fact.reason || "Compare the source and confirm the fact before relying on it."}</p>{correcting && <><FileFormImport fields={factImportFields(fact.label)} values={{ value, reason }} contextKey={`${importContext}:${fact.id}:${fact.value}`} disabled={importDisabled} saveNote="Apply fills your correction draft. Compare it with the original source and use Save correction." onApply={patch => { if (typeof patch.value === "string") setValue(patch.value); if (typeof patch.reason === "string") setReason(patch.reason); }} /><div className="field-grid"><Field label="Corrected value" value={value} onChange={setValue} /><Field label="Reason for correction" value={reason} onChange={setReason} hint="The original source value remains in the record." /></div></>}<div className="fact-actions">{correcting ? <><button className="button primary small" disabled={!value.trim() || !reason.trim()} onClick={() => { dispatch({ type: "fact", id: fact.id, value, reason, status: "corrected" }); setCorrecting(false); notify("Correction saved with its reason. Dependent sections need renewed review."); }}>Save correction</button><button className="button ghost small" onClick={() => setCorrecting(false)}>Cancel</button></> : <><button className="button secondary small" onClick={() => { dispatch({ type: "fact", id: fact.id, status: "confirmed" }); notify("Fact confirmed."); }}><Check size={14} />Confirm</button><button className="button ghost small" onClick={() => { setValue(fact.value); setCorrecting(true); }}>Correct value</button><button className="button ghost small" onClick={() => { dispatch({ type: "fact", id: fact.id, status: "unresolved" }); notify("Fact left unresolved for later review."); }}>Leave unresolved</button><button className="link-button" onClick={() => { dispatch({ type: "fact", id: fact.id, status: "issue", reason: "Applicant reported a source inconsistency. Review the original document." }); notify("Source issue recorded for review."); }}>Report issue</button></>}</div></div></article>;
}

export default function Workspace({ user, forceSample = false, canAccessAdmin = false, showOverview = false }: { user: User; forceSample?: boolean; canAccessAdmin?: boolean; showOverview?: boolean }) {
  const [state, setState] = useState<CaseState>(() => user && !forceSample ? createEmptyCase() : createSampleCase());
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(user && !forceSample ? "loading" : "sample");
  const [saveMessage, setSaveMessage] = useState("");
  const [savePulse, setSavePulse] = useState(0);
  const [toast, setToast] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [profileTab, setProfileTab] = useState("personal");
  const [evidenceFilter, setEvidenceFilter] = useState("all");
  const [selectedCriteria, setSelectedCriteria] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [uploadNotice, setUploadNotice] = useState("");
  const failedDirectory = useRef(false);
  const uploadInFlight = useRef(false);
  const failedReplacementId = useRef<string | null>(null);
  const uploadFolderId = useRef<string | null>(null);
  const failedFolderId = useRef<string | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [manualText, setManualText] = useState("");
  const [caseLoaded, setCaseLoaded] = useState(!user || forceSample);
  const [hasPersonalSnapshot, setHasPersonalSnapshot] = useState(false);
  const [remoteConflict, setRemoteConflict] = useState<{ state: CaseState; revision: number } | null>(null);
  const stateRef = useRef(state);
  const serverRevision = useRef(0);
  const dirty = useRef(false);
  const changeVersion = useRef(0);
  const saving = useRef(false);
  const loaded = useRef(!user || forceSample);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const replacementId = useRef<string | null>(null);
  const failedFiles = useRef<File[]>([]);
  const failedUploadContext = useRef("");
  const personalSnapshot = useRef<CaseState | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const page = state.lastPage === "facts" ? "evidence" : state.lastPage === "overview" ? "dashboard" : state.lastPage === "final" ? "review" : state.lastPage || "dashboard";

  useEffect(() => {
    try { setSidebarCollapsed(window.localStorage.getItem("harness-law:sidebar-collapsed") === "1"); } catch { /* Keep navigation usable when browser storage is unavailable. */ }
  }, []);
  useEffect(() => {
    failedFiles.current = []; failedUploadContext.current = "";
    failedFolderId.current = null; failedReplacementId.current = null; failedDirectory.current = false;
    setUploadError(""); setUploadNotice("");
  }, [state.id, state.mode, user?.userId]);
  function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try { window.localStorage.setItem("harness-law:sidebar-collapsed", next ? "1" : "0"); } catch { /* The toggle still works for this session. */ }
  }

  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 5500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    if (!user || forceSample) return;
    let active = true;
    fetch("/api/case", { credentials: "same-origin", headers: { "X-Harness-Account": user.userId } }).then(async response => {
      if (!response.ok) throw new Error(response.status === 401 ? "Your session has expired. Sign in again to recover your saved case." : "We could not load your case. Try again before making changes.");
      const result = await response.json() as { state: CaseState; revision: number };
      if (!active) return;
      serverRevision.current = result.revision;
      const openedState = showOverview ? { ...result.state, lastPage: "dashboard" } : result.state;
      stateRef.current = openedState;
      setState(openedState);
      loaded.current = true;
      setCaseLoaded(true);
      setSaveStatus("saved");
    }).catch(error => { if (active) { setSaveStatus("error"); setSaveMessage(error.message); } });
    return () => { active = false; };
  }, [user, forceSample, showOverview]);

  const persist = useCallback(async () => {
    if (!user || forceSample || !loaded.current || saving.current || !dirty.current || stateRef.current.mode === "sample") return;
    saving.current = true;
    const version = changeVersion.current;
    const snapshot = { ...stateRef.current, revision: serverRevision.current };
    setSaveStatus("saving");
    try {
      const response = await fetch("/api/case", { method: "PUT", headers: { "Content-Type": "application/json", "X-Harness-Account": user.userId }, credentials: "same-origin", body: JSON.stringify({ state: snapshot, expectedRevision: serverRevision.current }) });
      const result = await response.json() as { state: CaseState; revision: number; error?: string };
      if (response.status === 409) { setRemoteConflict({ state: result.state, revision: result.revision }); setSaveStatus("conflict"); setSaveMessage("This case changed in another window. Your local changes are still here. Choose which version to keep."); return; }
      if (!response.ok) throw new Error(response.status === 401 ? "Your session expired. Your edits are still in this window. Sign in again, then retry." : result.error || "Your changes could not be saved. Check your connection and retry.");
      serverRevision.current = result.revision;
      stateRef.current = { ...stateRef.current, revision: result.revision };
      setState(stateRef.current);
      if (version === changeVersion.current) { dirty.current = false; setSaveStatus("saved"); setSaveMessage(""); } else { setSaveStatus("saving"); setSavePulse(value => value + 1); }
    } catch (error) { setSaveStatus("error"); setSaveMessage(error instanceof Error ? error.message : "Save failed. Your local changes are preserved."); }
    finally { saving.current = false; }
  }, [user, forceSample]);

  useEffect(() => {
    if (!user || !loaded.current || !dirty.current || uploading || deleting || saveStatus === "conflict" || saveStatus === "error") return;
    const timer = setTimeout(() => { void persist(); }, 900);
    return () => clearTimeout(timer);
  }, [state, saveStatus, savePulse, persist, user, uploading, deleting]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (dirty.current && stateRef.current.mode === "personal") { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const dispatch = useCallback((action: Action) => {
    if (user && !loaded.current) { notify("Load your saved case before making changes."); return; }
    if (deletingRef.current && action.type !== "navigate") { notify("Wait for deletion to finish before editing your case."); return; }
    if (action.type === "remove_document" && uploadInFlight.current) { notify("Finish the current upload before removing a source."); return; }
    try {
      const next = applyAction(stateRef.current, action);
      stateRef.current = next;
      setState(next);
      dirty.current = next.mode === "personal";
      changeVersion.current++;
      if (user && next.mode === "personal" && saveStatus !== "conflict") setSaveStatus("saving");
    } catch (error) { notify(error instanceof Error ? error.message : "This change is not available."); }
  }, [notify, saveStatus, user]);
  function navigate(next: string) { dispatch({ type: "navigate", page: next === "facts" ? "evidence" : next }); setMobileOpen(false); window.scrollTo({ top: 0, behavior: "instant" }); }
  function downloadText(text: string, name: string, type = "text/plain;charset=utf-8") { const url = URL.createObjectURL(new Blob([text], { type })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  function downloadLocal() { downloadText(JSON.stringify(stateRef.current, null, 2), "harness-law-local-recovery.json", "application/json"); notify("Your local case copy has been downloaded."); }

  function exploreSample() {
    if (uploadInFlight.current) { notify("Finish the current upload before switching cases."); return; }
    if (state.mode === "personal") {
      if (dirty.current || saving.current) { notify("Finish saving your personal case, then open the sample."); return; }
      personalSnapshot.current = state;
      setHasPersonalSnapshot(true);
      const sample = createSampleCase(); stateRef.current = sample; setState(sample); setSaveStatus("sample"); dirty.current = false;
      notify("Fictional sample opened. Your personal case is safely kept separate.");
    } else if (personalSnapshot.current) {
      stateRef.current = personalSnapshot.current; setState(personalSnapshot.current); personalSnapshot.current = null; setHasPersonalSnapshot(false); dirty.current = false; setSaveStatus("saved");
      notify("Returned to your saved personal case.");
    }
  }
  function resetCase() {
    if (forceSample) { window.location.assign('/workspace'); return; }
    if (uploadInFlight.current) { notify("Finish the current upload before creating another case."); return; }
    failedFiles.current = []; failedReplacementId.current = null; setUploadError("");
    const next = createEmptyCase();
    if (user) next.profile.email = user.email;
    next.onboarding = { version: 1, step: 1 };
    stateRef.current = next; setState(next); personalSnapshot.current = null; setHasPersonalSnapshot(false); dirty.current = true; changeVersion.current++; setSaveStatus(user ? "saving" : "sample"); setModal(null); notify("Your new personal workspace is ready.");
  }
  function startRun(criterion: string) {
    const blockers = runBlockers(stateRef.current, criterion);
    if (blockers.length) { notify(blockers[0]); return; }
    dispatch({ type: "start_run", criterion });
    const generation = stateRef.current.runs[criterion].generation;
    timers.current.push(setTimeout(() => { dispatch({ type: "finish_run", criterion, generation }); notify("Sample run completed. Evidence support and human review are separate checks."); }, 1800));
  }
  function requestUpload(sourceId: string | null = null, folderId: string | null = null, kind: "files" | "folder" = "files") {
    if (uploadInFlight.current) { notify("Wait for the current upload batch to finish."); return; }
    if (!user) { notify("Sign in and start a personal case to upload private documents. Sample files are fictional."); return; }
    if (state.mode === "sample") { notify("Return to your personal case before uploading a document."); return; }
    if (!state.consent) { setModal({ kind: "consent" }); return; }
    replacementId.current = sourceId; uploadFolderId.current = folderId;
    if (kind === "folder") { if (folderInput.current) { folderInput.current.value = ""; folderInput.current.click(); } return; }
    if (fileInput.current) { fileInput.current.multiple = !sourceId; fileInput.current.click(); }
  }
  function evidenceFailure(error: unknown) {
    if (error instanceof EvidenceRequestError && error.status === 409 && error.state && error.revision !== undefined) {
      setRemoteConflict({ state: error.state, revision: error.revision }); setSaveStatus("conflict");
      setSaveMessage("Your case changed during the evidence update. Compare the saved version before retrying.");
    }
    return error instanceof Error ? error.message : "The file could not be saved. Retry this file.";
  }
  async function retainFile(file: File, folderId: string | null = null, replacementSourceId: string | null = null): Promise<Evidence> {
    if (!user || stateRef.current.mode !== "personal" || !loaded.current) throw new Error("Open your signed-in personal case to upload files.");
    if (!stateRef.current.consent) throw new Error("Review and save file storage consent first.");
    if (saving.current) throw new Error("Wait for your current changes to finish saving, then try again.");
    if (dirty.current) { await persist(); if (dirty.current) throw new Error("Save your current case changes successfully before uploading."); }
    const base = { ...stateRef.current, revision: serverRevision.current };
    const localVersion = changeVersion.current;
    const result = await uploadEvidenceFile(file, user.userId, base, folderId, replacementSourceId);
    if (stateRef.current.id !== base.id || stateRef.current.mode !== "personal") throw new Error("The case changed. Your upload stays with its original case.");
    if (changeVersion.current !== localVersion && (result.replayed || result.revision !== base.revision + 1)) {
      throw new EvidenceRequestError("A newer case version was saved. Compare it before continuing.", 409, result.state, result.revision);
    }
    const changed = changeVersion.current !== localVersion;
    const next = changed ? { ...applyAction(stateRef.current, { type: "complete_upload", caseId: base.id, document: result.document, replacementSourceId }), revision: result.revision } : result.state;
    serverRevision.current = result.revision; stateRef.current = next; setState(next);
    dirty.current = changed; setSaveStatus(changed ? "saving" : "saved");
    return next.documents.find(document => document.objectId === result.document.objectId) ?? result.document;
  }
  async function importFile(file: File, signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("Canceled", "AbortError");
    if (uploadInFlight.current) throw new Error("Wait for the current upload to finish.");
    uploadInFlight.current = true; setUploading(true);
    try { return await retainFile(file); }
    catch (error) { evidenceFailure(error); throw error; }
    finally { uploadInFlight.current = false; setUploading(false); }
  }
  async function grantFileConsent() {
    if (!user || stateRef.current.mode !== "personal") throw new Error("Open your personal case to save file storage consent.");
    if (saving.current || uploadInFlight.current) throw new Error("Wait for the current save or upload to finish.");
    dispatch({ type: "consent", value: true }); await persist();
    if (dirty.current || !stateRef.current.consent) throw new Error("Consent was not saved. Resolve the save message before uploading.");
  }
  async function uploadFiles(files: File[], replacementSourceId: string | null = null, folderId: string | null = null, directory = false) {
    if (!files.length) return;
    if (uploadInFlight.current) { notify("Wait for the current evidence update to finish."); return; }
    if (!user || stateRef.current.mode === "sample") { notify("Private uploads require a signed-in personal case."); return; }
    if (!stateRef.current.consent) { setModal({ kind: "consent" }); return; }
    if (replacementSourceId && files.length !== 1) { setUploadError("Choose exactly one file to replace this source."); return; }
    uploadInFlight.current = true; setUploading(true); setUploadError(""); setUploadNotice("");
    failedFiles.current = []; failedReplacementId.current = replacementSourceId; failedFolderId.current = folderId; failedDirectory.current = directory;
    failedUploadContext.current = `${user.userId}:${stateRef.current.id}`;
    let completed = 0;
    try {
      if (saving.current) throw new Error("Wait for your current changes to finish saving, then choose the folder or files again.");
      const plan = planEvidenceUpload(files, stateRef.current.folders ?? [], folderId, stateRef.current.documents.length - (replacementSourceId ? 1 : 0), directory);
      if (plan.skipped.length) setUploadNotice(`Skipped ${plan.skipped.length}: ${plan.skipped.slice(0, 5).join("; ")}${plan.skipped.length > 5 ? "; plus additional unsupported files" : ""}.`);
      if (!plan.entries.length) { setUploadError("No supported files were selected. Choose non-empty documents up to 20 MB each."); return; }
      if (plan.folders.length) {
        let next = stateRef.current;
        for (const folder of plan.folders) next = applyAction(next, { type: "folder_create", folder });
        stateRef.current = next; setState(next); dirty.current = true; changeVersion.current++;
      }
      if (dirty.current) { await persist(); if (dirty.current) throw new Error("Your folder structure could not be saved. Resolve the save message, then retry."); }
      for (const [index, entry] of plan.entries.entries()) {
        setUploadProgress(`Uploading ${index + 1} of ${plan.entries.length}: ${entry.file.name}`);
        try { await retainFile(entry.file, entry.folderId, replacementSourceId); completed++; }
        catch (error) { failedFiles.current.push(...plan.entries.slice(index).map(item => item.file)); setUploadError(evidenceFailure(error)); break; }
      }
      if (completed) notify(`${completed} ${completed === 1 ? "file saved" : "files saved"} to Evidence${directory ? " with their folder structure" : ""}.`);
    } catch (error) { failedFiles.current = files; setUploadError(evidenceFailure(error)); }
    finally { uploadInFlight.current = false; setUploading(false); setUploadProgress(""); if (fileInput.current) fileInput.current.value = ""; if (folderInput.current) folderInput.current.value = ""; }
  }
  function retryUpload() {
    if (failedUploadContext.current !== `${user?.userId}:${stateRef.current.id}` || stateRef.current.mode !== "personal") {
      failedFiles.current = []; setUploadError(""); notify("The upload belonged to another case. Choose files again in this case."); return;
    }
    void uploadFiles([...failedFiles.current], failedReplacementId.current, failedFolderId.current, failedDirectory.current);
  }
  async function deleteEvidence(target: { kind: "file" | "folder"; id: string }) {
    if (uploadInFlight.current) throw new Error("Wait for the current evidence update to finish.");
    if (stateRef.current.mode === "sample") {
      dispatch({ type: "delete_evidence", target });
      notify("Deleted from this fictional sample session."); return;
    }
    if (!user || !loaded.current) throw new Error("Sign in and load your personal case before deleting evidence.");
    if (saving.current || saveStatus === "conflict" || saveStatus === "error") throw new Error("Finish saving or resolve the workspace message before deleting evidence.");
    uploadInFlight.current = true; deletingRef.current = true; setDeleting(true);
    try {
      if (dirty.current) { await persist(); if (dirty.current) throw new Error("Save your changes successfully before deleting evidence."); }
      const base = { ...stateRef.current, revision: serverRevision.current };
      const localVersion = changeVersion.current;
      const result = await deleteEvidenceItem(target, user.userId, base);
      if (stateRef.current.id !== base.id || stateRef.current.mode !== "personal") throw new Error("Your case changed. Refresh to see the saved deletion.");
      // Only navigation can change locally while deletion is in flight.
      const changed = changeVersion.current !== localVersion;
      const next = changed ? { ...result.state, lastPage: stateRef.current.lastPage } : result.state;
      serverRevision.current = result.revision; stateRef.current = next; setState(next); dirty.current = changed;
      setSaveStatus(changed ? "saving" : "saved"); setSaveMessage("");
      notify(result.cleanupPending ? "Removed from Evidence. Private storage cleanup will retry when you reopen the workspace." : target.kind === "folder" ? "Folder and its contents deleted." : "File deleted from Evidence and private storage.");
    } catch (error) { evidenceFailure(error); throw error; }
    finally { uploadInFlight.current = false; deletingRef.current = false; setDeleting(false); }
  }
  async function downloadEvidence(document: Evidence) {
    try {
      const file = await readEvidenceFile(document, user?.userId ?? null, stateRef.current.id);
      const url = URL.createObjectURL(file); const link = window.document.createElement("a"); link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { notify(evidenceFailure(error)); }
  }
  function downloadDraft() {
    const gaps = getBlockers(state);
    const claims = state.composition?.claims || state.criteria.flatMap(id => currentResult(state, id)?.claims || []);
    const text = ["HARNESS LAW — WORKING DRAFT", "NOT FOR FILING · Preparation only", state.mode === "sample" ? "FICTIONAL SAMPLE CASE — all names and documents are illustrative." : "Personal applicant preparation", `Case: ${state.name}`, `Composition: ${state.composition ? `version ${state.composition.version}${state.composition.stale ? " (out of date)" : ""}` : "Not yet assembled"}`, `Exported: ${new Date().toISOString()}`, "", "OPEN ITEMS", ...gaps.map(g => `• ${g.title}: ${g.detail}`), "", "APPLICANT", state.profile.fullName || "[Full name missing]", state.professional.field || "[Professional field missing]", state.professional.intendedWork || "[Intended work missing]", "", "DRAFT SECTIONS", ...claims.flatMap(c => [c.text, `Revision ${c.revision} · support: ${readable(c.supportStatus)} · review: ${readable(c.reviewStatus)}`, ...c.citations.map(citation => { const doc = state.documents.find(d => d.id === citation.sourceId); return `Source: ${doc?.name || citation.sourceId}, version ${citation.sourceVersion}, exhibit ${doc?.exhibit || "unassigned"}, page ${citation.page}\nQuoted passage: ${citation.quote}`; }), c.citations.length ? "" : "[Evidence missing]\n"]), claims.length ? "" : "[No draft paragraphs yet]", "EXHIBIT INDEX — working references, no final pagination", ...state.documents.map(d => `${d.exhibit} · ${d.name} · version ${d.version} · ${readable(d.status)}`), "", "Official form templates, final exhibit pagination, immutable package approval, and finalization are unavailable."].join("\n");
    downloadText(text, `harness-law-working-draft-v${state.composition?.version || 0}.txt`); notify("Working draft downloaded with source references and open items.");
  }
  const openSource = (citation: Claim["citations"][number], claim: string) => setModal({ kind: "source", citation, claim });
  const readyCount = state.criteria.filter(id => criterionReady(state, id)).length;
  const reviewCount = state.criteria.flatMap(id => currentResult(state, id)?.claims || []).filter(c => c.reviewStatus !== "unreviewed").length;
  const isSample = state.mode === "sample";
  const importDisabled = !caseLoaded || uploading || deleting || saveStatus === "saving" || saveStatus === "conflict" || saveStatus === "error";
  const importContext = `${user?.userId ?? "guest"}:${state.id}:${state.mode}:${page}`;
  const importSaveNote = isSample ? "Applied answers stay in this fictional sample session." : "Applied answers use the usual case autosave. Check the save status before leaving.";
  const setupFocus = !state.intake && state.onboarding?.completedAt ? getOnboardingNextStep(state.onboarding.goal) : null;
  const firstName = state.profile.preferredName || state.profile.fullName.split(" ")[0] || user?.displayName.split(" ")[0] || "there";
  const criterionId = page.startsWith("criterion:") ? page.split(":")[1] : null;
  const activeCriterion = CRITERIA.find(c => c.id === criterionId);
  const pageTitle = activeCriterion?.shortTitle || NAV.find(n => n.id === page)?.label || (page === "settings" ? "Settings & privacy" : "Help & guidance");

  function criterionCard(id: string) {
    const criterion = CRITERIA.find(c => c.id === id)!;
    const run = state.runs[id], result = currentResult(state, id);
    const sources = state.documents.filter(d => d.associations.some(a => a.criterion === id && a.status === "confirmed")).length;
    const ready = criterionReady(state, id);
    const status = result?.stale ? "Update needed" : ready ? "Ready to compose" : result ? "Review needed" : "Not started";
    return <article key={id} className="criterion-card"><div className="criterion-top"><span className="criterion-number">{id}</span><Pill tone={ready ? "green" : result ? "amber" : "gray"}>{status}</Pill></div><h3 className="criterion-title">{criterion.title}</h3><p className="criterion-description">{criterion.description}</p><div className="criterion-meta"><span><FolderOpen size={14} />{sources} {sources === 1 ? "source" : "sources"}</span><span><CheckCheck size={14} />{result?.claims.filter(c => c.reviewStatus !== "unreviewed").length || 0} reviewed</span></div><div className="criterion-divider" /><div className="criterion-footer"><span><span className={`dot ${run?.status === "succeeded" ? "green" : ""}`} />{run?.status === "succeeded" ? "Run complete" : readable(run?.status || "idle")}</span><button className="link-button" onClick={() => navigate(`criterion:${id}`)}>Open section<ChevronRight size={15} /></button></div></article>;
  }

  function intakeCard() {
    const intake = state.intake;
    const completed = !!intake?.completedAt;
    const visa = VISA_OPTIONS.find(option => option.id === intake?.answers.visaType)?.label ?? "Your immigration plans";
    const birthplace = intake?.answers.birthCountry === "OTHER" ? intake.answers.birthCountryOther : countryName(intake?.answers.birthCountry ?? "");
    const citizenships = intake?.answers.citizenships.map(countryName).filter(Boolean).join(", ");
    return <section className="overview-intake" aria-labelledby="overview-intake-title">
      <div className="overview-intake-heading"><span className="overview-intake-symbol" aria-hidden="true"><FolderOpen size={20} /></span><h2 id="overview-intake-title">Your intake</h2><span className="overview-intake-state">{completed ? "Intake complete" : intake ? "In progress" : "Not started"}</span></div>
      <p className="overview-intake-visa">{completed ? visa : "A little about you."}</p>
      {completed ? <dl className="overview-intake-facts">
        <div><dt>Country of birth</dt><dd>{birthplace || "Not provided"}</dd></div>
        <div><dt>Citizenship</dt><dd>{citizenships || "Not provided"}</dd></div>
      </dl> : <p className="overview-intake-description">{intake ? "Your saved answers are here whenever you’re ready to continue." : "Add your background and immigration plans when you’re ready. You can update them here at any time."}</p>}
      {completed && intake?.answers.visaType !== "eb1a" && <p className="overview-intake-note">Your visa interest is recorded. This workspace provides EB-1A preparation tools.</p>}
      <a className="overview-intake-edit" href="/onboarding?edit=1"><PencilLine size={16} aria-hidden="true" />{completed ? "Edit intake" : intake ? "Continue intake" : "Start intake"}</a>
    </section>;
  }

  function dashboard() {
    const showIntake = !isSample && caseLoaded;
    const nextActions = [
      { title: "Review your profile", detail: "Keep your information current", page: "profile", icon: UserRound },
      { title: "Review evidence support", detail: "Check the story behind each claim", page: state.criteria[0] ? `criterion:${state.criteria[0]}` : "criteria", icon: FolderOpen },
      { title: "Assemble your working draft", detail: "Choose your current sections", page: "composition", icon: BookOpen },
    ];
    return <div className="overview-page">
      <header className="overview-welcome">
        <div><span className="eyebrow">OVERVIEW</span><h1>Welcome back, {firstName}.</h1><p>Let’s take the next step in your preparation.</p></div>
        <span className="overview-case-label">{isSample ? <BookOpen size={15} aria-hidden="true" /> : <LockKeyhole size={15} aria-hidden="true" />}{isSample ? "Fictional sample" : "Personal workspace"}</span>
      </header>

      <div className={`overview-summary${showIntake ? " has-intake" : ""}`}>
        {showIntake && intakeCard()}
        <section className="overview-next" aria-labelledby="overview-next-step">
          <div className="overview-next-label"><span aria-hidden="true">{state.documents.length ? <FolderOpen size={18} /> : <UserRound size={18} />}</span><span>Next step</span></div>
          <h2 id="overview-next-step">{state.documents.length ? "Bring your evidence together." : "Build your profile."}</h2>
          <p>{state.documents.length ? "Review the support for each section before bringing your case into a working draft." : "Add your professional background and the achievements that tell your story."}</p>
          <button className="button primary" onClick={() => navigate(state.documents.length ? "criteria" : "profile")}>{state.documents.length ? "Review criteria" : "Start my profile"}</button>
        </section>
      </div>

      <section className="overview-progress" aria-labelledby="overview-progress-title">
        <div className="stats-heading"><h2 id="overview-progress-title">Your preparation at a glance</h2></div>
        <div className="stats-grid">
          {[
            { icon: FolderOpen, value: state.documents.length, label: "Evidence sources", detail: `${state.documents.filter(d => d.status === "ready").length} ${isSample ? "sample sources ready" : "processed sources"}` },
            { icon: ListChecks, value: state.criteria.length, label: "Selected criteria", detail: "Each reviewed independently" },
            { icon: BookOpen, value: `${readyCount} / ${state.criteria.length}`, label: "Ready to compose", detail: "Support and review checked" },
            { icon: CheckCheck, value: reviewCount, label: "Reviewed paragraphs", detail: "Review belongs to a revision" },
          ].map(item => <div className="stat-card" key={item.label}><div className="stat-icon" aria-hidden="true"><item.icon size={18} /></div><span className="stat-value">{item.value}</span><span className="stat-label">{item.label}</span><span className="stat-detail">{item.detail}</span></div>)}
        </div>
      </section>

      <section className="overview-sections" aria-labelledby="overview-sections-title">
        <div className="section-heading"><div><h2 id="overview-sections-title">Your case sections</h2><p>Build your story, one achievement at a time.</p></div><button className="button secondary small" onClick={() => navigate("criteria")}>Manage criteria</button></div>
        {state.criteria.length ? <div className="criteria-grid">{state.criteria.map(criterionCard)}</div> : <div className="panel"><EmptyState icon={<ListChecks size={28} />} title="Choose where to begin" action={<button className="button primary" onClick={() => navigate("criteria")}>Explore the criteria</button>}>Select the criteria that relate to your experience. You can revisit your selection at any time.</EmptyState></div>}
        <p className="footer-note"><ShieldCheck size={14} />Workspace progress reflects preparation, never the likelihood of approval.</p>
      </section>

      <div className="overview-details">
        <section className="panel overview-actions" aria-labelledby="overview-actions-title">
          <div className="panel-header"><h2 id="overview-actions-title">Your next actions</h2><span className="nav-count">{nextActions.length}</span></div>
          <div className="task-list">{nextActions.map(task => <button className="task-row" key={task.title} onClick={() => navigate(task.page)}><span className="overview-task-icon" aria-hidden="true"><task.icon size={18} /></span><span><strong>{task.title}</strong><small>{task.detail}</small></span></button>)}</div>
        </section>
        <section className="panel overview-activity" aria-labelledby="overview-activity-title">
          <div className="panel-header"><h2 id="overview-activity-title">Recent activity</h2><Clock3 size={18} aria-hidden="true" /></div>
          <div className="activity-list">{state.activities.slice(0, 3).map(activity => <div className="activity-row" key={activity.id}><span className="activity-dot" aria-hidden="true" /><div><strong>{activity.title}</strong><p>{activity.detail}</p><small>{dateLabel(activity.at)}</small></div></div>)}{!state.activities.length && <div className="overview-activity-empty"><Clock3 size={24} aria-hidden="true" /><p>Your preparation milestones will appear here.</p></div>}</div>
        </section>
      </div>

    </div>;
  }

  function profileScreen() {
    return <><div className="page-heading"><div><span className="eyebrow">01 · YOUR FOUNDATION</span><h1>Your profile</h1><p className="title-subtitle">The person and the professional behind your accomplishments.</p></div><Pill tone={state.profile.confirmed ? "green" : "amber"}>{state.profile.confirmed ? "Profile confirmed" : "Confirmation needed"}</Pill></div><div className="tabs" role="tablist" aria-label="Profile sections"><button role="tab" aria-selected={profileTab === "personal"} className={`tab ${profileTab === "personal" ? "active" : ""}`} onClick={() => setProfileTab("personal")}><UserRound size={16} />Personal details</button><button role="tab" aria-selected={profileTab === "professional"} className={`tab ${profileTab === "professional" ? "active" : ""}`} onClick={() => setProfileTab("professional")}><BriefcaseBusiness size={16} />Professional background</button></div><div className="panel form-section"><div className="panel-header"><div><h2>{profileTab === "personal" ? "The essentials" : "Your professional story"}</h2><p>Save what you know. Return to the rest when you’re ready.</p></div></div><div className="panel-body"><FileFormImport fields={profileTab === "personal" ? PROFILE_IMPORT_FIELDS : PROFESSIONAL_IMPORT_FIELDS} values={profileTab === "personal" ? { ...state.profile } : { ...state.professional }} contextKey={`${importContext}:${profileTab}`} disabled={importDisabled} saveNote={importSaveNote} onApply={patch => dispatch(profileTab === "personal" ? { type: "profile", patch: { ...importTextPatch(patch), confirmed: false } } : { type: "professional", patch: importTextPatch(patch) })} /><div className="field-grid">{profileTab === "personal" ? <><Field label="Full legal name" value={state.profile.fullName} onChange={fullName => dispatch({ type: "profile", patch: { fullName, confirmed: false } })} /><Field label="Preferred name" value={state.profile.preferredName} onChange={preferredName => dispatch({ type: "profile", patch: { preferredName } })} /><Field label="Email address" type="email" value={state.profile.email} onChange={email => dispatch({ type: "profile", patch: { email, confirmed: false } })} /><Field label="Phone number (including country code)" type="tel" value={state.profile.phone} onChange={phone => dispatch({ type: "profile", patch: { phone, confirmed: false } })} /><Field label="Country of residence" value={state.profile.country} onChange={country => dispatch({ type: "profile", patch: { country, confirmed: false } })} /><Field label="Prior names (if applicable)" value={state.profile.priorNames} onChange={priorNames => dispatch({ type: "profile", patch: { priorNames, confirmed: false } })} /><Field label="Mailing address" value={state.profile.address} multiline onChange={address => dispatch({ type: "profile", patch: { address, confirmed: false } })} hint="Use the format appropriate for your country, including postal code if applicable." /></> : <><Field label="Field of expertise" value={state.professional.field} onChange={field => dispatch({ type: "professional", patch: { field } })} /><Field label="Current role" value={state.professional.role} onChange={role => dispatch({ type: "professional", patch: { role } })} /><Field label="Organization" value={state.professional.organization} onChange={organization => dispatch({ type: "professional", patch: { organization } })} /><Field label="Employment and research timeline" multiline value={state.professional.timeline} onChange={timeline => dispatch({ type: "professional", patch: { timeline } })} hint="Include dates, organizations, and responsibilities." /><Field label="Key accomplishments" multiline value={state.professional.achievements} onChange={achievements => dispatch({ type: "professional", patch: { achievements } })} /><Field label="Intended work in the United States" multiline value={state.professional.intendedWork} onChange={intendedWork => dispatch({ type: "professional", patch: { intendedWork } })} /></>}</div><div className="notice info"><Fingerprint size={19} /><p>{profileTab === "personal" ? "These details are applicant-entered. Profile changes flag dependent drafts and form fields for renewed review. Identity documents are optional during preparation." : "Your narrative is an applicant statement. It becomes evidence-supported only when the relevant sources and claims have been reviewed."}</p></div>{profileTab === "personal" && <button className="button primary" disabled={!state.profile.fullName.trim() || !state.profile.country.trim()} onClick={() => { dispatch({ type: "profile", patch: { confirmed: true } }); notify("Profile facts confirmed. You can still update them at any time."); }}><CheckCheck size={16} />Confirm my profile details</button>}</div></div></>;
  }

  function criteriaScreen() {
    return <><div className="page-heading"><div><span className="eyebrow">02 · CHOOSE YOUR FOCUS</span><h1>Your criteria</h1><p className="title-subtitle">Start with the achievements that best reflect your work.</p></div><Pill tone="green">{state.criteria.length} selected</Pill></div><div className="notice info"><BookOpen size={20} /><p>Selection helps organize your preparation. It is not a finding of eligibility. Each criterion needs its own support, and the overall record requires a separate review. <a href="https://www.uscis.gov/policy-manual/volume-6-part-f-chapter-2" target="_blank" rel="noreferrer">Read official USCIS guidance <ExternalLink size={12} /></a></p></div><div className="criteria-grid selection-grid">{CRITERIA.map(criterion => { const selected = state.criteria.includes(criterion.id); return <article className={`criterion-card selectable ${selected ? "selected" : ""}`} key={criterion.id}><div className="criterion-top"><span className="criterion-number">{criterion.id}</span><label className="selection-control"><input type="checkbox" checked={selected} onChange={() => { dispatch({ type: "toggle_criterion", criterion: criterion.id }); notify(selected ? "Criterion removed from selection. Your source documents are preserved." : "Criterion added to your workspace."); }} aria-label={`Select ${criterion.title}`} /><span>{selected ? "Selected" : "Select criterion"}</span></label></div><h3>{criterion.title}</h3><p className="criterion-description">{criterion.description}</p><p className="field-help">Examples: {criterion.examples.join("; ")}.</p><div className="criterion-footer"><span>{selected ? "In your workspace" : "Available to explore"}</span><button className="link-button" onClick={() => navigate(`criterion:${criterion.id}`)}>Open section<ChevronRight size={15} /></button></div></article>; })}</div><div className="notice warning"><Award size={20} /><p><strong>Major award or comparable evidence?</strong> These require a separate, reviewed route or mapping. Approved processing is not connected in this release. Record the context in your professional background and seek qualified advice before relying on a route.</p><button className="link-button" onClick={() => { setProfileTab("professional"); navigate("profile"); }}>Add context<ChevronRight size={14} /></button></div></>;
  }

  function evidenceScreen() {
    return <>
      {!state.consent && !isSample && <div className="notice warning"><ShieldCheck size={19} /><p>Review file storage consent before adding your documents.</p><button className="button secondary small" onClick={() => setModal({ kind: "consent" })}>Review consent</button></div>}
      <EvidenceDrive state={state} initialFilter={evidenceFilter} disabled={!caseLoaded || uploading || deleting || saveStatus === "conflict" || saveStatus === "error"} uploading={uploading} uploadError={uploadError} onUpload={(files, folderId) => void uploadFiles(files, null, folderId)} onRequestUpload={(folderId, kind) => requestUpload(null, folderId, kind)} onDelete={deleteEvidence} onOpen={document => setModal({ kind: "evidence", sourceId: document.id })} onDownload={document => void downloadEvidence(document)} onAction={dispatch} />
      {uploadProgress && <p className="field-help" role="status">{uploadProgress}</p>}
      {uploadNotice && <p className="field-help" role="status">{uploadNotice}</p>}
      {uploadError && failedFiles.current.length > 0 && <button className="button secondary small" disabled={uploading || deleting || saveStatus === "conflict"} onClick={retryUpload}>Retry upload</button>}
    </>;
  }

  function criterionScreen() {
    if (!activeCriterion) return criteriaScreen();
    const id = activeCriterion.id, run = state.runs[id], result = currentResult(state, id);
    const blockers = runBlockers(state, id);
    const sources = state.documents.filter(d => d.associations.some(a => a.criterion === id && a.status !== "removed"));
    return <><button className="link-button back-link" onClick={() => navigate("dashboard")}><ArrowLeft size={15} />Back to overview</button><div className="page-heading"><div><span className="eyebrow">{id} · CRITERION WORKSPACE</span><h1>{activeCriterion.title}</h1><p className="title-subtitle">{activeCriterion.description}</p></div><Pill tone={criterionReady(state, id) ? "green" : "amber"}>{criterionReady(state, id) ? "Ready to compose" : "Preparation in progress"}</Pill></div>{!state.criteria.includes(id) && <div className="notice info"><ListChecks size={18} /><p>Add this criterion to your case to begin preparing its section.</p><button className="button primary small" onClick={() => dispatch({ type: "toggle_criterion", criterion: id })}>Select criterion</button></div>}
      <div className="criterion-banner"><div><span className="field-label">Run status</span><strong>{readable(run?.status || "idle")}</strong><span>{run?.stage || "Not started"}</span></div><div><span className="field-label">Evidence support</span><strong>{result?.stale ? "Out of date" : result?.claims.every(c => c.supportStatus === "supported") ? "Claims supported" : "Review needed"}</strong><span>Checked claim by claim</span></div><div><span className="field-label">Human review</span><strong>{result?.claims.length ? `${result.claims.filter(c => c.reviewStatus !== "unreviewed").length} of ${result.claims.length} reviewed` : "Unreviewed"}</strong><span>Applies to this revision</span></div><div><span className="field-label">Result revision</span><strong>{result ? `Revision ${result.revision}` : "No result yet"}</strong><span>Generation {run?.generation || 0}</span></div></div>
      <div className="detail-grid"><section>{result?.stale && <div className="notice warning"><AlertCircle size={20} /><p>A source, fact, or association changed. This result remains visible for comparison, but requires an updated run before composition or renewed review.</p></div>}<div className="section-heading"><div><h2>{isSample ? "Evidence-linked draft" : "Your section draft"}</h2><p>{isSample ? "Fictional sample output. A completed run does not establish the criterion." : "Write a manual section while production processing is unavailable."}</p></div></div>{result?.claims.map(claim => <ClaimCard key={claim.id} claim={claim} importDisabled={importDisabled} importContext={importContext} target={id} stale={result.stale} dispatch={dispatch} openSource={openSource} openHistory={claim => setModal({ kind: "history", claim })} notify={notify} />)}{!result && <div className="panel"><EmptyState icon={<PencilLine size={28} />} title="A place for this part of your story">Connect the relevant sources, then prepare a manual section below. Personal AI processing is not connected.</EmptyState></div>}<div className="panel"><div className="panel-header"><h3>Write a section manually</h3><Pill tone="gray">Applicant statement</Pill></div><div className="panel-body"><FileFormImport fields={DRAFT_IMPORT_FIELDS} values={{ text: manualText }} contextKey={`${importContext}:${id}`} disabled={importDisabled} saveNote="Apply fills your draft. Use Save manual section to create an unsupported, unreviewed applicant statement." onApply={patch => { if (typeof patch.text === "string") setManualText(patch.text); }} /><label className="field"><span className="field-label">Your draft text</span><textarea className="textarea" rows={5} placeholder="Describe this achievement in your own words…" value={manualText} onChange={e => setManualText(e.target.value)} /></label><p className="field-help">This creates an unsupported, unreviewed section. {result ? "It replaces the current section; the previous result remains in history." : "It can be included in a working draft with its evidence gap identified."}</p><button className="button secondary" disabled={!manualText.trim() || !state.criteria.includes(id)} onClick={() => { dispatch({ type: "manual_section", criterion: id, text: manualText }); setManualText(""); notify("Manual section created with evidence missing and human review pending."); }}><PencilLine size={15} />Save manual section</button></div></div>{!!run?.history.length && <div className="panel history-panel"><div className="panel-header"><h3>Previous section results</h3></div><div className="panel-body">{run.history.map((item, i) => <details className="history-entry" key={`${item.id}-${i}`}><summary>Result revision {item.revision} · {dateLabel(item.createdAt)}</summary>{item.claims.map(c => <p key={c.id}>{c.text}</p>)}</details>)}</div></div>}</section>
        <aside className="secondary-column"><div className="panel"><div className="panel-header"><h3>{isSample ? "Sample processing" : "Section processing"}</h3><RefreshCw size={17} /></div><div className="panel-body"><p className="field-help">{isSample ? "Explore an independent run using fixed fictional examples. No external AI is called." : "Production AI modules and approved rules are not connected. Manual drafting remains available."}</p>{blockers.length > 0 && <ul className="compact-list">{blockers.map(problem => <li key={problem}>{problem}</li>)}</ul>}{run?.error && <p className="notice warning">{run.error}</p>}<button className="button primary full-width" disabled={!!blockers.length || run?.status === "running" || !isSample} onClick={() => startRun(id)}>{run?.status === "running" ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}{isSample ? "Start sample run" : "Processing unavailable"}</button>{run?.status === "running" && <button className="button ghost small" onClick={() => { dispatch({ type: "cancel_run", criterion: id }); notify("Sample run canceled. Previous output is preserved."); }}>Cancel run</button>}<div className="metadata-list"><span>Module <strong>{result?.moduleVersion || "Unavailable"}</strong></span><span>Rules <strong>{result?.ruleVersion || "Unavailable"}</strong></span></div></div></div><div className="panel"><div className="panel-header"><h3>Questions to resolve</h3></div><div className="panel-body">{run?.questions.length ? run.questions.map(q => <div className="question-row" key={q}><AlertCircle size={16} /><p>{q}</p></div>) : <p className="field-help">Check source support and the complete record. No unresolved question here is a finding of eligibility.</p>}<button className="link-button" onClick={() => navigate("evidence")}>Review evidence<ChevronRight size={14} /></button></div></div><div className="panel"><div className="panel-header"><h3>Linked evidence</h3><span className="nav-count">{sources.length}</span></div><div className="panel-body">{sources.map(doc => <button className="source-list-row" key={doc.id} onClick={() => setModal({ kind: "evidence", sourceId: doc.id })}><FileText size={18} /><span><strong>{doc.name}</strong><small>v{doc.version} · {readable(doc.associations.find(a => a.criterion === id)!.status)}</small></span><ChevronRight size={15} /></button>)}{!sources.length && <p className="field-help">No source associations yet.</p>}<button className="link-button" onClick={() => { setEvidenceFilter(id); navigate("evidence"); }}>Manage evidence<ChevronRight size={14} /></button></div></div></aside></div></>;
  }

  function compositionScreen() {
    const available = state.criteria.filter(id => { const r = currentResult(state, id); return r && !r.stale && state.runs[id].status === "succeeded"; });
    const chosen = selectedCriteria.filter(id => available.includes(id));
    return <><div className="page-heading"><div><span className="eyebrow">05 · BRING IT TOGETHER</span><h1>Compose your case</h1><p className="title-subtitle">Choose the exact section revisions for your next working draft.</p></div>{state.composition && <Pill tone={state.composition.stale ? "amber" : "green"}>Composition v{state.composition.version}</Pill>}</div><div className="notice info"><BookOpen size={20} /><p>A working draft can include sections that still need support or review. Every gap stays visible. Composition readiness and final filing readiness are separate.</p></div><div className="detail-grid"><div className="panel"><div className="panel-header"><h2>Select your sections</h2><button className="link-button" disabled={!available.length} onClick={() => setSelectedCriteria(available)}>Select all current</button></div><div className="composition-options">{state.criteria.map(id => { const c = CRITERIA.find(c => c.id === id)!; const result = currentResult(state, id); const canSelect = available.includes(id); return <div className="option-row" key={id}><label className="option-label"><input type="checkbox" checked={chosen.includes(id)} disabled={!canSelect} onChange={e => setSelectedCriteria(e.target.checked ? [...selectedCriteria, id] : selectedCriteria.filter(x => x !== id))} /><span><strong>{c.title}</strong><small>{id} · {result ? `Result revision ${result.revision}` : "No result yet"} · {result?.stale ? "Out of date" : criterionReady(state, id) ? "Ready to compose" : "Support or review pending"}</small></span></label><button className="icon-button" aria-label={`Review ${c.title}`} onClick={() => navigate(`criterion:${id}`)}><ChevronRight size={16} /></button></div>; })}{!state.criteria.length && <EmptyState title="Start with a criterion" action={<button className="button secondary" onClick={() => navigate("criteria")}>Choose criteria</button>}>Your selected criteria will appear here when a section result is available.</EmptyState>}</div></div><aside><div className="panel"><div className="panel-header"><h3>Your next composition</h3></div><div className="panel-body"><span className="big-number">{chosen.length}</span><p>section {chosen.length === 1 ? "revision" : "revisions"} selected</p><div className="divider" /><p className="field-help">{state.criteria.length - chosen.length} selected criteria will be omitted. A later source or result change will mark this composition out of date.</p><button className="button primary full-width" disabled={!chosen.length} onClick={() => { if (state.composition?.claims.some(c => c.locked) && !window.confirm("This creates a new composition. Existing locked paragraphs remain in composition history but are not carried into the new draft. Continue?")) return; dispatch({ type: "compose", criteria: chosen }); navigate("draft"); notify("Working draft assembled from the selected result revisions."); }}><BookOpen size={16} />Create working draft</button></div></div>{state.composition && <button className="button secondary full-width" onClick={() => navigate("draft")}>Open current draft<ChevronRight size={16} /></button>}</aside></div></>;
  }

  function draftScreen() {
    const composition = state.composition;
    return <><div className="page-heading"><div><span className="eyebrow">06 · SHAPE YOUR STORY</span><h1>Working draft</h1><p className="title-subtitle">Every paragraph, source, and review in one place.</p></div><div className="heading-actions"><button className="button secondary" onClick={downloadDraft}><ArrowDownToLine size={16} />Download draft</button><button className="button primary" onClick={() => navigate("composition")}>{composition ? "Update composition" : "Compose a draft"}<ChevronRight size={16} /></button></div></div>{!composition ? <div className="panel"><EmptyState icon={<BookOpen size={32} />} title="Your story is ready to come together" action={<button className="button primary" onClick={() => navigate("composition")}>Choose your sections<ChevronRight size={16} /></button>}>Select your current criterion results to create a versioned working draft. Sections with gaps remain clearly identified.</EmptyState></div> : <><div className={`notice ${composition.stale ? "warning" : "info"}`}><BookOpen size={20} /><p><strong>Working draft · Composition v{composition.version}.</strong> {composition.stale ? "A dependency or selected result changed. This draft is out of date. Create a new composition before recording reviews." : "This preparation draft is editable and is not a filing-ready document. Material edits require renewed evidence support and human review."}</p></div><div className="draft-document"><div className="draft-document-heading"><span className="document-eyebrow">APPLICANT PREPARATION · {isSample ? "FICTIONAL SAMPLE" : "PRIVATE WORKSPACE"}</span><h2 className="draft-title">The professional record of<br />{state.profile.fullName || "the applicant"}</h2><p>{state.professional.field || "Professional field not yet entered"}</p><div className="draft-version">Composition v{composition.version} · {dateLabel(composition.createdAt)}<span>{composition.selected.map(s => `${s.criterion} r${s.revision}`).join(" · ")}</span></div></div>{composition.claims.map(claim => <ClaimCard key={claim.id} claim={claim} importDisabled={importDisabled} importContext={importContext} target="composition" stale={composition.stale} dispatch={dispatch} openSource={openSource} openHistory={claim => setModal({ kind: "history", claim })} notify={notify} />)}<div className="notice warning"><AlertCircle size={18} /><p>Omitted selected criteria: {state.criteria.filter(c => !composition.selected.some(s => s.criterion === c)).join(", ") || "None"}. Official form mapping, final exhibit pagination, and filing output remain unavailable.</p></div></div></>}{!!state.compositionHistory?.length && <section className="panel history-panel"><div className="panel-header"><h3>Composition history</h3><History size={17} /></div><div className="panel-body">{state.compositionHistory.map((item, index) => <details className="history-entry" key={`${item.id}-${item.version}-${index}`}><summary>Composition v{item.version} · {dateLabel(item.createdAt)} · {item.claims.length} paragraphs</summary><p className="field-help">Pinned results: {item.selected.map(s => `${s.criterion} r${s.revision}`).join(", ")}. Historical reviews apply only to this version.</p>{item.claims.map(c => <p key={c.id}>{c.text}</p>)}<button className="link-button" onClick={() => downloadText([`HARNESS LAW — HISTORICAL WORKING DRAFT v${item.version}`, "NOT FOR FILING. This is a historical snapshot and may have outdated sources.", ...item.claims.map(c => c.text)].join("\n\n"), `harness-law-history-v${item.version}.txt`)}><ArrowDownToLine size={14} />Download this version</button></details>)}</div></section>}</>;
  }

  function formsScreen() {
    return <><div className="page-heading"><div><span className="eyebrow">07 · PREPARE THE DETAILS</span><h1>Application forms</h1><p className="title-subtitle">Review the information that will inform your official forms.</p></div><Pill tone="amber">Preparation worksheet</Pill></div><div className="notice warning"><AlertCircle size={20} /><p><strong>Official form templates are unavailable.</strong> This worksheet is a preparation preview, not an official form. No current edition or field mapping has been verified. Finalization stays blocked.</p></div><div className="detail-grid"><div className="panel"><div className="panel-header"><h2>Review your field information</h2></div><div className="panel-body"><FileFormImport fields={WORKSHEET_IMPORT_FIELDS} values={{ ...state.forms }} contextKey={importContext} disabled={importDisabled} saveNote={importSaveNote} onApply={patch => dispatch({ type: "forms", patch: { ...importTextPatch(patch), reviewed: false } })} /><button className="link-button" onClick={() => { dispatch({ type: "forms", patch: { fullName: state.profile.fullName, address: state.profile.address, country: state.profile.country, intendedWork: state.professional.intendedWork, reviewed: false } }); notify("Worksheet updated from your entered profile. Review the fields again."); }}><RefreshCw size={14} />Copy current profile information</button><div className="field-grid"><Field label="Full legal name" value={state.forms.fullName} onChange={fullName => dispatch({ type: "forms", patch: { fullName, reviewed: false } })} /><Field label="Country of residence" value={state.forms.country} onChange={country => dispatch({ type: "forms", patch: { country, reviewed: false } })} /><Field label="Mailing address" multiline value={state.forms.address} onChange={address => dispatch({ type: "forms", patch: { address, reviewed: false } })} /><Field label="Intended work in the United States" multiline value={state.forms.intendedWork} onChange={intendedWork => dispatch({ type: "forms", patch: { intendedWork, reviewed: false } })} /></div>{(state.forms.fullName !== state.profile.fullName || state.forms.address !== state.profile.address || state.forms.country !== state.profile.country || state.forms.intendedWork !== state.professional.intendedWork) && <div className="notice warning"><AlertCircle size={18} /><p>Some worksheet fields differ from your current profile. Resolve the differences before confirming your review.</p><button className="link-button" onClick={() => navigate("profile")}>Review profile</button></div>}<button className="button primary" disabled={!state.forms.fullName.trim() || !state.forms.address.trim() || !state.forms.country.trim() || !state.forms.intendedWork.trim() || state.forms.fullName !== state.profile.fullName || state.forms.address !== state.profile.address || state.forms.country !== state.profile.country || state.forms.intendedWork !== state.professional.intendedWork} onClick={() => { dispatch({ type: "forms", patch: { reviewed: true } }); notify("Worksheet field review recorded. Official template validation is still required."); }}><CheckCheck size={16} />{state.forms.reviewed ? "Fields reviewed" : "Confirm field review"}</button></div></div><aside className="panel preparation-preview"><div className="panel-header"><h3>Preparation preview</h3><Eye size={17} /></div><div className="panel-body"><span className="eyebrow">NOT AN OFFICIAL FORM</span><h3>Applicant information</h3>{[{ label: "Full legal name", value: state.forms.fullName }, { label: "Country of residence", value: state.forms.country }, { label: "Mailing address", value: state.forms.address }, { label: "Intended work", value: state.forms.intendedWork }].map(item => <div className="preview-field" key={item.label}><span className="field-label">{item.label}</span><p>{item.value || <span className="missing-value">Not provided</span>}</p></div>)}<Pill tone={state.forms.reviewed ? "green" : "amber"}>{state.forms.reviewed ? "Applicant field review recorded" : "Field review pending"}</Pill><p className="field-help">Template edition: unavailable<br />Official field mappings: unavailable</p></div></aside></div></>;
  }

  function reviewScreen() {
    const blockers = getBlockers(state);
    return <><div className="page-heading"><div><span className="eyebrow">08 · SEE THE WHOLE PICTURE</span><h1>Final review</h1><p className="title-subtitle">Know what is ready, what needs care, and what comes next.</p></div><button className="button primary" onClick={downloadDraft}><ArrowDownToLine size={16} />Download working draft</button></div><div className="notice warning"><ShieldCheck size={21} /><p><strong>Finalization is blocked.</strong> Official templates and the immutable final-packet service are not connected. You can review and download your working draft, with its gaps clearly identified.</p></div><div className="detail-grid"><section><div className="panel"><div className="panel-header"><h2>Items to resolve</h2><Pill tone="amber">{blockers.length} open items</Pill></div><div className="blocker-list">{blockers.map(blocker => <div className="blocker-row" key={blocker.id}><AlertCircle size={18} /><div><h3>{blocker.title}</h3><p>{blocker.detail}</p></div><button className="link-button" onClick={() => navigate(blocker.page === "final" ? "settings" : blocker.page === "overview" ? "dashboard" : blocker.page)}>Review<ChevronRight size={14} /></button></div>)}</div></div><div className="panel"><div className="panel-header"><h2>Working exhibit index</h2><span className="field-help">Final pagination unavailable</span></div><div className="panel-body">{state.documents.map(doc => <button className="exhibit-row" key={doc.id} onClick={() => setModal({ kind: "evidence", sourceId: doc.id })}><span className="criterion-number">{doc.exhibit}</span><span><strong>{doc.name}</strong><small>Source version {doc.version} · {doc.pages || "—"} source pages</small></span><ChevronRight size={16} /></button>)}{!state.documents.length && <p className="field-help">Add evidence to build an exhibit index.</p>}</div></div></section><aside><div className="panel"><div className="panel-header"><h3>Your preparation packet</h3><FileCheck2 size={18} /></div><div className="panel-body"><div className="summary-line"><span>Composition</span><strong>{state.composition ? `v${state.composition.version}` : "Not assembled"}</strong></div><div className="summary-line"><span>Selected sections</span><strong>{state.composition?.selected.length || 0}</strong></div><div className="summary-line"><span>Source exhibits</span><strong>{state.documents.length}</strong></div><div className="summary-line"><span>Official forms</span><Pill tone="amber">Unavailable</Pill></div><div className="summary-line"><span>Final package</span><Pill tone="amber">Unavailable</Pill></div><div className="divider" /><button className="button secondary full-width" onClick={downloadDraft}><ArrowDownToLine size={16} />Download working draft</button><button className="button primary full-width" disabled><LockKeyhole size={16} />Finalize packet</button><p className="field-help">Finalization requires current official templates, a complete review, and approval of the exact assembled package. No filing-ready output is produced here.</p></div></div><div className="quiet-note"><Scale size={22} /><h3>The whole record matters.</h3><p>Preparation status does not assess eligibility or predict an immigration decision.</p></div></aside></div></>;
  }

  function settingsScreen() {
    return <><div className="page-heading"><div><span className="eyebrow">YOUR WORKSPACE, YOUR CONTROL</span><h1>Settings & privacy</h1><p className="title-subtitle">A clear view of how this workspace works.</p></div></div><div className="settings-grid"><section className="panel"><div className="panel-header"><h2>Service availability</h2><Settings2 size={19} /></div><div className="panel-body"><div className="summary-line"><span>Case save & recovery</span><Pill tone={user ? "green" : "gray"}>{user ? "Connected" : "Sign-in required"}</Pill></div><div className="summary-line"><span>Private file storage</span><Pill tone="green">Quarantine only</Pill></div>{["Evidence safety scanning & extraction", "AI criterion processing", "Approved production rules", "Official form templates", "Final packet assembly"].map(label => <div className="summary-line" key={label}><span>{label}</span><Pill tone="amber">Not connected</Pill></div>)}<div className="summary-line"><span>Local form import</span><Pill tone="green">Available in your browser</Pill></div><p className="field-help">Fictional sample runs demonstrate status and version handling. Personal documents are never sent to an external AI provider by this release.</p></div></section><section className="panel"><div className="panel-header"><h2>Privacy & consent</h2><ShieldCheck size={19} /></div><div className="panel-body"><p>Site analytics help us understand visits, devices, and approximate locations. They do not include your case answers or document contents. <a className="link-button" href="/privacy">Read about site analytics</a></p><p>Personal cases are saved to your authenticated account. All uploaded files, including documents used to fill forms, are stored privately in Evidence. Original files can be downloaded or read locally to suggest form answers; server safety scanning and evidence extraction are not connected.</p><p>Form import saves new files to Evidence and reads their text in your browser. Browse Evidence reuses a saved file. Only answers you review and apply fill your form; they remain applicant-entered information, not verified facts.</p><p>Consent is required before evidence uploads. Withdrawing it prevents future uploads; it does not delete existing stored documents.</p><Pill tone={state.consent ? "green" : "amber"}>{state.consent ? isSample ? "Fictional sample consent" : "Processing consent recorded" : "Consent not recorded"}</Pill><div className="inline-actions"><button className="button secondary small" onClick={() => { setConsentChecked(false); setModal({ kind: "consent" }); }}>Review consent</button>{state.consent && !isSample && <button className="link-button" onClick={() => { dispatch({ type: "consent", value: false }); notify("Consent withdrawn for future processing and uploads."); }}>Withdraw consent</button>}</div></div></section><section className="panel"><div className="panel-header"><h2>Optional attorney review</h2><UsersRound size={19} /></div><div className="panel-body"><p>A qualified attorney can help assess the record and your circumstances. Attorney engagement, invitations, and secure sharing are not connected in this release.</p><p>No attorney has been invited or engaged through this workspace. Applicant self-review and working-draft downloads remain available.</p><button className="button secondary small" onClick={downloadDraft}><ArrowDownToLine size={15} />Download for your own review</button></div></section><section className="panel"><div className="panel-header"><h2>Your case</h2><FolderOpen size={19} /></div><div className="panel-body"><FileFormImport fields={CASE_NAME_IMPORT_FIELDS} values={{ name: state.name }} contextKey={importContext} disabled={importDisabled} saveNote={importSaveNote} onApply={patch => { if (typeof patch.name === "string") dispatch({ type: "rename", name: patch.name }); }} /><Field label="Case name" value={state.name} onChange={name => dispatch({ type: "rename", name })} /><p className="field-help">{isSample ? "Sample changes stay in this browser session. Sign in to create a private saved case." : "Your last position is saved along with your case."}</p><div className="inline-actions">{user && state.mode === "personal" && <button className="button secondary small" onClick={exploreSample}>Explore fictional sample</button>}{forceSample && user ? <a className="button secondary small" href="/workspace">Open my personal case</a> : user ? <button className="button danger small" onClick={() => setModal({ kind: "reset" })}>Start a new personal case</button> : <a className="button primary small" href="/signup">Sign in to save<ChevronRight size={14} /></a>}<button className="link-button" onClick={downloadLocal}>Export local case copy</button></div></div></section></div></>;
  }

  return <EvidenceLibraryProvider value={{ documents: state.documents, folders: state.folders ?? [], mode: state.mode, caseId: state.id, accountId: user?.userId ?? null, consent: state.consent, disabled: importDisabled, upload: importFile, read: (document, signal) => readEvidenceFile(document, user?.userId ?? null, state.id, signal), grantConsent: grantFileConsent }}><div className={`app-shell ${mobileOpen ? "nav-open" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
    <AnalyticsTracker page={isSample ? 'workspace/sample' : `workspace/${page}`} />
    <a className="skip-link" href="#main-content">Skip to content</a>
    {mobileOpen && <button className="nav-overlay" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside id="workspace-navigation" className="sidebar" aria-label="Primary navigation">
      <button className="brand" onClick={() => navigate("dashboard")} aria-label="Harness Law overview" title="Overview">
        <span className="sidebar-brand-full"><BrandLogo inverse /></span>
        <span className="sidebar-brand-mark" aria-hidden="true"><BrandMark /></span>
      </button>
      <button className="icon-button sidebar-toggle" type="button" onClick={toggleSidebar} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!sidebarCollapsed} aria-controls="workspace-navigation">{sidebarCollapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}<span>{sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}</span></button>
      <section className="case-context" aria-labelledby="sidebar-case-label"><span className="case-context-icon" aria-hidden="true"><FolderOpen size={18} /></span><div className="case-context-copy"><span id="sidebar-case-label" className="case-context-label">CURRENT CASE</span><strong>{state.name || "My EB-1A preparation"}</strong><span className="case-context-status">{isSample ? "Fictional sample" : "Private workspace"}</span></div></section>
      <nav>
        <div className="nav-group"><span className="nav-label">YOUR WORKSPACE</span>{NAV.slice(0, 4).map(item => <button key={item.id} className={`nav-item ${page === item.id || item.id === "criteria" && criterionId ? "active" : ""}`} onClick={() => navigate(item.id)} aria-label={item.label} title={sidebarCollapsed ? item.label : undefined} aria-current={page === item.id ? "page" : undefined}><item.icon size={18} aria-hidden="true" /><span>{item.label}</span>{item.id === "evidence" && <span className="nav-count">{state.documents.length}</span>}</button>)}</div>
        <div className="nav-group"><span className="nav-label">YOUR APPLICATION</span>{NAV.slice(4).map(item => <button key={item.id} className={`nav-item ${page === item.id ? "active" : ""}`} onClick={() => navigate(item.id)} aria-label={item.label} title={sidebarCollapsed ? item.label : undefined} aria-current={page === item.id ? "page" : undefined}><item.icon size={18} aria-hidden="true" /><span>{item.label}</span>{item.id === "draft" && <span className="tiny-label">DRAFT</span>}</button>)}</div>
      </nav>
      <div className="sidebar-bottom">
        <section className="account-area" aria-label="Your account">
          <span className="account-label">ACCOUNT</span>
          <div className="account-identity" title={user?.displayName || "Not signed in"} aria-label={user ? `Signed in as ${user.displayName}` : "Not signed in"}><span className="user-avatar" aria-hidden="true">{user ? user.displayName.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase() || "U" : <UserRound size={17} />}</span><span className="account-identity-copy"><small className="account-signed-label">{user ? "Signed in as" : "Guest access"}</small><strong>{user?.displayName || "Not signed in"}</strong></span></div>
          <div className="account-links">
            {canAccessAdmin && <a className="nav-item" href="/admin" aria-label="Admin portal" title={sidebarCollapsed ? "Admin portal" : undefined}><ShieldCheck size={18} aria-hidden="true" /><span>Admin portal</span></a>}
            <a className="nav-item" href="/account" aria-label="Account management" title={sidebarCollapsed ? "Account management" : undefined}><UserRound size={18} aria-hidden="true" /><span>Account management</span></a>
            <button className={`nav-item ${page === "settings" ? "active" : ""}`} onClick={() => navigate("settings")} aria-label="Settings" title={sidebarCollapsed ? "Settings" : undefined} aria-current={page === "settings" ? "page" : undefined}><Settings2 size={18} aria-hidden="true" /><span>Settings</span></button>
            <button className={`nav-item ${page === "help" ? "active" : ""}`} onClick={() => navigate("help")} aria-label="Help & guidance" title={sidebarCollapsed ? "Help & guidance" : undefined} aria-current={page === "help" ? "page" : undefined}><CircleHelp size={18} aria-hidden="true" /><span>Help & guidance</span></button>
            {forceSample && user ? <a className="nav-item" href="/workspace" aria-label="Back to my case" title={sidebarCollapsed ? "Back to my case" : undefined}><BriefcaseBusiness size={18} aria-hidden="true" /><span>Back to my case</span></a> : user ? <button className="nav-item" disabled={saveStatus === "loading" || saveStatus === "saving"} onClick={() => { setMobileOpen(false); if (isSample && !hasPersonalSnapshot) setModal({ kind: "reset" }); else exploreSample(); }} aria-label={isSample ? hasPersonalSnapshot ? "Back to my case" : "Start my case" : "Explore sample"} title={sidebarCollapsed ? isSample ? hasPersonalSnapshot ? "Back to my case" : "Start my case" : "Explore sample" : undefined}>{isSample ? <BriefcaseBusiness size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}<span>{isSample ? hasPersonalSnapshot ? "Back to my case" : "Start my case" : "Explore sample"}</span></button> : null}
          </div>
          {user ? <form action="/api/auth/logout" method="post" target="_top"><button type="submit" className="account-action" aria-label="Sign out" title="Sign out"><LogOut size={17} aria-hidden="true" /><span>Sign out</span></button></form> : <a className="account-action" href="/signup" aria-label="Sign in to save" title="Sign in to save"><LogIn size={17} aria-hidden="true" /><span>Sign in to save</span></a>}
        </section>
      </div>
    </aside>
    <div className="app-body"><header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-only" aria-label={mobileOpen ? "Close navigation" : "Open navigation"} aria-controls="workspace-navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}><Menu size={21} /></button><span>My workspace</span><ChevronRight size={13} /><strong>{pageTitle}</strong></div><div className="topbar-actions"><span className={`save-state ${saveStatus}`} role="status" aria-live="polite">{saveStatus === "saving" || saveStatus === "loading" ? <Loader2 className="spin" size={14} /> : saveStatus === "saved" ? <CheckCheck size={15} /> : saveStatus === "error" || saveStatus === "conflict" ? <AlertCircle size={14} /> : <span className="dot" />}{saveStatus === "sample" ? "Sample · changes temporary" : saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "All changes saved" : saveStatus === "loading" ? "Loading your case…" : saveStatus === "conflict" ? "Save conflict" : "Save failed"}</span></div></header>
      <main className="workspace" id="main-content">{!isSample && setupFocus && <section className="notice info" aria-label="Your preparation focus"><ListChecks size={20} /><div><strong>Your focus: {setupFocus.title}</strong><p>{setupFocus.description}</p><button className="link-button" onClick={() => navigate(setupFocus.page)}>{setupFocus.action}<ChevronRight size={14} /></button></div></section>}{(saveStatus === "error" || saveStatus === "conflict") && <div className="notice warning" role="alert"><AlertCircle size={20} /><div><strong>{saveStatus === "conflict" ? "Your local edits are preserved" : "Your changes need attention"}</strong><p>{saveMessage}</p><div className="inline-actions">{saveStatus === "error" && <button className="button secondary small" onClick={() => loaded.current ? void persist() : window.location.reload()}>Retry {caseLoaded ? "save" : "load"}</button>}<button className="link-button" onClick={downloadLocal}>Download local copy</button>{saveStatus === "conflict" && remoteConflict && <><button className="link-button" onClick={() => { if (!window.confirm("Replace the other saved version with the changes in this window? Download a local copy first if you need both versions.")) return; serverRevision.current = remoteConflict.revision; dirty.current = true; changeVersion.current++; setRemoteConflict(null); setSaveStatus("saving"); setSaveMessage(""); void persist(); }}>Keep my local version</button><button className="link-button" onClick={() => { if (!window.confirm("Discard the changes in this window and use the saved version? Download a local copy first to preserve them.")) return; stateRef.current = remoteConflict.state; setState(remoteConflict.state); serverRevision.current = remoteConflict.revision; dirty.current = false; setRemoteConflict(null); setSaveStatus("saved"); }}>Use saved version</button></>}{saveMessage.includes("session") && <a className="link-button" target="_blank" rel="noreferrer" href="/signin">Sign in again<ExternalLink size={13} /></a>}</div></div></div>}{page === "dashboard" ? dashboard() : page === "profile" ? profileScreen() : page === "criteria" ? criteriaScreen() : page === "evidence" ? evidenceScreen() : criterionId ? criterionScreen() : page === "composition" ? compositionScreen() : page === "draft" ? draftScreen() : page === "forms" ? formsScreen() : page === "review" ? reviewScreen() : page === "help" ? <WorkspaceHelp onNavigate={navigate} /> : settingsScreen()}<footer className="workspace-footer"><span>Thoughtfully prepared. Always your story.</span><span><BrandLogo className="footer-brand" /><small>·</small>{isSample ? "Fictional sample workspace" : "Private applicant workspace"}</span></footer></main>
    </div>
    <input ref={node => { folderInput.current = node; node?.setAttribute("webkitdirectory", ""); }} className="sr-only" type="file" multiple aria-label="Upload evidence folder" onChange={event => void uploadFiles(Array.from(event.target.files || []), null, uploadFolderId.current, true)} />
    <input ref={fileInput} className="sr-only" type="file" multiple accept=".pdf,.docx,.jpg,.jpeg,.png,.txt,.md,.markdown,.csv,.json" aria-label="Upload evidence files" onChange={e => { const target = replacementId.current; replacementId.current = null; void uploadFiles(Array.from(e.target.files || []), target, uploadFolderId.current); }} />
    {toast && <div className="toast" role="status" aria-live="polite"><CheckCircle2 size={18} /><span>{toast}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast("")}><X size={16} /></button></div>}
    {modal && renderModal()}
  </div></EvidenceLibraryProvider>;

  function renderModal() {
    if (!modal) return null;
    if (modal.kind === "reset") return <Dialog title="Start a new personal case" onClose={() => setModal(null)}><p>This creates an empty personal workspace and replaces the current saved case. Download a local copy first if you want to keep the existing preparation record.</p><div className="notice warning"><AlertCircle size={19} /><p>Source references and drafts in the current case will be removed from this workspace. Uploaded files are not automatically deleted from private storage.</p></div><div className="modal-footer"><button className="button secondary" onClick={downloadLocal}>Download current case</button><button className="button ghost" onClick={() => setModal(null)}>Cancel</button><button className="button primary" onClick={resetCase}>Create empty personal case</button></div></Dialog>;
    if (modal.kind === "consent") return <Dialog title="Your documents, your consent" onClose={() => setModal(null)}><p>Files you upload here or use to fill a form are stored privately in your Evidence library under this account. You can organize them into folders, download originals, and reuse supported documents to fill forms. Text for form suggestions is read in your browser. Server safety scanning, verified evidence extraction, and AI processing are not connected; local reading does not mark a document verified.</p><p>No documents are sent to an external AI provider. You can withdraw consent for future uploads in Settings. Withdrawal does not erase files already stored.</p><label className="consent-check"><input type="checkbox" checked={consentChecked} onChange={e => setConsentChecked(e.target.checked)} /><span>I consent to private storage of my uploaded evidence for this preparation workspace and understand the processing limitations.</span></label><div className="modal-footer"><button className="button ghost" onClick={() => setModal(null)}>Not now</button><button className="button primary" disabled={!consentChecked || isSample} onClick={() => { dispatch({ type: "consent", value: true }); setModal(null); notify("File storage consent recorded. Wait for All changes saved, then choose your files."); }}>Save consent</button></div>{isSample && <p className="field-help">Consent in this sample is fictional. Open a personal case to record your own.</p>}</Dialog>;
    if (modal.kind === "history") return <Dialog title="Paragraph version history" onClose={() => setModal(null)}><div className="history-entry"><Pill tone="green">Current · revision {modal.claim.revision}</Pill><p>{modal.claim.text}</p><p className="field-help">{readable(modal.claim.supportStatus)} · {readable(modal.claim.reviewStatus)}</p></div>{modal.claim.history.map((item, index) => <div className="history-entry" key={`${item.revision}-${index}`}><span className="eyebrow">REVISION {item.revision} · {dateLabel(item.at)}</span><p>{item.text}</p><small>{item.author}</small></div>)}{!modal.claim.history.length && <p className="field-help">No text revisions yet. Editing creates a new revision and resets support and human review.</p>}</Dialog>;
    if (modal.kind === "source") {
      const source = state.documents.find(d => d.id === modal.citation.sourceId);
      const historic = source?.version !== modal.citation.sourceVersion ? source?.previousVersions?.find(v => v.version === modal.citation.sourceVersion) : undefined;
      const validVersion = source?.version === modal.citation.sourceVersion || !!historic;
      const safe = validVersion && (historic?.status || source?.status) === "ready";
      const excerpt = historic?.excerpt ?? source?.excerpt;
      return <Dialog drawer title="A closer look at the source" onClose={() => setModal(null)}><div className="source-metadata"><span className="file-icon"><FileText size={24} /></span><div><h3>{historic?.name || source?.name || "Source unavailable"}</h3><p>Version {modal.citation.sourceVersion} · Exhibit {source?.exhibit || "unassigned"} · Page {modal.citation.page}</p></div></div>{source?.sample && <Pill tone="amber">Fictional sample document</Pill>}<div className="source-claim"><span className="eyebrow">THE CLAIM YOU ARE REVIEWING</span><p>{modal.claim}</p></div><span className="eyebrow">EXACT CITED PASSAGE · SOURCE TEXT</span>{safe ? <><blockquote className="source-excerpt"><Quote size={22} /><mark>{modal.citation.quote}</mark></blockquote><p className="field-help">The highlighted passage is source text. It is separate from the claim and does not by itself establish eligibility.</p><details className="source-context"><summary>Read full sample source context</summary><pre>{excerpt}</pre></details></> : <div className="notice warning"><AlertCircle size={20} /><p>{!validVersion ? "The cited source version is no longer available in this case. Restore or replace the source and review the claim." : "This source has not completed scanning and extraction. Its contents are not rendered."}</p></div>}<div className="modal-footer"><button className="button secondary" onClick={() => setModal(null)}>Back to the draft<ChevronRight size={15} /></button></div></Dialog>;
    }
    const document = state.documents.find(d => d.id === modal.sourceId);
    if (!document) return <Dialog title="Source removed" onClose={() => setModal(null)}><p>This source is no longer part of the case. Dependent results require review.</p></Dialog>;
    return <Dialog drawer title="Source details & associations" onClose={() => setModal(null)}><div className="source-metadata"><span className="file-icon"><FileText size={25} /></span><div><h3>{document.name}</h3><p>{document.exhibit} · Version {document.version} · {document.kind}</p></div></div><Pill tone={document.status === "ready" ? "green" : "amber"}>{document.sample ? "Fictional sample source" : readable(document.status)}</Pill>{document.status !== "ready" && <div className="notice warning"><ShieldCheck size={19} /><p>{document.issue || "Stored privately in quarantine. Safety scanning and extraction are not connected; file contents cannot be previewed or used as support."}</p></div>}<div className="section-heading"><div><h3>Criterion associations</h3><p>Confirm this exact version for each section.</p></div></div><div className="association-list">{CRITERIA.map(c => { const association = document.associations.find(a => a.criterion === c.id); return <label className="association-row" key={c.id}><span><strong>{c.id} · {c.shortTitle}</strong><small>{association ? `Association revision ${association.revision}` : "Not associated"}</small></span><select className="select" aria-label={`${c.id} association`} value={association?.status || "removed"} onChange={e => { if (association?.status === "confirmed" && e.target.value !== "confirmed") { const result = state.runs[c.id]?.result; const composition = state.composition?.selected.some(s => s.criterion === c.id) ? ` Composition v${state.composition.version} will also need review.` : ""; if (result && !window.confirm(`Changing this association will invalidate ${c.id} result revision ${result.revision}.${composition} The source remains stored for other criteria. Continue?`)) return; } dispatch({ type: "association", sourceId: document.id, criterion: c.id, status: e.target.value as "proposed" | "confirmed" | "removed" }); notify("Association updated. Dependent criterion results have been marked for review."); }}><option value="removed">Not included</option><option value="proposed">Proposed</option><option value="confirmed" disabled={document.status !== "ready"}>Confirmed</option></select></label>; })}</div>{document.status === "ready" && <details className="source-context"><summary>View fictional source text</summary><pre>{document.excerpt}</pre></details>}{state.facts.filter(fact => fact.sourceId === document.id).map(fact => <FactCard key={fact.id} fact={fact} importDisabled={importDisabled} importContext={importContext} document={document} dispatch={dispatch} openSource={openSource} notify={notify} />)}{!!document.previousVersions?.length && <details className="source-context"><summary>Previous source versions ({document.previousVersions.length})</summary>{document.previousVersions.map(v => <div className="history-entry" key={v.version}><strong>Version {v.version} · {v.name}</strong><p>{dateLabel(v.at)} · {readable(v.status)}</p></div>)}</details>}<div className="modal-footer">{document.sample ? <button className="button secondary small" onClick={() => { dispatch({ type: "replace_document", sourceId: document.id, document: { ...document, excerpt: `${document.excerpt}\nFictional sample version updated for review practice.` } }); notify("New sample source version created. Dependent results are stale; reconfirm its associations."); }}>Create sample version</button> : <button className="button secondary small" onClick={() => requestUpload(document.id)}><Upload size={14} />Replace file</button>}<button className="button danger small" disabled={uploading || deleting} onClick={async () => { if (!window.confirm(`Delete ${document.name}${document.sample ? " from this fictional sample" : " and its stored versions"}? Dependent sections will need review. This cannot be undone.`)) return; try { await deleteEvidence({ kind: "file", id: document.id }); setModal(null); } catch (error) { notify(error instanceof Error ? error.message : "Deletion failed. Please retry."); } }}><Trash2 size={14} />{deleting ? "Deleting…" : "Delete file"}</button></div><p className="field-help">Removing one association preserves the source and other associations. Replacing a source creates a new version and requires renewed confirmation.</p></Dialog>;
  }
}




