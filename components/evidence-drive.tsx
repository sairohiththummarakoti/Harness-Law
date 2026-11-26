"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Download, FileText, Folder, FolderInput, FolderPlus, Grid2X2, List, Loader2, MoreHorizontal, Pencil, Search, Trash2, Upload, X } from "lucide-react";
import { applyAction, CRITERIA, type Action, type CaseState, type Evidence, type EvidenceFolder } from "@/lib/model";
import { folderPath, folderTrail, MAX_FOLDER_NAME } from "@/lib/evidence-folders";
import styles from "./evidence-drive.module.css";

type Manage = { kind: "create" } | { kind: "rename" | "move-folder" | "delete-folder" | "move-file" | "delete-file"; id: string };
export type EvidenceDriveProps = {
  state: CaseState;
  initialFilter?: string;
  disabled: boolean;
  uploading: boolean;
  uploadError: string;
  onUpload: (files: File[], folderId: string | null) => void;
  onRequestUpload: (folderId: string | null, kind?: "files" | "folder") => void;
  onDelete: (target: { kind: "file" | "folder"; id: string }) => Promise<void>;
  onOpen: (document: Evidence) => void;
  onDownload?: (document: Evidence) => void;
  onAction: (action: Action) => void;
};

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
function dateLabel(date: string): string { return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }

type MenuItem = { label: string; icon: ReactNode; onSelect: () => void; disabled?: boolean; danger?: boolean };

function ActionMenu({ label, open, onToggle, onClose, items, children, disabled = false, primary = false }: {
  label: string; open: boolean; onToggle: () => void; onClose: () => void; items: MenuItem[];
  children?: ReactNode; disabled?: boolean; primary?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close.current();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault(); close.current(); trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", keyboard);
    };
  }, [open]);

  return <div ref={root} className={styles.menu} data-open={open || undefined}>
    <button ref={trigger} type="button" className={primary ? "button primary" : styles.menuTrigger} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={onToggle} onKeyDown={event => {
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !open) { event.preventDefault(); onToggle(); }
    }}>{children || <MoreHorizontal size={18} aria-hidden="true" />}</button>
    {open && <div ref={panel} id={id} role="menu" aria-label={label} className={`${styles.menuItems} ${primary ? styles.uploadItems : ""}`} onKeyDown={event => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>{items.map(item => <button key={item.label} role="menuitem" type="button" tabIndex={-1} disabled={item.disabled} className={item.danger ? styles.destructive : undefined} onClick={() => { onClose(); trigger.current?.focus(); item.onSelect(); }}>{item.icon}{item.label}</button>)}</div>}
  </div>;
}

export function EvidenceDrive({ state, initialFilter = "all", disabled, uploading, uploadError, onUpload, onRequestUpload, onDelete, onOpen, onDownload, onAction }: EvidenceDriveProps) {
  const folders = state.folders ?? [];
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(initialFilter);
  const [view, setView] = useState<"list" | "grid">("list");
  const [dragging, setDragging] = useState(false);
  const [dropError, setDropError] = useState("");
  const [manage, setManage] = useState<Manage | null>(null);
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [error, setError] = useState("");
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const context = `${state.mode}:${state.id}`;
  const latestContext = useRef(context); latestContext.current = context;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const folderId = currentId && folders.some(item => item.id === currentId) ? currentId : null;
  const locked = disabled || uploading || deleting;
  const searching = !!query.trim();
  const search = query.trim().toLowerCase();
  const trail = folderTrail(folders, folderId);
  const visibleFolders = folders.filter(folder => (searching ? folder.name.toLowerCase().includes(search) : folder.parentId === folderId) && filter === "all").sort((a, b) => a.name.localeCompare(b.name));
  const documents = state.documents.filter(document =>
    (searching || filter !== "all" ? document.name.toLowerCase().includes(search) : (document.folderId ?? null) === folderId)
    && (filter === "all" || filter === "needs_attention" && document.status !== "ready" || document.associations.some(association => association.criterion === filter && association.status !== "removed"))
  ).sort((a, b) => a.name.localeCompare(b.name));
  const selectedFolder = manage && "id" in manage && manage.kind !== "move-file" && manage.kind !== "delete-file" ? folders.find(item => item.id === manage.id) : undefined;
  const selectedDocument = manage?.kind === "move-file" || manage?.kind === "delete-file" ? state.documents.find(item => item.id === manage.id) : undefined;
  const movableFolders = folders.filter(folder => !selectedFolder || !folderTrail(folders, folder.id).some(ancestor => ancestor.id === selectedFolder.id)).sort((a, b) => folderPath(folders, a.id).localeCompare(folderPath(folders, b.id)));
  const deletingFolderIds = new Set(selectedFolder ? folders.filter(folder => folderTrail(folders, folder.id).some(ancestor => ancestor.id === selectedFolder.id)).map(folder => folder.id) : []);
  const deletingFileCount = state.documents.filter(document => document.folderId && deletingFolderIds.has(document.folderId)).length;
  const isDelete = manage?.kind === "delete-file" || manage?.kind === "delete-folder";

  useEffect(() => { setCurrentId(null); setQuery(""); setFilter(initialFilter); setManage(null); setDragging(false); setDropError(""); setOpenMenu(null); setDeleting(false); }, [state.id, state.mode, initialFilter]);
  useEffect(() => { setOpenMenu(null); }, [query, filter, view]);
  useEffect(() => { if (manage && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [manage]);

  function openFolder(id: string | null) { setOpenMenu(null); setCurrentId(id); setQuery(""); setFilter("all"); }
  function manageFolder(kind: "rename" | "move-folder" | "delete-folder", folder: EvidenceFolder) {
    setName(folder.name); setDestination(folder.parentId ?? ""); setError(""); setManage({ kind, id: folder.id });
  }
  function moveDocument(document: Evidence) { setDestination(document.folderId ?? ""); setError(""); setManage({ kind: "move-file", id: document.id }); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!manage || locked) return;
    if (manage.kind === "delete-folder" || manage.kind === "delete-file") {
      if (!selectedFolder && !selectedDocument) { setError("This item no longer exists. Close this dialog and refresh the library."); return; }
      const requestContext = context;
      setDeleting(true); setError("");
      try {
        await onDelete({ kind: manage.kind === "delete-folder" ? "folder" : "file", id: manage.id });
        if (latestContext.current === requestContext) setManage(null);
      } catch (cause) {
        if (latestContext.current === requestContext) setError(cause instanceof Error ? cause.message : "Deletion could not be completed. Please try again.");
      } finally {
        if (latestContext.current === requestContext) setDeleting(false);
      }
      return;
    }
    const action: Action = manage.kind === "create" ? { type: "folder_create", folder: { id: `folder-${crypto.randomUUID()}`, name, parentId: folderId } }
      : manage.kind === "rename" ? { type: "folder_rename", folderId: manage.id, name }
      : manage.kind === "move-folder" ? { type: "folder_move", folderId: manage.id, parentId: destination || null }
      : { type: "document_move", sourceId: manage.id, folderId: destination || null };
    try { applyAction(state, action); onAction(action); setManage(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "This change could not be made. Please try again."); }
  }
  function folderMenu(folder: EvidenceFolder) {
    const key = `folder:${folder.id}`;
    return <ActionMenu label={`Actions for folder ${folder.name}`} open={openMenu === key} onToggle={() => setOpenMenu(openMenu === key ? null : key)} onClose={() => setOpenMenu(null)} items={[
      { label: "Rename", icon: <Pencil size={15} />, disabled: locked, onSelect: () => manageFolder("rename", folder) },
      { label: "Move folder", icon: <FolderInput size={15} />, disabled: locked, onSelect: () => manageFolder("move-folder", folder) },
      { label: "Delete folder", icon: <Trash2 size={15} />, disabled: locked, danger: true, onSelect: () => manageFolder("delete-folder", folder) },
    ]} />;
  }
  function documentMenu(document: Evidence) {
    const key = `file:${document.id}`;
    return <ActionMenu label={`Actions for file ${document.name}`} open={openMenu === key} onToggle={() => setOpenMenu(openMenu === key ? null : key)} onClose={() => setOpenMenu(null)} items={[
      { label: "Move to folder", icon: <FolderInput size={15} />, disabled: locked, onSelect: () => moveDocument(document) },
      ...(onDownload && !document.sample ? [{ label: "Download original", icon: <Download size={15} />, disabled: locked, onSelect: () => onDownload(document) }] : []),
      { label: "File details", icon: <FileText size={15} />, onSelect: () => onOpen(document) },
      { label: "Delete file", icon: <Trash2 size={15} />, disabled: locked, danger: true, onSelect: () => { setError(""); setManage({ kind: "delete-file", id: document.id }); } },
    ]} />;
  }

  return <div className={styles.drive} onDragOver={event => { event.preventDefault(); if (!locked) setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={event => {
    event.preventDefault(); setDragging(false); if (locked) return;
    if (Array.from(event.dataTransfer.items).some(item => item.kind === "file" && item.webkitGetAsEntry?.()?.isDirectory)) {
      setDropError("To add a folder and keep its structure, choose Upload, then Upload folder."); return;
    }
    setDropError(""); onUpload(Array.from(event.dataTransfer.files), folderId);
  }}>
    <div className="page-heading"><div><span className="eyebrow">YOUR DOCUMENTS, TOGETHER</span><h1>Evidence library</h1><p className="title-subtitle">A place for every document. Organize once, use wherever you need it.</p></div><div className={styles.headerActions}>
      <button type="button" className="button secondary" disabled={locked || folders.length >= 200} onClick={() => { setOpenMenu(null); setName(""); setError(""); setManage({ kind: "create" }); }}><FolderPlus size={17} />New folder</button>
      <ActionMenu label="Upload to Evidence" primary disabled={locked} open={openMenu === "upload"} onToggle={() => setOpenMenu(openMenu === "upload" ? null : "upload")} onClose={() => setOpenMenu(null)} items={[
        { label: "Upload files", icon: <FileText size={17} />, onSelect: () => { setDropError(""); onRequestUpload(folderId, "files"); } },
        { label: "Upload folder", icon: <Folder size={17} />, onSelect: () => { setDropError(""); onRequestUpload(folderId, "folder"); } },
      ]}>{uploading ? <Loader2 size={17} className={styles.spinner} aria-hidden="true" /> : <Upload size={17} aria-hidden="true" />}{uploading ? "Uploading…" : "Upload"}<ChevronDown size={15} aria-hidden="true" /></ActionMenu>
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
      {(dropError || uploadError) && <p className={styles.error} role="alert">{dropError || uploadError}</p>}
      {!!visibleFolders.length && <section className={styles.folderSection} aria-label="Folders"><div className={styles.folderGrid}>{visibleFolders.map(folder => <div className={styles.folderTile} key={folder.id}><button className={styles.folderOpen} type="button" onClick={() => openFolder(folder.id)}><Folder size={24} aria-hidden="true" /><span><strong>{folder.name}</strong><small>{searching ? folderPath(folders, folder.parentId) : `${folders.filter(item => item.parentId === folder.id).length + state.documents.filter(document => document.folderId === folder.id).length} items`}</small></span></button>{folderMenu(folder)}</div>)}</div></section>}
      {!!documents.length && <section aria-label="Files" className={`${styles.files} ${view === "grid" ? styles.grid : styles.list}`}>
        {view === "list" && <div className={styles.listHeading} aria-hidden="true"><span>Name</span><span>Status</span><span>Added</span><span>Size</span><span /></div>}
        {documents.map(document => <article className={styles.file} key={document.id}>
          <button type="button" className={styles.fileOpen} onClick={() => onOpen(document)}><span className={styles.fileIcon}><FileText size={22} aria-hidden="true" /><small>{document.kind}</small></span><span className={styles.fileName}><strong>{document.name}</strong><small>{searching || filter !== "all" ? folderPath(folders, document.folderId ?? null) : document.exhibit ? `${document.exhibit} · Version ${document.version}` : `Version ${document.version}`}</small></span></button>
          <span className={`${styles.status} ${document.status === "ready" ? styles.ready : ""}`}>{document.sample ? "Fictional sample" : document.status === "ready" ? "Ready" : document.status === "rejected" ? "Rejected" : "Stored · unverified"}</span>
          <span className={styles.date}>{dateLabel(document.uploadedAt)}</span><span className={styles.size}>{sizeLabel(document.bytes)}</span>{documentMenu(document)}
        </article>)}
      </section>}
      {!documents.length && !visibleFolders.length && <div className={styles.empty}><Folder size={36} aria-hidden="true" /><h2>{searching || filter !== "all" ? "No matching files" : folderId ? "This folder is ready for your files" : "Your documents start here"}</h2><p>{searching || filter !== "all" ? "Try another search or filter." : "Choose Upload above to add files or an entire folder, or drop files here."}</p>{(searching || filter !== "all") && <button className="button secondary small" type="button" onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</button>}</div>}
      <div className={styles.bottomNote}><span>Drop files here · Upload a folder to keep its structure · Up to 20 MB per file</span><span>Moving a file keeps its source links.</span></div>
    </div>
    <p className={styles.help}>PDF, DOCX, TXT, Markdown, CSV, JSON, JPG and PNG. Folder uploads keep subfolders containing supported files; browsers do not include empty folders. Stored documents still need review; organizing a file does not verify its contents.</p>
    {manage && <dialog ref={dialog} className={styles.dialog} onCancel={event => { if (deleting) event.preventDefault(); else setManage(null); }} aria-labelledby={titleId}><form onSubmit={event => void submit(event)}>
      <div className={styles.dialogHeader}><h2 id={titleId}>{manage.kind === "create" ? "New folder" : manage.kind === "rename" ? "Rename folder" : manage.kind === "delete-folder" ? "Delete folder?" : manage.kind === "delete-file" ? "Delete file?" : "Move to folder"}</h2><button className={styles.close} type="button" aria-label="Close library dialog" disabled={deleting} onClick={() => setManage(null)}><X size={20} /></button></div>
      {manage.kind === "create" || manage.kind === "rename" ? <label className={styles.field}>Folder name<input autoFocus value={name} maxLength={MAX_FOLDER_NAME} onChange={event => { setName(event.target.value); setError(""); }} required disabled={locked} /><small>{manage.kind === "create" ? `Create in ${folderPath(folders, folderId)}` : "File names and source links stay the same."}</small></label>
        : isDelete ? <div className={styles.deleteSummary}>
          <span className={styles.deleteIcon}><Trash2 size={23} aria-hidden="true" /></span>
          <p className={styles.dialogText}><strong>{selectedDocument?.name ?? selectedFolder?.name ?? "This item"}</strong>{manage.kind === "delete-folder" ? <> and everything inside will be deleted: <strong>{deletingFileCount} {deletingFileCount === 1 ? "file" : "files"}</strong> and <strong>{Math.max(0, deletingFolderIds.size - 1)} {deletingFolderIds.size === 2 ? "subfolder" : "subfolders"}</strong>.</> : " will be deleted from your Evidence library."}</p>
          <p className={styles.dialogText}>{state.mode === "sample" ? "This affects the fictional sample only. Personal files are unchanged." : "This also deletes the stored original files and cannot be undone."} Any sections that rely on these files will need review.</p>
        </div>
        : <label className={styles.field}>Destination for {selectedDocument?.name ?? selectedFolder?.name ?? "this item"}<select autoFocus value={destination} onChange={event => { setDestination(event.target.value); setError(""); }} disabled={locked}><option value="">All files</option>{movableFolders.map(folder => <option key={folder.id} value={folder.id}>{folderPath(folders, folder.id)}</option>)}</select><small>Moving changes its location, not its evidence associations.</small></label>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.dialogActions}><button type="button" className="button secondary" autoFocus={isDelete} disabled={deleting} onClick={() => setManage(null)}>Cancel</button><button type="submit" className={`button ${isDelete ? "danger" : "primary"}`} disabled={locked}>{deleting ? <><Loader2 size={16} className={styles.spinner} aria-hidden="true" />Deleting…</> : manage.kind === "create" ? "Create folder" : manage.kind === "rename" ? "Save name" : manage.kind === "delete-folder" ? "Delete folder" : manage.kind === "delete-file" ? "Delete file" : "Move here"}</button></div>
      {deleting && <p className={styles.pending} role="status">Deleting from your library and private storage…</p>}
    </form></dialog>}
  </div>;
}
