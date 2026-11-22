export interface WorkerCapability { case_id: string; job_id: string; expires_at: number; }

function base64url(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); }
function decode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding');
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
}
async function hmac(secret: string) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function signWorkerCapability(scope: WorkerCapability, secret: string) {
  if (secret.length < 32) throw new Error('Worker secret must contain at least 32 characters.');
  const payload = base64url(new TextEncoder().encode(JSON.stringify(scope)));
  const signature = await crypto.subtle.sign('HMAC', await hmac(secret), new TextEncoder().encode(payload));
  return `${payload}.${base64url(new Uint8Array(signature))}`;
}
export async function verifyWorkerCapability(token: string, secret: string | undefined, now = Date.now()): Promise<WorkerCapability | null> {
  if (!secret || secret.length < 32 || token.length > 2048) return null;
  try {
    const parts = token.split('.'); if (parts.length !== 2) return null;
    if (!await crypto.subtle.verify('HMAC', await hmac(secret), decode(parts[1]), new TextEncoder().encode(parts[0]))) return null;
    const scope = JSON.parse(new TextDecoder().decode(decode(parts[0]))) as WorkerCapability;
    if (typeof scope.case_id !== 'string' || typeof scope.job_id !== 'string' || !Number.isSafeInteger(scope.expires_at)) return null;
    if (scope.expires_at <= now || scope.expires_at > now + 15 * 60_000) return null;
    return scope;
  } catch { return null; }
}

export async function canonicalHash(value: unknown): Promise<string> {
  const canonicalize = (v: unknown): unknown => Array.isArray(v) ? v.map(canonicalize) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonicalize(x)])) : v;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonicalize(value))));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}
