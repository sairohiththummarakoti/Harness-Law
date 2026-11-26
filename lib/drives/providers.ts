import type { DriveProvider, ProviderConfig } from './config.ts';
import { validItemId } from './security.ts';

export class DriveError extends Error { status: number; code: string; constructor(message: string, status = 502, code = 'drive_unavailable') { super(message); this.status = status; this.code = code; } }
export interface DriveTokens { accessToken: string; refreshToken?: string; expiresAt: number }
export interface DriveItem { id: string; name: string; isFolder: boolean; mimeType: string; size: number; modifiedTime: string | null; parentId: string | null; driveId: string | null; shortcut: boolean }
export interface ProviderIdentity { accountId: string; accountLabel: string; root: DriveItem }
type Fetcher = typeof fetch;
type Data = Record<string, unknown>;
const object = (value: unknown): Data => value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
const optionalString = (value: unknown): string | null => typeof value === 'string' && value.length ? value : null;
const googleBase = 'https://www.googleapis.com/drive/v3/files';
const graphBase = 'https://graph.microsoft.com/v1.0';
const googleFields = 'id,name,mimeType,size,modifiedTime,parents,driveId,shortcutDetails,trashed';
const graphFields = 'id,name,size,folder,file,parentReference,remoteItem,deleted,lastModifiedDateTime';

async function fetchJson(url: string, token: string, fetcher: Fetcher): Promise<Data> {
  const res = await fetcher(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(12_000) });
  if (res.status === 401) throw new DriveError('Reconnect this drive to continue.', 401, 'drive_reconnect_required');
  if (res.status === 403 || res.status === 404) throw new DriveError('This item is no longer accessible.', 403, 'drive_access_denied');
  if (!res.ok) throw new DriveError('The cloud provider could not complete the request.');
  // Provider responses are bounded independently of caller pagination inputs.
  const text = await readLimitedResponse(res, 2 * 1024 * 1024);
  try { const parsed: unknown = JSON.parse(new TextDecoder().decode(text)); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); return parsed as Data; } catch { throw new DriveError('The cloud provider returned an invalid response.'); }
}
export async function readLimitedResponse(response: Response, limit: number): Promise<Uint8Array> {
  const length = response.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > limit) throw new DriveError('This file is too large to import.', 413, 'file_too_large');
  if (!response.body) throw new DriveError('The cloud provider returned an empty response.');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > limit) { await reader.cancel(); throw new DriveError('This file is too large to import.', 413, 'file_too_large'); } chunks.push(part.value); } }
  finally { reader.releaseLock(); }
  const out = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; } return out;
}
function item(provider: DriveProvider, value: Data): DriveItem {
  if (!validItemId(value.id) || typeof value.name !== 'string' || value.trashed || value.deleted) throw new DriveError('This cloud item is not available.', 403, 'drive_access_denied');
  const isGoogle = provider === 'google_drive';
  return { id: value.id, name: value.name.slice(0, 1000), isFolder: isGoogle ? value.mimeType === 'application/vnd.google-apps.folder' : !!value.folder,
    mimeType: isGoogle ? String(value.mimeType || '') : String(object(value.file).mimeType || ''), size: Math.max(0, Number(value.size) || 0), modifiedTime: optionalString(value.modifiedTime) || optionalString(value.lastModifiedDateTime),
    parentId: isGoogle ? (Array.isArray(value.parents) && value.parents.length === 1 ? optionalString(value.parents[0]) : null) : optionalString(object(value.parentReference).id),
    driveId: isGoogle ? optionalString(value.driveId) : optionalString(object(value.parentReference).driveId), shortcut: isGoogle ? !!value.shortcutDetails || value.mimeType === 'application/vnd.google-apps.shortcut' : !!value.remoteItem };
}
function graphItemPath(driveId: string | null, id: string) {
  return driveId ? `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(id)}` : id === 'root' ? '/me/drive/root' : `/me/drive/items/${encodeURIComponent(id)}`;
}
export async function getItem(provider: DriveProvider, token: string, id: string, driveId: string | null = null, fetcher: Fetcher = fetch): Promise<DriveItem> {
  if (!validItemId(id) || (driveId !== null && !validItemId(driveId))) throw new DriveError('Invalid cloud item.', 400, 'invalid_item');
  const url = provider === 'google_drive' ? `${googleBase}/${encodeURIComponent(id)}?fields=${encodeURIComponent(googleFields)}&supportsAllDrives=true` : `${graphBase}${graphItemPath(driveId, id)}?$select=${graphFields}`;
  return item(provider, await fetchJson(url, token, fetcher));
}
export async function providerIdentity(provider: DriveProvider, token: string, fetcher: Fetcher = fetch): Promise<ProviderIdentity> {
  const data = provider === 'google_drive' ? await fetchJson('https://www.googleapis.com/oauth2/v3/userinfo', token, fetcher) : await fetchJson(`${graphBase}/me?$select=id,displayName,mail,userPrincipalName`, token, fetcher);
  const accountId = provider === 'google_drive' ? data.sub : data.id;
  if (typeof accountId !== 'string' || !accountId || accountId.length > 300) throw new DriveError('The connected account could not be verified.');
  const root = await getItem(provider, token, 'root', null, fetcher);
  if (!root.isFolder || root.shortcut || provider === 'onedrive' && !validItemId(root.driveId)) throw new DriveError('The cloud drive could not be verified.');
  return { accountId, accountLabel: String(data.email || data.mail || data.userPrincipalName || data.displayName || 'Connected account').slice(0, 300), root };
}
/** Applies to every browse/import request; client IDs, paths and breadcrumbs never grant access. */
export async function assertWithinRoot(provider: DriveProvider, token: string, id: string, rootId: string, driveId: string | null, fetcher: Fetcher = fetch): Promise<DriveItem> {
  const first = await getItem(provider, token, id, driveId, fetcher); let current = first; const seen = new Set<string>();
  for (let depth = 0; depth < 64; depth++) {
    if (current.shortcut || provider === 'onedrive' && current.driveId !== driveId) throw new DriveError('This item is outside the connected folder.', 403, 'outside_root');
    if (current.id === rootId) return first;
    if (seen.has(current.id) || !current.parentId || !validItemId(current.parentId)) break;
    seen.add(current.id); current = await getItem(provider, token, current.parentId, driveId, fetcher);
  }
  throw new DriveError('This item is outside the connected folder.', 403, 'outside_root');
}
export async function listChildren(provider: DriveProvider, token: string, folderId: string, driveId: string | null, pageToken?: string, fetcher: Fetcher = fetch) {
  let url: URL;
  if (provider === 'google_drive') {
    url = new URL(googleBase); url.searchParams.set('q', `'${folderId}' in parents and trashed = false`); url.searchParams.set('fields', `nextPageToken,files(${googleFields})`); url.searchParams.set('pageSize', '100'); url.searchParams.set('orderBy', 'folder,name'); url.searchParams.set('supportsAllDrives', 'true'); url.searchParams.set('includeItemsFromAllDrives', 'true');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
  } else {
    url = new URL(`${graphBase}${graphItemPath(driveId, folderId)}/children`); url.searchParams.set('$select', graphFields); url.searchParams.set('$top', '100');
    if (pageToken) url.searchParams.set('$skiptoken', pageToken);
  }
  const data = await fetchJson(url.href, token, fetcher); let next: string | null = null;
  if (provider === 'google_drive') next = typeof data.nextPageToken === 'string' ? data.nextPageToken : null;
  else if (typeof data['@odata.nextLink'] === 'string') {
    const candidate = new URL(data['@odata.nextLink']);
    if (candidate.origin !== url.origin || candidate.pathname !== url.pathname || candidate.username || candidate.password) throw new DriveError('The provider returned an invalid next page.');
    next = candidate.searchParams.get('$skiptoken');
    if (!next) throw new DriveError('The provider returned an unsupported next page.');
  }
  if (next && next.length > 12000) throw new DriveError('The provider returned an invalid next page.');
  const raw = provider === 'google_drive' ? data.files : data.value;
  if (!Array.isArray(raw) || raw.length > 1000) throw new DriveError('The provider returned an invalid file list.');
  const items = raw.map(object).filter(value => !value.trashed && !value.deleted).map(value => item(provider, value)).filter(value => !value.shortcut && value.parentId === folderId && (provider !== 'onedrive' || value.driveId === driveId));
  return { items, nextPageToken: next };
}
export async function exchangeToken(config: ProviderConfig, fields: Record<string, string>, fetcher: Fetcher = fetch): Promise<DriveTokens> {
  const response = await fetcher(config.tokenUrl, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12_000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...fields }) });
  if (!response.ok) throw new DriveError('Reconnect this drive to continue.', 401, 'drive_reconnect_required');
  const data = object(JSON.parse(new TextDecoder().decode(await readLimitedResponse(response, 64 * 1024))));
  if (typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 16000 || typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new DriveError('The provider returned invalid authorization.');
  const scopes = typeof data.scope === 'string' ? data.scope.toLowerCase().split(/\s+/) : [];
  const required = config.provider === 'google_drive' ? 'https://www.googleapis.com/auth/drive.readonly' : 'files.read';
  if (scopes.length && !scopes.some((scope: string) => scope === required || scope === `https://graph.microsoft.com/${required}`)) throw new DriveError('Read-only file access was not granted.', 403, 'drive_scope_missing');
  return { accessToken: data.access_token, refreshToken: typeof data.refresh_token === 'string' && data.refresh_token.length <= 16000 ? data.refresh_token : undefined, expiresAt: Math.floor(Date.now() / 1000) + Math.min(data.expires_in, 86400) };
}
export async function downloadItem(provider: DriveProvider, token: string, file: DriveItem, limit: number, fetcher: Fetcher = fetch) {
  if (file.isFolder || file.shortcut || file.size > limit) throw new DriveError('Select a supported file no larger than 20 MB.', 422, 'invalid_file');
  const nativeGoogle = provider === 'google_drive' && file.mimeType.startsWith('application/vnd.google-apps.');
  if (nativeGoogle && !['application/vnd.google-apps.document', 'application/vnd.google-apps.spreadsheet', 'application/vnd.google-apps.presentation', 'application/vnd.google-apps.drawing'].includes(file.mimeType)) throw new DriveError('This Google file type cannot be imported.', 415, 'unsupported_file');
  const url = provider === 'google_drive' ? `${googleBase}/${encodeURIComponent(file.id)}${nativeGoogle ? '/export?mimeType=application%2Fpdf' : '?alt=media'}` : `${graphBase}${graphItemPath(file.driveId, file.id)}/content`;
  let response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  if (provider === 'onedrive' && response.status === 302) {
    const location = response.headers.get('location'); if (!location) throw new DriveError('The download is unavailable.');
    const target = new URL(location);
    // Graph issues short-lived download URLs. Never forward OAuth credentials to them.
    const allowed = target.hostname.endsWith('.sharepoint.com') || target.hostname.endsWith('.1drv.com') || target.hostname.endsWith('.onedrive.com') || target.hostname.endsWith('.files.1drv.com') || target.hostname.endsWith('.storage.live.com');
    if (target.protocol !== 'https:' || target.username || target.password || !allowed) throw new DriveError('The provider returned an unsupported download location.');
    response = await fetcher(target.href, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  }
  if (response.status === 401) throw new DriveError('Reconnect this drive to continue.', 401, 'drive_reconnect_required');
  if (!response.ok) throw new DriveError('The selected file could not be downloaded.');
  const bytes = await readLimitedResponse(response, limit);
  if (!bytes.length) throw new DriveError('The selected file is empty.', 422, 'empty_file');
  return { bytes, name: nativeGoogle && !/\.pdf$/i.test(file.name) ? `${file.name}.pdf` : file.name };
}
