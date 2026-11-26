import { FormImportError, IMPORT_LIMITS, importFormat, readableImportError, type ParsedImportDocument } from './form-import-limits.ts';
import { extractPdfDocument } from './form-import-pdf.ts';

export { FormImportError, IMPORT_ACCEPT, IMPORT_LIMITS } from './form-import-limits.ts';
export type ImportExtraction = ParsedImportDocument & { fileName: string };
export type ImportExtractionOptions = { signal?: AbortSignal; onProgress?: (message: string) => void };
type ImportWorkerFactory = (format: 'document' | 'pdf', pdfVersion?: string) => Promise<Worker>;
const createBundledWorker: ImportWorkerFactory = async (format, pdfVersion) => {
  if (format === 'pdf') return new Worker(`/form-import-pdf/${pdfVersion}/pdf.worker.mjs`, { type: 'module' });
  // Vite's worker wrapper emits an origin-relative asset URL. Vinext rewrites
  // import.meta.url in client modules, so constructing a worker URL from it is unsafe.
  const module = await import('./form-import.worker.ts?worker');
  return new module.default();
};

/** No selected file is uploaded. Only bundled parser code/assets are requested from this origin. */
export async function extractImportFile(file: File, options: ImportExtractionOptions = {}, createWorker: ImportWorkerFactory = createBundledWorker): Promise<ImportExtraction> {
  const { signal, onProgress } = options;
  signal?.throwIfAborted();
  const format = importFormat(file.name, file.size);
  if (typeof Worker === 'undefined') throw new FormImportError('Local document reading is unavailable in this browser. Try a current browser or enter your answers manually.');
  const controller = new AbortController(); let worker: Worker | undefined; let stopPdf: (() => void) | undefined;
  let settled = false; let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectStopped: (error: unknown) => void = () => undefined;
  const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject; });
  const stop = (error: unknown) => {
    if (settled) return;
    controller.abort(); worker?.terminate(); stopPdf?.(); rejectStopped(error);
  };
  const abort = () => stop(new DOMException('Document reading canceled.', 'AbortError'));
  signal?.addEventListener('abort', abort, { once: true });
  timer = setTimeout(() => stop(new FormImportError('Reading this file took too long. Choose a shorter or simpler document and try again.')), IMPORT_LIMITS.timeoutMs);
  const startWorker = async (kind: 'document' | 'pdf', pdfVersion?: string) => {
    const created = await createWorker(kind, pdfVersion);
    if (controller.signal.aborted) { created.terminate(); throw new DOMException('Document reading canceled.', 'AbortError'); }
    worker = created;
    return created;
  };
  const extract = async (): Promise<ParsedImportDocument> => {
    onProgress?.('Reading your document locally…');
    const bytes = await file.arrayBuffer();
    controller.signal.throwIfAborted();
    if (bytes.byteLength !== file.size || bytes.byteLength > IMPORT_LIMITS.fileBytes) throw new FormImportError('This file changed while it was being read. Choose it again.');
    if (format !== 'pdf') {
      const documentWorker = await startWorker('document');
      return new Promise<ParsedImportDocument>((resolve, reject) => {
        documentWorker.onmessage = (event: MessageEvent<Partial<ParsedImportDocument> & { error?: string }>) => {
          if (controller.signal.aborted) return;
          if (typeof event.data.text === 'string') resolve({ text: event.data.text, ...(event.data.manualOnly === true ? { manualOnly: true, manualOnlyReason: event.data.manualOnlyReason } : {}) });
          else reject(new FormImportError(event.data.error || 'We could not read this document. Try another file.'));
        };
        documentWorker.onerror = event => { event.preventDefault(); reject(new FormImportError('The local document reader could not start. Reload the page or try another file.')); };
        documentWorker.postMessage({ name: file.name, bytes }, [bytes]);
      });
    }
    if (new TextDecoder('ascii').decode(bytes.slice(0, 1024)).indexOf('%PDF-') < 0) throw new FormImportError('This file is not a readable PDF. Choose a valid text PDF.');
    // The PDF API runs in the browser; all PDF parsing runs in this explicitly owned worker.
    // Supplying the port prevents a silent fake-worker fallback from blocking the UI.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    controller.signal.throwIfAborted();
    const nativePdfWorker = await startWorker('pdf', pdfjs.version);
    nativePdfWorker.onerror = event => { event.preventDefault(); stop(new FormImportError('The local PDF reader could not start. Reload the page and try again.')); };
    const pdfWorker = pdfjs.PDFWorker.create({ port: nativePdfWorker });
    const assetBase = new URL(`/form-import-pdf/${pdfjs.version}/`, window.location.origin).href;
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), worker: pdfWorker, cMapUrl: `${assetBase}cmaps/`, standardFontDataUrl: `${assetBase}standard_fonts/`, disableFontFace: true, useSystemFonts: false, useWorkerFetch: true, useWasm: false, isOffscreenCanvasSupported: false, isImageDecoderSupported: false, enableXfa: false, stopAtErrors: true, verbosity: 0 });
    stopPdf = () => { void task.destroy().catch(() => undefined); pdfWorker.destroy(); };
    try {
      const document = await task.promise;
      controller.signal.throwIfAborted();
      return { text: await extractPdfDocument(document, onProgress, controller.signal) };
    } finally { stopPdf(); stopPdf = undefined; }
  };
  try {
    const parsed = await Promise.race([extract(), stopped]);
    signal?.throwIfAborted();
    return { ...parsed, fileName: file.name };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new FormImportError(readableImportError(error, format));
  } finally {
    settled = true; if (timer) clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); worker?.terminate(); stopPdf?.();
  }
}
