import { driveDependencies } from '@/lib/drives/runtime';
import { handleDriveImport } from '@/lib/drives/import';
import { handleEvidenceUpload } from '@/lib/evidence-storage';
import { evidenceStorageDependencies } from '@/lib/evidence-repository';

export const dynamic = 'force-dynamic';
export function POST(request: Request) {
  return handleDriveImport(request, {
    ...driveDependencies(),
    upload: uploadRequest => handleEvidenceUpload(uploadRequest, evidenceStorageDependencies()),
  });
}
