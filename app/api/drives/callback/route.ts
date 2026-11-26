import { driveDependencies } from '@/lib/drives/runtime';
import { handleDriveCallback } from '@/lib/drives/service';

export const dynamic = 'force-dynamic';
export function GET(request: Request) { return handleDriveCallback(request, driveDependencies()); }
