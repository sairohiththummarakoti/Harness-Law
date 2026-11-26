"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, ArrowUp, ChevronRight, FileText, Folder, Search, X } from "lucide-react";
import type { Evidence, EvidenceFolder } from "@/lib/model";
import { importFormat } from "@/lib/form-import-limits";
import { MAX_IMPORT_FILES, evidenceSourceLabel } from "@/lib/form-import-batch";
import { folderTrail, folderPath } from "@/lib/evidence-folders";
import styles from "./evidence-picker.module.css";

function unavailableReason(document: Evidence): string {
  if (document.sample) return document.excerpt.trim() ? "" : "No sample text available";
  if (!document.objectId) return "Original file unavailable";
  if (document.status === "rejected") return "This file cannot be used";
  if (/\.(jpe?g|png)$/i.test(document.name)) return "Images need OCR before form filling";
  try { importFormat(document.name, document.bytes); return ""; }
  catch (error) { return error instanceof Error ? error.message : "Unsupported document"; }
}
const sizeLabel = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.ceil(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export function EvidencePicker({ documents, folders, disabled = false, onChoose, onClose }: {
  documents: Evidence[];
  folders: EvidenceFolder[];
  disabled?: boolean;
  onChoose: (documents: Evidence[]) => void;
  onClose: () => void;
}) {
  const id = useId();
  const search = useRef<HTMLInputElement>(null);
  const selectAll = useRef<HTMLInputElement>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [selectionNote, setSelectionNote] = useState("");
  const currentFolder = folders.some(folder => folder.id === folderId) ? folderId : null;
  const needle = query.trim().toLocaleLowerCase();
  const path = folderTrail(folders, currentFolder);
  const childFolders = folders.filter(folder => needle ? folder.name.toLocaleLowerCase().includes(needle) : folder.parentId === currentFolder).sort((a, b) => a.name.localeCompare(b.name));
  const files = documents.filter(document => needle ? document.name.toLocaleLowerCase().includes(needle) : (document.folderId ?? null) === currentFolder).sort((a, b) => a.name.localeCompare(b.name));
  const eligible = files.filter(document => !unavailableReason(document));
  const chosen = documents.filter(document => selected.has(document.id) && !unavailableReason(document));
  const visibleSelectedCount = eligible.filter(document => selected.has(document.id)).length;
  const allVisibleSelected = eligible.length > 0 && visibleSelectedCount === eligible.length;

  useEffect(() => { search.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => { if (selectAll.current) selectAll.current.indeterminate = visibleSelectedCount > 0 && !allVisibleSelected; }, [visibleSelectedCount, allVisibleSelected]);

  function openFolder(next: string | null) {
    if (next !== currentFolder) setHistory(previous => [...previous, currentFolder]);
    setFolderId(next); setQuery("");
  }
  function back() {
    if (!history.length) return;
    setFolderId(history.at(-1) ?? null); setHistory(previous => previous.slice(0, -1)); setQuery("");
  }
  function toggle(document: Evidence, checked: boolean) {
    setSelectionNote("");
    if (checked && chosen.length >= MAX_IMPORT_FILES) { setSelectionNote(`Choose up to ${MAX_IMPORT_FILES} files at a time.`); return; }
    setSelected(previous => { const next = new Set(previous); if (checked) next.add(document.id); else next.delete(document.id); return next; });
  }
  function toggleVisible(checked: boolean) {
    setSelectionNote("");
    const next = new Set(chosen.map(document => document.id));
    if (checked) {
      for (const document of eligible) if (next.size < MAX_IMPORT_FILES || next.has(document.id)) next.add(document.id);
      if (eligible.some(document => !next.has(document.id))) setSelectionNote(`Selected up to ${MAX_IMPORT_FILES} files. Use these, then browse for more.`);
    } else for (const document of eligible) next.delete(document.id);
    setSelected(next);
  }

  return <section className={styles.picker} aria-labelledby={`${id}-title`} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <div className={styles.heading}><div><h4 id={`${id}-title`}>Browse Evidence</h4><p>Choose files from any folder. Your selections stay checked as you browse.</p></div><button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close Evidence browser"><X size={18} /></button></div>
    <div className={styles.addressBar}>
      <div className={styles.navigation}><button type="button" className={styles.iconButton} disabled={!history.length} onClick={back} aria-label="Back to previous Evidence folder"><ArrowLeft size={18} /></button><button type="button" className={styles.iconButton} disabled={!currentFolder} onClick={() => openFolder(path.at(-1)?.parentId ?? null)} aria-label="Up one Evidence folder"><ArrowUp size={18} /></button></div>
      <nav className={styles.breadcrumbs} aria-label="Evidence folder location"><button type="button" onClick={() => openFolder(null)} aria-current={!currentFolder ? "location" : undefined}><Folder size={16} aria-hidden="true" />Evidence</button>{path.map(folder => <span key={folder.id}><ChevronRight size={13} aria-hidden="true" /><button type="button" onClick={() => openFolder(folder.id)} aria-current={folder.id === currentFolder ? "location" : undefined}>{folder.name}</button></span>)}</nav>
      <label className={styles.search}><Search size={16} aria-hidden="true" /><span className={styles.srOnly}>Search saved evidence files and folders</span><input ref={search} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search Evidence" /></label>
    </div>
    <div className={styles.selectionBar}><label><input ref={selectAll} type="checkbox" checked={allVisibleSelected} disabled={disabled || !eligible.length} onChange={event => toggleVisible(event.target.checked)} />Select all files here</label><span>{needle ? "Results from all folders" : `${childFolders.length} folders · ${files.length} files`}</span></div>
    <div className={styles.list}>
      <table className={styles.table}><thead><tr><th scope="col"><span className={styles.srOnly}>Select</span></th><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Size</th></tr></thead><tbody>
        {childFolders.map(folder => <tr className={styles.folder} key={folder.id}><td /><td><button type="button" onClick={() => openFolder(folder.id)}><Folder size={22} aria-hidden="true" /><span><strong>{folder.name}</strong>{needle && <small>{folderPath(folders, folder.parentId)}</small>}</span><ChevronRight size={15} aria-hidden="true" /></button></td><td>Folder</td><td>—</td></tr>)}
        {files.map(document => {
          const reason = unavailableReason(document);
          const checked = chosen.some(item => item.id === document.id);
          const inputId = `${id}-file-${document.id}`;
          return <tr className={`${styles.file} ${checked ? styles.selected : ""} ${reason ? styles.unavailable : ""}`} key={document.id}>
            <td><input id={inputId} type="checkbox" checked={checked} disabled={disabled || !!reason} aria-label={`Select ${document.name}`} aria-describedby={reason ? `${inputId}-reason` : undefined} onChange={event => toggle(document, event.target.checked)} /></td>
            <td><label htmlFor={inputId}><FileText size={21} aria-hidden="true" /><span><strong>{document.name}</strong>{needle && <small>{folderPath(folders, document.folderId ?? null)}</small>}{document.sample && <small>Fictional sample text</small>}{reason && <small id={`${inputId}-reason`} className={styles.reason}>{reason}</small>}</span></label></td>
            <td>{document.kind}</td><td>{sizeLabel(document.bytes)}</td>
          </tr>;
        })}
      </tbody></table>
      {!files.length && !childFolders.length && <div className={styles.empty}><Folder size={28} aria-hidden="true" /><strong>{needle ? "No matching files or folders" : "No files in this folder yet"}</strong><p>{needle ? "Try another filename or folder name." : "Upload documents to Evidence, then reuse them here."}</p></div>}
    </div>
    <div className={styles.footer}><div className={styles.selectionSummary}><strong aria-live="polite">{chosen.length} {chosen.length === 1 ? "file" : "files"} selected</strong>{chosen.length > 0 && <button type="button" disabled={disabled} onClick={() => { setSelected(new Set()); setSelectionNote(""); }}>Clear selection</button>}</div><div className={styles.footerActions}><button type="button" className={styles.cancel} onClick={onClose}>Cancel</button><button type="button" className={styles.use} disabled={disabled || !chosen.length} onClick={() => onChoose(chosen)}>Use {chosen.length || "selected"} {chosen.length === 1 ? "file" : "files"}<ChevronRight size={16} aria-hidden="true" /></button></div></div>
    {chosen.length > 0 && <p className={styles.selectedNames}>{chosen.map(document => evidenceSourceLabel(document, folders)).join(" · ")}</p>}
    {selectionNote && <p className={styles.resultNote} role="status">{selectionNote}</p>}
    <p className={styles.note}>Choose up to {MAX_IMPORT_FILES} files. Review suggested answers before applying them. Scanned files may need OCR.</p>
  </section>;
}
