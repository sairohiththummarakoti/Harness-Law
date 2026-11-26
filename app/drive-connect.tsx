"use client";

import { useCallback, useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { ArrowLeft, Check, ChevronRight, Cloud, FileText, Folder, FolderOpen, HardDrive, Loader2, LockKeyhole, PencilLine, Plus, RefreshCw, Unplug, Upload, X } from "lucide-react";
import type { CaseState } from "@/lib/model";
import { folderNameError } from "@/lib/evidence-folders";
import { driveCallback, DriveRequestError, requestDrive } from "@/lib/drive-client";
import styles from "./drive-connect.module.css";

type Provider = "google_drive" | "onedrive";
type Scope = "folder" | "whole_drive";
type Connection = { id: string; provider: Provider; displayName: string; scope: Scope; rootId: string; rootName: string; accountLabel: string; status: "pending" | "connected" | "reconnect_required"; caseId: string | null; evidenceFolderId: string | null };
export type ConnectedEvidenceLocation = { id: string; caseId: string; evidenceFolderId: string };
type CloudItem = { id: string; name: string; isFolder: boolean; size: number; mimeType: string };
type BrowseResult = { folderId: string; items: CloudItem[]; nextCursor: string | null; root: { id: string; name: string } };
type Config = { providers: { id: Provider; ready: boolean; reason: string | null; notice?: string | null }[] };
type CaseResult = { state: CaseState; revision: number; drives?: Connection[] };
type Trail = { id: string; name: string }[];
type Modal = { kind: "device"; source: "computer" | "icloud" } | { kind: "cloud"; connection: Connection } | null;

export interface DriveConnectProps {
  userId: string;
  returnTo: string;
  disabled?: boolean;
  openConnectionId?: string | null;
  onCloseConnection: () => void;
  onNotify: (message: string) => void;
  onCaseMutation: (operation: (base: CaseState) => Promise<CaseResult>) => Promise<void>;
  onDeviceUpload: (name: string, files: File[], directory: boolean) => Promise<void>;
  beforeConnect: () => Promise<void>;
  onConnectedLocationsChange?: (locations: ConnectedEvidenceLocation[]) => void;
}

function ProviderIcon({ provider }: { provider: Provider | "icloud" | "computer" }) {
  if (provider === "computer") return <HardDrive size={25} />;
  if (provider === "icloud") return <Cloud size={28} className={styles.icloudIcon} />;
  if (provider === "onedrive") return <svg width="29" height="26" viewBox="0 0 24 24" aria-hidden="true"><path fill="#0364b8" d="M10.1 6.5A5.6 5.6 0 0 0 4.6 11a4.2 4.2 0 0 0-3.6 4.1A4.3 4.3 0 0 0 5.3 19.5h12.9a3.8 3.8 0 0 0 .8-7.5 4.8 4.8 0 0 0-4.7-4 5.5 5.5 0 0 0-4.2-1.5Z"/><path fill="#28a8ea" d="M19.4 19.5a3.8 3.8 0 0 0 .4-7.5l-5.5-4-4.5 5.4 9.6 6.1Z"/></svg>;
  return <svg width="25" height="25" viewBox="0 0 87.3 78" aria-hidden="true"><path fill="#00ac47" d="m43.65 0-16.15 0L0 53h27.5L57.4 1.2Z"/><path fill="#ffba00" d="M43.65 25 59.8 53h27.5L57.4 1.2 43.65 0 29.9 1.2Z"/><path fill="#2684fc" d="M0 53h87.3L73.55 76.8 69.05 78h-50.8l-4.5-1.2Z"/></svg>;
}
const providerName = (provider: Provider) => provider === "google_drive" ? "Google Drive" : "OneDrive";
const bytes = (size: number) => !size ? "—" : size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
const messageOf = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Please try again.";
const directoryAttributes = { webkitdirectory: "", directory: "" } as InputHTMLAttributes<HTMLInputElement>;

export default function DriveConnect({ userId, returnTo, disabled = false, openConnectionId, onCloseConnection, onNotify, onCaseMutation, onDeviceUpload, beforeConnect, onConnectedLocationsChange }: DriveConnectProps) {
  const [config, setConfig] = useState<Config | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  useEffect(() => {
    onConnectedLocationsChange?.(connections.flatMap(connection => connection.status === "connected" && connection.caseId && connection.evidenceFolderId ? [{ id: connection.id, caseId: connection.caseId, evidenceFolderId: connection.evidenceFolderId }] : []));
  }, [connections, onConnectedLocationsChange]);
  const [loaded, setLoaded] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Scope>("folder");
  const [trail, setTrail] = useState<Trail>([]);
  const [items, setItems] = useState<CloudItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selection, setSelection] = useState<Map<string, CloudItem>>(new Map());
  const [files, setFiles] = useState<File[]>([]);
  const [directory, setDirectory] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [progress, setProgress] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const openedConnection = useRef<string | null>(null);
  const callbackHandled = useRef(false);
  const browseSequence = useRef(0);
  const uploadIds = useRef(new Map<string, string>());
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const closeCallback = useRef(onCloseConnection);
  useEffect(() => { closeCallback.current = onCloseConnection; }, [onCloseConnection]);
  const locked = disabled || busy;

  const request = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    return requestDrive<T>(path, userId, init);
  }, [userId]);

  const connectionError = useCallback((cause: unknown, connectionId: string) => {
    setError(messageOf(cause));
    if (cause instanceof DriveRequestError && cause.needsReauth) {
      setConnections(previous => previous.map(value => value.id === connectionId ? { ...value, status: "reconnect_required" } : value));
      setModal(previous => previous?.kind === "cloud" && previous.connection.id === connectionId ? { ...previous, connection: { ...previous.connection, status: "reconnect_required" } } : previous);
    }
    if (cause instanceof DriveRequestError && cause.code === "connection_not_found") {
      setConnections(previous => previous.filter(value => value.id !== connectionId));
      setModal(null); closeCallback.current();
    }
  }, []);

  const refresh = useCallback(async () => {
    const results = await Promise.allSettled([request<Config>("/api/drives/config"), request<{ drives: Connection[] }>("/api/drives")]);
    if (results[0].status === "fulfilled") setConfig(results[0].value);
    if (results[1].status === "fulfilled") setConnections(results[1].value.drives);
    setLoaded(true);
    const failed = results.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }, [request]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => { if (active) return refresh(); }).catch(cause => { if (active) setError(messageOf(cause)); });
    return () => { active = false; };
  }, [refresh]);
  useEffect(() => {
    if (modal && dialog.current && !dialog.current.open) dialog.current.showModal();
    if (!modal) dialog.current?.close();
  }, [modal]);

  const browse = useCallback(async (connection: Connection, path: Trail, nextCursor?: string) => {
    const sequence = ++browseSequence.current;
    setLoading(true); setError("");
    if (!nextCursor) { setTrail(path); setItems([]); setCursor(null); }
    try {
      const query = new URLSearchParams({ connectionId: connection.id });
      if (path.length) query.set("folderId", path[path.length - 1].id);
      if (nextCursor) query.set("cursor", nextCursor);
      const data = await request<BrowseResult>(`/api/drives/browse?${query}`);
      if (sequence !== browseSequence.current) return;
      if (!path.length) setTrail([{ id: data.root.id, name: data.root.name || providerName(connection.provider) }]);
      setItems(previous => nextCursor ? [...previous, ...data.items.filter(item => !previous.some(old => old.id === item.id))] : data.items);
      setCursor(data.nextCursor);
    } catch (cause) { if (sequence === browseSequence.current) connectionError(cause, connection.id); }
    finally { if (sequence === browseSequence.current) setLoading(false); }
  }, [request, connectionError]);

  const openCloud = useCallback(async (connection: Connection) => {
    const sequence = ++browseSequence.current;
    setError(""); setName(connection.displayName || ""); setScope(connection.scope === "whole_drive" && connection.status !== "pending" ? "whole_drive" : "folder");
    setSelection(new Map()); setRenaming(false); setConfirmDisconnect(false); setProgress("");
    setModal({ kind: "cloud", connection }); setLoading(true); setItems([]); setTrail([]); setCursor(null);
    try {
      const result = await request<{ drives: Connection[] }>("/api/drives");
      if (sequence !== browseSequence.current) return;
      setConnections(result.drives);
      const latest = result.drives.find(value => value.id === connection.id);
      if (!latest) throw new DriveRequestError("This connection was removed. Imported evidence remains in your library.", 404, "connection_not_found");
      setName(latest.displayName || ""); setModal({ kind: "cloud", connection: latest });
      if (latest.status === "reconnect_required") setLoading(false);
      else await browse(latest, []);
    } catch (cause) { if (sequence === browseSequence.current) { connectionError(cause, connection.id); setLoading(false); } }
  }, [browse, request, connectionError]);

  useEffect(() => {
    if (!openConnectionId) { openedConnection.current = null; return; }
    if (!loaded || openedConnection.current === openConnectionId) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const connection = connections.find(value => value.id === openConnectionId);
      if (connection) { openedConnection.current = openConnectionId; void openCloud(connection); }
      else { setError("This connection is no longer available. Connect the drive again to continue."); closeCallback.current(); }
    });
    return () => { active = false; };
  }, [openConnectionId, connections, loaded, openCloud]);

  useEffect(() => {
    if (!loaded || callbackHandled.current) return;
    let active = true;
    queueMicrotask(() => {
      if (!active || callbackHandled.current) return;
      callbackHandled.current = true;
      const callback = driveCallback(new URL(window.location.href));
      if (!callback.present) return;
      window.history.replaceState(window.history.state, "", callback.cleanUrl);
      if (callback.error) { setError(callback.error); return; }
      const connection = connections.find(value => value.id === callback.connectionId);
      if (connection) void openCloud(connection);
      else setError("The connection could not be loaded. Try again or connect the drive again.");
    });
    return () => { active = false; };
  }, [loaded, connections, openCloud]);

  function close() {
    if (busy) return;
    browseSequence.current++; setLoading(false); setModal(null); setError(""); setProgress("");
    closeCallback.current();
  }
  function openDevice(source: "computer" | "icloud") {
    setError(""); setName(""); setFiles([]); setDirectory(false); setProgress(""); setModal({ kind: "device", source });
  }
  function selectFiles(list: FileList | null, folder: boolean) {
    if (!list?.length) return;
    const chosen = Array.from(list);
    setFiles(chosen); setDirectory(folder); setError("");
    if (!name.trim() && folder) setName(chosen[0].webkitRelativePath.split("/")[0]);
  }
  async function connect(provider: Provider) {
    setBusy(true); setError("");
    try {
      await beforeConnect();
      const result = await request<{ authorizationUrl: string }>("/api/drives/connect", { method: "POST", body: JSON.stringify({ provider, returnTo }) });
      window.location.assign(result.authorizationUrl);
    } catch (cause) { setError(messageOf(cause)); setBusy(false); }
  }
  async function uploadDevice() {
    const invalid = folderNameError(name.trim());
    if (invalid || !files.length) { setError(invalid || "Choose at least one file to upload."); return; }
    setBusy(true); setError(""); setProgress(`Adding ${files.length} ${files.length === 1 ? "file" : "files"}…`);
    try { await onDeviceUpload(name.trim(), files, directory); setModal(null); onNotify(`Added ${files.length} ${files.length === 1 ? "file" : "files"} to ${name.trim()}.`); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); setProgress(""); }
  }
  async function saveConnection(rename: boolean) {
    if (modal?.kind !== "cloud") return;
    const invalid = folderNameError(name.trim());
    if (invalid) { setError(invalid); return; }
    const connection = modal.connection;
    setBusy(true); setError("");
    try {
      let saved: Connection[] | undefined;
      await onCaseMutation(async base => {
        const body = rename ? { id: connection.id, displayName: name.trim(), caseId: base.id, expectedRevision: base.revision }
          : { connectionId: connection.id, displayName: name.trim(), scope, rootId: trail[trail.length - 1]?.id, caseId: base.id, expectedRevision: base.revision };
        const result = await request<CaseResult>("/api/drives", { method: rename ? "PATCH" : "POST", body: JSON.stringify(body) });
        saved = result.drives; return result;
      });
      if (saved) setConnections(saved);
      const updated = saved?.find(value => value.id === connection.id);
      setRenaming(false);
      if (updated) { setModal({ kind: "cloud", connection: updated }); if (!rename) await browse(updated, []); }
      else { setModal(null); closeCallback.current(); }
      onNotify(rename ? "Connection renamed." : `${name.trim()} is connected. Choose files to copy into Evidence.`);
    } catch (cause) { connectionError(cause, connection.id); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    if (modal?.kind !== "cloud") return;
    setBusy(true); setError("");
    try {
      const result = await request<{ drives: Connection[] }>(`/api/drives?id=${encodeURIComponent(modal.connection.id)}`, { method: "DELETE" });
      setConnections(result.drives); setModal(null); closeCallback.current();
      onNotify("Drive disconnected. Your imported evidence is still available.");
    } catch (cause) { connectionError(cause, modal.connection.id); }
    finally { setBusy(false); }
  }
  function toggle(item: CloudItem) {
    setSelection(previous => { const next = new Map(previous); if (next.has(item.id)) next.delete(item.id); else next.set(item.id, item); return next; });
  }
  async function importSelected() {
    if (modal?.kind !== "cloud" || !selection.size) return;
    const connection = modal.connection;
    const chosen = Array.from(selection.values());
    let completed = 0;
    setBusy(true); setError("");
    try {
      for (const file of chosen) {
        setProgress(`Importing ${completed + 1} of ${chosen.length}: ${file.name}`);
        const key = `${connection.id}:${file.id}`;
        const uploadId = uploadIds.current.get(key) || crypto.randomUUID();
        uploadIds.current.set(key, uploadId);
        await onCaseMutation(base => request<CaseResult>("/api/drives/import", { method: "POST", body: JSON.stringify({ connectionId: connection.id, fileId: file.id, caseId: base.id, expectedRevision: base.revision, uploadId }) }));
        uploadIds.current.delete(key);
        completed++;
        setSelection(previous => { const next = new Map(previous); next.delete(file.id); return next; });
      }
      onNotify(`Imported ${completed} ${completed === 1 ? "file" : "files"} into ${connection.displayName}.`);
    } catch (cause) { connectionError(cause, connection.id); setError(`${completed ? `${completed} imported. ` : ""}${messageOf(cause)} Remaining files are still selected.`); }
    finally { setBusy(false); setProgress(""); }
  }

  const cloud = modal?.kind === "cloud" ? modal.connection : null;
  const pending = cloud?.status === "pending";
  const visibleFiles = items.filter(item => !item.isFolder);
  const allVisibleSelected = visibleFiles.length > 0 && visibleFiles.every(item => selection.has(item.id));
  const currentFolder = trail[trail.length - 1];

  return <section className={styles.section} aria-label="Add an evidence location">
    <div className={styles.heading}><div><h3>Bring your evidence together</h3><p>Connect a cloud location or upload a folder from your device.</p></div><span className={styles.access}><LockKeyhole size={13} /> Cloud access is read-only</span></div>
    <div className={styles.sources}>
      {(["google_drive", "onedrive"] as const).map(provider => {
        const capability = config?.providers.find(value => value.id === provider);
        return <button key={provider} className={styles.source} type="button" disabled={locked || !capability?.ready} onClick={() => void connect(provider)} title={capability?.reason || undefined}><ProviderIcon provider={provider} /><strong>{providerName(provider)}</strong><span>{!loaded ? "Checking availability…" : capability?.ready ? capability.notice || "Connect a location" : capability?.reason || "Temporarily unavailable"}</span>{capability?.ready && <Plus size={15} className={styles.sourcePlus} />}</button>;
      })}
      <button type="button" className={styles.source} disabled={locked} onClick={() => openDevice("icloud")}><ProviderIcon provider="icloud" /><strong>iCloud Drive</strong><span>Import through your device</span><Plus size={15} className={styles.sourcePlus} /></button>
      <button type="button" className={styles.source} disabled={locked} onClick={() => openDevice("computer")}><ProviderIcon provider="computer" /><strong>Your computer</strong><span>Upload files or a folder</span><Plus size={15} className={styles.sourcePlus} /></button>
    </div>
    {connections.length > 0 && <div className={styles.locations}><span>Connected locations</span><div>{connections.map(connection => <button type="button" key={connection.id} disabled={locked} onClick={() => openCloud(connection)}><Cloud size={14} /><span>{connection.displayName || providerName(connection.provider)}</span>{connection.status === "pending" ? <small>Finish setup</small> : connection.status === "reconnect_required" ? <small>Reconnect</small> : <ChevronRight size={13} />}</button>)}</div></div>}
    {error && !modal && <div className={styles.error} role="alert">{error}<button type="button" disabled={locked} onClick={() => { setError(""); void refresh().catch(cause => setError(messageOf(cause))); }}>Try again</button></div>}
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="drive-dialog-title" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close(); } }}>
      {modal && <div className={styles.dialogInner}>
        <header className={styles.dialogHeader}><div className={styles.dialogTitleIcon}><ProviderIcon provider={cloud?.provider || (modal.kind === "device" ? modal.source : "computer")} /></div><div><h2 id="drive-dialog-title">{cloud ? pending ? `Connect ${providerName(cloud.provider)}` : cloud.displayName : modal.kind === "device" && modal.source === "icloud" ? "Import from iCloud Drive" : "Upload to Evidence"}</h2><p>{cloud ? cloud.accountLabel || providerName(cloud.provider) : "Create a named folder for your evidence."}</p></div><button type="button" className={styles.iconButton} disabled={busy} onClick={close} aria-label="Close evidence dialog"><X size={21} /></button></header>
        {error && <div role="alert" className={styles.error}>{error}</div>}
        {modal.kind === "device" ? <>
          {modal.source === "icloud" && <p className={styles.info}><Cloud size={18} /><span>Choose iCloud Drive in your device’s file browser. Files are copied into Evidence; this does not create a live iCloud connection.</span></p>}
          <label className={styles.field}>Evidence folder name<input value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Publications or Recommendation letters" maxLength={80} disabled={locked} autoFocus /></label>
          <div className={styles.deviceActions}><button type="button" className={styles.secondary} disabled={locked} onClick={() => fileInput.current?.click()}><FileText size={17} />Choose files</button><button type="button" className={styles.secondary} disabled={locked} onClick={() => folderInput.current?.click()}><FolderOpen size={17} />Choose folder</button></div>
          <input ref={fileInput} hidden type="file" multiple onChange={event => { selectFiles(event.target.files, false); event.target.value = ""; }} />
          <input ref={folderInput} hidden type="file" multiple {...directoryAttributes} onChange={event => { selectFiles(event.target.files, true); event.target.value = ""; }} />
          <div className={styles.fileSummary}>{files.length ? <><strong><Check size={16} /> {files.length} {files.length === 1 ? "file" : "files"} selected{directory ? " · Folder structure preserved" : ""}</strong><ul>{files.slice(0, 4).map((file, index) => <li key={`${file.name}-${index}`}><FileText size={14} /><span>{file.webkitRelativePath || file.name}</span><small>{bytes(file.size)}</small></li>)}</ul>{files.length > 4 && <small>and {files.length - 4} more</small>}</> : <><Upload size={25} /><span>Choose the files you want to keep with your case.</span></>}</div>
        </> : cloud && <>
          {(pending || renaming) && <label className={styles.field}>Evidence folder name<input value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Publications or Research work" maxLength={80} disabled={locked} autoFocus /></label>}
          {pending && <><fieldset className={styles.scope}><legend>Choose what Harness Law can browse</legend><label><input type="radio" name="drive-scope" value="folder" checked={scope === "folder"} disabled={locked} onChange={() => setScope("folder")} /><Folder size={17} /><span>A specific folder</span></label><label><input type="radio" name="drive-scope" value="whole_drive" checked={scope === "whole_drive"} disabled={locked} onChange={() => setScope("whole_drive")} /><Cloud size={17} /><span>Entire drive</span></label></fieldset><p className={styles.scopeNote}>Your provider grants read-only drive permission. Harness Law limits browsing and imports to the location you choose here.</p></>}
          {!pending && <div className={styles.connectionTools}><span><LockKeyhole size={13} />Read-only source · Files are imported as copies</span><button type="button" disabled={locked} onClick={() => { setRenaming(value => !value); setConfirmDisconnect(false); setName(cloud.displayName); }}><PencilLine size={14} />{renaming ? "Cancel rename" : "Rename"}</button><button type="button" disabled={locked} onClick={() => { setConfirmDisconnect(value => !value); setRenaming(false); }}><Unplug size={14} />Disconnect</button></div>}
          {confirmDisconnect && <div className={styles.confirm}><p>Disconnect this source? Imported files stay in your Evidence library.</p><button type="button" className={styles.danger} disabled={locked} onClick={() => void disconnect()}>Disconnect source</button><button type="button" className={styles.textButton} disabled={locked} onClick={() => setConfirmDisconnect(false)}>Cancel</button></div>}
          {renaming && <div className={styles.renameAction}><button type="button" className={styles.primary} disabled={locked || !name.trim()} onClick={() => void saveConnection(true)}>Save name</button></div>}
          {cloud.status === "reconnect_required" ? <div className={styles.empty}><Cloud size={26} /><p>This account needs to be connected again before you can browse it.</p><button type="button" className={styles.primary} disabled={locked || !config?.providers.find(value => value.id === cloud.provider)?.ready} onClick={() => void connect(cloud.provider)}>Connect account again</button></div> : <>
            <div className={styles.browserToolbar}><button type="button" className={styles.iconButton} aria-label="Previous folder" disabled={locked || loading || trail.length < 2} onClick={() => void browse(cloud, trail.slice(0, -1))}><ArrowLeft size={17} /></button><nav aria-label="Cloud folder path" className={styles.breadcrumbs}>{trail.map((folder, index) => <span key={folder.id}>{index > 0 && <ChevronRight size={12} />}<button type="button" disabled={locked || loading || index === trail.length - 1} onClick={() => void browse(cloud, trail.slice(0, index + 1))}>{folder.name}</button></span>)}</nav><button type="button" className={styles.iconButton} aria-label="Refresh folder" disabled={locked || loading} onClick={() => void browse(cloud, trail)}><RefreshCw size={16} /></button></div>
            <div className={styles.browser} aria-busy={loading}>
              <div className={styles.listHeader}>{!pending && <input type="checkbox" aria-label="Select all visible files" checked={allVisibleSelected} disabled={locked || loading || !visibleFiles.length} onChange={() => setSelection(previous => { const next = new Map(previous); visibleFiles.forEach(item => allVisibleSelected ? next.delete(item.id) : next.set(item.id, item)); return next; })} />}<span>Name</span><span>Size</span></div>
              {items.map(item => <div key={item.id} className={`${styles.fileRow} ${selection.has(item.id) ? styles.selected : ""}`}>
                {!pending && (item.isFolder ? <span className={styles.checkboxSpace} /> : <input type="checkbox" checked={selection.has(item.id)} disabled={locked || loading} aria-label={`Select ${item.name}`} onChange={() => toggle(item)} />)}
                <button type="button" className={styles.itemName} disabled={locked || loading || (pending && !item.isFolder)} onClick={() => item.isFolder ? void browse(cloud, [...trail, { id: item.id, name: item.name }]) : toggle(item)}>{item.isFolder ? <Folder size={20} className={styles.folderIcon} /> : <FileText size={19} />}<span>{item.name}</span>{item.isFolder && <ChevronRight size={14} />}</button><small>{item.isFolder ? "Folder" : bytes(item.size)}</small>
              </div>)}
              {loading && <div className={styles.empty}><Loader2 size={22} className={styles.spinner} /><span>Loading files…</span></div>}
              {!loading && !items.length && <div className={styles.empty}><FolderOpen size={27} /><span>{error ? "Use Refresh to try opening this folder again." : "This folder is empty."}</span></div>}
              {cursor && !loading && <button type="button" className={styles.loadMore} disabled={locked} onClick={() => void browse(cloud, trail, cursor)}>Load more files</button>}
            </div>
            {pending ? <p className={styles.selectionNote}><FolderOpen size={16} />{scope === "whole_drive" ? `Selected: Entire ${providerName(cloud.provider)}` : `Selected folder: ${currentFolder?.name || "Choose a folder above"}`}</p> : <p className={styles.selectionNote}>{selection.size} selected{selection.size > 0 && <button type="button" className={styles.textButton} disabled={locked} onClick={() => setSelection(new Map())}>Clear selection</button>}</p>}
          </>}
        </>}
        <footer className={styles.footer}><span role="status" className={styles.progress}>{busy && <Loader2 size={16} className={styles.spinner} />}{progress || (busy ? "Saving…" : "")}</span><button type="button" className={styles.secondary} disabled={busy} onClick={close}>{cloud && !pending ? "Done" : "Cancel"}</button>{modal.kind === "device" ? <button type="button" className={styles.primary} disabled={locked || !files.length || !name.trim()} onClick={() => void uploadDevice()}><Upload size={16} />Add to Evidence</button> : pending ? <button type="button" className={styles.primary} disabled={locked || loading || !name.trim() || !currentFolder} onClick={() => void saveConnection(false)}><Check size={16} />{scope === "whole_drive" ? "Connect drive" : "Connect this folder"}</button> : cloud?.status === "connected" && <button type="button" className={styles.primary} disabled={locked || loading || !selection.size} onClick={() => void importSelected()}><Plus size={16} />Import {selection.size || "selected"} {selection.size === 1 ? "file" : "files"}</button>}</footer>
      </div>}
    </dialog>
  </section>;
}
