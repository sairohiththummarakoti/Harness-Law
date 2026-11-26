"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ChevronRight, Download, FileText, Folder, FolderInput, FolderPlus, Grid2X2, List, Loader2, MoreHorizontal, Pencil, Search, Trash2, Upload, X } from "lucide-react";
import { applyAction, CRITERIA, type Action, type CaseState, type Evidence, type EvidenceFolder } from "@/lib/model";
import { folderPath, folderTrail, MAX_FOLDER_NAME } from "@/lib/evidence-folders";
import styles from "./evidence-drive.module.css";

type Manage = { kind: "create" } | { kind: "rename" | "move-folder" | "remove"; id: string } | { kind: "move-file"; id: string };
export type EvidenceDriveProps = {
  state: CaseState;
  initialFilter?: string;
  disabled: boolean;
  uploading: boolean;
  uploadError: string;
  onUpload: (files: File[], folderId: string | null) => void;
  onRequestUpload: (folderId: string | null) => void;
  onOpen: (document: Evidence) => void;
  onDownload?: (document: Evidence) => void;
  onAction: (action: Action) => void;
};

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
function dateLabel(date: string): string { return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }

export function EvidenceDrive({ state, initialFilter = "all", disabled, uploading, uploadError, onUpload, onRequestUpload, onOpen, onDownload, onAction }: EvidenceDriveProps) {
  const folders = state.folders ?? [];
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(initialFilter);
  const [view, setView] = useState<"list" | "grid">("list");
  const [dragging, setDragging] = useState(false);
  const [manage, setManage] = useState<Manage | null>(null);
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const folderId = currentId && folders.some(item => item.id === currentId) ? currentId : null;
  const locked = disabled || uploading;
  const searching = !!query.trim();
  const search = query.trim().toLowerCase();
  const trail = folderTrail(folders, folderId);
  const visibleFolders = folders.filter(folder => (searching ? folder.name.toLowerCase().includes(search) : folder.parentId === folderId) && filter === "all").sort((a, b) => a.name.localeCompare(b.name));
  const documents = state.documents.filter(document =>
    (searching || filter !== "all" ? document.name.toLowerCase().includes(search) : (document.folderId ?? null) === folderId)
    && (filter === "all" || filter === "needs_attention" && document.status !== "ready" || document.associations.some(association => association.criterion === filter && association.status !== "removed"))
  ).sort((a, b) => a.name.localeCompare(b.name));
  const selectedFolder = manage && "id" in manage && manage.kind !== "move-file" ? folders.find(item => item.id === manage.id) : undefined;
  const selectedDocument = manage?.kind === "move-file" ? state.documents.find(item => item.id === manage.id) : undefined;
  const movableFolders = folders.filter(folder => !selectedFolder || !folderTrail(folders, folder.id).some(ancestor => ancestor.id === selectedFolder.id)).sort((a, b) => folderPath(folders, a.id).localeCompare(folderPath(folders, b.id)));

  useEffect(() => { setCurrentId(null); setQuery(""); setFilter(initialFilter); setManage(null); setDragging(false); }, [state.id, state.mode, initialFilter]);
  useEffect(() => { if (manage && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [manage]);

  function openFolder(id: string | null) { setCurrentId(id); setQuery(""); setFilter("all"); }
  function manageFolder(kind: "rename" | "move-folder" | "remove", folder: EvidenceFolder) {
    setName(folder.name); setDestination(folder.parentId ?? ""); setError(""); setManage({ kind, id: folder.id });
  }
  function moveDocument(document: Evidence) { setDestination(document.folderId ?? ""); setError(""); setManage({ kind: "move-file", id: document.id }); }
  function submit(event: FormEvent) {
    event.preventDefault(); if (!manage || locked) return;
    const action: Action = manage.kind === "create" ? { type: "folder_create", folder: { id: `folder-${crypto.randomUUID()}`, name, parentId: folderId } }
      : manage.kind === "rename" ? { type: "folder_rename", folderId: manage.id, name }
      : manage.kind === "move-folder" ? { type: "folder_move", folderId: manage.id, parentId: destination || null }
      : manage.kind === "move-file" ? { type: "document_move", sourceId: manage.id, folderId: destination || null }
      : { type: "folder_remove", folderId: manage.id };
    try { applyAction(state, action); onAction(action); setManage(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "This change could not be made. Please try again."); }
  }
  function folderMenu(folder: EvidenceFolder) {
    return <details className={styles.menu}><summary aria-label={`Actions for folder ${folder.name}`}><MoreHorizontal size={18} /></summary><div className={styles.menuItems}>
      <button type="button" disabled={locked} onClick={() => manageFolder("rename", folder)}><Pencil size={15} />Rename</button>
      <button type="button" disabled={locked} onClick={() => manageFolder("move-folder", folder)}><FolderInput size={15} />Move folder</button>
      <button type="button" disabled={locked} onClick={() => manageFolder("remove", folder)}><Trash2 size={15} />Remove empty folder</button>
    </div></details>;
  }
  function documentMenu(document: Evidence) {
    return <details className={styles.menu}><summary aria-label={`Actions for file ${document.name}`}><MoreHorizontal size={18} /></summary><div className={styles.menuItems}>
      <button type="button" disabled={locked} onClick={() => moveDocument(document)}><FolderInput size={15} />Move to folder</button>
      {onDownload && !document.sample && <button type="button" disabled={locked} onClick={() => onDownload(document)}><Download size={15} />Download original</button>}
      <button type="button" onClick={() => onOpen(document)}><FileText size={15} />File details</button>
    </div></details>;
  }

  return <div className={styles.drive} onDragOver={event => { event.preventDefault(); if (!locked) setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); if (!locked) onUpload(Array.from(event.dataTransfer.files), folderId); }}>
    <div className="page-heading"><div><span className="eyebrow">YOUR DOCUMENTS, TOGETHER</span><h1>Evidence library</h1><p className="title-subtitle">A place for every document. Organize once, use wherever you need it.</p></div><div className={styles.headerActions}>
      <button type="button" className="button secondary" disabled={locked || folders.length >= 200} onClick={() => { setName(""); setError(""); setManage({ kind: "create" }); }}><FolderPlus size={17} />New folder</button>
      <button type="button" className="button primary" disabled={locked} onClick={() => onRequestUpload(folderId)}>{uploading ? <Loader2 size={17} className={styles.spinner} /> : <Upload size={17} />}{uploading ? "Uploading…" : "Upload files"}</button>
    </div></div>
    {state.mode === "sample" && <p className={styles.sampleNotice}>Fictional sample files. Folder changes are temporary; personal uploads belong in your own workspace.</p>}
    <div className={`${styles.surface} ${dragging ? styles.dragging : ""}`}>
      <div className={styles.toolbar}>
        <label className={styles.search}><Search size={17} aria-hidden="true" /><input type="search" aria-label="Search all evidence files and folders" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search files and folders" /></label>
        <select className={styles.filter} value={filter} aria-label="Filter evidence files" onChange={event => setFilter(event.target.value)}><option value="all">All types</option><option value="needs_attention">Needs attention</option>{CRITERIA.map(criterion => <option key={criterion.id} value={criterion.id}>{criterion.shortTitle}</option>)}</select>
        <div className={styles.viewToggle} role="group" aria-label="File view"><button type="button" aria-label="List view" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={18} /></button><button type="button" aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")}><Grid2X2 size={18} /></button></div>
      </div>
      <div className={styles.locationRow}><nav className={styles.breadcrumbs} aria-label="Evidence folders"><button type="button" onClick={() => openFolder(null)} aria-current={!folderId && !searching ? "location" : undefined}>All files</button>{trail.map(folder => <span key={folder.id}><ChevronRight size={14} aria-hidden="true" /><button type="button" onClick={() => openFolder(folder.id)} aria-current={folder.id === folderId && !searching ? "location" : undefined}>{folder.name}</button></span>)}</nav><span className={styles.count}>{searching || filter !== "all" ? "Results across all folders" : `${visibleFolders.length} ${visibleFolders.length === 1 ? "folder" : "folders"} · ${documents.length} ${documents.length === 1 ? "file" : "files"}`}</span></div>
      {dragging && <p className={styles.dropNotice}>Drop files to upload into {folderId ? trail.at(-1)?.name : "All files"}.</p>}
      {uploadError && <p className={styles.error} role="alert">{uploadError}</p>}
      {!!visibleFolders.length && <section className={styles.folderSection} aria-label="Folders"><div className={styles.folderGrid}>{visibleFolders.map(folder => <div className={styles.folderTile} key={folder.id}><button className={styles.folderOpen} type="button" onClick={() => openFolder(folder.id)}><Folder size={24} aria-hidden="true" /><span><strong>{folder.name}</strong><small>{searching ? folderPath(folders, folder.parentId) : `${folders.filter(item => item.parentId === folder.id).length + state.documents.filter(document => document.folderId === folder.id).length} items`}</small></span></button>{folderMenu(folder)}</div>)}</div></section>}
      {!!documents.length && <section aria-label="Files" className={`${styles.files} ${view === "grid" ? styles.grid : styles.list}`}>
        {view === "list" && <div className={styles.listHeading} aria-hidden="true"><span>Name</span><span>Status</span><span>Added</span><span>Size</span><span /></div>}
        {documents.map(document => <article className={styles.file} key={document.id}>
          <button type="button" className={styles.fileOpen} onClick={() => onOpen(document)}><span className={styles.fileIcon}><FileText size={22} aria-hidden="true" /><small>{document.kind}</small></span><span className={styles.fileName}><strong>{document.name}</strong><small>{searching || filter !== "all" ? folderPath(folders, document.folderId ?? null) : document.exhibit ? `${document.exhibit} · Version ${document.version}` : `Version ${document.version}`}</small></span></button>
          <span className={`${styles.status} ${document.status === "ready" ? styles.ready : ""}`}>{document.sample ? "Fictional sample" : document.status === "ready" ? "Ready" : document.status === "rejected" ? "Rejected" : "Stored · unverified"}</span>
          <span className={styles.date}>{dateLabel(document.uploadedAt)}</span><span className={styles.size}>{sizeLabel(document.bytes)}</span>{documentMenu(document)}
        </article>)}
      </section>}
      {!documents.length && !visibleFolders.length && <div className={styles.empty}><Folder size={36} aria-hidden="true" /><h2>{searching || filter !== "all" ? "No matching files" : folderId ? "This folder is ready for your files" : "Your documents start here"}</h2><p>{searching || filter !== "all" ? "Try another search or filter." : "Upload a document or create a folder to keep your preparation organized."}</p>{searching || filter !== "all" ? <button className="button secondary small" type="button" onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</button> : <button className="button secondary small" type="button" disabled={locked} onClick={() => onRequestUpload(folderId)}><Upload size={16} />Browse your computer</button>}</div>}
      <div className={styles.bottomNote}><span>Drop files here or choose Upload files · Up to 20 MB each</span><span>Moving a file keeps its source links.</span></div>
    </div>
    <p className={styles.help}>PDF, DOCX, TXT, Markdown, CSV, JSON, JPG and PNG. Stored documents still need review; organizing a file does not verify its contents.</p>
    {manage && <dialog ref={dialog} className={styles.dialog} onCancel={() => setManage(null)} aria-labelledby={titleId}><form onSubmit={submit}>
      <div className={styles.dialogHeader}><h2 id={titleId}>{manage.kind === "create" ? "New folder" : manage.kind === "rename" ? "Rename folder" : manage.kind === "remove" ? "Remove empty folder" : "Move to folder"}</h2><button className={styles.close} type="button" aria-label="Close folder dialog" onClick={() => setManage(null)}><X size={20} /></button></div>
      {manage.kind === "create" || manage.kind === "rename" ? <label className={styles.field}>Folder name<input autoFocus value={name} maxLength={MAX_FOLDER_NAME} onChange={event => { setName(event.target.value); setError(""); }} required disabled={locked} /><small>{manage.kind === "create" ? `Create in ${folderPath(folders, folderId)}` : "File names and source links stay the same."}</small></label>
        : manage.kind === "remove" ? <p className={styles.dialogText}>Remove “{selectedFolder?.name ?? "this folder"}”? Only empty folders can be removed. Move any files or subfolders out first.</p>
        : <label className={styles.field}>Destination for {selectedDocument?.name ?? selectedFolder?.name ?? "this item"}<select autoFocus value={destination} onChange={event => { setDestination(event.target.value); setError(""); }} disabled={locked}><option value="">All files</option>{movableFolders.map(folder => <option key={folder.id} value={folder.id}>{folderPath(folders, folder.id)}</option>)}</select><small>Moving changes its location, not its evidence associations.</small></label>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.dialogActions}><button type="button" className="button secondary" onClick={() => setManage(null)}>Cancel</button><button type="submit" className={`button ${manage.kind === "remove" ? "danger" : "primary"}`} disabled={locked}>{manage.kind === "create" ? "Create folder" : manage.kind === "rename" ? "Save name" : manage.kind === "remove" ? "Remove folder" : "Move here"}</button></div>
    </form></dialog>}
  </div>;
}
