# Harness Law

An applicant workspace for organizing EB-1A evidence, reviewing source-linked criterion sections, and composing an editable working petition. Built from `01_UI_and_User_Experience.docx` version 1.2, dated November 22, 2026. The product name is **Harness Law**.

The sample case uses fictional people, organizations, documents, and claims. It demonstrates the workflow and must not be used as filing material.

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

Domain tests cover revision handling and the evidence-to-composition rules. The user interface additionally needs browser testing for keyboard navigation, responsive layouts, save recovery, file upload, and citation focus restoration.

## Data and access

Hosted access is private to the Site owner. Application API routes require an authenticated user and key stored case data by that identity. D1 stores the case and revision; R2 holds quarantined uploads. Saves use optimistic concurrency to report a conflict rather than silently replacing another revision. The sample can be explored without submitting personal information.

Uploads require explicit processing consent and have a 20 MB per-file limit. Uploaded files remain quarantined with a **Needs attention** status. They cannot be used as extracted evidence or previewed by the application while malware scanning and extraction are unavailable.

## Service integration boundaries

This is a working preparation MVP, not a production filing system. Only the UI/UX specification was provided; the five referenced specifications and production providers were not supplied. The interface exposes these boundaries rather than reporting simulated production success:

- Malware scanning, OCR, and structured extraction are not connected. Sample passages are fictional fixtures.
- Sample criterion runs are deterministic demonstrations. Production AI modules and an approved, versioned rule registry are not connected.
- Form fields and a preparation preview are available; an official form template and versioned field mapping need integration and validation.
- Working drafts can be downloaded. Final filing-package assembly, exact-byte approval, and government submission are not implemented; finalization remains blocked.
- Attorney engagement, sharing, invitations, and review permissions are not enabled. Attorney review is optional in the requirements, not a universal filing gate.
- Hosted authentication uses ChatGPT sign-in. A separate email/password registration, recovery, and verification service is not included.

Criterion execution status, evidence support, human review, and composition readiness are independent. None expresses an immigration eligibility conclusion or approval probability. The application links to the maintained [USCIS extraordinary ability guidance](https://www.uscis.gov/policy-manual/volume-6-part-f-chapter-2).

## Code structure

- `app/workspace.tsx`: applicant screens and interactions.
- `app/globals.css`: responsive visual system.
- `lib/model.ts`: typed case state, actions, dependencies, and review rules.
- `app/api/`: authenticated persistence and quarantine upload endpoints.
- `db/schema.ts` and `drizzle/`: database schema and migrations.
- `tests/`: regression tests for domain invariants.
- `.openai/hosting.json`: Site identity and D1/R2 bindings.

The maintained Vinext/Cloudflare runtime in `scripts/` and `worker/` provides the development and deployment foundation. Do not commit local runtime state, evidence bytes, credentials, or `.env` files.
