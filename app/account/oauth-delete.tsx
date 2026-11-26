"use client";

import { useState } from "react";
import styles from "./account.module.css";

export default function OAuthDeleteAccount({ provider }: { provider: string }) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (confirmation !== "DELETE") {
      setError('Type "DELETE" in all caps to confirm.');
      return;
    }
    if (!confirm("Are you sure you want to permanently delete your account, saved cases, and connected drives? This cannot be undone.")) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/delete-oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      const data = await res.json() as { redirectTo?: string; error?: string };
      if (res.ok && data.redirectTo) {
        location.assign(data.redirectTo);
      } else {
        setError(data.error || "Could not delete account.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${styles.card} ${styles.dangerZone}`}>
      <h2>Delete account</h2>
      <p className={styles.cardDesc}>
        Permanently deletes your {provider} workspace account, saved cases, connected drives, and uploaded evidence. This action cannot be undone.
      </p>
      {error && (
        <div role="alert" className={`${styles.notice} ${styles.noticeError}`} style={{ marginBottom: 14 }}>
          {error}
        </div>
      )}
      <form onSubmit={handleDelete}>
        <label>
          Type DELETE to confirm
          <input
            type="text"
            value={confirmation}
            onChange={e => setConfirmation(e.target.value)}
            placeholder="DELETE"
            required
          />
        </label>
        <div>
          <button className={styles.btnDanger} disabled={busy || confirmation !== "DELETE"}>
            {busy ? "Deleting account…" : "Permanently delete account"}
          </button>
        </div>
      </form>
    </div>
  );
}
