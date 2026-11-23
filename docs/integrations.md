# Harness Law integration API

The `/v1` backend implements the versioned preparation workflow from **02_Integrations_and_APIs.docx v1.2**. It uses the shared application identity resolver (hosted ChatGPT sign-in or configured Google sign-in) and Cloudflare D1, with private Amazon S3 or R2 object storage. External processing requires configured, validated providers and approved rule/template registries. Missing providers produce explicit blocked jobs; synthetic test fixtures are never enabled in production.

The existing workspace still uses `/api/case` and `/api/evidence`. Its browser-writable demonstration state is deliberately separate from `/v1` authoritative records. This release delivers the backend and its contracts; migrating workspace controls to these endpoints and activating production providers are separate rollout steps. Existing personal records and quarantined uploads are preserved, not silently imported as trusted evidence.

## API contract

[OpenAPI 3.1 contract](openapi.v1.json) contains the paths and request schemas. Runtime strict validation is in `lib/integrations/domain.ts`; shared record types are in `contracts.ts`. All JSON responses use schema version 1 and a request ID. Errors include `code`, `message`, `request_id`, `retryable`, and applicable `field_errors` or `current_revision`.

Applicant requests use the authenticated application session. Clients can send `X-Harness-Account` with the server-rendered user ID to reject stale requests after switching accounts; this header is a consistency check, not a credential. Mutations require the same `Origin`, a JSON body (except raw upload bytes), and an `Idempotency-Key` of 8–128 allowed characters. Revision-sensitive mutations use `expected_revision` or an exact `If-Match` value. Server-owned status, hashes, owner identity and provenance cannot be supplied as authoritative applicant fields. An inaccessible case or object returns a generic 404. Each account has one authoritative preparation case; `GET /v1/cases` discovers it.

Worker credentials are separate: a short-lived HMAC capability binds one case and job, expires within 15 minutes, and cannot be used to choose another criterion or write another result. Sources and publication recheck both current consent and pinned dependencies. Applicant tokens cannot publish worker results. Hosted deployment must retain the Sites proxy that authenticates and overwrites the identity headers; do not expose a bypass origin trusting caller-provided `oai-authenticated-*` headers.

## Preparation flow

1. `POST /v1/cases` with `processing_consent`; update consent through `PATCH /cases/{id}/consent` using the current case revision. Withdrawal cancels pending/running work and denies worker retrieval and publication.
2. Create confirmed applicant-statement facts with `POST /cases/{id}/facts`; correct them with revision-aware `PATCH /facts/{fact_id}`. Extracted source blocks remain independently inspectable and never become independent evidence merely because an applicant confirms a value.
3. Create an upload session with title, media type, byte count, and SHA-256. Transfer bytes to its authenticated `PUT .../content` grant, then `POST .../confirm`. Renewal retains the original destination and limits. Supported formats are PDF, DOCX, PNG and JPEG, at most 20 MiB per source. The server verifies actual format, stored size and digest; confirmed files remain quarantined until scanning and complete extraction succeed.
4. Create a proposed criterion link, then confirm its exact revision. An approved module, confirmed required facts, accepted extracted sources and confirmed links are required before `POST /criterion-runs` freezes a manifest and queues a run. `POST /draft-jobs` dispatches missing selected modules and creates a composition pinned to the explicitly available results; later results require a new composition.
5. Workers scan before extraction. Source pages, reading order, table cells and raw parser output are stored with exact versions. Nonpaged sources require a pinned PDF rendition. Criterion generation sends only the run's sources/facts and approved configuration through the model gateway. Typed output must cover the configured elements and cite exact authorized blocks and approved authorities.
6. Read exact result revisions and review or edit individual claims. Edits create revisions with `needs_review` and `unreviewed`; historical approvals remain attached to historical content. Composition retains original result identities, unresolved criteria and shared-event review tasks. Case-wide overall-record, continued-work, prospective-benefit and applicable major-award analysis uses separately authorized evidence and its own approved rule version. Applicant-authored analysis is added through `PATCH /compositions/{id}/analysis`, then reviewed through paragraph reviews. This implementation assembles pinned sections deterministically; it does not silently generate case-wide legal conclusions.
7. Form previews map confirmed facts using reviewed official template metadata. Missing fields, invalid dates and overflow stay unresolved. The export worker retrieves the approved template bytes and verifies their digest before rendering. Review all composed material claims, resolve selected-criterion and shared-event tasks, then create an export candidate.
8. Open `GET /exports/{id}/preview`, inspect those exact bytes, and confirm their packet digest and draft revision. Confirmation compares current source/link/fact/rule/result/template dependencies directly, independently of event delivery. The final download serves the pinned approved object version and rechecks its digest. Changes never overwrite historical packets.

Selected result assessments, missing-evidence tasks and contradictions stay frozen in the composition. `PATCH /compositions/{id}/issues` records a revision-scoped applicant disposition and reason; undispositioned issues block final approval. Acknowledging a contradiction preserves the adverse source information in the renderer snapshot. These dispositions are private review metadata and do not certify legal sufficiency or authorize omitting adverse evidence from the petition.

Citation requests specify `result_id` plus `result_revision`, or `composition_id` plus `draft_revision`. Viewer and byte-range requests authorize every request and verify the original source/rendition version. No reusable public storage URL is returned.

## Persistence and workers

The additive `drizzle/0001_integration_cases.sql` migration creates authoritative case heads and payload chunks. State, immutable history, dependency revisions, idempotency receipts and outbox events commit in one D1 transaction. A unique commit token guards every chunk insertion/removal after the head CAS; a zero-row losing CAS cannot leave phantom events. Chunking respects D1's [2 MB value/row limit](https://developers.cloudflare.com/d1/platform/limits/). A case aggregate is bounded to 24 MiB of UTF-8 JSON and 10,000 mutation receipts; reaching capacity fails explicitly rather than discarding replay protection.

Apply only to the intended database after backing up and checking applied migrations. For a fresh local integration database:

```powershell
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_integration_cases.sql
```

Applicant mutations reserve 1 MiB below the aggregate ceiling for worker checkpoints; worker outputs reserve a further 256 KiB for failure recovery. Capacity rejection preserves prior state and stored output intents.

`worker/index.ts` exposes a scheduled handler. Configure a Cloudflare Cron Trigger for the deployed Worker to run it, or invoke a specific job with a signed capability. No production trigger is created by this code change. The helper prints only safe job status, never its bearer token:

```powershell
node --experimental-strip-types scripts/run-integration-job.mts https://your-app.example CASE_ID JOB_ID
```

Set `HARNESS_WORKER_SECRET` through the runtime secret manager (at least 32 random characters) and provide the same secret to the trusted dispatcher. The script does not acquire or persist credentials. Jobs use leases, version-pinned checkpoints, three-attempt budgets, exponential backoff, and a dead-letter event. Duplicate dispatch returns existing state. Provider attempts are recorded without evidence text. Model timeouts with uncertain completion are held for reconciliation rather than automatically initiating another potentially billable call. Explicit retry requires a recorded reason; corrected missing-provider/storage configuration can resume the same job within its budget. Invalid output and unsafe scans remain blocked.

The provider circuit breaker is shared across jobs within an isolate. Durable job budgets provide the bound across isolate restarts. Jobs and their outbox events are committed together; the dispatcher polls durable jobs and marks corresponding events delivered under the same lease acquisition. No external queue or notification transport is implicitly enabled.

## Configuration

All settings are injected server bindings. Never put credentials in source, browser code, query strings, or routine logs. Partial configuration is rejected rather than falling back to a different provider.

| Settings | Purpose |
|---|---|
| `HARNESS_S3_BUCKET`, `HARNESS_S3_REGION`, `HARNESS_S3_ACCESS_KEY_ID`, `HARNESS_S3_SECRET_ACCESS_KEY`, optional `HARNESS_S3_SESSION_TOKEN` | Versioned private S3 with SigV4 signing. Use scoped workload credentials and rotate them through deployment secrets. If no S3 settings exist, the existing R2 binding is used for local development. |
| `HARNESS_SCANNER_URL`, `HARNESS_SCANNER_TOKEN` | Private HTTPS malware scanning adapter. |
| `HARNESS_EXTRACTOR_URL`, `HARNESS_EXTRACTOR_TOKEN` | Private HTTPS parser/OCR adapter, including canonical PDF renditions. |
| `HARNESS_RENDERER_URL`, `HARNESS_RENDERER_TOKEN` | Private HTTPS packet renderer and reference-reconciliation service. |
| `OPENAI_API_KEY`, `HARNESS_MODEL` | Server-side OpenAI Responses gateway using strict structured output and `store:false`. The configured model must match the pinned approved module. |
| `HARNESS_MODULE_REGISTRY` | JSON array of approved C01–C10 module configurations with module/rule/prompt/schema/evaluation versions, activation approval, instructions, required fact keys, required element IDs, and authority references. |
| `HARNESS_CASE_RULE_REGISTRY` | JSON object with reviewed case-wide rule `version`, `approval`, and `authority_refs`. |
| `HARNESS_FORM_REGISTRY` | JSON array of reviewed template versions, source URLs, retrieval dates, SHA-256, approval, edition and deterministic field mappings. |

Approval metadata is a deployment configuration responsibility. No synthetic legal rule pack or official form edition ships active. `store:false` disables API response storage; confirm the account's actual provider retention terms before transmitting real applicant data.

## External service contracts

`provider-contracts.ts` defines Harness Law contracts, not AWS, USCIS or OCR vendor endpoints. The selected provider must supply an adapter conforming to these schemas. Scanner and extractor requests contain `schema_version`, `task_id`, exact document version, SHA-256, media type and base64 bytes. Responses must repeat that scope. Scanner statuses are `clean`, `infected`, or `indeterminate`. Extraction returns complete contiguous physical pages; bounding boxes are normalized `[x_min, y_min, x_max, y_max]`. Failed pages cannot become ready evidence. Raw extraction is stored separately from normalized blocks.

Renderer requests contain a frozen digest, section/case-analysis mappings, claims, grouping decisions, source bytes and verified form templates. Responses contain complete PDF bytes, physical page count, and one formal reference entry per citation. The server independently checks expected claim/source IDs, exhibit uniqueness, source and packet page bounds, readable references, and the packet byte digest. **PDF page-content accuracy and printed-reference rendering must pass real provider conformance fixtures before activating that renderer.** Mock tests validate contracts and application controls; they do not validate an external renderer's pagination implementation.

Current renderer transport supports a maximum of 20 MiB of source input per packet and a bounded PDF response. Larger workloads need a streaming renderer transport with the same immutable reference contract. Readiness, model completion, human review and legal sufficiency remain separate.

## AWS storage preparation

`infra/harness-storage.yaml` defines a private versioned S3 bucket with encryption, public-access blocking, enforced object ownership, TLS-only access and retained evidence versions. Its application policy permits read/write only under the four Harness Law object prefixes; it grants no bucket administration, public sharing, user/key creation or evidence deletion. It may attach to an existing designated role. The stack creates no application access keys.

```powershell
./scripts/plan-storage.ps1 -Region us-east-2 -Profile YOUR_DEPLOYMENT_PROFILE
```

The default creates a reviewable CloudFormation change set without executing it. `-Apply` executes a deployment only when deliberately invoked. Neither mode was run against the user's AWS account during this implementation. Browser sign-in alone does not supply server-side application credentials.

## Verification and release boundaries

Run `npm run typecheck`, `npm test`, and `npm run build`. Integration tests use synthetic evidence and injected providers. They cover ownership denial across routes, idempotency, CAS races and rollback, Unicode chunk storage, interrupted/expired/tampered uploads, provider failures, scan ordering, duplicate delivery, cancellation, uncertain model attempts, criterion isolation, fabricated citations, shared-source invalidation, exact result history, case-wide analysis, event reconciliation, form validation and exact-byte packet approval.

Production activation still requires the user's chosen scanner/OCR/renderer service details, scoped AWS credentials, reviewed rule/template registries, provider conformance tests, migration deployment and a worker schedule. P1 reviewer engagements and notifications remain explicitly unavailable. Government submission is outside this API.
