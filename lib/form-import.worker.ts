import { parseImportDocument } from './form-import-parse.ts';
import { importFormat, readableImportError } from './form-import-limits.ts';

self.onmessage = (event: MessageEvent<{ name: string; bytes: ArrayBuffer }>) => {
  const { name, bytes } = event.data;
  try {
    self.postMessage(parseImportDocument(name, new Uint8Array(bytes)));
  } catch (error) {
    let format;
    try { format = importFormat(name, bytes.byteLength); } catch { /* already reported below */ }
    self.postMessage({ error: readableImportError(error, format) });
  }
};
