# Password authentication rollout

## Current implementation

Email/password identities use IDs prefixed with `password:` and remain separate from Google and hosted ChatGPT identities. Passwords are stored as PBKDF2-SHA-256 hashes; sessions and one-time email tokens are opaque random values whose hashes are stored in D1. Verification, password-reset, and email-change links expire after ten minutes and are single use. Login, signup, resend, and recovery requests are rate-limited. Cloudflare Turnstile is enforced on public auth POSTs when configured.

The local Vite/Wrangler configuration binds `EMAIL` without `remote: true` and sets `HARNESS_MAIL_MODE=local`. This uses Cloudflare's local simulated delivery. Inspect the local Wrangler output/artifacts for the message; it does not deliver to the recipient's real mailbox. Never add `remote: true` to a developer configuration used with real addresses.

## Local functional test

With `HARNESS_MAIL_MODE=resend-test`, run `npm run dev`, open `/signup`, and register with a disposable address and a password of at least eight characters. The local D1 database stores the account as unverified. Open the development test link shown by the form; the verification page requires an explicit confirmation button. Then test login and logout, `/forgot-password` and `/reset-password`, and `/account` for email change, password change, and account deletion. The email-change link now opens an explicit confirmation page so automated mail scanners cannot change the address merely by fetching the link. Local auth tests use an in-memory D1 database and stub mail delivery; they do not send messages to a mailbox.

## D1 migration

The password-account schema is introduced by `0003_password_accounts.sql`; policy acceptance version columns are added by `0004_account_policy_versions.sql`. Apply both migrations to the intended D1 database after checking its migration history and backing up production data. The Sites deployment must also include them in its normal migration process. Do not reapply already applied migrations.

## Resend testing and delivery

The auth mail adapter supports Resend's REST API directly; selecting it takes precedence over Cloudflare's local `EMAIL` simulator. Create a Resend API key with sending permission. For local development without a verified sending domain, put only the API key in the ignored `.dev.vars` file:

```dotenv
HARNESS_RESEND_API_KEY=re_your_key_here
```

Start the test build with the test mail mode set (`$env:HARNESS_MAIL_MODE='resend-test'; npm run dev` in PowerShell). This selects Resend and defaults the sender to `Harness Law <onboarding@resend.dev>` and the recipient to `delivered@resend.dev`. The app shows a **development-only test link** after signup, resend, forgot-password, or email-change requests so you can complete each flow even though Resend's test recipient does not place the message in a mailbox. Never use this mode in production; the server rejects it outside development. Keep the key out of source control.

Resend documents `POST https://api.resend.com/emails`, bearer authentication, and the `from`, `to`, `subject`, and `text` fields in its [Send Email API](https://resend.com/docs/api-reference/emails/send-email). Its documented test recipient, `delivered@resend.dev`, simulates a delivered event and does not place the message in a mailbox. To test actual delivery to Gmail, Outlook, Yahoo, or another inbox, later verify a sender domain with Resend and set `HARNESS_MAIL_PROVIDER=resend` and `HARNESS_MAIL_FROM` to that sender. See [Resend's test-email addresses](https://resend.com/changelog/sending-test-emails).

For production, set `HARNESS_MAIL_PROVIDER=resend`, set `HARNESS_MAIL_FROM` to an address on the verified sending domain, and store `HARNESS_RESEND_API_KEY` as a Cloudflare Worker secret (for example, `npx wrangler secret put HARNESS_RESEND_API_KEY`). Resend remains swappable: change the provider setting and sender/API credentials without changing signup or authentication code. Cloudflare's `EMAIL` binding remains available as an alternative provider.

## Turnstile

Create a Turnstile widget for the app's test/staging hostname and production hostname. Configure `HARNESS_TURNSTILE_SITE_KEY` as a nonsecret Worker variable and `HARNESS_TURNSTILE_SECRET_KEY` as a Worker secret. Configure both together. Configure `HARNESS_TERMS_VERSION` and `HARNESS_PRIVACY_VERSION` to the exact approved policy versions only after the responsible organization has reviewed and approved the policy text; production signup remains disabled without them. The current Terms and Privacy pages are drafts, not approved legal policies. If the secret is set but the site key is missing, auth forms remain disabled and the server rejects requests. Use Cloudflare's published test keys only in isolated test environments.

## Release blockers

- `/terms` and `/privacy` currently contain drafts. The owner and qualified counsel must approve the final text, effective date, business contact, retention schedule, jurisdiction, and subprocessors before enabling public registration.
- Run the migration in staging and exercise registration, simulated email inspection, link confirmation, expiry/replay, resend throttling, verified and unverified login, reset, email change, password change, account deletion, and both object-storage configurations.
- Account deletion attempts cleanup of legacy R2 uploads and versioned integration storage before removing D1 account/case rows. Validate this against a disposable staging account and storage bucket before production rollout.
- Add monitoring and an operational response for mail failure, Turnstile outage, rate-limit abuse, and partial storage cleanup.
