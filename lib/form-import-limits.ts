export const IMPORT_LIMITS = {
  fileBytes: 10 * 1024 * 1024,
  pdfPages: 50,
  archiveBytes: 20 * 1024 * 1024,
  archiveEntries: 512,
  xmlBytes: 2 * 1024 * 1024,
  textCharacters: 200_000,
  timeoutMs: 20_000,
  jsonDepth: 20,
  csvRows: 2_000,
  csvColumns: 100,
} as const;

export const IMPORT_ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.csv,.json';
export type ImportFormat = 'pdf' | 'docx' | 'txt' | 'md' | 'csv' | 'json';
export interface ParsedImportDocument { text: string; manualOnly?: boolean; manualOnlyReason?: string }
export class FormImportError extends Error {
  constructor(message: string) { super(message); this.name = 'FormImportError'; }
}
export function importFormat(name: string, size: number): ImportFormat {
  if (size > IMPORT_LIMITS.fileBytes) throw new FormImportError('Choose a file smaller than 10 MB.');
  if (!size) throw new FormImportError('This file is empty. Choose a document containing text.');
  const extension = name.split('.').pop()?.toLowerCase();
  if (extension === 'markdown') return 'md';
  if (extension && ['pdf', 'docx', 'txt', 'md', 'csv', 'json'].includes(extension)) return extension as ImportFormat;
  if (extension && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'tif', 'tiff', 'heic'].includes(extension)) {
    throw new FormImportError('Images and scans need OCR first. Choose a text PDF, DOCX, TXT, Markdown, CSV, or JSON file.');
  }
  throw new FormImportError('Choose a text PDF, DOCX, TXT, Markdown, CSV, or JSON file.');
}
export function checkedImportText(text: string): string {
  if (text.length > IMPORT_LIMITS.textCharacters) throw new FormImportError('This document contains too much text. Choose a shorter document (up to 200,000 characters).');
  // These controls are not useful applicant text. Do not interpret markup or URLs.
  return text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}
export function readableImportError(error: unknown, format?: ImportFormat): string {
  if (error instanceof FormImportError) return error.message;
  if (error && typeof error === 'object' && 'name' in error && error.name === 'PasswordException') return 'Password-protected PDFs are not supported. Choose an unencrypted copy.';
  return format === 'pdf' ? 'We could not read this PDF. Choose an unencrypted text PDF or try a text document.' : 'We could not read this document. Check that it opens correctly, or try a TXT copy.';
}
