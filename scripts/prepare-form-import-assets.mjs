import { cp, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Fonts/CMaps are parser support files only. Applicant documents never enter this directory.
// The pinned version in the URL prevents an old deployment from serving incompatible assets.
const packageRoot = new URL('../node_modules/pdfjs-dist/', import.meta.url);
const { version } = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
const target = new URL(`../public/form-import-pdf/${version}/`, import.meta.url);
await mkdir(target, { recursive: true });
for (const name of ['cmaps', 'standard_fonts']) await cp(fileURLToPath(new URL(name, packageRoot)), fileURLToPath(new URL(name, target)), { recursive: true });
// Keep PDF.js's self-contained worker untouched: dev transformation of its
// optional imports can inject browser-only Vite client code into a worker.
await cp(fileURLToPath(new URL('legacy/build/pdf.worker.min.mjs', packageRoot)), fileURLToPath(new URL('pdf.worker.mjs', target)));
