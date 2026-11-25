"use client";
import { useState } from 'react';
import styles from './account.module.css';

export default function AccountSettings({ email }: { email: string }) {
  const [notice, setNotice] = useState('');
  const [isError, setIsError] = useState(false);
  const [testOnlyLink, setTestOnlyLink] = useState('');
  const [busyEmail, setBusyEmail] = useState(false);
  const [busyPassword, setBusyPassword] = useState(false);
  const [busyReset, setBusyReset] = useState(false);
  const [busyDelete, setBusyDelete] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showDeletePassword, setShowDeletePassword] = useState(false);

  async function changeEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice('');
    setIsError(false);
    setTestOnlyLink('');
    setBusyEmail(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/email/change-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.get('email') })
      });
      const body = await response.json() as { message?: string; error?: string; testOnlyLink?: string };
      if (!response.ok) {
        setIsError(true);
        setNotice(body.error || 'Failed to request email change.');
      } else {
        setNotice(body.message || 'Confirmation sent to new email.');
        setTestOnlyLink(body.testOnlyLink || '');
        (event.target as HTMLFormElement).reset();
      }
    } catch {
      setIsError(true);
      setNotice('Network error. Please try again.');
    } finally {
      setBusyEmail(false);
    }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice('');
    setIsError(false);
    setBusyPassword(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/email/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: form.get('currentPassword'),
          password: form.get('password')
        })
      });
      const body = await response.json() as { redirectTo?: string; error?: string };
      if (body.redirectTo) {
        location.assign(body.redirectTo);
      } else {
        setIsError(true);
        setNotice(body.error || 'Password change failed.');
      }
    } catch {
      setIsError(true);
      setNotice('Network error. Please try again.');
    } finally {
      setBusyPassword(false);
    }
  }

  async function sendResetEmail() {
    setNotice('');
    setIsError(false);
    setTestOnlyLink('');
    setBusyReset(true);
    try {
      const response = await fetch('/api/auth/email/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const body = await response.json() as { message?: string; error?: string; testOnlyLink?: string; testOnlyOtp?: string };
      if (!response.ok) {
        setIsError(true);
        setNotice(body.error || 'Could not send password reset email.');
      } else {
        setNotice(body.message || `Password reset instructions sent to ${email}.`);
        if (body.testOnlyLink) setTestOnlyLink(body.testOnlyLink);
      }
    } catch {
      setIsError(true);
      setNotice('Network error. Please try again.');
    } finally {
      setBusyReset(false);
    }
  }

  async function removeAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirm('Are you absolutely sure you want to delete your Harness Law account? All saved cases, drafts, and evidence will be permanently deleted.')) {
      return;
    }
    setNotice('');
    setIsError(false);
    setBusyDelete(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/email/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: form.get('password') })
      });
      const body = await response.json() as { redirectTo?: string; error?: string };
      if (body.redirectTo) {
        location.assign(body.redirectTo);
      } else {
        setIsError(true);
        setNotice(body.error || 'Deletion failed. Check your password and try again.');
      }
    } catch {
      setIsError(true);
      setNotice('Account deletion could not finish. Please try again.');
    } finally {
      setBusyDelete(false);
    }
  }

  return (
    <div>
      {notice && (
        <div role="status" className={`${styles.notice} ${isError ? styles.noticeError : ''}`} style={{ marginBottom: 20 }}>
          {notice}
        </div>
      )}
      {testOnlyLink && (
        <div role="status" className={styles.notice} style={{ marginBottom: 20 }}>
          Development test link: <a href={testOnlyLink} style={{ color: '#214d3b', textDecoration: 'underline' }}>Confirm email change</a>
        </div>
      )}

      {/* Change Email */}
      <div className={styles.card}>
        <h2>Change email address</h2>
        <p className={styles.cardDesc}>
          Current email: <strong>{email}</strong>. A 6-digit confirmation code and link will be sent to your new address. Your current email remains active until you confirm.
        </p>
        <form onSubmit={changeEmail}>
          <label>
            New email address
            <input name="email" type="email" required autoComplete="email" placeholder="new.email@example.com" />
          </label>
          <div>
            <button className={styles.btnPrimary} disabled={busyEmail}>
              {busyEmail ? 'Sending confirmation…' : 'Send confirmation'}
            </button>
          </div>
        </form>
      </div>

      {/* Change Password */}
      <div className={styles.card}>
        <h2>Change password</h2>
        <p className={styles.cardDesc}>
          Ensure your password is at least 8 characters. Changing your password revokes existing sign-in sessions and sends a security notice to your email.
        </p>
        <form onSubmit={changePassword}>
          <label>
            Current password
            <div className={styles.passwordWrapper}>
              <input
                type={showPassword ? 'text' : 'password'}
                name="currentPassword"
                autoComplete="current-password"
                required
                placeholder="Current password"
              />
              <button
                type="button"
                className={styles.passwordToggle}
                onClick={() => setShowPassword(!showPassword)}
                aria-pressed={showPassword}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>
          <label>
            New password
            <div className={styles.passwordWrapper}>
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={1024}
                required
                placeholder="New password (min 8 characters)"
              />
            </div>
          </label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className={styles.btnPrimary} disabled={busyPassword}>
              {busyPassword ? 'Updating…' : 'Update password'}
            </button>
            <button
              type="button"
              className={styles.btnSignOut}
              onClick={sendResetEmail}
              disabled={busyReset}
            >
              {busyReset ? 'Sending reset link…' : 'Reset password via email'}
            </button>
          </div>
        </form>
      </div>

      {/* Delete Account */}
      <div className={`${styles.card} ${styles.dangerZone}`}>
        <h2>Delete account</h2>
        <p className={styles.cardDesc}>
          Permanently deletes your account, authentication credentials, and all uploaded evidence and cases. This action cannot be undone.
        </p>
        <form onSubmit={removeAccount}>
          <label>
            Confirm current password
            <div className={styles.passwordWrapper}>
              <input
                type={showDeletePassword ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                required
                placeholder="Enter password to confirm deletion"
              />
              <button
                type="button"
                className={styles.passwordToggle}
                onClick={() => setShowDeletePassword(!showDeletePassword)}
                aria-pressed={showDeletePassword}
              >
                {showDeletePassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>
          <div>
            <button className={styles.btnDanger} disabled={busyDelete}>
              {busyDelete ? 'Deleting account…' : 'Permanently delete account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
