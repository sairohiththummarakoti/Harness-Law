# Evidence object storage

The ordinary Evidence upload route and cloud imports share `handleEvidenceUpload`. The server validates the account, same-origin request, saved case revision, consent, file limits, replacement identity and destination folder before reserving an object. Imports must provide a server-verified file and folder to this same entry point; they must not directly insert object rows or trust client S3 paths.

## New uploads

When the existing `HARNESS_S3_BUCKET`, `HARNESS_S3_REGION`, `HARNESS_S3_ACCESS_KEY_ID` and `HARNESS_S3_SECRET_ACCESS_KEY` bindings are configured, new originals use the existing Signature V4 S3 adapter. `HARNESS_S3_SESSION_TOKEN` is optional. Bucket versioning remains required. Missing or invalid partial S3 configuration fails closed rather than silently placing new files in R2. No bucket, policy, or credential is provisioned by this code.

An example physical key is:

```text
users/{owner-sha256}/{folder-name-slug}/files/{case-and-folder-sha256}/{upload-identity}-{filename-slug}
```

The root destination uses `Evidence` as the folder label. Unicode names retain their original display names in the database; only operator-friendly storage slugs are normalized. Owner hashes avoid exposing provider IDs or emails. Folder and upload hashes prevent collisions even when different folders or cases have identical names. A deterministic upload ID is reserved before an immutable conditional PUT, so retrying a file does not overwrite another object.

The database stores the locator with an `s3:` prefix to distinguish the backend. This prefix is not part of the physical S3 key. The private metadata records `storageBackend`, `storageVersion`, all known `storageVersions`, and `storageDeletedVersions`. These fields and the content hash are stripped from the public Evidence response. No schema migration is needed: the existing `metadata_json` and durable deletion key lists retain this information.

## Existing files and deletion

- Existing unprefixed `quarantine/...` objects continue to use R2 even when S3 is enabled.
- Explicit S3 metadata uses the recorded S3 version. Missing S3 configuration cannot redirect that read or deletion to R2.
- The retired Drive importer produced unmarked `users/...` objects. For this known legacy namespace only, the adapter checks R2 first, then S3 if R2 has no object. The discovered backend and S3 version are persisted. Access errors never trigger a fallback. Ambiguous or unknown locators fail closed.
- S3 reads verify SHA-256 and enforce the Evidence limit of 20 MB while reading the response, before allocating the completed body. All downloads remain private attachment responses.
- Deletion removes exact S3 versions, not merely delete markers. Source replacement retains previous object registrations, so deleting a file or folder removes both its old R2 originals and new S3 versions.
- Late upload receipts on tombstoned objects atomically reopen deletion jobs. A cleanup job cannot be marked complete while a known S3 version lacks a successful deletion receipt. Each late writer also attempts removal of its own returned version. Failed cleanup remains retryable through ordinary workspace loads.

Names and folders in Evidence are logical organization. Renaming a folder, moving a file, or renaming a file does not relocate immutable bytes. The physical key preserves the folder and filename at reservation time; the current display name and location are stored in case metadata. This keeps retries and source references stable.

## Rename API

`PATCH /api/evidence` accepts `{caseId, expectedRevision, objectId, name}` with the same origin and `X-Harness-Account` protections as uploads. Names must retain the original extension and may not contain path or control characters. D1 atomically updates the current object metadata and compares-and-swaps the case; responses return `{document, state, revision}`. Stale edits return a 409 and the latest state. Repeating an already completed rename returns its current result. `uploadOriginalName` preserves the original upload identity so a lost upload response can still be reconciled after a rename.

The adapter is covered by synthetic object-store tests and SQLite-backed D1 transaction tests. Tests do not upload private files or change AWS infrastructure. Existing objects are not bulk-migrated.
