import { driveDependencies } from '@/lib/drives/runtime';
import { handleDriveConnect } from '@/lib/drives/service';

export const dynamic = 'force-dynamic';
export function POST(request: Request) { return handleDriveConnect(request, driveDependencies()); }
