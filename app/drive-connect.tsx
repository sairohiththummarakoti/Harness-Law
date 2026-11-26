"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, ChevronRight, Cloud, FileText, Folder, FolderOpen, HardDrive, Lock, PencilLine, RefreshCw, Trash2, Upload, X } from "lucide-react";

type DriveProviderId = "google_drive" | "onedrive" | "icloud" | "dropbox";
type DriveScope = "folder" | "whole_drive";

interface ConnectedDrive {
  id: string;
  provider: DriveProviderId;
  display_name: string | null;
  scope: DriveScope;
  folder_name: string | null;
  status: string;
  hasToken?: boolean;
  updated_at: number;
}

interface CloudItem {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  size: number;
  modifiedTime: string | null;
}

function ProviderIcon({ id, size = 22 }: { id: DriveProviderId; size?: number }) {
  if (id === "google_drive") {
    return (
      <svg width={size} height={size} viewBox="0 0 87.3 78" aria-hidden="true">
        <path fill="#0066da" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" />
        <path fill="#00ac47" d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" />
        <path fill="#ea4335" d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" />
        <path fill="#00832d" d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" />
        <path fill="#2684fc" d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
        <path fill="#ffba00" d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" />
      </svg>
    );
  }
  if (id === "onedrive") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#0364b8" d="M10.1 6.5A5.6 5.6 0 0 0 4.6 11a4.2 4.2 0 0 0-3.6 4.1A4.3 4.3 0 0 0 5.3 19.5h12.9a3.8 3.8 0 0 0 .8-7.5 4.8 4.8 0 0 0-4.7-4 5.5 5.5 0 0 0-4.2-1.5Z" />
        <path fill="#0078d4" d="M10.1 6.5a5.6 5.6 0 0 1 4.2 1.5l-4.5 5.4L4.6 11a5.6 5.6 0 0 1 5.5-4.5Z" />
        <path fill="#28a8ea" d="M19.4 19.5a3.8 3.8 0 0 0 .4-7.5l-5.5-4-4.5 5.4 9.6 6.1Z" />
      </svg>
    );
  }
  if (id === "icloud") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="#1d3529" aria-hidden="true">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.37c.62-.75 1.04-1.8 1.01-2.87-.96.04-2.12.64-2.79 1.42-.58.68-1.1 1.74-1.01 2.79 1.07.08 2.17-.59 2.79-1.34z" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#0061ff" aria-hidden="true">
      <path d="M6 2 0 5.8l6 3.8 6-3.8L6 2Zm12 0-6 3.8 6 3.8 6-3.8L18 2ZM0 13.4l6 3.8 6-3.8-6-3.8-6 3.8Zm18-3.8-6 3.8 6 3.8 6-3.8-6-3.8ZM6 18.5l6 3.8 6-3.8-6-3.8-6 3.8Z" />
    </svg>
  );
}

const DRIVE_PROVIDERS: Array<{ id: DriveProviderId; name: string; color: string }> = [
  { id: "google_drive", name: "Google Drive", color: "#1a73e8" },
  { id: "onedrive", name: "OneDrive", color: "#0078d4" },
  { id: "icloud", name: "iCloud Drive", color: "#1d3529" },
  { id: "dropbox", name: "Dropbox", color: "#0061ff" },
];

function providerLabel(id: DriveProviderId) {
  return DRIVE_PROVIDERS.find(p => p.id === id)?.name || id;
}

async function ensureGsiLoaded(): Promise<void> {
  const w = window as unknown as { google?: { accounts?: { oauth2?: unknown } } };
  if (w.google?.accounts?.oauth2) return;
  await new Promise<void>((resolve, reject) => {
    const existing = document.getElementById("harness-google-identity") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load Google script.")), { once: true });
      if (w.google?.accounts?.oauth2) resolve();
      return;
    }
    const script = document.createElement("script");
    script.id = "harness-google-identity";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Google script."));
    document.head.appendChild(script);
  });
}

export default function DriveConnect({
  userId,
  isSample,
  onNotify,
}: {
  userId?: string;
  isSample?: boolean;
  onNotify?: (message: string) => void;
}) {
  const [selectedProvider, setSelectedProvider] = useState<DriveProviderId>("google_drive");
  const [customName, setCustomName] = useState("");
  const [scope, setScope] = useState<DriveScope>("folder");
  const [folderName, setFolderName] = useState("");
  const [drives, setDrives] = useState<ConnectedDrive[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [browsedFiles, setBrowsedFiles] = useState<File[]>([]);
  const [browsedFolderLabel, setBrowsedFolderLabel] = useState("");
  const [importing, setImporting] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const [authorizingCloud, setAuthorizingCloud] = useState(false);
  const [cloudBrowserOpen, setCloudBrowserOpen] = useState(false);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudItems, setCloudItems] = useState<CloudItem[]>([]);
  const [cloudBreadcrumbs, setCloudBreadcrumbs] = useState<Array<{ id: string; name: string }>>([{ id: "root", name: "My Drive" }]);
  const [importingFileId, setImportingFileId] = useState<string | null>(null);

  useEffect(() => {
    if (isSample || !userId) return;
    let active = true;
    setLoading(true);
    fetch("/api/drives", {
      credentials: "same-origin",
      headers: { "X-Harness-Account": userId },
    })
      .then(async res => {
        if (!res.ok) return;
        const data = await res.json() as { drives?: ConnectedDrive[] };
        if (active && Array.isArray(data.drives)) {
          setDrives(data.drives);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [userId, isSample]);

  async function refreshDrives() {
    if (!userId || isSample) return;
    const res = await fetch("/api/drives", {
      credentials: "same-origin",
      headers: { "X-Harness-Account": userId },
    });
    if (res.ok) {
      const data = await res.json() as { drives?: ConnectedDrive[] };
      if (Array.isArray(data.drives)) setDrives(data.drives);
    }
  }

  async function authorizeGoogleDriveCloud() {
    if (!userId || isSample) {
      setError("Sign in to authorize Google Drive.");
      return;
    }
    setError("");
    setAuthorizingCloud(true);
    try {
      const [cfgRes] = await Promise.all([
        fetch("/api/auth/google", { credentials: "same-origin", cache: "no-store" }),
        ensureGsiLoaded(),
      ]);
      const cfg = await cfgRes.json() as { clientId?: string; error?: string };
      if (!cfgRes.ok || !cfg.clientId) {
        throw new Error(cfg.error || "Google Client ID is not configured.");
      }

      const w = window as unknown as {
        google?: {
          accounts?: {
            oauth2?: {
              initTokenClient: (opts: {
                client_id: string;
                scope: string;
                callback: (resp: { access_token?: string; expires_in?: number; error?: string }) => void;
              }) => { requestAccessToken: () => void };
            };
          };
        };
      };
      const oauth2 = w.google?.accounts?.oauth2;
      if (!oauth2) throw new Error("Google OAuth2 client unavailable.");

      await new Promise<void>((resolve, reject) => {
        const client = oauth2.initTokenClient({
          client_id: cfg.clientId!,
          scope: "https://www.googleapis.com/auth/drive.readonly",
          callback: async resp => {
            if (resp.error || !resp.access_token) {
              reject(new Error(resp.error || "Google Drive authorization was cancelled."));
              return;
            }
            try {
              const saveRes = await fetch("/api/drives/token", {
                method: "POST",
                credentials: "same-origin",
                headers: {
                  "Content-Type": "application/json",
                  "X-Harness-Account": userId,
                },
                body: JSON.stringify({
                  provider: "google_drive",
                  accessToken: resp.access_token,
                  expiresIn: resp.expires_in ?? 3500,
                  scope,
                  folderName: scope === "folder" ? folderName.trim() : undefined,
                  displayName: customName.trim() || undefined,
                }),
              });
              if (!saveRes.ok) {
                const errBody = await saveRes.json().catch(() => ({})) as { error?: string };
                throw new Error(errBody.error || "Failed to save Google Drive authorization.");
              }
              await refreshDrives();
              onNotify?.("Google Drive connected.");
              resolve();
            } catch (e) {
              reject(e);
            }
          },
        });
        client.requestAccessToken();
      });

      await loadCloudFolder("root", [{ id: "root", name: "My Drive" }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not authorize Google Drive.");
    } finally {
      setAuthorizingCloud(false);
    }
  }

  async function loadCloudFolder(folderId: string, breadcrumbs: Array<{ id: string; name: string }>) {
    if (!userId || isSample) return;
    setError("");
    setCloudBrowserOpen(true);
    setCloudLoading(true);
    setCloudBreadcrumbs(breadcrumbs);
    try {
      const res = await fetch(`/api/drives/browse?provider=google_drive&folderId=${encodeURIComponent(folderId)}`, {
        credentials: "same-origin",
        headers: { "X-Harness-Account": userId },
      });
      const data = await res.json() as { items?: CloudItem[]; needsReauth?: boolean; error?: string };
      if (!res.ok) {
        if (data.needsReauth) {
          setCloudBrowserOpen(false);
          setError(data.error || "Please authorize Google Drive to browse folders.");
        } else {
          setError(data.error || "Could not load folders.");
        }
        return;
      }
      setCloudItems(data.items ?? []);
    } catch {
      setError("Network error while browsing Google Drive.");
    } finally {
      setCloudLoading(false);
    }
  }

  async function importCloudFile(item: CloudItem) {
    if (!userId || isSample) return;
    setError("");
    setImportingFileId(item.id);
    const folderPath = cloudBreadcrumbs.slice(1).map(b => b.name).join("/");
    try {
      const res = await fetch("/api/drives/import", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-Harness-Account": userId,
        },
        body: JSON.stringify({
          provider: "google_drive",
          fileId: item.id,
          fileName: item.name,
          mimeType: item.mimeType,
          folderPath,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        setError(data.error || `Could not import ${item.name}.`);
      } else {
        onNotify?.(`Imported "${item.name}".`);
      }
    } catch {
      setError(`Network error importing ${item.name}.`);
    } finally {
      setImportingFileId(null);
    }
  }

  function openFolderBrowser() {
    setError("");
    folderInputRef.current?.click();
  }

  function handleFolderSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const firstPath = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath || "";
    const rootFolder = firstPath.split("/")[0] || "Selected Folder";
    setBrowsedFolderLabel(rootFolder);
    if (!folderName.trim()) {
      setFolderName(rootFolder);
    }
    setBrowsedFiles(files);
    e.target.value = "";
  }

  async function handleImportBrowsedFiles() {
    if (!userId || isSample || !browsedFiles.length) return;
    setError("");
    setImporting(true);
    let uploaded = 0;
    const supported = browsedFiles.filter(f => /\.(pdf|docx|txt|jpg|jpeg|png)$/i.test(f.name));
    if (!supported.length) {
      setError("No supported files (PDF, DOCX, TXT, JPG, PNG) found in this folder.");
      setImporting(false);
      return;
    }
    try {
      for (const file of supported) {
        const form = new FormData();
        form.append("file", file);
        const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || browsedFolderLabel;
        const folderPath = rel.includes("/") ? rel.split("/").slice(0, -1).join("/") : browsedFolderLabel;
        if (folderPath) form.append("folder", folderPath);
        const res = await fetch("/api/evidence", {
          method: "POST",
          body: form,
          credentials: "same-origin",
          headers: { "X-Harness-Account": userId },
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(data.error || `Failed to upload ${file.name}`);
        }
        uploaded++;
      }
      onNotify?.(`Imported ${uploaded} file${uploaded === 1 ? "" : "s"} from "${browsedFolderLabel}".`);
      setBrowsedFiles([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import files.");
    } finally {
      setImporting(false);
    }
  }

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (isSample || !userId) {
      setError("Sign in to connect a cloud drive.");
      return;
    }
    if (scope === "folder" && !folderName.trim()) {
      setError("Please select or enter a folder.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/drives", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-Harness-Account": userId,
        },
        body: JSON.stringify({
          provider: selectedProvider,
          displayName: customName.trim() || undefined,
          scope,
          folderName: scope === "folder" ? folderName.trim() : undefined,
        }),
      });
      const data = await res.json() as { drives?: ConnectedDrive[]; error?: string };
      if (!res.ok) {
        setError(data.error || "Could not connect drive.");
      } else {
        if (Array.isArray(data.drives)) setDrives(data.drives);
        setCustomName("");
        setFolderName("");
        onNotify?.(`${customName.trim() || providerLabel(selectedProvider)} connected.`);
      }
    } catch {
      setError("Network error while connecting drive.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRenameDrive(id: string) {
    if (!userId || isSample || !editingName.trim()) return;
    setError("");
    try {
      const res = await fetch("/api/drives", {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-Harness-Account": userId,
        },
        body: JSON.stringify({ id, displayName: editingName.trim() }),
      });
      const data = await res.json() as { drives?: ConnectedDrive[]; error?: string };
      if (!res.ok) {
        setError(data.error || "Could not rename connection.");
      } else {
        if (Array.isArray(data.drives)) setDrives(data.drives);
        setEditingId(null);
        setEditingName("");
        onNotify?.("Renamed.");
      }
    } catch {
      setError("Network error while renaming.");
    }
  }

  async function handleDisconnect(id: string, provider: DriveProviderId) {
    if (!userId || isSample) return;
    setError("");
    try {
      const res = await fetch(`/api/drives?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "X-Harness-Account": userId },
      });
      const data = await res.json() as { drives?: ConnectedDrive[]; error?: string };
      if (!res.ok) {
        setError(data.error || "Could not disconnect drive.");
      } else {
        if (Array.isArray(data.drives)) setDrives(data.drives);
        if (provider === "google_drive") setCloudBrowserOpen(false);
        onNotify?.(`${providerLabel(provider)} disconnected.`);
      }
    } catch {
      setError("Network error while disconnecting drive.");
    }
  }

  const googleDriveConn = drives.find(d => d.provider === "google_drive");

  return (
    <div className="panel form-section" style={{ marginTop: 22 }}>
      <div className="panel-header">
        <div>
          <h2>Connect with Drive</h2>
          <p>Choose a cloud drive to grant read-only access for your evidence.</p>
        </div>
        <span className="pill green" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Lock size={13} /> Read-only
        </span>
      </div>

      <div className="panel-body">
        <div style={{ marginBottom: 22, paddingBottom: 18, borderBottom: "1px solid #e5ebe6" }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 12px", color: "#1d3529" }}>
            Connected drives
          </h3>
          {loading ? (
            <p style={{ fontSize: 13, color: "#606e64", margin: 0 }}>Loading…</p>
          ) : drives.length === 0 ? (
            <p style={{ fontSize: 13.5, color: "#606e64", margin: 0, padding: "12px 14px", borderRadius: 8, border: "1px dashed #d7e0d6", background: "#fafbf8" }}>
              No connected drives
            </p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {drives.map(drive => (
                <div
                  key={drive.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "12px 14px",
                    borderRadius: 8,
                    border: "1px solid #dce5d5",
                    background: "#f9fbf8",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <ProviderIcon id={drive.provider} size={22} />
                    <div>
                      {editingId === drive.id ? (
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          <input
                            type="text"
                            value={editingName}
                            onChange={e => setEditingName(e.target.value)}
                            placeholder="e.g. Letters"
                            maxLength={120}
                            style={{ padding: "4px 8px", fontSize: 13.5, borderRadius: 6, border: "1px solid #bdcbc0" }}
                          />
                          <button type="button" className="button primary small" onClick={() => void handleRenameDrive(drive.id)}>
                            Save
                          </button>
                          <button type="button" className="button ghost small" onClick={() => setEditingId(null)}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <strong style={{ fontSize: 14, color: "#1d3529", display: "flex", alignItems: "center", gap: 6 }}>
                          {drive.display_name || providerLabel(drive.provider)}
                          <CheckCircle2 size={14} color="#214d3b" />
                        </strong>
                      )}
                      <span style={{ fontSize: 12.5, color: "#55675c" }}>
                        {providerLabel(drive.provider)} · {drive.scope === "folder" ? "Specific folder" : "Whole drive"}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {editingId !== drive.id && (
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() => {
                          setEditingId(drive.id);
                          setEditingName(drive.display_name || providerLabel(drive.provider));
                        }}
                      >
                        <PencilLine size={14} /> Rename
                      </button>
                    )}
                    {drive.provider === "google_drive" && (
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() => drive.hasToken ? void loadCloudFolder("root", [{ id: "root", name: "My Drive" }]) : void authorizeGoogleDriveCloud()}
                      >
                        <FolderOpen size={14} /> Browse
                      </button>
                    )}
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => handleDisconnect(drive.id, drive.provider)}
                    >
                      <Trash2 size={14} /> Disconnect
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={handleConnect} style={{ display: "grid", gap: 18 }}>
          {/* Provider Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))", gap: 10 }}>
            {DRIVE_PROVIDERS.map(provider => {
              const active = selectedProvider === provider.id;
              return (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => setSelectedProvider(provider.id)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    padding: "16px 12px",
                    borderRadius: 10,
                    border: active ? `2px solid ${provider.color}` : "1px solid #d7e0d6",
                    background: active ? "#f4f8f5" : "#ffffff",
                    boxShadow: active ? "0 4px 12px #143b2e12" : "none",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <ProviderIcon id={provider.id} size={26} />
                  <span style={{ fontWeight: 600, fontSize: 13.5, color: "#1d3529" }}>
                    {provider.name}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Access Scope */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 14px",
                borderRadius: 8,
                border: scope === "folder" ? "2px solid #214d3b" : "1px solid #d7e0d6",
                background: scope === "folder" ? "#f5f9f4" : "#ffffff",
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="driveScope"
                value="folder"
                checked={scope === "folder"}
                onChange={() => setScope("folder")}
              />
              <Folder size={17} color="#214d3b" />
              <span style={{ fontSize: 14, fontWeight: 600, color: "#1d3529" }}>Specific folder</span>
            </label>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 14px",
                borderRadius: 8,
                border: scope === "whole_drive" ? "2px solid #214d3b" : "1px solid #d7e0d6",
                background: scope === "whole_drive" ? "#f5f9f4" : "#ffffff",
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="driveScope"
                value="whole_drive"
                checked={scope === "whole_drive"}
                onChange={() => setScope("whole_drive")}
              />
              <HardDrive size={17} color="#214d3b" />
              <span style={{ fontSize: 14, fontWeight: 600, color: "#1d3529" }}>Whole drive</span>
            </label>
          </div>

          {/* Custom Name & Folder Input */}
          <div style={{ display: "grid", gap: 12 }}>
            <label className="field" style={{ maxWidth: 460 }}>
              <span className="field-label">Name this drive (e.g. Letters)</span>
              <input
                type="text"
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                placeholder="e.g. Letters, Publications, Awards"
                maxLength={120}
                disabled={isSample}
              />
            </label>

            {scope === "folder" && (
              <label className="field">
                <span className="field-label">Folder</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    type="text"
                    value={folderName}
                    onChange={e => setFolderName(e.target.value)}
                    placeholder="Select a folder or paste link"
                    disabled={isSample}
                    style={{ flex: 1, minWidth: 200 }}
                  />
                  {selectedProvider === "google_drive" && (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => googleDriveConn?.hasToken ? void loadCloudFolder("root", [{ id: "root", name: "My Drive" }]) : void authorizeGoogleDriveCloud()}
                      disabled={isSample || authorizingCloud}
                    >
                      <ProviderIcon id="google_drive" size={16} />
                      {authorizingCloud ? "Connecting…" : "Browse Google Drive"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="button secondary"
                    onClick={openFolderBrowser}
                    disabled={isSample}
                  >
                    <FolderOpen size={16} /> Browse device
                  </button>
                </div>
              </label>
            )}
          </div>

          <input
            ref={folderInputRef}
            type="file"
            multiple
            // @ts-expect-error webkitdirectory is supported in Chromium, Safari, and Firefox
            webkitdirectory=""
            directory=""
            style={{ display: "none" }}
            onChange={handleFolderSelected}
          />

          {/* Remote Google Drive Cloud Browser */}
          {cloudBrowserOpen && (
            <div style={{ padding: "14px 16px", borderRadius: 8, border: "1px solid #b9cde6", background: "#f4f8fd" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", fontSize: 13.5, fontWeight: 600, color: "#1d3529" }}>
                  <ProviderIcon id="google_drive" size={16} />
                  {cloudBreadcrumbs.map((crumb, idx) => (
                    <span key={crumb.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {idx > 0 && <ChevronRight size={14} />}
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => void loadCloudFolder(crumb.id, cloudBreadcrumbs.slice(0, idx + 1))}
                      >
                        {crumb.name}
                      </button>
                    </span>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {cloudBreadcrumbs.length > 1 && (
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => {
                        const pathLabel = cloudBreadcrumbs.slice(1).map(b => b.name).join("/");
                        setFolderName(pathLabel);
                        setScope("folder");
                        onNotify?.(`Selected "${pathLabel}".`);
                      }}
                    >
                      Select folder
                    </button>
                  )}
                  <button
                    type="button"
                    className="button ghost small"
                    onClick={() => void loadCloudFolder(cloudBreadcrumbs[cloudBreadcrumbs.length - 1].id, cloudBreadcrumbs)}
                    title="Refresh"
                  >
                    <RefreshCw size={14} />
                  </button>
                  <button
                    type="button"
                    className="button ghost small"
                    onClick={() => setCloudBrowserOpen(false)}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {cloudLoading ? (
                <p style={{ fontSize: 13, color: "#55675c", margin: "8px 0" }}>Loading…</p>
              ) : cloudItems.length === 0 ? (
                <p style={{ fontSize: 13, color: "#55675c", margin: "8px 0" }}>Empty folder.</p>
              ) : (
                <div style={{ maxHeight: 220, overflowY: "auto", display: "grid", gap: 6 }}>
                  {cloudItems.map(item => (
                    <div
                      key={item.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        background: "#fff",
                        padding: "7px 10px",
                        borderRadius: 6,
                        border: "1px solid #dce5f2",
                      }}
                    >
                      {item.isFolder ? (
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => void loadCloudFolder(item.id, [...cloudBreadcrumbs, { id: item.id, name: item.name }])}
                          style={{ fontWeight: 600 }}
                        >
                          <Folder size={15} color="#1a73e8" /> {item.name}
                        </button>
                      ) : (
                        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#1d3529", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <FileText size={14} color="#55675c" /> {item.name}
                          {item.size > 0 && <small style={{ color: "#606e64" }}>({(item.size / 1024).toFixed(1)} KB)</small>}
                        </span>
                      )}

                      {!item.isFolder && (
                        <button
                          type="button"
                          className="button secondary small"
                          disabled={importingFileId === item.id}
                          onClick={() => void importCloudFile(item)}
                        >
                          <Upload size={13} /> {importingFileId === item.id ? "Importing…" : "Import"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Local Directory Browser Preview */}
          {browsedFiles.length > 0 && (
            <div style={{ padding: "14px 16px", borderRadius: 8, border: "1px solid #c3d8c8", background: "#f5f9f4" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                <strong style={{ fontSize: 14, color: "#1d3529", display: "flex", alignItems: "center", gap: 6 }}>
                  <FolderOpen size={16} /> {browsedFolderLabel} ({browsedFiles.length})
                </strong>
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => setBrowsedFiles([])}
                  aria-label="Clear selected folder"
                >
                  <X size={14} />
                </button>
              </div>
              <div style={{ maxHeight: 150, overflowY: "auto", display: "grid", gap: 6, marginBottom: 12 }}>
                {browsedFiles.slice(0, 25).map((file, idx) => {
                  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
                  return (
                    <div key={`${rel}-${idx}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12.5, color: "#334d3e", background: "#fff", padding: "6px 10px", borderRadius: 6, border: "1px solid #e0e7e1" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <FileText size={14} /> {rel}
                      </span>
                      <span style={{ color: "#606e64", flexShrink: 0, marginLeft: 8 }}>
                        {(file.size / 1024).toFixed(1)} KB
                      </span>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                className="button secondary small"
                onClick={handleImportBrowsedFiles}
                disabled={importing || isSample}
              >
                <Upload size={14} /> {importing ? "Importing…" : "Import files"}
              </button>
            </div>
          )}

          {error && (
            <div className="notice warning" role="alert" style={{ marginTop: 0 }}>
              <p style={{ margin: 0 }}>{error}</p>
            </div>
          )}

          <div>
            <button type="submit" className="button primary" disabled={saving || isSample}>
              <Cloud size={16} />
              {saving ? "Connecting…" : `Connect ${providerLabel(selectedProvider)}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
