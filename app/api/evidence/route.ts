import { handleEvidenceDelete, handleEvidenceRead, handleEvidenceUpload } from '@/lib/evidence-storage';
import { evidenceStorageDependencies } from '@/lib/evidence-repository';

export const dynamic = 'force-dynamic';
export function POST(request: Request) { return handleEvidenceUpload(request, evidenceStorageDependencies()); }
export function GET(request: Request) { return handleEvidenceRead(request, evidenceStorageDependencies()); }
export function DELETE(request: Request) { return handleEvidenceDelete(request, evidenceStorageDependencies()); }
