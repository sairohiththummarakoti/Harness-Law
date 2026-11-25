"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Check, FileText, Loader2, Upload, X } from "lucide-react";
import { buildImportPatch, suggestImportFields, validateImportValue, type ImportField, type ImportSuggestion, type ImportValue } from "@/lib/form-import";
import { extractImportFile } from "@/lib/form-import-extract";
import styles from "./file-form-import.module.css";

type ImportValues = Record<string, unknown>;
type Review = { fileName: string; text: string; suggestions: ImportSuggestion[]; baseline: ImportValues; context: string; manualOnlyReason?: string };
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

/** Files and extracted text stay in this mounted component. Only the reviewed patch leaves it. */
export function FileFormImport({ fields, values, onApply, disabled = false, contextKey, label = "Fill from a document", saveNote = "Review the filled answers, then use this form’s usual save action." }: FileFormImportProps) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const importHeading = useRef<HTMLHeadingElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const latest = useRef({ fields, values, disabled, contextKey, onApply });
  latest.current = { fields, values, disabled, contextKey, onApply };
  const lastFile = useRef<File | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const [assignment, setAssignment] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [showText, setShowText] = useState(false);
  const activeReview = !disabled && review?.context === contextKey ? review : null;

  useEffect(() => {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
    lastFile.current = null;
    setBusy(false); setProgress(""); setReview(null); setError(""); setNotice("");
    setAssignment(""); setSelectedText(""); setShowText(false); setDragging(false);
    if (fileInput.current) fileInput.current.value = "";
    return () => { generation.current += 1; controller.current?.abort(); };
  }, [contextKey, disabled]);

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
    controller.current?.abort(); controller.current = null; lastFile.current = null;
    setBusy(false); setProgress(""); setReview(null); setError("");
    setNotice("Import canceled. Your form answers have not changed.");
    setSelectedText(""); setAssignment("");
    if (fileInput.current) fileInput.current.value = "";
    returnFocus();
  }

  async function choose(file: File) {
    if (latest.current.disabled) return;
    controller.current?.abort();
    const request = ++generation.current;
    const context = latest.current.contextKey;
    const abort = new AbortController(); controller.current = abort;
    lastFile.current = file;
    setReview(null); setError(""); setNotice(""); setBusy(true); setProgress("Reading your document locally…");
    setAssignment(""); setSelectedText(""); setShowText(false); setDragging(false);
    try {
      const result = await extractImportFile(file, { signal: abort.signal, onProgress: (message: string) => {
        if (request === generation.current && !abort.signal.aborted) setProgress(message);
      } });
      if (abort.signal.aborted || request !== generation.current || latest.current.disabled || latest.current.contextKey !== context) return;
      if (!result.text.trim()) {
        setError("No readable text was found. Try a document containing selectable text. Scans and images need OCR first.");
        return;
      }
      const current = latest.current;
      const suggestions = result.manualOnly ? [] : suggestImportFields(result.text, current.fields, current.values);
      const manualOnlyReason = result.manualOnly ? result.manualOnlyReason || "This document needs manual field assignment." : undefined;
      setReview({ fileName: result.fileName, text: result.text, suggestions, baseline: structuredClone(current.values), context, manualOnlyReason });
      setShowText(suggestions.length === 0);
      setNotice(suggestions.length ? "Review each suggestion before filling this form." : manualOnlyReason ? "Read the document text and assign the relevant passages to fields below." : "No reliable field matches were found. Choose text and assign it to a field below.");
      // The next animation frame follows the committed review markup.
      requestAnimationFrame(() => { if (request === generation.current) reviewHeading.current?.focus(); });
    } catch (cause) {
      if (abort.signal.aborted || request !== generation.current) return;
      setError(cause instanceof Error ? cause.message : "We couldn’t read this document. Try another supported file.");
    } finally {
      if (request === generation.current) { controller.current = null; setBusy(false); setProgress(""); }
    }
  }

  function chooseInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) void choose(file);
  }

  function drop(event: DragEvent<HTMLElement>) {
    event.preventDefault(); setDragging(false);
    if (disabled) return;
    if (event.dataTransfer.files.length !== 1) {
      setError("Choose one document at a time."); return;
    }
    const file = event.dataTransfer.files[0];
    if (file) void choose(file);
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
    setReview(current => current && ({ ...current, suggestions: [...current.suggestions, { key: field.key, value, selected: false, excerpt: selectedText, error: checked?.error }] }));
    setAssignment("");
    setNotice(`Added ${field.label}. Edit its proposed value and select it to fill this form.`);
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
    setReview(null); lastFile.current = null; setSelectedText(""); setAssignment(""); setError("");
    setNotice(`Filled ${count} ${count === 1 ? "field" : "fields"} in this form. ${saveNote}`);
    returnFocus();
  }

  function editor(field: ImportField, suggestion: ImportSuggestion) {
    const inputId = `${id}-value-${field.key}`;
    const helpId = `${id}-help-${field.key}`;
    const errorId = `${id}-error-${field.key}`;
    const describedBy = [helpId, suggestion.error ? errorId : ""].filter(Boolean).join(" ");
    const common = { id: inputId, className: styles.editor, disabled, "aria-invalid": !!suggestion.error, "aria-describedby": describedBy };
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
    onDragOver={event => { event.preventDefault(); if (!disabled) setDragging(true); }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={drop}>
    <div className={styles.intro}>
      <span className={styles.icon}><FileText size={21} aria-hidden="true" /></span>
      <div className={styles.introText}><h3 ref={importHeading} id={`${id}-title`} tabIndex={-1}>{label}</h3><p>Choose a document to review suggestions for the fields in this form.</p></div>
      <button ref={chooseButton} type="button" className={styles.choose} disabled={disabled} onClick={() => fileInput.current?.click()}><Upload size={16} aria-hidden="true" />{busy || activeReview ? "Choose another file" : "Choose a file"}</button>
    </div>
    <label htmlFor={`${id}-file`} className={styles.srOnly}>Document for {label.toLowerCase()}</label>
    <input ref={fileInput} id={`${id}-file`} className={styles.srOnly} tabIndex={-1} type="file" accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json" disabled={disabled} onChange={chooseInput} />
    <p className={styles.fileHelp}>Or drop one file here, up to 10 MB. Text PDF, DOCX, TXT, Markdown, CSV or JSON. Scans and images need OCR first.</p>
    <p className={styles.privacy}>Read only in your browser. Your file is not uploaded or added as evidence. Filled answers are saved with this form and still need review.</p>
    {disabled && <p className={styles.fileHelp}>File import is unavailable while this form is saving or waiting for a conflict to be resolved.</p>}
    {busy && <div className={styles.progress} role="status"><Loader2 size={19} className={styles.spinner} aria-hidden="true" /><span>{progress || "Reading your document…"}</span><button type="button" className={styles.quiet} onClick={cancel}>Cancel import</button></div>}
    {error && <div className={styles.error} role="alert"><p>{error}</p>{!busy && lastFile.current && !activeReview && <button type="button" className={styles.quiet} disabled={disabled} onClick={() => { if (lastFile.current) void choose(lastFile.current); }}>Retry this file</button>}</div>}
    <p className={`${styles.notice} ${notice ? "" : styles.srOnly}`} role="status" aria-live="polite">{notice}</p>
    {activeReview && <div className={styles.review}>
      <div className={styles.reviewHeader}><div><h4 ref={reviewHeading} tabIndex={-1}>Review before filling</h4><p>{activeReview.fileName}</p></div><button type="button" className={styles.close} onClick={cancel} aria-label="Cancel file import"><X size={18} aria-hidden="true" /></button></div>
      <p className={styles.instructions}>Only selected fields will change. Existing answers are unselected by default. Suggestions are applicant-entered information, not verified facts.</p>
      {activeReview.manualOnlyReason && <p className={styles.manualNotice}>{activeReview.manualOnlyReason} Automatic suggestions are disabled for this document. Choose a passage and assign it to a field below.</p>}
      <details className={styles.extracted} open={showText} onToggle={event => setShowText(event.currentTarget.open)}>
        <summary>Read extracted text or assign a field yourself</summary>
        <label htmlFor={`${id}-text`}>Document text</label>
        <textarea id={`${id}-text`} className={styles.documentText} readOnly rows={8} value={activeReview.text} onSelect={event => { const element = event.currentTarget; setSelectedText(element.value.slice(element.selectionStart, element.selectionEnd)); }} aria-describedby={`${id}-text-help`} />
        <p id={`${id}-text-help`}>Select a passage to use as a proposed answer and source excerpt, then choose its field. You can also add an empty field and write the answer yourself.</p>
        {assignable.length ? <div className={styles.assignment}><label htmlFor={`${id}-assignment`}>Assign to a field<select id={`${id}-assignment`} value={assignment} onChange={event => setAssignment(event.target.value)}><option value="">Choose a field</option>{assignable.map(field => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label><button type="button" className={styles.choose} disabled={!assignment} onClick={addAssignment}>Add field</button></div> : <p>All fields are listed below. Edit their proposed values as needed.</p>}
        {selectedText && <p className={styles.selectionNote}>{selectedText.length.toLocaleString()} characters selected from the document.</p>}
      </details>
      <div className={styles.suggestions}>
        {activeReview.suggestions.map(suggestion => {
          const field = fields.find(item => item.key === suggestion.key);
          if (!field) return null;
          return <div key={field.key} className={`${styles.suggestion} ${suggestion.selected ? styles.selected : ""}`}>
            <label className={styles.selection}><input type="checkbox" checked={suggestion.selected} onChange={event => selectSuggestion(field.key, event.target.checked)} /><span>Fill {field.label}</span></label>
            <div className={styles.current}><strong>Current answer</strong><p>{displayValue(field, values[field.key])}</p></div>
            <label htmlFor={`${id}-value-${field.key}`} className={styles.valueLabel}>Proposed {field.label.toLowerCase()}</label>
            {editor(field, suggestion)}
            <p id={`${id}-help-${field.key}`} className={styles.fieldHelp}>{field.kind === "multi" ? "Multiple choices allowed. " : ""}{field.maxLength ? `Up to ${field.maxLength.toLocaleString()} characters.` : "Edit this value before applying if needed."}</p>
            {suggestion.error && <p id={`${id}-error-${field.key}`} className={styles.fieldError}>{suggestion.error}</p>}
            {suggestion.excerpt ? <details className={styles.excerpt}><summary>Source excerpt</summary><blockquote>{suggestion.excerpt}</blockquote></details> : <p className={styles.fieldHelp}>Manually assigned. Check the document text above for context.</p>}
          </div>;
        })}
      </div>
      <div className={styles.applyRow}><button type="button" className={styles.apply} disabled={!selectedCount || disabled} onClick={apply}><Check size={17} aria-hidden="true" />Fill {selectedCount || "selected"} {selectedCount === 1 ? "field" : "fields"}</button><button type="button" className={styles.quiet} onClick={cancel}>Cancel import</button></div>
      <p className={styles.fileHelp}>{saveNote}</p>
    </div>}
  </section>;
}

export default FileFormImport;
