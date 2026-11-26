import { authJson } from '@/lib/auth/runtime';

/** Browser-provided bearer tokens are no longer accepted or persisted. */
export function POST() {
  return authJson({ error: 'Reconnect through the secure drive connection flow.', code: 'legacy_flow_removed' }, 410);
}
