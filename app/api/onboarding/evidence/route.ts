import { getAppUser } from '@/app/auth';
import { database } from '@/lib/api';
import { handleEvidenceSetupComplete } from '@/lib/onboarding-evidence';

export const dynamic = 'force-dynamic';
export function POST(request: Request) {
  return handleEvidenceSetupComplete(request, { getUser: getAppUser, database });
}
