import type { CaseState } from './model.ts';

export type EvidenceDeleteTarget = { kind: 'file' | 'folder'; id: string };

/** Resolve the full tree before mutation so files in sibling folders stay untouched. */
export function evidenceDeletionSelection(state: CaseState, target: EvidenceDeleteTarget) {
  const folderIds = new Set<string>();
  if (target.kind === 'folder') {
    if (!state.folders?.some(folder => folder.id === target.id)) throw new Error('This folder no longer exists.');
    folderIds.add(target.id);
    for (let changed = true; changed;) {
      changed = false;
      for (const folder of state.folders ?? []) {
        if (folder.parentId && folderIds.has(folder.parentId) && !folderIds.has(folder.id)) { folderIds.add(folder.id); changed = true; }
      }
    }
  } else if (!state.documents.some(document => document.id === target.id)) throw new Error('This file no longer exists.');
  const documents = state.documents.filter(document => target.kind === 'file' ? document.id === target.id : !!document.folderId && folderIds.has(document.folderId));
  return { documents, folderIds };
}
