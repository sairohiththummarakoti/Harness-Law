# Google account signup

Harness Law supports direct Google account signup with Google's official Identity Services button. It requests identity only (Google subject, verified email, optional name), never Gmail messages, mailbox permissions, or Google API refresh tokens. Existing ChatGPT sign-in remains available.

## Required owner configuration

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview), and select or create the Harnesslaw project.
2. Complete Branding with the application name and the owner's support/developer contact. Set the application's homepage to `https://harnesslaw.ai`. Use an accurate, owner-approved privacy-policy URL when required for production branding; this integration does not invent a privacy policy or business contact.
3. Choose an External audience for public applicants. Complete Google's applicable production setup before inviting public users; add test users where the Console requires them during development.
4. Under Clients, create an OAuth client with application type **Web application**.
5. Add authorized JavaScript origins exactly, without a trailing slash or path:
   - `https://harnesslaw.ai`
   - `https://harness-law-workspace.sairohith-thummarako.chatgpt.site` if visitors will use the platform URL.
6. Copy the public client ID ending in `.apps.googleusercontent.com`. Set the Site runtime variable `HARNESS_GOOGLE_CLIENT_ID` to that value, then deploy the saved version to apply the runtime configuration.

This integration uses the GIS popup callback, not the OAuth authorization-code flow. No client secret or authorized redirect URI is needed. Do not send or commit a client secret. Use a separate development client with the precise local origin shown by the dev server if testing real Google login locally.

Google UI is enabled only when the runtime client ID is configured. Until then the existing ChatGPT entry remains functional; an unconfigured Google endpoint fails closed. A placeholder client ID must never be configured in production.

## Applicant flow

`/signup` → Continue with Google → Google account chooser → server verification → `/onboarding` → professional field/role → preparation goal → names/review → saved `/workspace`.

Returning Google users are identified by Google's stable subject, not their email address. Completed setup opens their saved workspace. The displayed Google name is an editable setup suggestion, not confirmation of legal facts. An account's email is session/contact data, not a verified immigration fact.

Google and ChatGPT identities have separate workspaces. Matching email addresses do not merge accounts. Existing ChatGPT ownership IDs are unchanged. Explicit switching and logout revoke the Google session; logout also exits the hosted ChatGPT session. Setup and workspace requests include the account displayed in that tab, preventing an old tab from reading or saving under a newly selected account.

## Security and storage

- Google ID tokens are verified using `jose` and Google's rotating public keys: RS256 signature, issuer, configured client audience/authorized party, expiration, issued-at time, verified email, subject, and nonce.
- Sign-in challenges expire after ten minutes and are consumed atomically once. Requests require a same-origin browser context; POST requires same-origin JSON with a bounded body.
- A random opaque session token is stored in an HTTP-only cookie. Production cookies are Secure, host-only, path `/`, SameSite=Lax, and use the `__Host-` prefix. The database stores only the SHA-256 token hash, identity/contact fields, and expiration.
- Sessions expire after 24 hours and are revoked server-side on logout/provider switching. Provider selection persists beyond session expiry to prevent automatic fallback to another signed-in identity. No Google credential is stored in localStorage or logs.
- Development-only cookie names work only on explicit loopback HTTP in development mode. Production does not trust them or caller-supplied identity headers.
- Additive migration `0002_google_signin.sql` creates authentication tables. The earlier authored `0001_integration_cases.sql` and its metadata are retained as a schema-history dependency; this release does not add the versioned processing APIs or activate their providers. Sites applies pending migrations before the Worker deployment. Do not edit an applied migration.

## Verification boundary

Automated checks exercise signed RSA JWTs and negative claims, CSRF, nonce replay, session rotation/revocation/expiry, provider selection, and actual SQLite execution of the migration and repository SQL. They do not establish that the Google Cloud client has been configured correctly.

On November 22, 2026, the isolated release passed typecheck, all 71 tests, and the production build. The official Google button rendered correctly on desktop and at 390 px using a local-only placeholder client ID for layout inspection; that value was removed before the release build and was never configured in production. Existing ChatGPT sign-in, setup saving, logout, and saved-step resumption were exercised in the local browser. Real local API calls confirmed stale-account GET, save, and upload requests return 401 without changing the stored case. Independent security review findings were fixed and rechecked.

Real Google account selection and the complete hosted signup journey must be checked after the owner's client ID is configured. Google consent/account steps are not simulated as successful production authentication.

References: [Google setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid), [JavaScript API](https://developers.google.com/identity/gsi/web/reference/js-reference), [ID-token verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), [branding](https://developers.google.com/identity/branding-guidelines).
