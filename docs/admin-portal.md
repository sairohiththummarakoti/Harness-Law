# Admin portal

The `/admin` page and both `/api/admin/*` handlers require authenticated, server-authorized admin access. The public site audience stays unchanged. No admin endpoint returns case JSON or evidence contents.

## Owner and additional admins

Set `HARNESS_ADMIN_OWNER_EMAIL` in Sites runtime settings, then deploy the saved version to apply it. The first authenticated identity matching this configured email binds the singleton owner to its verified provider and stable user ID. An arbitrary first visitor cannot claim ownership. Subsequent access uses that identity, not an editable email or name. There is no default owner, production development bypass, or client-supplied role.

The owner sees an Admin portal link in the workspace Account section. On the portal Users tab, the owner can grant access to a user already recorded after signing in. The Access tab lists grants and supports revocation. Grant and revoke changes are atomic with their audit entries. The owner cannot be removed through this API. Additional admins can read analytics but cannot manage admins. Every API request rechecks authorization; a hidden link is not the boundary.

The initial binding is provider-specific. Signing in using a second provider does not automatically inherit admin access even if its email matches. Use the original provider to administer access. Owner recovery/rebinding requires an operator-controlled database change; changing the bootstrap environment variable does not transfer ownership.

## Metric definitions

- Total users: authenticated accounts observed since analytics collection began, not a reconstructed historical registration count.
- Active now: accounts seen in the past five minutes.
- Active users: distinct authenticated accounts active in the selected period.
- New users: accounts first observed in the selected period.
- Signed-in sessions: first authenticated activity after at least 30 minutes of inactivity. These are observed visits, not exact identity-provider login transactions or browser counts.
- Page views: accepted allowlisted page events, including anonymous visits. Authenticated repeated views of the same page are throttled. Bots, blockers, and privacy preferences can affect totals.

The dashboard supports 7, 30, and 90 days, daily trends, popular pages, country/region/city breakdowns, browser/device categories, referring hosts, recent sessions, and a paginated user directory. Locations come only from trusted Workers request metadata and are approximate; unavailable locations remain unknown. No raw IP, precise coordinates, full user agent, query string, case answer, or document contents are retained. Referrer hosts are untrusted aggregate traffic labels, never authorization input.

Detailed events have a 90-day query/cleanup horizon. Account first/last-seen metadata and the admin audit are retained. Collection is first-party, uses no advertising cookies, honors DNT/GPC, and is non-blocking for applicant workflows. Refresh analytics from the dashboard; counts are not a live provider-session inventory.

## Local verification

Generate schema migrations with `npm run db:generate`; apply only pending SQL to the local preview DB using the Sites local D1 command. A temporary ignored `.dev.vars` may set the owner email to the existing local mock sign-in account for QA. Never deploy that value. Local owner records are in local D1 only.

Run the admin access and analytics tests, typecheck, the existing auth tests, and the Site build. Check anonymous and ordinary-user denial, owner binding, immediate revocation, cross-origin rejection, immutable owner protection, analytics deduplication and date windows, and responsive UI behavior. Hosted migrations are applied during Sites deployment.
