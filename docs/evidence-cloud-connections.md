# Evidence cloud connections

Google Drive and OneDrive connections are read-only sources. Applicants select a folder or their main drive, name the connection, and import selected files into their Harness Law Evidence folder. Every connection has its own account identity, root ID, encrypted credentials, and Evidence folder. A connection does not automatically copy its entire contents. Files are imported individually from the paginated browser; nested folders can be opened before selecting files.

Edits, renames and deletion in Evidence apply to Harness Law copies. The adapters never write to Google Drive or OneDrive. Disconnecting removes the saved connection and its credentials while retaining previously imported evidence. It does not revoke a provider-wide OAuth grant, which could otherwise break another saved connection to the same account. Applicants can also revoke Harness Law from their provider's account permissions.

## Provider setup

Set server secrets through the deployment environment; never put them in browser code or a committed configuration file.

| Variable | Purpose |
| --- | --- |
| `HARNESS_DRIVE_GOOGLE_CLIENT_ID` | Dedicated web OAuth client from the owner's authorized Google Cloud project `harness-law-drive-2026`. |
| `HARNESS_DRIVE_GOOGLE_CLIENT_SECRET` | That client's secret. |
| `HARNESS_DRIVE_GOOGLE_TESTING` | Set to `true` while Google's consent screen is in Testing mode. The provider tile displays that only invited Google accounts can connect. This notice does not change Google's access controls or credential readiness. |
| `HARNESS_DRIVE_MICROSOFT_CLIENT_ID` | Microsoft Entra web application registration. |
| `HARNESS_DRIVE_MICROSOFT_CLIENT_SECRET` | That registration's current client secret. |
| `HARNESS_DRIVE_TOKEN_SECRET` | Random secret of at least 32 characters for server-side AES-GCM encryption. |

The Drive project `harness-law-drive-2026` was selected after the earlier `harness-ai-39545` project could not be accessed. The existing sign-in Google client is deliberately **never a fallback** for Drive. Incomplete configuration disables that provider through `/api/drives/config`. This endpoint exposes availability and explanation, never credentials. Rotating the token encryption secret requires reconnecting existing connections unless a deliberate key migration is added.

Both web applications must register the exact callback `https://harnesslaw.ai/api/drives/callback`. Register other deployed origins separately if they are intentionally supported. Local development can use `http://localhost:<port>/api/drives/callback` with a separately registered redirect and development mode. Callback URLs must match exactly.

For Google, enable the Drive API in the owner's project and configure the consent screen, verified domain, published privacy policy and app identity. The application requests `openid email https://www.googleapis.com/auth/drive.readonly`. Google's `drive.readonly` permission is restricted and covers the account's Drive files: public production use requires the applicable Google verification process. **Choosing a folder in Harness Law creates a server-enforced application boundary; Google does not issue a recursively folder-limited read-only OAuth token.** The narrower `drive.file` scope is not a replacement for arbitrary recursive read-only folder browsing. See [Google Drive scope guidance](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

For Microsoft, create an Entra application with the supported account audience needed by the site (the implemented `common` endpoint supports personal and organizational accounts when the registration allows them). Register a web redirect, create a secret, and configure delegated `Files.Read` and `User.Read` permissions. The request also includes `openid profile offline_access`. Organizational policy may require administrator consent. `Files.Read` is read-only account-level access; Harness Law enforces the selected folder boundary on the server. See [app registration](https://learn.microsoft.com/en-us/graph/auth-register-app-v2), [authorization code flow with PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), and [Drive item children permissions](https://learn.microsoft.com/en-us/graph/api/driveitem-list-children?view=graph-rest-1.0).

The browser starts from the account's main drive. Shared-drive roots, shared-item shortcuts and OneDrive `remoteItem` links are not supported in this release; shortcuts are rejected rather than following them outside the chosen root. This limitation also applies when importing a file. Google Docs, Sheets, Slides and Drawings are exported as PDF. Other files pass through the existing Evidence upload file-type and 20 MiB validation. Provider export limits can be lower.

## iCloud

iCloud uses the device file picker. Choose files from iCloud Drive in Files/Finder, or a locally synchronized iCloud Drive folder on Windows. No persistent iCloud cloud connection is fabricated. Apple's documented [CloudKit JS](https://developer.apple.com/documentation/cloudkitjs) operates on an application's CloudKit containers; it is not an OAuth API for browsing arbitrary files in a user's iCloud Drive. We did not find a documented public arbitrary-iCloud-Drive browsing API. See Apple's [iCloud Drive device access guidance](https://support.apple.com/en-mide/118443).

## API contract

All endpoints require the active app session. UI requests include `X-Harness-Account` to reject stale tabs after an account switch. Writes require the same `Origin` and JSON content type; OAuth callback state is separately bound to the authenticated owner and an HttpOnly browser cookie.

| Endpoint | Request and result |
| --- | --- |
| `GET /api/drives/config` | `{providers:[{id,ready,reason,notice}],icloud:{mode:"device_import"},access:"read_only"}` |
| `POST /api/drives/connect` | `{provider,returnTo}` → `{authorizationUrl}`. Only `/evidence-setup` and `/workspace?view=evidence` return destinations are supported. |
| `GET /api/drives/callback` | Provider callback consumes one-use state, exchanges the code with PKCE, creates a pending connection, and redirects with `driveConnection` or `driveError`. |
| `GET /api/drives` | `{drives}` containing public connection metadata. |
| `GET /api/drives/browse?connectionId=...&folderId=...&cursor=...` | `{connectionId,folderId,items,nextCursor,root:{id,name}}`. Omit folder ID for the connection root; omit cursor for page one. |
| `POST /api/drives` | `{connectionId,displayName,scope,rootId,caseId,expectedRevision}` finalizes a pending connection. A `whole_drive` selection uses its provider root. Returns `{drives,state,revision}`. |
| `PATCH /api/drives` | `{id,displayName,caseId,expectedRevision}` renames the connection and its Evidence folder in the same compare-and-swap. Returns `{drives,state,revision}`. |
| `DELETE /api/drives?id=...` | Deletes the connection only; returns `{drives}`. Imported files and their Evidence folder remain. |
| `POST /api/drives/import` | `{connectionId,fileId,caseId,expectedRevision,uploadId}`. `uploadId` is a client-generated UUID retained on retries. Returns the normal Evidence upload result (`document,state,revision`), including its conflict or validation response. |

Public connections contain `id`, `provider`, `displayName`, `scope`, `rootId`, `rootName`, `accountLabel`, `status`, `caseId`, `evidenceFolderId`, `createdAt`, and `updatedAt`. Status is `pending`, `connected`, or `reconnect_required`. Pending selection expires after 30 minutes. Connection names use the existing Evidence folder rules: at most 80 characters, no slashes/control characters, and a unique name among sibling folders.

An OAuth callback does not create a case folder until the applicant chooses the location and name. Saving performs a transaction guarded by both the case revision and connection state. The Evidence folder is marked `origin:"external"` with its `connectionId`. Cloud imports always target that saved folder and use provider-reported metadata; caller-provided names, paths or destination folders do not grant access.

Case-related conflict responses include the current authenticated owner's `state` and `revision` when available, allowing the workspace to show its existing saved-version comparison flow. Errors retain their HTTP status plus `error`, `code`, and `needsReauth` fields.

The import adapter invokes `handleEvidenceUpload` in-process. Therefore upload ownership, content checks, quarantine state, object identity, CAS, idempotency, and S3/R2 routing are shared with device uploads. Importing multiple files must proceed sequentially with the returned revision. A retry after success returns the existing upload. If the remote file's bytes changed between attempts, the existing upload identity rejects conflicting content instead of overwriting it.

## Security and verification

OAuth uses a 10-minute one-use state, a browser nonce cookie, PKCE S256, and server-side authorization-code exchange. Tokens never go to the browser and are encrypted with owner/connection identity as authenticated data. Expired access tokens refresh only their own connection; unavailable or revoked authorization requires reconnecting. The legacy browser bearer-token endpoint returns HTTP 410.

Browse and import resolve provider IDs server-side and walk ancestry to the saved root. Cycles, shortcuts, other drives, malformed IDs and escaped roots fail closed. File downloads recheck ancestry before saving. Paging cursors are encrypted and bound to owner, connection, root and current folder. Provider pagination URLs are never accepted from a caller. Network origins are fixed, provider bodies are bounded, and signed OneDrive download redirects receive no OAuth Authorization header.

`tests/drive-connections.test.ts` exercises these boundaries with injected providers, plus a real in-process Evidence upload handler for import retries. No live provider consent or applicant files are used in tests. Provider credentials, real consent/verification, and a live connection test remain deployment setup tasks; successful mocked tests do not assert that a provider's project has been configured.
