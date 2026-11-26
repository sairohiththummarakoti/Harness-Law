export interface EvidenceFolder { id: string; name: string; parentId: string | null; origin?: 'upload' | 'external'; connectionId?: string }

export const MAX_EVIDENCE_FOLDERS = 200;
export const MAX_FOLDER_NAME = 80;

export function normalizeFolderName(name: string): string { return name.trim(); }

export function folderNameError(name: string): string | null {
  if (!name.trim()) return "Enter a folder name.";
  if (name !== name.trim()) return "Folder names cannot start or end with spaces.";
  if (name.length > MAX_FOLDER_NAME) return `Use ${MAX_FOLDER_NAME} characters or fewer for the folder name.`;
  if (/[\\/\x00-\x1f\x7f]/.test(name) || name === "." || name === "..") return "Use a folder name without slashes or control characters.";
  return null;
}

/** Shared by case validation and folder actions; legacy documents without a folder remain at the root. */
export function folderIntegrityError(state: { folders?: EvidenceFolder[]; documents: { folderId?: string | null }[] }): string | null {
  const folders = state.folders ?? [];
  if (folders.length > MAX_EVIDENCE_FOLDERS) return `A case can contain up to ${MAX_EVIDENCE_FOLDERS} folders.`;
  const byId = new Map<string, EvidenceFolder>();
  const siblings = new Set<string>();
  for (const folder of folders) {
    if (!folder.id || folder.id.length > 150 || /[\x00-\x1f\x7f]/.test(folder.id)) return "The folder identity is invalid.";
    if (byId.has(folder.id)) return "Each folder must have a unique identity.";
    byId.set(folder.id, folder);
    const nameError = folderNameError(folder.name); if (nameError) return nameError;
    const siblingKey = JSON.stringify([folder.parentId, folder.name.normalize("NFKC").toLowerCase()]);
    if (siblings.has(siblingKey)) return "A folder with that name already exists in this location.";
    siblings.add(siblingKey);
  }
  for (const folder of folders) {
    const visited = new Set<string>([folder.id]);
    let parentId = folder.parentId;
    while (parentId !== null) {
      if (visited.has(parentId)) return "A folder cannot be placed inside itself or one of its subfolders.";
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) return "The destination folder no longer exists.";
      parentId = parent.parentId;
    }
  }
  if (state.documents.some(document => document.folderId != null && !byId.has(document.folderId))) return "A document refers to a folder that no longer exists.";
  return null;
}

export function folderTrail(folders: EvidenceFolder[], folderId: string | null): EvidenceFolder[] {
  const trail: EvidenceFolder[] = [], visited = new Set<string>();
  let current = folderId;
  while (current !== null && !visited.has(current)) {
    visited.add(current);
    const folder = folders.find(item => item.id === current); if (!folder) break;
    trail.unshift(folder); current = folder.parentId;
  }
  return trail;
}

export function folderPath(folders: EvidenceFolder[], folderId: string | null): string {
  return ["All files", ...folderTrail(folders, folderId).map(folder => folder.name)].join(" / ");
}
