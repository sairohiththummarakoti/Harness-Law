# Harness Law

An applicant workspace for organizing EB-1A evidence, reviewing source-linked criterion sections, and composing an editable working petition. Built from `01_UI_and_User_Experience.docx` version 1.2, dated November 22, 2026. The product name is **Harness Law**.

The sample case uses fictional people, organizations, documents, and claims. It demonstrates the workflow and must not be used as filing material.

## Visitor and setup flow

- `/` is the public talent visa preparation landing page. Its walkthrough and previews describe the implemented **EB-1A** workspace only.
- `/signup` and `/signin` provide focused entry screens. Google Identity Services is available when the owner configures `HARNESS_GOOGLE_CLIENT_ID`; it verifies identity server-side and returns to `/onboarding`. ChatGPT remains available through the real hosted sign-in endpoint; there is no email/password collection or simulated provider login. Signed-in visitors can continue directly.
- `/onboarding` is a saved legal intake: applicant basics, visa interest, birth country, multiple citizenships, professional background, an EB-1A-only ten-criteria dropdown and separate major-award question, then review. Each accepted step saves with revision checks. Existing accounts can open or edit intake without resetting their case. Non-EB-1A interests finish at a saved intake summary; full preparation tools remain EB-1A-only.
- `/workspace` opens a signed-in applicant's saved case and last page. Anonymous visitors see the fictional sample, and `/workspace?sample=1` always opens an isolated fictional sample, including when signed in.

Intake uses an optional, versioned `intake` object in existing case JSON; no database migration is needed. Birth country and citizenships are separate from the existing profile country. Completion updates the applicant name, phone, field and role, and can seed criteria into an empty EB-1A workspace. Existing criterion selections, documents and evidence remain intact. Self-reported selections never determine eligibility or grant consent. Changed profile facts require confirmation again.

The legacy `onboarding` object remains supported. The workspace links to the new intake for existing applicants. Country pickers include ISO country/territory codes, Kosovo, a historical/unlisted birth-country entry and a stateless option. E-1 applicants see the official State Department treaty table link without being screened out by nationality. Account email is shown from authenticated identity; no marketing or SMS consent is fabricated.

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
