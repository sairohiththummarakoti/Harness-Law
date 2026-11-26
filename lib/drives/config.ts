export type DriveProvider = 'google_drive' | 'onedrive';
export type DriveEnvironment = Record<string, unknown>;
export interface ProviderConfig { provider: DriveProvider; clientId: string; clientSecret: string; authorizeUrl: string; tokenUrl: string; scope: string }
function value(env: DriveEnvironment, name: string): string { return typeof env[name] === 'string' ? (env[name] as string).trim() : ''; }
export function driveSecret(env: DriveEnvironment): string { return value(env, 'HARNESS_DRIVE_TOKEN_SECRET'); }
export function providerConfig(env: DriveEnvironment, provider: unknown): ProviderConfig | null {
  if (provider !== 'google_drive' && provider !== 'onedrive') return null;
  const prefix = provider === 'google_drive' ? 'HARNESS_DRIVE_GOOGLE' : 'HARNESS_DRIVE_MICROSOFT';
  const clientId = value(env, `${prefix}_CLIENT_ID`), clientSecret = value(env, `${prefix}_CLIENT_SECRET`);
  if (!clientId || !clientSecret || driveSecret(env).length < 32) return null;
  return provider === 'google_drive'
    ? { provider, clientId, clientSecret, authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', scope: 'openid email https://www.googleapis.com/auth/drive.readonly' }
    : { provider, clientId, clientSecret, authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', scope: 'openid profile offline_access https://graph.microsoft.com/Files.Read https://graph.microsoft.com/User.Read' };
}
export function capabilities(env: DriveEnvironment) {
  return { providers: (['google_drive', 'onedrive'] as const).map(id => ({ id, ready: !!providerConfig(env, id), reason: providerConfig(env, id) ? null : 'The site owner needs to finish provider setup.', notice: id === 'google_drive' && value(env, 'HARNESS_DRIVE_GOOGLE_TESTING').toLowerCase() === 'true' ? 'Testing: invited Google accounts only.' : null })), icloud: { mode: 'device_import' as const }, access: 'read_only' as const };
}
