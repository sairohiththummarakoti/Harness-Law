import { env } from 'cloudflare:workers';
import { getAppUser } from '@/app/auth';
import { getAdminAccess } from '@/lib/admin/access';
import { parseOverviewQuery, readAdminOverview } from '@/lib/admin/analytics';
import { authJson } from '@/lib/auth/runtime';
import { matchesExpectedAccount } from '@/lib/account-context';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const user = await getAppUser();
  if (!user) return authJson({ error: 'Sign in to open administration.' }, 401);
  if (!matchesExpectedAccount(request, user.userId)) return authJson({ error: 'Your signed-in account changed. Reload this page.' }, 401);
  if (!env.DB) return authJson({ error: 'Administration is temporarily unavailable.' }, 503);
  try {
    const ownerEmail = (env as unknown as { HARNESS_ADMIN_OWNER_EMAIL?: string }).HARNESS_ADMIN_OWNER_EMAIL;
    const access = await getAdminAccess(env.DB, user, ownerEmail);
    if (!access) return authJson({ error: 'Administrator access is required.' }, 403);
    const query = parseOverviewQuery(new URL(request.url));
    if (!query) return authJson({ error: 'Choose a valid date range and page.' }, 400);
    return authJson(await readAdminOverview(env.DB, { role: access.role, email: user.email }, query));
  } catch { return authJson({ error: 'Analytics could not be loaded. Please retry.' }, 503); }
}
