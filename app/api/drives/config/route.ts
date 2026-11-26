import { driveDependencies } from '@/lib/drives/runtime';
import { handleDriveConfig } from '@/lib/drives/service';

export const dynamic = 'force-dynamic';
export function GET(request: Request) { return handleDriveConfig(request, driveDependencies()); }
