'use client';

import { useEffect } from 'react';

function canonicalPage(value: string) {
  if (value.startsWith('workspace/criterion:')) return 'workspace/criterion';
  return value;
}

/** Collect only canonical page names, never forms, case text, filenames, query strings, or IP addresses. */
export function AnalyticsTracker({ page }: { page?: string }) {
  useEffect(() => {
    const navigatorPrivacy = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (navigator.doNotTrack === '1' || navigatorPrivacy.globalPrivacyControl) return;
    const pathname = window.location.pathname.replace(/\/$/, '') || '/';
    if (!page && (pathname === '/workspace' || pathname.startsWith('/admin'))) return;
    if (!page && !['/', '/signin', '/signup', '/onboarding', '/privacy'].includes(pathname)) return;
    const canonical = canonicalPage(page || pathname);
    let referrer = '';
    try {
      const candidate = document.referrer ? new URL(document.referrer).hostname : '';
      // Keep only ordinary public hostnames, never a local address or URL path.
      if (/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(candidate)) referrer = candidate;
    } catch { /* No referrer. */ }
    let lastHeartbeat = 0;
    let viewed = false;
    const send = (kind: 'pageview' | 'heartbeat') => {
      if (document.visibilityState !== 'visible') return;
      // A page opened in a background tab gets its view when first shown.
      if (kind === 'heartbeat' && !viewed) kind = 'pageview';
      const now = Date.now();
      if (kind === 'heartbeat' && now - lastHeartbeat < 55_000) return;
      lastHeartbeat = now;
      if (kind === 'pageview') viewed = true;
      // No retries: analytics must never interrupt preparation or replay a page view.
      void fetch('/api/analytics', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: canonical, kind, eventId: crypto.randomUUID(), ...(referrer ? { referrer } : {}) }),
        keepalive: true }).catch(() => {});
    };
    // Delaying one task also avoids duplicate development StrictMode effects.
    const initial = window.setTimeout(() => send('pageview'), 0);
    const heartbeat = window.setInterval(() => send('heartbeat'), 60_000);
    const onVisible = () => send('heartbeat');
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearTimeout(initial); window.clearInterval(heartbeat); document.removeEventListener('visibilitychange', onVisible); };
  }, [page]);
  return null;
}
