import { folderIntegrityError, folderNameError, MAX_EVIDENCE_FOLDERS, type EvidenceFolder } from './evidence-folders.ts';
import { MAX_FILE_BYTES, validUploadName } from './validation.ts';

type UploadFile = { name: string; size: number; webkitRelativePath?: string };
export interface UploadPlan<T> { folders: EvidenceFolder[]; entries: { file: T; folderId: string | null }[]; skipped: string[] }

/** Preflight the entire selection before creating folders or storing any bytes. */
export function planEvidenceUpload<T extends UploadFile>(files: T[], existing: EvidenceFolder[], parentId: string | null, documentCount: number, directory: boolean, createId: () => string = () => `folder-${crypto.randomUUID()}`): UploadPlan<T> {
  const folders = existing.map(folder => ({ ...folder }));
  if (parentId && !folders.some(folder => folder.id === parentId)) throw new Error('The upload destination no longer exists. Choose a folder again.');
  const entries: UploadPlan<T>['entries'] = [], skipped: string[] = [];
  for (const file of files) {
    if (!validUploadName(file.name) || file.size <= 0 || file.size > MAX_FILE_BYTES) {
      skipped.push(`${file.webkitRelativePath || file.name}: ${!validUploadName(file.name) ? 'unsupported file type' : file.size <= 0 ? 'empty file' : 'over 20 MB'}`);
      continue;
    }
    if (entries.length + documentCount >= 200) throw new Error(`This selection exceeds the 200-file library limit. You can add ${Math.max(0, 200 - documentCount)} more files.`);
    let folderId = parentId;
    if (directory) {
      const path = file.webkitRelativePath;
      if (!path || path.includes('\\')) throw new Error('Your browser did not supply a valid folder path. Choose Upload files instead.');
      const parts = path.split('/');
      if (parts.length < 2 || parts.pop() !== file.name) throw new Error('A selected file has an invalid folder path. Choose the folder again.');
      for (const name of parts) {
        const error = folderNameError(name);
        if (error) throw new Error(`${name || 'Folder'}: ${error}`);
        const key = name.normalize('NFKC').toLowerCase();
        const existingFolder = folders.find(folder => folder.parentId === folderId && folder.name.normalize('NFKC').toLowerCase() === key);
        if (existingFolder) folderId = existingFolder.id;
        else {
          if (folders.length >= MAX_EVIDENCE_FOLDERS) throw new Error(`A case can contain up to ${MAX_EVIDENCE_FOLDERS} folders.`);
          const folder: EvidenceFolder = { id: createId(), name, parentId: folderId }; folders.push(folder); folderId = folder.id;
        }
      }
    }
    entries.push({ file, folderId });
  }
  const error = folderIntegrityError({ folders, documents: entries });
  if (error) throw new Error(error);
  return { folders: folders.slice(existing.length), entries, skipped };
}
