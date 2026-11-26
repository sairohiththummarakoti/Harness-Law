import { analyzeImportFields, type ImportField, type ImportSuggestion, type ImportValue } from './form-import.ts';
import { folderPath, type EvidenceFolder } from './evidence-folders.ts';

export const MAX_IMPORT_FILES = 20;
export const MAX_IMPORT_BATCH_CHARACTERS = 500_000;
export function evidenceSourceLabel(document: { name: string; folderId?: string | null }, folders: EvidenceFolder[]): string {
  return `${folderPath(folders, document.folderId ?? null)} / ${document.name}`;
}
export interface ImportTextSource { fileName: string; text: string; manualOnly?: boolean; manualOnlyReason?: string }
export interface ImportConflict {
  key: string;
  label: string;
  candidates: { fileName: string; value: ImportValue; excerpt: string; error?: string }[];
}

/** Match each source independently so section boundaries and ambiguous answers never cross files. */
export function mergeImportSources(sources: ImportTextSource[], fields: ImportField[], current: Record<string, unknown>) {
  const grouped = new Map<string, { fileName: string; suggestion: ImportSuggestion }[]>();
  const ambiguousKeys = new Set<string>();
  for (const source of sources) {
    const analysis = analyzeImportFields(source.text, fields, current, { manualOnly: source.manualOnly });
    for (const ambiguity of analysis.ambiguities) ambiguousKeys.add(ambiguity.key);
    for (const suggestion of [...analysis.suggestions, ...analysis.ambiguities.flatMap(ambiguity => ambiguity.candidates)]) {
      const entries = grouped.get(suggestion.key) ?? [];
      entries.push({ fileName: source.fileName, suggestion });
      grouped.set(suggestion.key, entries);
    }
  }
  const suggestions: ImportSuggestion[] = [];
  const conflicts: ImportConflict[] = [];
  for (const field of fields) {
    const entries = grouped.get(field.key);
    if (!entries?.length) continue;
    const first = entries[0].suggestion;
    if (ambiguousKeys.has(field.key) || entries.some(entry => JSON.stringify(entry.suggestion.value) !== JSON.stringify(first.value))) {
      conflicts.push({ key: field.key, label: field.label, candidates: entries.map(({ fileName, suggestion }) => ({ fileName, value: suggestion.value, excerpt: suggestion.excerpt, error: suggestion.error })) });
      continue;
    }
    suggestions.push({ ...first, selected: entries.every(entry => entry.suggestion.selected), excerpt: entries.map(entry => `${entry.fileName}\n${entry.suggestion.excerpt}`).join('\n\n') });
  }
  return { suggestions, conflicts };
}
