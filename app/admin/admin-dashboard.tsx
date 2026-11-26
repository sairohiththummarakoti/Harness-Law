"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Activity, BarChart3, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock3, Eye, Globe2, LayoutDashboard, Loader2, LockKeyhole, MapPin, Monitor, RefreshCw, Search, ShieldCheck, UserPlus, UsersRound, AlertCircle } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import type { AdminOverview, AnalyticsBreakdown, AnalyticsRange } from "@/lib/admin/analytics-types";
import styles from "./admin.module.css";

type Viewer = { userId: string; email: string; displayName: string; role: "owner" | "admin" };
type Member = { userId: string; email: string; displayName: string; provider: string; role: "owner" | "admin"; createdAt: number };
type AuditEntry = { id: string; action: string; actorEmail: string; targetEmail: string; createdAt: number };
type AccessData = { members: Member[]; audit: AuditEntry[] };
type PendingAction = { action: "grant" | "revoke"; userId: string; email: string; displayName: string; provider: string };
type Tab = "overview" | "users" | "access";

const count = (value: number) => new Intl.NumberFormat("en-US").format(value);
const dateTime = (value: number | null) => value && Number.isFinite(value) ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not available";
const dateOnly = (value: number | null) => value && Number.isFinite(value) ? new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" }) : "Not available";
function countryName(value: string | null) {
  if (!value) return "Unknown";
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(value.toUpperCase()) || value; } catch { return value; }
}
function locationText(value: { country: string | null; region: string | null; city: string | null }) {
  return [...new Set([value.city, value.region, value.country ? countryName(value.country) : null].filter(Boolean))].join(", ") || "Unknown";
}
function pageName(value: string) {
  const known: Record<string, string> = { "/": "Launch page", "/signin": "Sign in", "/signup": "Get started", "/onboarding": "Intake", "/workspace": "Workspace", "/privacy": "Privacy", "workspace/sample": "Fictional sample", "/workspace/sample": "Fictional sample", criterion: "Criterion details", dashboard: "Overview", profile: "Your profile", criteria: "Your criteria", evidence: "Evidence library", facts: "Facts & sources", composition: "Compose your case", draft: "Working draft", forms: "Application forms", review: "Final review", help: "Help & guidance", settings: "Settings" };
  return known[value] || (value.startsWith("/workspace/") ? known[value.slice(11)] || value : value.startsWith("workspace/") ? known[value.slice(10)] || value : value);
}
function providerName(provider: string) { return provider === "chatgpt" ? "ChatGPT" : provider === "google" ? "Google" : provider; }

function Empty({ title = "No activity yet", children }: { title?: string; children: ReactNode }) {
  return <div className={styles.empty}><BarChart3 size={28} aria-hidden="true" /><strong>{title}</strong><p>{children}</p></div>;
}
function Breakdown({ items, emptyText, transform = (label: string) => label }: { items: AnalyticsBreakdown[]; emptyText: string; transform?: (label: string) => string }) {
  const maximum = Math.max(1, ...items.map(item => item.count));
  return items.length ? <div className={styles.breakdown}>{items.slice(0, 8).map(item => <div key={item.label} className={styles.breakdownRow}><div className={styles.breakdownLine}><span>{transform(item.label)}</span><strong>{count(item.count)}</strong></div><div className={styles.barTrack} aria-hidden="true"><span style={{ width: `${Math.max(1, item.count / maximum * 100)}%` }} /></div></div>)}</div> : <Empty>{emptyText}</Empty>;
}
function Trend({ data }: { data: AdminOverview["trend"] }) {
  if (!data.some(day => day.pageviews || day.activeUsers || day.sessions)) return <Empty title="Your traffic story starts here">Visits and signed-in activity will appear as people use the site.</Empty>;
  const max = Math.max(1, ...data.flatMap(day => [day.pageviews, day.activeUsers]));
  const top = Math.max(1, Math.ceil(max / 4) * 4);
  const x = (index: number) => 42 + index / Math.max(1, data.length - 1) * 650;
  const y = (value: number) => 188 - value / top * 166;
  const line = (field: "pageviews" | "activeUsers") => data.map((day, index) => `${x(index)},${y(day[field])}`).join(" ");
  const shortDate = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return <><div className={styles.legend}><span><i />Page views</span><span><i />Signed-in users</span></div><svg className={styles.chart} viewBox="0 0 716 212" role="img" aria-label={`Daily page views and signed-in users from ${data[0].date} to ${data[data.length - 1].date}. Exact figures are available in the daily data table below.`}>
    {[0, 1, 2, 3, 4].map(step => <g key={step}><line x1="42" x2="692" y1={y(step * top / 4)} y2={y(step * top / 4)} stroke="#e5ecdf" strokeDasharray={step ? "3 5" : undefined} /><text x="30" y={y(step * top / 4) + 4} textAnchor="end" fill="#768772" fontSize="11">{count(step * top / 4)}</text></g>)}
    <polyline points={line("pageviews")} fill="none" stroke="#1c6546" strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round" />
    <polyline points={line("activeUsers")} fill="none" stroke="#9bbf5d" strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round" />
    {data.map((day, index) => <g key={day.date}><circle cx={x(index)} cy={y(day.pageviews)} r={data.length <= 7 ? 3.5 : 2} fill="#1c6546"><title>{day.date}: {day.pageviews} page views, {day.activeUsers} signed-in users</title></circle></g>)}
  </svg><div className={styles.chartLabels}><span>{shortDate(data[0].date)}</span><span>Daily totals · UTC</span><span>{shortDate(data[data.length - 1].date)}</span></div><details className={styles.chartData}><summary>View daily data</summary><div className={styles.tableWrap}><table className={styles.table}><caption className={styles.srOnly}>Daily site activity</caption><thead><tr><th scope="col">Date (UTC)</th><th scope="col">Page views</th><th scope="col">Signed-in users</th><th scope="col">Sessions</th></tr></thead><tbody>{data.map(day => <tr key={day.date}><td>{day.date}</td><td>{count(day.pageviews)}</td><td>{count(day.activeUsers)}</td><td>{count(day.sessions)}</td></tr>)}</tbody></table></div></details></>;
}

async function readResponse<T>(response: Response): Promise<T> {
  const result: unknown = await response.json().catch(() => null);
  const serverMessage = result && typeof result === "object" && "error" in result && typeof result.error === "string" ? result.error : null;
  if (!response.ok) throw new Error(response.status === 401 ? "Your session expired. Sign in again to view the admin portal." : response.status === 403 ? "This account no longer has access to this information." : serverMessage || "This information could not be loaded. Please try again.");
  return result as T;
}

export default function AdminDashboard({ viewer }: { viewer: Viewer }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [days, setDays] = useState<AnalyticsRange>(30);
  const [data, setData] = useState<AdminOverview | null>(null);
  const [access, setAccess] = useState<AccessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessLoading, setAccessLoading] = useState(viewer.role === "owner");
  const [error, setError] = useState("");
  const [accessError, setAccessError] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [message, setMessage] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const confirmHeading = useRef<HTMLHeadingElement>(null);
  const isOwner = viewer.role === "owner" && (!data || data.viewer.role === "owner");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const params = new URLSearchParams({ days: String(days), search, page: String(page) });
    fetch(`/api/admin/overview?${params}`, { signal: controller.signal, cache: "no-store", headers: { "X-Harness-Account": viewer.userId } })
      .then(response => readResponse<AdminOverview>(response))
      .then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(cause => { if (!controller.signal.aborted) { setData(null); setAccess(null); setPending(null); setError(cause instanceof Error ? cause.message : "The dashboard could not be loaded."); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [days, search, page, refresh, viewer.userId]);

  useEffect(() => {
    if (viewer.role !== "owner") return;
    const controller = new AbortController();
    setAccessLoading(true); setAccessError("");
    fetch("/api/admin/members", { signal: controller.signal, cache: "no-store", headers: { "X-Harness-Account": viewer.userId } })
      .then(response => readResponse<AccessData>(response))
      .then(value => { if (!controller.signal.aborted) setAccess(value); })
      .catch(cause => { if (!controller.signal.aborted) { setAccess(null); setAccessError(cause instanceof Error ? cause.message : "Admin access could not be loaded."); } })
      .finally(() => { if (!controller.signal.aborted) setAccessLoading(false); });
    return () => controller.abort();
  }, [refresh, viewer.userId, viewer.role]);

  useEffect(() => { if (pending) confirmHeading.current?.focus(); }, [pending]);

  function changeTab(next: Tab) { setTab(next); setPending(null); setMutationError(""); setMessage(""); }
  function navigateTabs(event: KeyboardEvent<HTMLDivElement>) {
    const tabs: Tab[] = isOwner ? ["overview", "users", "access"] : ["overview", "users"];
    const current = tabs.indexOf(tab);
    const next = event.key === "ArrowRight" ? tabs[(current + 1) % tabs.length] : event.key === "ArrowLeft" ? tabs[(current - 1 + tabs.length) % tabs.length] : event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[tabs.length - 1] : null;
    if (!next) return;
    event.preventDefault(); changeTab(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`#admin-${next}-tab`)?.focus();
  }
  function beginAction(action: PendingAction) { setPending(action); setMutationError(""); setMessage(""); }
  async function applyAccessChange() {
    if (!pending || mutating || !isOwner) return;
    setMutating(true); setMutationError("");
    try {
      await readResponse(await fetch("/api/admin/members", { method: "POST", headers: { "Content-Type": "application/json", "X-Harness-Account": viewer.userId }, body: JSON.stringify({ action: pending.action, userId: pending.userId }) }));
      setMessage(pending.action === "grant" ? `Admin access granted to ${pending.email}.` : `Admin access removed for ${pending.email}.`);
      setPending(null); setRefresh(value => value + 1);
    } catch (cause) { setMutationError(cause instanceof Error ? cause.message : "The access change could not be saved."); }
    finally { setMutating(false); }
  }
  function searchUsers(event: FormEvent) { event.preventDefault(); setSearch(query.trim()); setPage(1); }
  function findUser() { changeTab("users"); requestAnimationFrame(() => searchInput.current?.focus()); }
  const initials = viewer.displayName.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase() || "A";
  const totalPages = data ? Math.max(1, Math.ceil(data.users.total / data.users.pageSize)) : 1;
  const knownMembers = new Set(access?.members.map(member => member.userId) ?? []);

  return <div className={styles.portal}>
    <header className={styles.header}><div className={styles.headerTop}><a href="/workspace" className={styles.brand} aria-label="Harness Law workspace"><BrandLogo inverse /></a><div className={styles.headerActions}><div className={styles.identity}><span className={styles.avatar} aria-hidden="true">{initials}</span><span className={styles.identityText}><strong>{viewer.displayName}</strong><small>{isOwner ? "Site owner" : "Administrator"}</small></span></div><a className={styles.backLink} href="/workspace"><LayoutDashboard size={16} aria-hidden="true" />My workspace</a></div></div><div className={styles.headerIntro}><div><span className={styles.eyebrow}>ADMIN PORTAL</span><h1>A clearer view of your site.</h1><p>Understand your audience, follow activity, and manage who has access.</p></div><span className={styles.accessBadge}><LockKeyhole size={14} aria-hidden="true" />Restricted access</span></div><div className={styles.tabs} role="tablist" aria-label="Admin portal sections" onKeyDown={navigateTabs}><button id="admin-overview-tab" type="button" role="tab" tabIndex={tab === "overview" ? 0 : -1} aria-selected={tab === "overview"} aria-controls="admin-panel" onClick={() => changeTab("overview")}><BarChart3 size={17} aria-hidden="true" />Overview</button><button id="admin-users-tab" type="button" role="tab" tabIndex={tab === "users" ? 0 : -1} aria-selected={tab === "users"} aria-controls="admin-panel" onClick={() => changeTab("users")}><UsersRound size={17} aria-hidden="true" />Users</button>{isOwner && <button id="admin-access-tab" type="button" role="tab" tabIndex={tab === "access" ? 0 : -1} aria-selected={tab === "access"} aria-controls="admin-panel" onClick={() => changeTab("access")}><ShieldCheck size={17} aria-hidden="true" />Access</button>}</div></header>
    <main className={styles.main}>
      <div className={styles.toolbar}><div className={styles.toolbarStart}><label htmlFor="admin-range">Reporting period</label><span className={styles.selectWrap}><select id="admin-range" value={days} onChange={event => { setDays(Number(event.target.value) as AnalyticsRange); setPage(1); }}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select><ChevronDown size={15} aria-hidden="true" /></span></div><div className={styles.toolbarEnd}><span className={styles.freshness}>{data ? `Updated ${new Date(data.generatedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : "Live site data"}</span><button type="button" className={styles.button} disabled={loading || mutating} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={15} className={loading ? styles.spin : undefined} aria-hidden="true" />Refresh</button></div></div>
      {error && <div className={`${styles.notice} ${styles.noticeError}`} role="alert"><AlertCircle size={20} aria-hidden="true" /><div><strong>Unable to load the portal</strong><p>{error}</p><button className={styles.button} onClick={() => setRefresh(value => value + 1)}>Try again</button> <a className={styles.button} href="/signin">Sign in</a></div></div>}
      {loading && !data && !error && <div className={styles.loading} role="status"><Loader2 size={22} className={styles.spin} aria-hidden="true" />Loading your site activity…</div>}
      {data && <div id="admin-panel" role="tabpanel" aria-labelledby={`admin-${tab}-tab`} aria-busy={loading}>
        {message && <div className={styles.success} role="status"><CheckCircle2 size={18} aria-hidden="true" />{message}</div>}
        {pending && isOwner && <section className={styles.confirm} aria-labelledby="admin-confirm-title"><h3 id="admin-confirm-title" ref={confirmHeading} tabIndex={-1}>{pending.action === "grant" ? "Grant admin access?" : "Remove admin access?"}</h3><p><strong>{pending.displayName}</strong> · {pending.email} · {providerName(pending.provider)}</p><p>{pending.action === "grant" ? "This account will be able to view site analytics and the user directory. Only you, the owner, can manage administrators. Applicant documents and case contents are not available in this portal." : "This account will lose access to the admin portal immediately. Its personal workspace will remain available."}</p>{mutationError && <p role="alert">{mutationError}</p>}<div className={styles.confirmActions}><button className={`${styles.button} ${pending.action === "grant" ? styles.primary : styles.danger}`} disabled={mutating} onClick={() => void applyAccessChange()}>{mutating && <Loader2 size={15} className={styles.spin} aria-hidden="true" />}{pending.action === "grant" ? "Grant admin access" : "Remove admin access"}</button><button className={styles.button} disabled={mutating} onClick={() => setPending(null)}>Cancel</button></div></section>}
        {tab === "overview" && <>
          {!data.trackingSince && <div className={styles.notice}><Activity size={20} aria-hidden="true" /><div><strong>Ready to collect your first activity</strong><p>Analytics begins with new visits. Earlier traffic and sign-ins are not reconstructed.</p></div></div>}
          <section className={styles.stats} aria-label="Site statistics">
            {[
              { label: "Active now", value: data.metrics.activeNow, note: "Signed in · last 5 minutes", icon: Activity },
              { label: "Total users", value: data.metrics.totalUsers, note: "Observed since tracking began", icon: UsersRound },
              { label: "Active users", value: data.metrics.activeUsers, note: `Signed in · last ${days} days`, icon: UsersRound },
              { label: "New users", value: data.metrics.newUsers, note: `First seen · last ${days} days`, icon: UserPlus },
              { label: "Signed-in sessions", value: data.metrics.sessions, note: `Last ${days} days`, icon: Clock3 },
              { label: "Page views", value: data.metrics.pageviews, note: `All observed visits · last ${days} days`, icon: Eye },
            ].map(metric => <article className={styles.stat} key={metric.label}><div className={styles.statTop}><span>{metric.label}</span><metric.icon size={19} aria-hidden="true" /></div><div className={styles.statValue}>{count(metric.value)}</div><p>{metric.note}</p></article>)}
          </section>
          <div className={styles.grid}><section className={styles.panel}><div className={styles.panelHeader}><div><h2>Activity over time</h2><p>Page views and signed-in users, day by day.</p></div><Activity size={20} aria-hidden="true" /></div><div className={styles.panelBody}><Trend data={data.trend} /></div></section><section className={styles.panel}><div className={styles.panelHeader}><div><h2>Where people sign in from</h2><p>Approximate location of signed-in sessions.</p></div><MapPin size={20} aria-hidden="true" /></div><div className={styles.panelBody}><Breakdown items={data.locations.map(item => ({ label: locationText(item), count: item.count }))} emptyText="Locations will appear after signed-in activity is recorded." /><p className={styles.smallNote}>Locations come from the hosting network. VPNs and network routing can affect accuracy; unavailable locations are shown as Unknown.</p></div></section></div>
          <div className={styles.thirds}><section className={styles.panel}><div className={styles.panelHeader}><div><h2>Popular pages</h2><p>Page views in this period.</p></div><LayoutDashboard size={19} aria-hidden="true" /></div><div className={styles.panelBody}><Breakdown items={data.pages} transform={pageName} emptyText="Page activity will appear here." /></div></section><section className={styles.panel}><div className={styles.panelHeader}><div><h2>Devices & browsers</h2><p>How visitors connect.</p></div><Monitor size={19} aria-hidden="true" /></div><div className={styles.panelBody}><Breakdown items={data.devices} emptyText="Device information will appear with site activity." />{data.browsers.length > 0 && <p className={styles.smallNote}>{data.browsers.slice(0, 4).map(item => `${item.label}: ${count(item.count)}`).join(" · ")}</p>}</div></section><section className={styles.panel}><div className={styles.panelHeader}><div><h2>Traffic sources</h2><p>Referring domains for page views.</p></div><Globe2 size={19} aria-hidden="true" /></div><div className={styles.panelBody}><Breakdown items={data.referrers} transform={label => label === "direct" || !label ? "Direct / unknown" : label} emptyText="Referring domains will appear as traffic arrives." /><p className={styles.smallNote}>Only the domain is recorded; URL paths and query strings are excluded.</p></div></section></div>
          <section className={styles.panel}><div className={styles.panelHeader}><div><h2>Recent signed-in sessions</h2><p>A new session starts after at least 30 minutes without observed activity.</p></div><Clock3 size={20} aria-hidden="true" /></div>{data.sessions.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className={styles.srOnly}>Recent signed-in sessions during the selected period</caption><thead><tr><th scope="col">User</th><th scope="col">Started</th><th scope="col">Approximate location</th><th scope="col">Device</th><th scope="col">Sign-in provider</th></tr></thead><tbody>{data.sessions.map(session => <tr key={session.id}><td className={styles.userCell}><strong>{session.displayName}</strong><small>{session.email}</small></td><td className={styles.nowrap}>{dateTime(session.createdAt)}</td><td>{locationText(session)}</td><td>{session.device}<small>{session.browser}</small></td><td>{providerName(session.provider)}</td></tr>)}</tbody></table></div> : <Empty title="No signed-in sessions in this period">Authenticated activity will be listed here as people use their workspaces.</Empty>}</section>
        </>}
        {tab === "users" && <>
          <div className={styles.sectionHeading}><div><h2>Your user directory</h2><p>Accounts observed on the site since tracking began. Separate sign-in providers may represent separate accounts.</p></div><span className={styles.pill}>{count(data.users.total)} {search ? "matches" : "users"}</span></div>
          <form className={styles.search} onSubmit={searchUsers}><div className={styles.searchField}><Search size={17} aria-hidden="true" /><label className={styles.srOnly} htmlFor="admin-user-search">Search users by name or email</label><input ref={searchInput} id="admin-user-search" type="search" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} placeholder="Search by name or email" /></div><button className={styles.button} type="submit" disabled={loading}>Search</button>{search && <button className={styles.button} type="button" onClick={() => { setQuery(""); setSearch(""); setPage(1); }}>Clear</button>}</form>
          {isOwner && accessError && <div className={`${styles.notice} ${styles.noticeError}`} role="alert"><AlertCircle size={18} aria-hidden="true" /><p>{accessError} Admin access changes are unavailable until this is resolved.</p></div>}
          <section className={styles.panel}>{data.users.items.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className={styles.srOnly}>User accounts and last observed activity</caption><thead><tr><th scope="col">User</th><th scope="col">First seen</th><th scope="col">Last active</th><th scope="col">Last location</th><th scope="col">Access</th>{isOwner && <th scope="col">Manage</th>}</tr></thead><tbody>{data.users.items.map(user => <tr key={user.userId}><td className={styles.userCell}><strong>{user.displayName}</strong><small>{user.email}</small><small>{providerName(user.provider)}</small></td><td className={styles.nowrap}>{dateOnly(user.firstSeen)}</td><td className={styles.nowrap}>{dateTime(user.lastSeen)}</td><td>{locationText(user)}</td><td>{user.role ? <span className={`${styles.pill} ${user.role === "owner" ? styles.ownerPill : ""}`}>{user.role === "owner" ? "Owner" : "Admin"}</span> : "Member"}</td>{isOwner && <td>{user.role === "owner" || user.userId === viewer.userId ? <span className={styles.smallNote}>Owner access</span> : knownMembers.has(user.userId) || user.role === "admin" ? <button className={`${styles.button} ${styles.danger}`} disabled={mutating || !access || accessLoading} onClick={() => beginAction({ action: "revoke", ...user })}>Remove admin</button> : <button className={styles.button} disabled={mutating || !access || accessLoading} onClick={() => beginAction({ action: "grant", ...user })}><UserPlus size={15} aria-hidden="true" />Add admin</button>}</td>}</tr>)}</tbody></table></div> : <Empty title={search ? "No matching users" : "No users observed yet"}>{search ? "Try another name or email address." : "People appear here after using the site while signed in."}</Empty>}<div className={styles.pagination}><span>{data.users.total ? `${count((data.users.page - 1) * data.users.pageSize + 1)}–${count(Math.min(data.users.page * data.users.pageSize, data.users.total))} of ${count(data.users.total)}` : "0 users"}</span><div className={styles.paginationActions}><button className={styles.button} aria-label="Previous users page" disabled={loading || data.users.page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}><ChevronLeft size={16} aria-hidden="true" /></button><span>Page {data.users.page} of {totalPages}</span><button className={styles.button} aria-label="Next users page" disabled={loading || data.users.page >= totalPages} onClick={() => setPage(value => value + 1)}><ChevronRight size={16} aria-hidden="true" /></button></div></div></section>
        </>}
        {tab === "access" && isOwner && <>
          <div className={styles.sectionHeading}><div><h2>People with admin access</h2><p>You control who can view site analytics and the user directory. Only the owner can add or remove administrators.</p></div><button className={`${styles.button} ${styles.primary}`} onClick={findUser}><UserPlus size={16} aria-hidden="true" />Find a user to add</button></div>
          {accessError && <div className={`${styles.notice} ${styles.noticeError}`} role="alert"><AlertCircle size={20} aria-hidden="true" /><div><strong>Unable to load admin access</strong><p>{accessError}</p><button className={styles.button} onClick={() => setRefresh(value => value + 1)}>Try again</button></div></div>}
          {accessLoading && !access && <div className={styles.loading} role="status"><Loader2 size={22} className={styles.spin} aria-hidden="true" />Loading admin access…</div>}
          {access && <div className={styles.stack}><section className={styles.panel}><div className={styles.accessInfo}><ShieldCheck size={20} aria-hidden="true" /><p>Add someone after they have signed in and appeared in the user directory. Access is tied to their verified account. Your owner access is protected.</p></div><div className={styles.tableWrap}><table className={styles.table}><caption className={styles.srOnly}>Authorized administrators</caption><thead><tr><th scope="col">Account</th><th scope="col">Role</th><th scope="col">Added</th><th scope="col">Action</th></tr></thead><tbody>{access.members.map(member => <tr key={member.userId}><td className={styles.userCell}><strong>{member.displayName}</strong><small>{member.email}</small><small>{providerName(member.provider)}</small></td><td><span className={`${styles.pill} ${member.role === "owner" ? styles.ownerPill : ""}`}>{member.role === "owner" ? "Owner" : "Admin"}</span></td><td className={styles.nowrap}>{dateOnly(member.createdAt)}</td><td>{member.role === "owner" || member.userId === viewer.userId ? <span className={styles.smallNote}>Protected owner</span> : <button className={`${styles.button} ${styles.danger}`} disabled={mutating} onClick={() => beginAction({ action: "revoke", ...member })}>Remove access</button>}</td></tr>)}</tbody></table></div></section><section className={styles.panel}><div className={styles.panelHeader}><div><h2>Admin access history</h2><p>A record of who changed access and when.</p></div><Clock3 size={20} aria-hidden="true" /></div>{access.audit.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className={styles.srOnly}>Admin permission changes</caption><thead><tr><th scope="col">Change</th><th scope="col">Account</th><th scope="col">Changed by</th><th scope="col">When</th></tr></thead><tbody>{access.audit.map(item => <tr key={item.id}><td>{item.action === "grant" ? "Admin access granted" : item.action === "revoke" ? "Admin access removed" : item.action === "bootstrap" || item.action === "owner_bound" ? "Owner access established" : item.action}</td><td className={styles.userCell}>{item.targetEmail}</td><td className={styles.userCell}>{item.actorEmail}</td><td className={styles.nowrap}>{dateTime(item.createdAt)}</td></tr>)}</tbody></table></div> : <Empty title="No access changes yet">When you add or remove an administrator, the change will be recorded here.</Empty>}</section></div>}
        </>}
      </div>}
      <footer className={styles.footer}><LockKeyhole size={15} aria-hidden="true" /><p>{data?.trackingSince ? `Tracking began ${dateOnly(data.trackingSince)}. ` : "New activity is recorded after analytics is enabled. "}Reports cover up to 90 days; older activity is removed during routine collection. Sessions reflect observed signed-in activity, not a count of authentication attempts. No raw IP addresses, applicant documents, or case contents are shown here.</p></footer>
    </main>
  </div>;
}
