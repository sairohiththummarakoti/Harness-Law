import { env } from 'cloudflare:workers';
import { getAppUser } from '@/app/auth';
import { adminJson, handleAdminMembersRequest } from '@/lib/admin/members';
import type { AdminDatabase } from '@/lib/admin/access';

export const dynamic = 'force-dynamic';
const runtime = env as unknown as { DB?: AdminDatabase; HARNESS_ADMIN_OWNER_EMAIL?: string };

function handle(request: Request) {
  if (!runtime.DB) return adminJson({ error: 'Admin storage is unavailable.' }, 503);
  return handleAdminMembersRequest(request, { db: runtime.DB, getUser: getAppUser, ownerEmail: runtime.HARNESS_ADMIN_OWNER_EMAIL });
}
export const GET = handle;
export const POST = handle;
