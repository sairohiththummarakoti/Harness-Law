import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { checkedImportText, FormImportError, IMPORT_LIMITS } from './form-import-limits.ts';

/** Stream each page so the text budget is enforced before a whole document is accumulated. */
export async function extractPdfDocument(document: PDFDocumentProxy, onProgress?: (message: string) => void, signal?: AbortSignal): Promise<string> {
  if (await document.getPermissions() !== null) throw new FormImportError('Encrypted PDFs are not supported. Choose an unencrypted copy.');
  if (document.numPages > IMPORT_LIMITS.pdfPages) throw new FormImportError('Choose a PDF with 50 pages or fewer.');
  const parts: string[] = []; let length = 0;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    signal?.throwIfAborted();
    onProgress?.(`Reading PDF page ${pageNumber} of ${document.numPages}…`);
    const page = await document.getPage(pageNumber);
    const reader = page.streamTextContent({ includeMarkedContent: false }).getReader();
    try {
      while (true) {
        signal?.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        for (const item of value.items) {
          if (!('str' in item)) continue;
          const text = item.str + (item.hasEOL ? '\n' : ' ');
          length += text.length;
          if (length > IMPORT_LIMITS.textCharacters) throw new FormImportError('This PDF contains too much text. Choose a shorter document (up to 200,000 characters).');
          parts.push(text);
        }
      }
    } finally { await reader.cancel(new Error('Document text reading finished.')).catch(() => undefined); reader.releaseLock(); page.cleanup(); }
    parts.push('\n'); length++;
  }
  const text = checkedImportText(parts.join(''));
  if (!text) throw new FormImportError('This PDF has no readable text. Scans and images need OCR first; choose a text PDF or text document.');
  return text;
}
