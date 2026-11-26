import { driveDependencies } from '@/lib/drives/runtime';
import { handleDriveDisconnect, handleDriveList, handleDriveSave } from '@/lib/drives/service';

export const dynamic = 'force-dynamic';
export function GET(request: Request) { return handleDriveList(request, driveDependencies()); }
export function POST(request: Request) { return handleDriveSave(request, driveDependencies()); }
export function PATCH(request: Request) { return handleDriveSave(request, driveDependencies(), true); }
export function DELETE(request: Request) { return handleDriveDisconnect(request, driveDependencies()); }
