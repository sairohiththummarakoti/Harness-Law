import { randomToken, tokenHash } from '../auth/runtime.ts';

export { randomToken, tokenHash };
export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encrypted value');
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
}
async function key(secret: string) {
  if (secret.length < 32) throw new Error('Drive encryption is not configured');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
/** Owner and record ID are authenticated, preventing ciphertext swaps between accounts. */
export async function seal(value: unknown, secret: string, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) }, await key(secret), new TextEncoder().encode(JSON.stringify(value)));
  return `v1.${base64url(iv)}.${base64url(new Uint8Array(encrypted))}`;
}
export async function unseal<T>(value: string, secret: string, context: string): Promise<T> {
  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') throw new Error('Invalid encrypted value');
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(parts[1]), additionalData: new TextEncoder().encode(context) }, await key(secret), decode(parts[2]));
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
export async function pkceChallenge(verifier: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}
export const validItemId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_!.-]{1,256}$/.test(value) && value !== '.' && value !== '..';
export const validConnectionId = (value: unknown): value is string => typeof value === 'string' && /^drv-[a-f0-9-]{36}$/.test(value);
export function connectionName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name.length > 0 && name.length <= 120 && !/[\x00-\x1f\x7f]/.test(name) ? name : null;
}
export function returnPath(value: unknown): string {
  return value === '/evidence-setup' || value === '/evidence-setup?edit=1' ? value : '/workspace?view=evidence';
}
