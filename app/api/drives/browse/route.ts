import { driveDependencies } from '@/lib/drives/runtime';
import { handleDriveBrowse } from '@/lib/drives/service';

export const dynamic = 'force-dynamic';
export function GET(request: Request) { return handleDriveBrowse(request, driveDependencies()); }
