/** A stale tab must not load or save a different account after a provider switch.
 * The header binds UI state to its server-rendered account; it is not a credential.
 * Requests without it retain compatibility with existing authenticated API clients.
 */
export function matchesExpectedAccount(request: Request, currentUserId: string): boolean {
  const expected = request.headers.get('X-Harness-Account');
  return expected === null || expected === currentUserId;
}
