"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Cloud, Folder, HardDrive, Lock, Trash2 } from "lucide-react";

type DriveProviderId = "google_drive" | "onedrive" | "icloud" | "dropbox" | "box";
type DriveScope = "folder" | "whole_drive";

interface ConnectedDrive {
  id: string;
  provider: DriveProviderId;
  scope: DriveScope;
  folder_name: string | null;
  status: string;
  updated_at: number;
}

const DRIVE_PROVIDERS: Array<{ id: DriveProviderId; name: string; subtitle: string; color: string }> = [
  { id: "google_drive", name: "Google Drive", subtitle: "drive.readonly", color: "#1a73e8" },
  { id: "onedrive", name: "Microsoft OneDrive", subtitle: "Files.Read", color: "#0078d4" },
  { id: "icloud", name: "Apple iCloud Drive", subtitle: "Read-only folder", color: "#2d3748" },
  { id: "dropbox", name: "Dropbox", subtitle: "files.content.read", color: "#0061ff" },
  { id: "box", name: "Box", subtitle: "Read-only access", color: "#0061d5" },
];

function providerLabel(id: DriveProviderId) {
  return DRIVE_PROVIDERS.find(p => p.id === id)?.name || id;
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
  const [scope, setScope] = useState<DriveScope>("folder");
  const [folderName, setFolderName] = useState("");
  const [drives, setDrives] = useState<ConnectedDrive[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (isSample || !userId) {
      setError("Sign in to a personal account to connect your cloud drive.");
      return;
    }
    if (scope === "folder" && !folderName.trim()) {
      setError("Enter the folder name or path you want to grant read access to.");
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
          scope,
          folderName: scope === "folder" ? folderName.trim() : undefined,
        }),
      });
      const data = await res.json() as { drives?: ConnectedDrive[]; error?: string };
      if (!res.ok) {
        setError(data.error || "Could not connect drive.");
      } else {
        if (Array.isArray(data.drives)) setDrives(data.drives);
        setFolderName("");
        onNotify?.(`${providerLabel(selectedProvider)} connected with read-only access.`);
      }
    } catch {
      setError("Network error while connecting drive. Please try again.");
    } finally {
      setSaving(false);
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
        onNotify?.(`${providerLabel(provider)} disconnected.`);
      }
    } catch {
      setError("Network error while disconnecting drive.");
    }
  }

  return (
    <div className="panel form-section" style={{ marginTop: 22 }}>
      <div className="panel-header">
        <div>
          <h2>Connect with Drive</h2>
          <p>Grant read-only access to a specific folder or your whole cloud drive to import evidence documents.</p>
        </div>
        <span className="pill green" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Lock size={13} /> Read-only
        </span>
      </div>

      <div className="panel-body">
        <form onSubmit={handleConnect} style={{ display: "grid", gap: 18 }}>
          <div>
            <span className="field-label" style={{ display: "block", marginBottom: 8 }}>
              1. Select cloud drive provider
            </span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
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
                      alignItems: "flex-start",
                      gap: 4,
                      padding: "12px 14px",
                      borderRadius: 8,
                      border: active ? `2px solid ${provider.color}` : "1px solid #d7e0d6",
                      background: active ? "#f5f9f4" : "#ffffff",
                      textAlign: "left",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 14, color: "#1d3529" }}>
                      <Cloud size={16} color={provider.color} />
                      {provider.name}
                    </span>
                    <span style={{ fontSize: 12, color: "#606e64" }}>{provider.subtitle}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="field-label" style={{ display: "block", marginBottom: 8 }}>
              2. Choose read access scope
            </span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
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
                  style={{ marginTop: 3 }}
                />
                <div>
                  <strong style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: "#1d3529" }}>
                    <Folder size={15} /> Specific folder only
                  </strong>
                  <span style={{ fontSize: 12.5, color: "#55675c", display: "block", marginTop: 3 }}>
                    Recommended. Limit read access to one dedicated case or evidence folder.
                  </span>
                </div>
              </label>

              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
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
                  style={{ marginTop: 3 }}
                />
                <div>
                  <strong style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: "#1d3529" }}>
                    <HardDrive size={15} /> Whole drive
                  </strong>
                  <span style={{ fontSize: 12.5, color: "#55675c", display: "block", marginTop: 3 }}>
                    Browse and read files across your entire {providerLabel(selectedProvider)}.
                  </span>
                </div>
              </label>
            </div>
          </div>

          {scope === "folder" && (
            <label className="field" style={{ maxWidth: 460 }}>
              <span className="field-label">Folder name or shared folder URL</span>
              <input
                type="text"
                value={folderName}
                onChange={e => setFolderName(e.target.value)}
                placeholder="e.g. EB-1A Evidence & Publications"
                disabled={isSample}
              />
            </label>
          )}

          {error && (
            <div className="notice warning" role="alert" style={{ marginTop: 0 }}>
              <p style={{ margin: 0 }}>{error}</p>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <button type="submit" className="button primary" disabled={saving || isSample}>
              <Cloud size={16} />
              {saving ? "Connecting..." : `Connect ${providerLabel(selectedProvider)} (Read-Only)`}
            </button>
            <span style={{ fontSize: 12.5, color: "#606e64" }}>
              Read-only permission: Harness Law never modifies or deletes your drive files.
            </span>
          </div>
        </form>

        {(loading || drives.length > 0) && (
          <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid #e5ebe6" }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 12px", color: "#1d3529" }}>
              Connected drives
            </h3>
            {loading ? (
              <p style={{ fontSize: 13, color: "#606e64" }}>Loading connected drives...</p>
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
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <CheckCircle2 size={18} color="#214d3b" />
                      <div>
                        <strong style={{ fontSize: 14, color: "#1d3529", display: "block" }}>
                          {providerLabel(drive.provider)}
                        </strong>
                        <span style={{ fontSize: 12.5, color: "#55675c" }}>
                          Read-only · {drive.scope === "folder" ? `Specific folder: "${drive.folder_name}"` : "Whole drive"}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => handleDisconnect(drive.id, drive.provider)}
                    >
                      <Trash2 size={14} /> Disconnect
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
