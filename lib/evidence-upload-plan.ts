import { folderIntegrityError, folderNameError, MAX_EVIDENCE_FOLDERS, type EvidenceFolder } from './evidence-folders.ts';
import { MAX_FILE_BYTES, validUploadName } from './validation.ts';

type UploadFile = { name: string; size: number; webkitRelativePath?: string };
export interface UploadPlan<T> { folders: EvidenceFolder[]; entries: { file: T; folderId: string | null }[]; skipped: string[] }

/** Preflight the entire selection before creating folders or storing any bytes. */
export function planEvidenceUpload<T extends UploadFile>(files: T[], existing: EvidenceFolder[], parentId: string | null, documentCount: number, directory: boolean, createId: () => string = () => `folder-${crypto.randomUUID()}`, stripDirectoryRoot = false): UploadPlan<T> {
  const folders = existing.map(folder => ({ ...folder }));
  if (parentId && !folders.some(folder => folder.id === parentId)) throw new Error('The upload destination no longer exists. Choose a folder again.');
  const entries: UploadPlan<T>['entries'] = [], skipped: string[] = [];
  let selectedRoot: string | undefined;
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
      if (stripDirectoryRoot) {
        const root = parts.shift();
        if (!root || root === '.' || root === '..' || /[\x00-\x1f\x7f]/.test(root)) throw new Error('A selected file has an invalid folder path. Choose the folder again.');
        if (selectedRoot !== undefined && selectedRoot !== root) throw new Error('Choose one folder at a time for a named evidence location.');
        selectedRoot = root;
      }
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

/** A named location replaces the picked directory's outer name, preserving its contents. */
export function planNamedEvidenceUpload<T extends UploadFile>(files: T[], existing: EvidenceFolder[], documentCount: number, name: string, directory: boolean, retryFolderId: string | null = null, createId: () => string = () => `folder-${crypto.randomUUID()}`): UploadPlan<T> & { folder: EvidenceFolder } {
  const normalizedName = name.trim();
  const invalid = folderNameError(normalizedName); if (invalid) throw new Error(invalid);
  const previous = retryFolderId ? existing.find(folder => folder.id === retryFolderId) : undefined;
  if (retryFolderId && (!previous || previous.parentId !== null || previous.origin !== 'upload' || previous.name !== normalizedName)) throw new Error('This upload location changed. Choose a new folder name before continuing.');
  const folder: EvidenceFolder = previous ?? { id: createId(), name: normalizedName, parentId: null, origin: 'upload' };
  const withRoot = previous ? existing : [...existing, folder];
  const integrity = folderIntegrityError({ folders: withRoot, documents: [] }); if (integrity) throw new Error(integrity);
  const plan = planEvidenceUpload(files, withRoot, folder.id, documentCount, directory, createId, directory);
  if (!plan.entries.length || plan.skipped.length) throw new Error(`Choose supported, non-empty files up to 20 MB each. ${plan.skipped.slice(0, 3).join('; ')}`);
  return { ...plan, folder, folders: [...(previous ? [] : [folder]), ...plan.folders] };
}

/** File object identity distinguishes an uncertain retry from a new deliberate selection. */
export function sameUploadSelection<T>(current: readonly T[], original: readonly T[]): boolean {
  return current.length === original.length && current.every((file, index) => file === original[index]);
}
