"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronRight, FileText, Folder, Search, X } from "lucide-react";
import type { Evidence, EvidenceFolder } from "@/lib/model";
import { importFormat } from "@/lib/form-import-limits";
import styles from "./evidence-picker.module.css";

function unavailableReason(document: Evidence): string {
  if (document.sample) return document.excerpt.trim() ? "" : "No sample text available";
  if (!document.objectId) return "Original file unavailable";
  if (document.status === "rejected") return "This file cannot be used";
  if (/\.(jpe?g|png)$/i.test(document.name)) return "Images need OCR before form filling";
  try { importFormat(document.name, document.bytes); return ""; }
  catch (error) { return error instanceof Error ? error.message : "Unsupported document"; }
}

function location(folderId: string | null | undefined, folders: EvidenceFolder[]) {
  const path: EvidenceFolder[] = [];
  const visited = new Set<string>();
  let next = folderId;
  while (next && !visited.has(next)) {
    visited.add(next);
    const folder = folders.find(item => item.id === next);
    if (!folder) break;
    path.unshift(folder); next = folder.parentId;
  }
  return path;
}

export function EvidencePicker({ documents, folders, disabled = false, onChoose, onClose }: {
  documents: Evidence[];
  folders: EvidenceFolder[];
  disabled?: boolean;
  onChoose: (document: Evidence) => void;
  onClose: () => void;
}) {
  const id = useId();
  const search = useRef<HTMLInputElement>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => { search.current?.focus({ preventScroll: true }); }, []);
  const currentFolder = folders.some(folder => folder.id === folderId) ? folderId : null;
  const needle = query.trim().toLocaleLowerCase();
  const path = location(currentFolder, folders);
  const childFolders = folders.filter(folder => needle ? folder.name.toLocaleLowerCase().includes(needle) : folder.parentId === currentFolder);
  const files = documents.filter(document => needle ? document.name.toLocaleLowerCase().includes(needle) : (document.folderId ?? null) === currentFolder);
  function openFolder(id: string | null) { setFolderId(id); setQuery(""); }
  return <section className={styles.picker} aria-labelledby={`${id}-title`} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <div className={styles.heading}><div><h4 id={`${id}-title`}>Browse Evidence</h4><p>Reuse a saved file without uploading it again.</p></div><button type="button" className={styles.close} onClick={onClose} aria-label="Close Evidence browser"><X size={18} /></button></div>
    <label className={styles.search}><Search size={17} aria-hidden="true" /><span className={styles.srOnly}>Search saved evidence files and folders</span><input ref={search} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search files and folders" /></label>
    <nav className={styles.breadcrumbs} aria-label="Evidence folder location"><button type="button" onClick={() => openFolder(null)} aria-current={!currentFolder ? "location" : undefined}>All files</button>{path.map(folder => <span key={folder.id}><ChevronRight size={13} aria-hidden="true" /><button type="button" onClick={() => openFolder(folder.id)} aria-current={folder.id === currentFolder ? "location" : undefined}>{folder.name}</button></span>)}</nav>
    {needle && <p className={styles.resultNote}>Search results across your Evidence library</p>}
    <div className={styles.list}>
      {childFolders.map(folder => <button className={styles.folder} type="button" key={folder.id} onClick={() => openFolder(folder.id)}><Folder size={22} aria-hidden="true" /><span><strong>{folder.name}</strong>{needle && <small>{location(folder.parentId, folders).map(item => item.name).join(" / ") || "All files"}</small>}</span><ChevronRight size={17} aria-hidden="true" /></button>)}
      {files.map(document => {
        const reason = unavailableReason(document);
        return <div className={styles.file} key={document.id}><FileText size={21} aria-hidden="true" /><div className={styles.fileName}><strong>{document.name}</strong><small>{document.sample ? "Fictional sample text" : `${document.kind} · ${document.bytes < 1024 * 1024 ? `${Math.max(1, Math.ceil(document.bytes / 1024))} KB` : `${(document.bytes / (1024 * 1024)).toFixed(1)} MB`}`}{needle ? ` · ${location(document.folderId, folders).map(item => item.name).join(" / ") || "All files"}` : ""}</small>{reason && <p id={`${id}-${document.id}-reason`}>{reason}</p>}</div><button type="button" className={styles.use} disabled={disabled || !!reason} aria-label={`Use ${document.name}`} aria-describedby={reason ? `${id}-${document.id}-reason` : undefined} onClick={() => onChoose(document)}>Use file<ChevronRight size={15} aria-hidden="true" /></button></div>;
      })}
      {!files.length && !childFolders.length && <div className={styles.empty}><Folder size={26} aria-hidden="true" /><strong>{needle ? "No matching files or folders" : "No files in this folder yet"}</strong><p>{needle ? "Try another filename or folder name." : "Upload a document to save it in Evidence, then reuse it here."}</p></div>}
    </div>
    <p className={styles.note}>Text is read in your browser. Review proposed answers before applying them. Scanned files may need OCR.</p>
  </section>;
}
