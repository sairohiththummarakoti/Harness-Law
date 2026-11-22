# Harness Law

An applicant workspace for organizing EB-1A evidence, reviewing source-linked criterion sections, and composing an editable working petition. Built from `01_UI_and_User_Experience.docx` version 1.2, dated November 22, 2026. The product name is **Harness Law**.

The sample case uses fictional people, organizations, documents, and claims. It demonstrates the workflow and must not be used as filing material.

## Visitor and setup flow

- `/` is the public talent visa preparation landing page. Its walkthrough and previews describe the implemented **EB-1A** workspace only.
- `/signup` and `/signin` provide focused entry screens. Google Identity Services is available when the owner configures `HARNESS_GOOGLE_CLIENT_ID`; it verifies identity server-side and returns to `/onboarding`. ChatGPT remains available through the real hosted sign-in endpoint; there is no email/password collection or simulated provider login. Signed-in visitors can continue directly.
- `/onboarding` guides new applicants through professional field and role, a preparation goal, and their full and preferred names. Each accepted step saves through the case API with revision checking. Back navigation and reload retain accepted answers; save failures keep the current answers available to retry. A concurrent save requires reviewing the newer version before continuing.
- `/workspace` opens a signed-in applicant's saved case and last page. Anonymous visitors see the fictional sample, and `/workspace?sample=1` always opens an isolated fictional sample, including when signed in.

Setup completion records an optional, versioned `onboarding` object in the existing case JSON. No database migration is needed. Completion never confirms profile facts, grants processing consent, or records evidence or attorney review. An evidence goal opens the evidence library, a narrative goal opens criteria selection, and a review goal opens final review; the chosen focus is also visible in the workspace.

Completed users and nonempty legacy cases bypass setup. Legacy data is not copied into a fresh case or silently overwritten. An empty personal case is eligible for setup even if it already has a saved revision or navigation history. Existing applicants can continue working without a setup requirement.

## Run locally

Requirements: Node.js 22.13 or later and npm.

```powershell
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_same_leopardon.sql
npm run dev
```

The development server starts on loopback, normally `http://localhost:5173`. The starter's local sign-in establishes a development-only identity; hosted sign-in is handled by Sites. Use the migration filename actually present in `drizzle/` if generating a fresh schema migration. Do not reapply an already applied migration.

## Verification

```powershell
npm run typecheck
npm test
npm run build
```

Domain tests cover revision handling and the evidence-to-composition rules. Setup tests cover backward compatibility, preservation of established cases, accepted-step resumption, goal destinations, strict metadata validation, and the separation of setup from legal-fact confirmation. The user interface additionally needs browser testing for keyboard navigation, responsive layouts, save recovery, file upload, and citation focus restoration.

## Data and access

The hosted application is open to visitors. Google (when configured) or ChatGPT sign-in is required for a personal workspace; application API routes key stored case data by the authenticated identity. Each user has a separate private case. D1 stores the case and revision; R2 holds quarantined uploads. Saves use optimistic concurrency to report a conflict rather than silently replacing another revision. The fictional sample can be explored without signing in or submitting personal information. The source repository remains private.

Uploads require explicit processing consent and have a 20 MB per-file limit. Uploaded files remain quarantined with a **Needs attention** status. They cannot be used as extracted evidence or previewed by the application while malware scanning and extraction are unavailable.

## Service integration boundaries

This is a working preparation MVP. The UI/UX and integration/API specifications have now been implemented at their respective layers. The new authoritative `/v1` backend has versioned upload sessions, processing jobs, criterion execution, citation validation, composition, form mapping and exact-byte packet approval. See [integration setup and release boundaries](docs/integrations.md) and the [OpenAPI contract](docs/openapi.v1.json). The existing workspace continues to use the legacy UI APIs until its controls are migrated; production providers and approved rule/template registries must be activated before personal processing is available.

The interface exposes these current boundaries:

- Malware scanning, OCR, and structured extraction are not connected. Sample passages are fictional fixtures.
- Sample criterion runs are deterministic demonstrations. Production AI modules and an approved, versioned rule registry are not connected.
- Form fields and a preparation preview are available; an official form template and versioned field mapping need integration and validation.
- Working drafts can be downloaded. The `/v1` packet candidate and exact-byte approval API is implemented and tested with synthetic fixtures; live finalization remains blocked until a validated renderer and reviewed templates/rules are configured. Government submission is outside this release.
- Attorney engagement, sharing, invitations, and review permissions are not enabled. Attorney review is optional in the requirements, not a universal filing gate.
- Authentication supports direct Google identity with revocable application sessions plus hosted ChatGPT sign-in. Google activation requires the owner’s public OAuth web client ID. See [Google sign-in setup](docs/google-signin-setup.md). Email/password registration is not included.

Criterion execution status, evidence support, human review, and composition readiness are independent. None expresses an immigration eligibility conclusion or approval probability. The application links to the maintained [USCIS extraordinary ability guidance](https://www.uscis.gov/policy-manual/volume-6-part-f-chapter-2).

## Code structure

- `app/workspace.tsx`: applicant screens and interactions.
- `app/page.tsx`, `app/landing.tsx`: public landing and interactive product walkthrough.
- `app/signup/`, `app/signin/`, `app/onboarding/`, `app/workspace/`: entry, setup, and workspace routes.
- `lib/onboarding.ts`: pure setup transitions, preservation rules, and goal-specific next actions.
- `app/globals.css`: responsive visual system.
- `lib/model.ts`: typed case state, actions, dependencies, and review rules.
- `app/api/`: authenticated persistence and quarantine upload endpoints.
- `app/v1/`, `lib/integrations/`: authoritative versioned APIs, provider adapters and durable job processing.
- `docs/openapi.v1.json`, `docs/integrations.md`: API schemas, setup and production activation requirements.
- `infra/harness-storage.yaml`: private S3 storage and scoped application policy template; no credentials or deployments are created automatically.
- `db/schema.ts` and `drizzle/`: database schema and migrations.
- `tests/`: regression tests for domain invariants.
- `.openai/hosting.json`: Site identity and D1/R2 bindings.

The maintained Vinext/Cloudflare runtime in `scripts/` and `worker/` provides the development and deployment foundation. Do not commit local runtime state, evidence bytes, credentials, or `.env` files.
