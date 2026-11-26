"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Check, FileText, FolderOpen, Loader2, Upload, X } from "lucide-react";
import { buildImportPatch, validateImportValue, type ImportField, type ImportSuggestion, type ImportValue } from "@/lib/form-import";
import { MAX_IMPORT_FILES, MAX_IMPORT_BATCH_CHARACTERS, evidenceSourceLabel, mergeImportSources, type ImportConflict, type ImportTextSource } from "@/lib/form-import-batch";
import { extractImportFile } from "@/lib/form-import-extract";
import { importFormat } from "@/lib/form-import-limits";
import type { Evidence } from "@/lib/model";
import { useEvidenceLibrary } from "./evidence-library-context";
import { EvidencePicker } from "./evidence-picker";
import styles from "./file-form-import.module.css";

type ImportValues = Record<string, unknown>;
type ImportSource = { file?: File; document?: Evidence };
type Review = { fileName: string; text: string; suggestions: ImportSuggestion[]; conflicts: ImportConflict[]; baseline: ImportValues; context: string; manualOnlyReason?: string };
type FileOutcome = { fileName: string; status: "waiting" | "reading" | "ready" | "failed"; message?: string };
export type FileFormImportProps = {
  fields: ImportField[];
  values: ImportValues;
  onApply: (patch: Record<string, ImportValue>) => void;
  disabled?: boolean;
  contextKey: string;
  label?: string;
  saveNote?: string;
};

const equal = (first: unknown, second: unknown) => JSON.stringify(first) === JSON.stringify(second);
const emptyValue = (field: ImportField): ImportValue => field.kind === "multi" ? [] : field.kind === "boolean" ? false : "";
function displayValue(field: ImportField, value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(item => field.options?.find(option => option.value === item)?.label ?? String(item)).join(", ") || "Empty";
  if (value === undefined || value === null || value === "") return "Empty";
  return field.options?.find(option => option.value === value)?.label ?? String(value);
}

/** Originals are retained in Evidence; extracted text stays local and only reviewed answers fill the form. */
export function FileFormImport({ fields, values, onApply, disabled = false, contextKey, label = "Fill from a document", saveNote = "Review the filled answers, then use this form’s usual save action." }: FileFormImportProps) {
  const id = useId();
  const library = useEvidenceLibrary();
  const activeContext = JSON.stringify([contextKey, library?.accountId ?? null, library?.caseId ?? null]);
  const actionsDisabled = disabled || !!library?.disabled;
  const canUpload = !!library && library.mode === "personal" && !!library.accountId;
  const [browseOpen, setBrowseOpen] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const browseButton = useRef<HTMLButtonElement>(null);
  const importHeading = useRef<HTMLHeadingElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const latest = useRef({ fields, values, disabled: actionsDisabled, contextKey: activeContext, onApply, library });
  latest.current = { fields, values, disabled: actionsDisabled, contextKey: activeContext, onApply, library };
  const lastSource = useRef<ImportSource[] | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [outcomes, setOutcomes] = useState<FileOutcome[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const [assignment, setAssignment] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [showText, setShowText] = useState(false);
  const activeReview = review?.context === activeContext ? review : null;

  useEffect(() => {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
    lastSource.current = null;
    setBusy(false); setProgress(""); setOutcomes([]); setReview(null); setError(""); setNotice("");
    setAssignment(""); setSelectedText(""); setShowText(false); setDragging(false); setBrowseOpen(false); setConsentChecked(false); setConsentBusy(false);
    if (fileInput.current) fileInput.current.value = "";
    return () => { generation.current += 1; controller.current?.abort(); };
  }, [activeContext]);

  function returnFocus() {
    const context = latest.current.contextKey;
    requestAnimationFrame(() => {
      if (latest.current.contextKey !== context) return;
      const button = chooseButton.current;
      if (button && !button.disabled) button.focus();
      else importHeading.current?.focus();
    });
  }

  function cancel() {
    generation.current += 1;
    controller.current?.abort(); controller.current = null; lastSource.current = null;
    setBusy(false); setProgress(""); setOutcomes([]); setReview(null); setError("");
    setNotice("Import canceled. Your form answers have not changed. Any file already saved remains in Evidence.");
    setSelectedText(""); setAssignment("");
    if (fileInput.current) fileInput.current.value = "";
    returnFocus();
  }

  function closeBrowser() {
    setBrowseOpen(false);
    requestAnimationFrame(() => browseButton.current?.focus());
  }

  async function saveConsent() {
    const current = latest.current;
    if (!current.library || current.disabled || !consentChecked || consentBusy) return;
    const context = current.contextKey;
    setConsentBusy(true); setError("");
    try {
      await current.library.grantConsent();
      if (latest.current.contextKey === context) setNotice("Consent saved. You can upload a file to Evidence and review its suggested answers.");
    } catch (cause) {
      if (latest.current.contextKey === context) setError(cause instanceof Error ? cause.message : "Consent could not be saved. Please retry.");
    } finally { if (latest.current.contextKey === context) setConsentBusy(false); }
  }

  async function choose(sources: ImportSource[]) {
    const current = latest.current;
    if (current.disabled || !current.library || !sources.length) return;
    if (sources.length > MAX_IMPORT_FILES) { setError(`Choose up to ${MAX_IMPORT_FILES} files at a time.`); return; }
    const hasUploads = sources.some(source => !source.document);
    if (hasUploads && (current.library.mode !== "personal" || !current.library.accountId)) {
      setError("Open a signed-in personal case to upload your files. You can browse fictional sample documents here."); return;
    }
    if (hasUploads && !current.library.consent) {
      setError("Save your storage consent below before uploading a file."); return;
    }
    controller.current?.abort();
    const request = ++generation.current;
    const context = current.contextKey;
    const abort = new AbortController(); controller.current = abort;
    lastSource.current = sources;
    setBrowseOpen(false);
    setReview(null); setError(""); setNotice(""); setBusy(true);
    setProgress("Opening your documents…");
    setAssignment(""); setSelectedText(""); setShowText(false); setDragging(false);
    const rows: FileOutcome[] = sources.map(source => ({ fileName: evidenceSourceLabel(source.document ?? { name: source.file?.name || "Document" }, current.library!.folders), status: "waiting" }));
    setOutcomes([...rows]);
    const isCurrent = () => !abort.signal.aborted && request === generation.current && latest.current.contextKey === context;
    const texts: ImportTextSource[] = [];
    let textLength = 0;
    try {
      for (let index = 0; index < sources.length; index++) {
        if (!isCurrent()) return;
        const source = sources[index];
        const prefix = `${index + 1} of ${sources.length}: ${rows[index].fileName}`;
        rows[index] = { ...rows[index], status: "reading" }; setOutcomes([...rows]);
        try {
          let file = source.file;
          if (!source.document) {
            if (!file) throw new Error("Choose a document to upload.");
            // Reject unsupported selections before storage; parsing happens only after retention.
            importFormat(file.name, file.size);
            setProgress(`${prefix} — saving to Evidence…`);
            source.document = await current.library.upload(file, abort.signal);
            if (!isCurrent()) return;
          } else if (!file) {
            setProgress(`${prefix} — opening saved file…`);
            file = await current.library.read(source.document, abort.signal);
            if (!isCurrent()) return;
          }
          if (!file) throw new Error("The original file is unavailable. Choose another document.");
          setProgress(`${prefix} — reading locally…`);
          const result = await extractImportFile(file, { signal: abort.signal, onProgress: (message: string) => {
            if (isCurrent()) setProgress(`${prefix} — ${message}`);
          } });
          if (!isCurrent()) return;
          if (!result.text.trim()) throw new Error("No readable text found. Scans and images need OCR first.");
          if (textLength + result.text.length > MAX_IMPORT_BATCH_CHARACTERS) throw new Error("This selection has too much text. Import this file in a separate batch.");
          textLength += result.text.length;
          texts.push({ fileName: rows[index].fileName, text: result.text, manualOnly: result.manualOnly, manualOnlyReason: result.manualOnlyReason });
          rows[index] = { ...rows[index], status: "ready", message: result.manualOnly ? "Text ready for manual assignment" : "Ready to review" };
        } catch (cause) {
          if (!isCurrent()) return;
          rows[index] = { ...rows[index], status: "failed", message: cause instanceof Error ? cause.message : "This document could not be read." };
        }
        setOutcomes([...rows]);
      }
      if (!isCurrent()) return;
      const failedCount = rows.filter(row => row.status === "failed").length;
      if (failedCount) setError(`${failedCount} ${failedCount === 1 ? "file could" : "files could"} not be read. Check each file’s result. Your saved files remain in Evidence.`);
      if (!texts.length) { setNotice("No form answers have changed. Try another supported document."); return; }
      const latestValues = latest.current;
      const { suggestions, conflicts } = mergeImportSources(texts, latestValues.fields, latestValues.values);
      const manualOnlyReason = texts.filter(source => source.manualOnly).map(source => `${source.fileName}: ${source.manualOnlyReason || "Choose text and assign it to a field manually."}`).join(" ") || undefined;
      const text = texts.map(source => texts.length > 1 ? `DOCUMENT: ${source.fileName}\n${source.text}` : source.text).join("\n\n────────────────────\n\n");
      setReview({ fileName: texts.map(source => source.fileName).join(" · "), text, suggestions, conflicts, baseline: structuredClone(latestValues.values), context, manualOnlyReason });
      setShowText(suggestions.length === 0 && conflicts.length === 0);
      setNotice(`${texts.length} ${texts.length === 1 ? "document is" : "documents are"} ready. ` + (conflicts.length ? "Some files suggest different answers. Choose the correct source for those fields below." : suggestions.length ? "Review each suggestion before filling this form." : "No reliable matches were found. Choose text and assign it to a field below."));
      requestAnimationFrame(() => { if (isCurrent()) reviewHeading.current?.focus(); });
    } finally {
      if (request === generation.current) { controller.current = null; setBusy(false); setProgress(""); }
    }
  }

  function chooseInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) void choose([{ file }]);
  }

  function drop(event: DragEvent<HTMLElement>) {
    event.preventDefault(); setDragging(false);
    if (actionsDisabled || busy) return;
    if (event.dataTransfer.files.length !== 1) {
      setError("Choose one document at a time."); return;
    }
    const file = event.dataTransfer.files[0];
    if (file) void choose([{ file }]);
  }

  function updateSuggestion(key: string, value: ImportValue) {
    const field = latest.current.fields.find(item => item.key === key);
    if (!field) return;
    const checked = validateImportValue(field, value);
    setReview(current => current && ({ ...current, suggestions: current.suggestions.map(suggestion => suggestion.key === key ? { ...suggestion, value, error: checked.error } : suggestion) }));
    setError(""); setNotice("");
  }

  function selectSuggestion(key: string, selected: boolean) {
    const field = latest.current.fields.find(item => item.key === key);
    if (!field) return;
    setReview(current => current && ({
      ...current,
      baseline: { ...current.baseline, [key]: structuredClone(latest.current.values[key]) },
      suggestions: current.suggestions.map(suggestion => suggestion.key === key ? {
        ...suggestion, selected,
        error: validateImportValue(field, suggestion.value).error,
      } : suggestion),
    }));
    setError("");
  }

  function addAssignment() {
    const field = latest.current.fields.find(item => item.key === assignment);
    if (!field || !activeReview || activeReview.suggestions.some(suggestion => suggestion.key === field.key)) return;
    const checked = selectedText ? validateImportValue(field, selectedText) : undefined;
    const value = checked?.value ?? (selectedText || emptyValue(field));
    setReview(current => current && ({ ...current, conflicts: current.conflicts.filter(conflict => conflict.key !== field.key), suggestions: [...current.suggestions, { key: field.key, value, selected: false, excerpt: selectedText, error: checked?.error }] }));
    setAssignment("");
    setNotice(`Added ${field.label}. Edit its proposed value and select it to fill this form.`);
  }

  function chooseConflict(conflict: ImportConflict, index: number) {
    const candidate = conflict.candidates[index];
    if (!candidate || actionsDisabled) return;
    setReview(current => current && ({ ...current,
      conflicts: current.conflicts.filter(item => item.key !== conflict.key),
      suggestions: [...current.suggestions.filter(item => item.key !== conflict.key), { key: conflict.key, value: candidate.value, excerpt: `${candidate.fileName}\n${candidate.excerpt}`, error: candidate.error, selected: false }],
    }));
    setNotice(`Added the proposed ${conflict.label.toLowerCase()}. Review and check its field below before applying.`);
  }

  function apply() {
    const current = latest.current;
    if (!activeReview || current.disabled || activeReview.context !== current.contextKey) return;
    const changed = activeReview.suggestions.filter(suggestion => suggestion.selected && !equal(activeReview.baseline[suggestion.key], current.values[suggestion.key]));
    if (changed.length) {
      const keys = new Set(changed.map(suggestion => suggestion.key));
      setReview(previous => previous && ({ ...previous, baseline: structuredClone(current.values), suggestions: previous.suggestions.map(suggestion => keys.has(suggestion.key) ? { ...suggestion, selected: false } : suggestion) }));
      setError("Some answers changed while you were reviewing. Those fields are now unselected. Compare their current values and select them again if you want to replace them.");
      return;
    }
    const result = buildImportPatch(current.fields, activeReview.suggestions, current.values);
    if (Object.keys(result.errors).length) {
      setReview(previous => previous && ({ ...previous, suggestions: previous.suggestions.map(suggestion => ({ ...suggestion, error: result.errors[suggestion.key] })) }));
      setError("Check the highlighted fields before applying your selections.");
      return;
    }
    const count = Object.keys(result.patch).length;
    if (!count) { setNotice("Select at least one field to fill."); return; }
    current.onApply(result.patch);
    setReview(null); lastSource.current = null; setOutcomes([]); setSelectedText(""); setAssignment(""); setError("");
    setNotice(`Filled ${count} ${count === 1 ? "field" : "fields"} in this form. ${saveNote}`);
    returnFocus();
  }

  function editor(field: ImportField, suggestion: ImportSuggestion) {
    const inputId = `${id}-value-${field.key}`;
    const helpId = `${id}-help-${field.key}`;
    const errorId = `${id}-error-${field.key}`;
    const describedBy = [helpId, suggestion.error ? errorId : ""].filter(Boolean).join(" ");
    const common = { id: inputId, className: styles.editor, disabled: actionsDisabled, "aria-invalid": !!suggestion.error, "aria-describedby": describedBy };
    if (field.kind === "choice") {
      const value = typeof suggestion.value === "string" ? suggestion.value : String(suggestion.value);
      const unrecognized = value && !field.options?.some(option => option.value === value);
      return <select {...common} value={value} onChange={event => updateSuggestion(field.key, event.target.value)}>
        <option value="">Choose a value</option>
        {unrecognized && <option value={value}>Unrecognized: {value}</option>}
        {field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>;
    }
    if (field.kind === "multi") {
      const value = Array.isArray(suggestion.value) ? suggestion.value : typeof suggestion.value === "string" && suggestion.value ? [suggestion.value] : [];
      const unknown = value.filter(item => !field.options?.some(option => option.value === item));
      return <select {...common} multiple size={Math.min(5, (field.options?.length ?? 0) + unknown.length || 3)} value={value} onChange={event => updateSuggestion(field.key, Array.from(event.target.selectedOptions, option => option.value))}>
        {unknown.map(item => <option key={item} value={item}>Unrecognized: {item}</option>)}
        {field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>;
    }
    if (field.kind === "boolean") return <select {...common} value={typeof suggestion.value === "boolean" ? String(suggestion.value) : ""} onChange={event => updateSuggestion(field.key, event.target.value === "true")}>
      <option value="" disabled>Choose yes or no</option><option value="true">Yes</option><option value="false">No</option>
    </select>;
    const value = Array.isArray(suggestion.value) ? suggestion.value.join(", ") : String(suggestion.value);
    // Keep overlong extracted values visible so the user can shorten them; validation blocks Apply.
    return field.kind === "textarea"
      ? <textarea {...common} rows={4} value={value} onChange={event => updateSuggestion(field.key, event.target.value)} />
      : <input {...common} type="text" value={value} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} onChange={event => updateSuggestion(field.key, event.target.value)} />;
  }

  const selectedCount = activeReview?.suggestions.filter(suggestion => suggestion.selected).length ?? 0;
  const assignable = fields.filter(field => !activeReview?.suggestions.some(suggestion => suggestion.key === field.key));
  return <section className={`${styles.importer} ${dragging ? styles.dragging : ""}`} aria-labelledby={`${id}-title`}
    onDragOver={event => { event.preventDefault(); if (!actionsDisabled && !busy && canUpload && library?.consent) setDragging(true); }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={drop}>
    <div className={styles.intro}>
      <span className={styles.icon}><FileText size={21} aria-hidden="true" /></span>
      <div className={styles.introText}><h3 ref={importHeading} id={`${id}-title`} tabIndex={-1}>{label}</h3><p>Upload a new document or select saved files from your Evidence library.</p></div>
      <div className={styles.fileActions}>
        <button ref={chooseButton} type="button" className={styles.choose} disabled={actionsDisabled || busy || !canUpload || !library?.consent} onClick={() => fileInput.current?.click()}><Upload size={16} aria-hidden="true" />Upload file</button>
        <button ref={browseButton} type="button" className={styles.choose} disabled={actionsDisabled || busy || !library} aria-expanded={browseOpen} onClick={() => setBrowseOpen(value => !value)}><FolderOpen size={16} aria-hidden="true" />Browse Evidence</button>
      </div>
    </div>
    <label htmlFor={`${id}-file`} className={styles.srOnly}>Document for {label.toLowerCase()}</label>
    <input ref={fileInput} id={`${id}-file`} className={styles.srOnly} tabIndex={-1} type="file" accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json" disabled={actionsDisabled || busy || !canUpload || !library?.consent} onChange={chooseInput} />
    <p className={styles.fileHelp}>Or drop one file here, up to 10 MB. Text PDF, DOCX, TXT, Markdown, CSV or JSON. Scans and images need OCR first.</p>
    <p className={styles.privacy}>New files are saved privately in Evidence. Text is read in your browser; only the answers you review and apply fill this form. Filling a form does not verify the evidence.</p>
    {!canUpload && <p className={styles.fileHelp}>Uploads require a signed-in personal case. In the sample, Browse Evidence lets you try the fictional documents.</p>}
    {canUpload && !library?.consent && <div className={styles.consent}>
      <label><input type="checkbox" checked={consentChecked} disabled={actionsDisabled || consentBusy} onChange={event => setConsentChecked(event.target.checked)} /><span>I agree to save my uploaded files privately in Evidence. I understand that safety scanning and automated evidence processing are not yet available.</span></label>
      <button type="button" className={styles.choose} disabled={!consentChecked || actionsDisabled || consentBusy} onClick={() => void saveConsent()}>{consentBusy && <Loader2 size={16} className={styles.spinner} aria-hidden="true" />}{consentBusy ? "Saving consent…" : "Save storage consent"}</button>
    </div>}
    {actionsDisabled && <p className={styles.fileHelp}>Wait for saving to finish or resolve the workspace message before continuing. Your document review stays here.</p>}
    {browseOpen && library && <EvidencePicker documents={library.documents} folders={library.folders} disabled={actionsDisabled || busy} onChoose={documents => void choose(documents.map(document => ({ document })))} onClose={closeBrowser} />}
    {busy && <div className={styles.progress} role="status"><Loader2 size={19} className={styles.spinner} aria-hidden="true" /><span>{progress || "Reading your document…"}</span><button type="button" className={styles.quiet} onClick={cancel}>Cancel import</button></div>}
    {outcomes.length > 0 && <ul className={styles.fileResults} aria-label="Document import results">{outcomes.map((outcome, index) => <li key={index} className={outcome.status === "failed" ? styles.failedFile : ""}><span>{outcome.status === "reading" ? <Loader2 size={15} className={styles.spinner} aria-hidden="true" /> : outcome.status === "ready" ? <Check size={15} aria-hidden="true" /> : <FileText size={15} aria-hidden="true" />}<strong>{outcome.fileName}</strong></span><small>{outcome.message || (outcome.status === "reading" ? "Reading…" : "Waiting")}</small></li>)}</ul>}
    {error && <div className={styles.error} role="alert"><p>{error}</p>{!busy && lastSource.current && !activeReview && <button type="button" className={styles.quiet} disabled={actionsDisabled} onClick={() => { if (lastSource.current) void choose(lastSource.current); }}>Retry files</button>}</div>}
    <p className={`${styles.notice} ${notice ? "" : styles.srOnly}`} role="status" aria-live="polite">{notice}</p>
    {activeReview && <div className={styles.review}>
      <div className={styles.reviewHeader}><div><h4 ref={reviewHeading} tabIndex={-1}>Review before filling</h4><p>{activeReview.fileName}</p></div><button type="button" className={styles.close} onClick={cancel} aria-label="Cancel file import"><X size={18} aria-hidden="true" /></button></div>
      <p className={styles.instructions}>Only selected fields will change. Existing answers are unselected by default. Suggestions are applicant-entered information, not verified facts.</p>
      {activeReview.manualOnlyReason && <p className={styles.manualNotice}>{activeReview.manualOnlyReason}</p>}
      {activeReview.conflicts.length > 0 && <div className={styles.conflicts}><h5>Different answers found</h5><p>Choose the source you want to use, or assign the field yourself from the document text. These fields will stay unchanged until you review and select them.</p>{activeReview.conflicts.map(conflict => <div key={conflict.key} className={styles.conflict}><strong>{conflict.label}</strong>{conflict.candidates.map((candidate, index) => <div className={styles.candidate} key={index}><div><small>{candidate.fileName}</small><p>{displayValue(fields.find(field => field.key === conflict.key)!, candidate.value)}</p></div><button type="button" className={styles.choose} disabled={actionsDisabled} onClick={() => chooseConflict(conflict, index)}>Use this answer</button></div>)}</div>)}</div>}
      <details className={styles.extracted} open={showText} onToggle={event => setShowText(event.currentTarget.open)}>
        <summary>Read extracted text or assign a field yourself</summary>
        <label htmlFor={`${id}-text`}>Document text</label>
        <textarea id={`${id}-text`} className={styles.documentText} readOnly rows={8} value={activeReview.text} onSelect={event => { const element = event.currentTarget; setSelectedText(element.value.slice(element.selectionStart, element.selectionEnd)); }} aria-describedby={`${id}-text-help`} />
        <p id={`${id}-text-help`}>Select a passage to use as a proposed answer and source excerpt, then choose its field. You can also add an empty field and write the answer yourself.</p>
        {assignable.length ? <div className={styles.assignment}><label htmlFor={`${id}-assignment`}>Assign to a field<select id={`${id}-assignment`} value={assignment} disabled={actionsDisabled} onChange={event => setAssignment(event.target.value)}><option value="">Choose a field</option>{assignable.map(field => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label><button type="button" className={styles.choose} disabled={!assignment || actionsDisabled} onClick={addAssignment}>Add field</button></div> : <p>All fields are listed below. Edit their proposed values as needed.</p>}
        {selectedText && <p className={styles.selectionNote}>{selectedText.length.toLocaleString()} characters selected from the document.</p>}
      </details>
      <div className={styles.suggestions}>
        {activeReview.suggestions.map(suggestion => {
          const field = fields.find(item => item.key === suggestion.key);
          if (!field) return null;
          return <div key={field.key} className={`${styles.suggestion} ${suggestion.selected ? styles.selected : ""}`}>
            <label className={styles.selection}><input type="checkbox" disabled={actionsDisabled} checked={suggestion.selected} onChange={event => selectSuggestion(field.key, event.target.checked)} /><span>Fill {field.label}</span></label>
            <div className={styles.current}><strong>Current answer</strong><p>{displayValue(field, values[field.key])}</p></div>
            <label htmlFor={`${id}-value-${field.key}`} className={styles.valueLabel}>Proposed {field.label.toLowerCase()}</label>
            {editor(field, suggestion)}
            <p id={`${id}-help-${field.key}`} className={styles.fieldHelp}>{field.kind === "multi" ? "Multiple choices allowed. " : ""}{field.maxLength ? `Up to ${field.maxLength.toLocaleString()} characters.` : "Edit this value before applying if needed."}</p>
            {suggestion.error && <p id={`${id}-error-${field.key}`} className={styles.fieldError}>{suggestion.error}</p>}
            {suggestion.excerpt ? <details className={styles.excerpt}><summary>Source excerpt</summary><blockquote>{suggestion.excerpt}</blockquote></details> : <p className={styles.fieldHelp}>Manually assigned. Check the document text above for context.</p>}
          </div>;
        })}
      </div>
      <div className={styles.applyRow}><button type="button" className={styles.apply} disabled={!selectedCount || actionsDisabled} onClick={apply}><Check size={17} aria-hidden="true" />Fill {selectedCount || "selected"} {selectedCount === 1 ? "field" : "fields"}</button><button type="button" className={styles.quiet} onClick={cancel}>Cancel import</button></div>
      <p className={styles.fileHelp}>{saveNote}</p>
    </div>}
  </section>;
}

export default FileFormImport;
