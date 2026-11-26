import { MAX_FILE_BYTES, safeFilename } from '../validation.ts';
import { assertWithinRoot, downloadItem, DriveError } from './providers.ts';
import { authorizedConnection, connectionFailure, DriveConflictError, driveBody, driveOwner, type DriveDependencies } from './service.ts';
import type { DriveConnection } from './repository.ts';
import { validItemId } from './security.ts';

export interface DriveImportDependencies extends DriveDependencies {
  /** The normal evidence upload handler owns persistence, CAS and retry identity. */
  upload(request: Request): Promise<Response>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleDriveImport(request: Request, deps: DriveImportDependencies): Promise<Response> {
  let connection: DriveConnection | undefined;
  try {
    await driveOwner(request, deps, true);
    const input = await driveBody(request);
    if (!validItemId(input.fileId) || typeof input.uploadId !== 'string' || !UUID.test(input.uploadId) || typeof input.expectedRevision !== 'number' || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision > 2147483647) {
      throw new DriveError('Reload your case and select the file again.', 400, 'invalid_import');
    }
    const { row, tokens, userId } = await authorizedConnection(request, deps, input.connectionId);
    connection = row;
    const state = await deps.repository.caseRead(userId);
    if (!state || state.mode !== 'personal' || state.id !== input.caseId || row.case_id !== state.id || !row.evidence_folder_id) {
      throw new DriveConflictError('This connection belongs to another case.', state, 'case_changed');
    }
    if (!state.folders?.some(folder => folder.id === row.evidence_folder_id && folder.connectionId === row.id)) {
      throw new DriveConflictError('This connection folder was removed. Connect a new location before importing.', state, 'folder_missing');
    }
    if (!state.consent) throw new DriveError('Confirm permission to store your evidence before importing.', 422, 'consent_required');
    const file = await assertWithinRoot(row.provider, tokens.accessToken, input.fileId, row.root_id, row.drive_id, deps.fetch);
    const download = await downloadItem(row.provider, tokens.accessToken, file, MAX_FILE_BYTES, deps.fetch);
    // Recheck after the download: a moved file or disconnected location cannot
    // use stale browser selection to escape the connection's saved boundary.
    await assertWithinRoot(row.provider, tokens.accessToken, file.id, row.root_id, row.drive_id, deps.fetch);
    const current = await deps.repository.get(userId, row.id);
    if (!current || current.status !== 'connected' || current.root_id !== row.root_id || current.case_id !== row.case_id || current.evidence_folder_id !== row.evidence_folder_id) {
      throw new DriveConflictError('This connection changed. Reopen it before importing.', await deps.repository.caseRead(userId), 'connection_changed');
    }
    const name = safeFilename(download.name);
    const form = new FormData();
    form.set('file', new File([download.bytes.buffer as ArrayBuffer], name, { type: /\.pdf$/i.test(name) ? 'application/pdf' : file.mimeType || 'application/octet-stream' }));
    form.set('caseId', state.id);
    form.set('expectedRevision', String(input.expectedRevision));
    form.set('uploadId', input.uploadId);
    form.set('folderId', row.evidence_folder_id);
    const headers = new Headers({ Origin: new URL(request.url).origin, 'X-Harness-Account': userId });
    // This is an in-process handler call, never a network request with tokens.
    return await deps.upload(new Request(new URL('/api/evidence', request.url), { method: 'POST', headers, body: form }));
  } catch (error) { return connectionFailure(error, deps, connection); }
}
