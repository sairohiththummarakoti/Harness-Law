"use client";

import { useEffect, useState } from 'react';
import { BellRing, CalendarDays, ChevronDown, ExternalLink } from 'lucide-react';
import { USCIS_GUIDANCE, guidanceDate } from '@/lib/uscis-guidance';
import type { UscisSourceStatus } from '@/lib/uscis-source-monitor';
import styles from './uscis-guidance-updates.module.css';

export function UscisGuidanceUpdates() {
  const [sources, setSources] = useState<UscisSourceStatus[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    let active = true;
    fetch('/api/uscis-guidance', { signal: controller.signal, credentials: 'same-origin' })
      .then(async response => {
        if (!response.ok) throw new Error('Source check unavailable');
        const data = await response.json() as { sources?: UscisSourceStatus[] };
        if (!data.sources?.length) throw new Error('Source check unavailable');
        if (active) setSources(data.sources);
      })
      .catch(() => { if (active) setUnavailable(true); })
      .finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, []);

  const changes = sources?.filter(source => source.version && source.version !== USCIS_GUIDANCE.reviewedSourceVersions[source.id]) ?? [];
  const checkFailed = unavailable || sources?.some(source => source.status === 'unavailable');
  const latest = USCIS_GUIDANCE.updates[0];
  return <section className={styles.updates} aria-label="USCIS guidance dates and updates">
    <div className={styles.dates}>
      <CalendarDays size={17} aria-hidden="true" />
      <span><a href={USCIS_GUIDANCE.manualUrl} target="_blank" rel="noreferrer">USCIS Policy Manual</a> · current as of <strong>{guidanceDate(USCIS_GUIDANCE.manualCurrentAsOf)}</strong></span>
      <span className={styles.version}>Guide v{USCIS_GUIDANCE.version}</span>
    </div>
    <details className={styles.banner}>
      <summary>
        <span className={styles.symbol}><BellRing size={21} aria-hidden="true" /></span>
        <span className={styles.bannerCopy}>
          <span className={styles.kicker}>{changes.length ? 'New source changes detected' : 'Latest included USCIS policy update'}</span>
          <strong>{changes.length ? 'USCIS has updated its source material' : `${guidanceDate(latest.date)} · ${latest.title}`}</strong>
          <span>{changes.length ? 'See the changed excerpts and official sources. Guide review is pending.' : 'View what changed, the affected criteria, and earlier updates.'}</span>
        </span>
        <span className={styles.expand}>What changed <ChevronDown size={17} aria-hidden="true" /></span>
      </summary>
      <div className={styles.history}>
        {changes.map(source => <article className={styles.detected} key={source.id}>
          <span className={styles.recordDate}>Observed {guidanceDate(source.latestChange?.detectedAt || source.lastSuccessfulAt || USCIS_GUIDANCE.verifiedAt)} · awaiting guide review</span>
          <h3>{source.label}</h3>
          <p>Reviewed version {USCIS_GUIDANCE.reviewedSourceVersions[source.id]?.slice(0, 8) || 'not recorded'} · observed version {source.version?.slice(0, 8)}. The source text differs from this guide’s reviewed version. A text change does not necessarily change eligibility rules.</p>
          {source.latestChange && <p>Latest comparison: {source.latestChange.previousVersion.slice(0, 8)} → {source.latestChange.version.slice(0, 8)}.</p>}
          {!!source.latestChange?.added.length && <><h4>Added or revised text</h4><ul>{source.latestChange.added.map((text, index) => <li key={index}>{text}</li>)}</ul></>}
          {!!source.latestChange?.removed.length && <><h4>Previous text</h4><ul>{source.latestChange.removed.map((text, index) => <li key={index}>{text}</li>)}</ul></>}
          {!source.latestChange && <p>This is the first monitoring snapshot, so a paragraph comparison is not available. Review the linked source for the latest wording.</p>}
          <a href={source.url} target="_blank" rel="noreferrer">Read the current USCIS source <ExternalLink size={13} /></a>
        </article>)}
        {USCIS_GUIDANCE.updates.map(update => <article key={update.id}>
          <span className={styles.recordDate}><time dateTime={update.date}>{guidanceDate(update.date)}</time> · {update.id}</span>
          <h3>{update.title}</h3><p className={styles.scope}>{update.scope}</p>
          <ul>{update.changes.map(change => <li key={change}>{change}</li>)}</ul>
          <a href={update.url} target="_blank" rel="noreferrer">Read the USCIS update <ExternalLink size={13} /></a>
        </article>)}
        <div className={styles.sourceRecord}>
          <strong>Source dates</strong>
          <p><a href={USCIS_GUIDANCE.eb1Url} target="_blank" rel="noreferrer">USCIS EB-1 page</a> last reviewed/updated: {guidanceDate(USCIS_GUIDANCE.eb1PageUpdatedAt)}. Policy Manual current-as-of date: {guidanceDate(USCIS_GUIDANCE.manualCurrentAsOf)}. Harness Law verified these pages on {guidanceDate(USCIS_GUIDANCE.verifiedAt)}.</p>
          <p>The manual’s current-as-of date is not the issue date of a new policy. New source changes are flagged here for review before the guide’s explanations are revised.</p>
          {sources?.map(source => <p key={source.id}>{source.label}: {source.status === 'unavailable' ? 'live check unavailable' : source.status === 'baseline' ? 'monitoring baseline recorded' : 'source checked'}{source.checkedAt ? ` on ${guidanceDate(source.checkedAt)}` : ''}{source.sourceUpdatedAt ? `; USCIS last updated ${guidanceDate(source.sourceUpdatedAt)}` : ''}{source.sourceCurrentAsOf ? `; USCIS current as of ${guidanceDate(source.sourceCurrentAsOf)}` : ''}{source.lastSuccessfulAt && source.status === 'unavailable' ? `; last successful check ${guidanceDate(source.lastSuccessfulAt)}` : ''}.</p>)}
        </div>
      </div>
    </details>
    <p className={styles.checkStatus} role="status">{checkFailed
      ? `Live USCIS check unavailable. Showing guidance verified ${guidanceDate(USCIS_GUIDANCE.verifiedAt)}; newer changes may exist.`
      : sources
        ? 'Sources are checked when this guide is opened, at most once every 24 hours. Open “What changed” for the check details.'
        : 'Checking USCIS for source updates…'}</p>
  </section>;
}
