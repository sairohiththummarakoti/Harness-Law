import test from 'node:test';
import assert from 'node:assert/strict';
import { strToU8 } from 'fflate';
import { parseImportBytes, parseImportDocument, docxXmlText } from '../lib/form-import-parse.ts';
import { extractImportFile } from '../lib/form-import-extract.ts';
import { extractPdfDocument } from '../lib/form-import-pdf.ts';
import { checkedImportText, importFormat, IMPORT_LIMITS, readableImportError } from '../lib/form-import-limits.ts';
import { applicantLines, makeDocx, makePdf } from './form-import-fixtures.ts';

test('real DOCX paragraphs, tables, breaks and XML entities extract as text', () => {
  assert.equal(parseImportBytes('Applicant.DOCX', makeDocx()), applicantLines.join('\n'));
  const xml = '<?xml version="1.0"?><w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>Name: Alex &amp; Jo</w:t><w:tab/><w:t>&lt;script&gt;literal&lt;/script&gt;</w:t><w:br/><w:t>Role: Engineer &#x26; author</w:t></w:r></w:p></w:body></w:document>';
  assert.equal(parseImportBytes('applicant.docx', makeDocx(xml)), 'Name: Alex & Jo\t<script>literal</script>\nRole: Engineer & author');
  const withHeader = makeDocx(undefined, { 'word/header1.xml': strToU8('<w:hdr xmlns:w="urn:w"><w:p><w:r><w:t>Phone: +1 555 000 0000</w:t></w:r></w:p></w:hdr>') });
  assert.match(parseImportBytes('applicant.docx', withHeader), /Phone: \+1 555 000 0000/);
});

test('plain UTF-8 / UTF-16, Markdown, JSON and CSV preserve readable values', () => {
  assert.equal(parseImportBytes('a.txt', strToU8('Full name: Alex\r\nRole: Engineer')), 'Full name: Alex\nRole: Engineer');
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Name: José', 'utf16le')]);
  assert.equal(parseImportBytes('a.txt', utf16), 'Name: José');
  assert.equal(parseImportBytes('a.markdown', strToU8('# Experience\nEngineering')), '# Experience\nEngineering');
  assert.equal(parseImportBytes('a.json', strToU8('{"profile":{"fullName":"Alex","citizenships":["CA","GB"]},"notes":"Plans"}')), 'profile:\nfullName: Alex\ncitizenships: CA; GB\nnotes: Plans');
  assert.equal(parseImportBytes('a.csv', strToU8('fullName,role\nAlex,"Research, engineering"')), 'fullName: Alex\nrole: Research, engineering');
  assert.equal(parseImportBytes('a.csv', strToU8('field,value\nfullName,Alex\nrole,"Lead ""Engineer"""')), 'fullName: Alex\nrole: Lead "Engineer"');
  const manyPeople = 'fullName,role\nAlex,Engineer\nPat,Designer';
  assert.equal(parseImportBytes('a.csv', strToU8(manyPeople)), manyPeople);
  const ambiguousVertical = 'Full name,Jordan\nPhone,123';
  assert.equal(parseImportBytes('a.csv', strToU8(ambiguousVertical)), ambiguousVertical);
});

test('ambiguous structured records and multiline scalar content require manual assignment', () => {
  const people = parseImportDocument('people.json', strToU8('[{"fullName":"Alex Applicant"},{"email":"pat@example.test"}]'));
  assert.equal(people.manualOnly, true); assert.match(people.manualOnlyReason!, /flat applicant record/);
  assert.match(people.text, /Alex Applicant/); assert.match(people.text, /pat@example.test/);
  const nested = parseImportDocument('nested.json', strToU8('{"applicant":{"fullName":"Alex Applicant"},"referee":{"email":"pat@example.test"}}'));
  assert.equal(nested.manualOnly, true); assert.match(nested.text, /referee/);
  for (const payload of [{ notes: 'First contact\nFull name: Pat Referee' }, { notes: ['First contact\nFull name: Pat Referee'] }, { 'notes\nFull name': 'Pat Referee' }]) {
    assert.equal(parseImportDocument('notes.json', strToU8(JSON.stringify(payload))).manualOnly, true);
  }
  const flat = parseImportDocument('applicant.json', strToU8('{"fullName":"Alex Applicant","citizenships":["CA","GB"]}'));
  assert.equal(flat.manualOnly, undefined); assert.equal(flat.text, 'fullName: Alex Applicant\ncitizenships: CA; GB');
  const records = parseImportDocument('people.csv', strToU8('fullName,email\nAlex Applicant,\nPat Referee,pat@example.test'));
  assert.equal(records.manualOnly, true); assert.match(records.manualOnlyReason!, /multiple records/); assert.match(records.text, /pat@example.test/);
  assert.equal(parseImportDocument('ambiguous.csv', strToU8('Full name,Jordan\nPhone,123')).manualOnly, true);
  assert.equal(parseImportDocument('multiline.csv', strToU8('field,value\nnotes,"First contact\nFull name: Pat Referee"')).manualOnly, true);
  assert.equal(parseImportDocument('applicant.csv', strToU8('fullName,email\nAlex Applicant,alex@example.test')).manualOnly, undefined);
});

test('DOCX compatibility alternatives choose one supported branch or its fallback', () => {
  const wrap = (content: string) => `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body>${content}</w:body></w:document>`;
  const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const fallback = wrap(`<mc:AlternateContent><mc:Choice Requires="w14">${p('Full name: Unsupported alternative')}</mc:Choice><mc:Fallback>${p('Full name: Alex Applicant')}</mc:Fallback></mc:AlternateContent>`);
  assert.equal(parseImportBytes('fallback.docx', makeDocx(fallback)), 'Full name: Alex Applicant');
  const supported = wrap(`<mc:AlternateContent><mc:Choice Requires="w14">${p('Role: Unsupported alternative')}</mc:Choice><mc:Choice Requires="w">${p('Role: Research engineer')}</mc:Choice><mc:Fallback>${p('Role: Duplicate fallback')}</mc:Fallback></mc:AlternateContent>`);
  assert.equal(parseImportBytes('supported.docx', makeDocx(supported)), 'Role: Research engineer');
});

test('DOCX omits directly hidden, deleted and moved-from text while retaining current visible runs', () => {
  const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>
    <w:r><w:rPr><w:vanish/></w:rPr><w:t>Full name: Hidden Person</w:t></w:r>
    <w:r><w:rPr><w:webHidden w:val="true"/></w:rPr><w:t>Phone: Hidden number</w:t></w:r>
    <w:del><w:r><w:t>Full name: Deleted Person</w:t><w:delText>Old value</w:delText></w:r></w:del>
    <w:moveFrom><w:r><w:t>Full name: Moved Person</w:t></w:r></w:moveFrom>
    <w:r><w:rPr><w:vanish w:val="false"/></w:rPr><w:t>Full name: Alex Applicant</w:t></w:r>
  </w:p><w:p><w:moveTo><w:r><w:rPr><w:rPrChange><w:rPr><w:vanish/></w:rPr></w:rPrChange></w:rPr><w:t>Role: Research engineer</w:t></w:r></w:moveTo></w:p></w:body></w:document>`;
  assert.equal(parseImportBytes('revisions.docx', makeDocx(xml)), 'Full name: Alex Applicant\nRole: Research engineer');
  const styled = parseImportDocument('hidden-style.docx', makeDocx(undefined, { 'word/styles.xml': strToU8('<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:styleId="Hidden"><w:rPr><w:vanish/></w:rPr></w:style></w:styles>') }));
  assert.equal(styled.manualOnly, true); assert.match(styled.manualOnlyReason!, /hidden-text styles/);
});

test('empty text is a valid empty result, unsupported/binary/malformed inputs have useful errors', () => {
  assert.equal(parseImportBytes('empty.txt', strToU8(' \n\t ')), '');
  assert.throws(() => importFormat('scan.png', 10), /OCR/);
  assert.throws(() => importFormat('a.exe', 10), /Choose a text PDF/);
  assert.throws(() => importFormat('a.txt', 0), /empty/);
  assert.throws(() => importFormat('a.txt', IMPORT_LIMITS.fileBytes + 1), /10 MB/);
  assert.throws(() => parseImportBytes('a.txt', new Uint8Array([0, 1, 255])), /readable text/);
  assert.throws(() => parseImportBytes('a.json', strToU8('{bad}')), /malformed/);
  assert.throws(() => parseImportBytes('a.csv', strToU8('Name,"Alex')), /unfinished/);
  assert.throws(() => parseImportBytes('a.docx', strToU8('PK invalid archive')), /malformed/);
  assert.throws(() => parseImportBytes('a.docx', makeDocx('<w:document xmlns:w="urn:w"><w:body><w:p></w:body></w:document>')), /malformed/);
  assert.throws(() => parseImportBytes('a.docx', makeDocx('<w:document xmlns:w="urn:w"><w:body/></w:document>')), /OCR/);
  assert.throws(() => docxXmlText('<!DOCTYPE x SYSTEM "https://example.invalid"><w:document/>'), /unsupported XML/);
  assert.equal(readableImportError(new Error('secret raw stack')), 'We could not read this document. Check that it opens correctly, or try a TXT copy.');
  assert.match(readableImportError({ name: 'PasswordException' }, 'pdf'), /Password-protected/);
});

test('text, JSON depth, CSV rows/columns and DOCX expansion budgets are enforced', () => {
  assert.throws(() => checkedImportText('x'.repeat(IMPORT_LIMITS.textCharacters + 1)), /too much text/);
  assert.throws(() => parseImportBytes('a.json', strToU8('['.repeat(25) + '1' + ']'.repeat(25))), /nested too deeply/);
  assert.throws(() => parseImportBytes('a.csv', strToU8('a,b\n'.repeat(IMPORT_LIMITS.csvRows + 1))), /too many rows/);
  assert.throws(() => parseImportBytes('a.csv', strToU8('a,'.repeat(IMPORT_LIMITS.csvColumns + 1))), /too many columns/);
  const oversized = makeDocx(); const view = new DataView(oversized.buffer, oversized.byteOffset, oversized.byteLength);
  for (let at = 0; at < oversized.length - 46; at++) if (view.getUint32(at, true) === 0x02014b50) { view.setUint32(at + 24, IMPORT_LIMITS.archiveBytes + 1, true); break; }
  assert.throws(() => parseImportBytes('a.docx', oversized), /20 MB/);
  const encrypted = makeDocx(); const encryptedView = new DataView(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength);
  for (let at = 0; at < encrypted.length - 46; at++) if (encryptedView.getUint32(at, true) === 0x02014b50) { encryptedView.setUint16(at + 8, 1, true); break; }
  assert.throws(() => parseImportBytes('a.docx', encrypted), /Encrypted DOCX/);
  const badCrc = makeDocx(); const crcView = new DataView(badCrc.buffer, badCrc.byteOffset, badCrc.byteLength);
  for (let at = 0; at < badCrc.length - 46; at++) if (crcView.getUint32(at, true) === 0x02014b50 && new TextDecoder().decode(badCrc.subarray(at + 46, at + 63)) === 'word/document.xml') { crcView.setUint32(at + 16, 123, true); break; }
  assert.throws(() => parseImportBytes('a.docx', badCrc), /damaged document text/);
  const bomb = makeDocx(`<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>${'x'.repeat(20000)}</w:t></w:r></w:p></w:body></w:document>`);
  const bombView = new DataView(bomb.buffer, bomb.byteOffset, bomb.byteLength);
  for (let at = 0; at < bomb.length - 46; at++) {
    if (bombView.getUint32(at, true) === 0x02014b50 && new TextDecoder().decode(bomb.subarray(at + 46, at + 63)) === 'word/document.xml') { bombView.setUint32(at + 24, 1, true); const local = bombView.getUint32(at + 42, true); bombView.setUint32(local + 22, 1, true); break; }
  }
  assert.throws(() => parseImportBytes('a.docx', bomb), /expands beyond/);
});

test('actual PDF text extracts; image-only, excessive pages, excessive text and malformed PDF reject', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const read = async (bytes: Uint8Array) => {
    const task = pdfjs.getDocument({ data: bytes, disableFontFace: true, useSystemFonts: false, useWorkerFetch: false, useWasm: false, verbosity: 0 });
    try { return await extractPdfDocument(await task.promise); } finally { await task.destroy(); }
  };
  const text = await read(makePdf());
  for (const line of applicantLines) assert.ok(text.includes(line), line);
  await assert.rejects(read(makePdf({ imageOnly: true })), /OCR/);
  await assert.rejects(read(makePdf({ password: 'synthetic-test-password' })), { name: 'PasswordException' });
  await assert.rejects(read(makePdf({ pages: IMPORT_LIMITS.pdfPages + 1 })), /50 pages/);
  await assert.rejects(read(makePdf({ pages: 50, fontSize: 3, lines: Array.from({ length: 36 }, () => 'x'.repeat(120)) })), /too much text/);
  await assert.rejects(read(strToU8('%PDF-1.4\nnot a pdf')), /Invalid PDF/);
});

test('worker extraction succeeds and cancel/context abandonment terminates pending parsing', async () => {
  let terminated = 0; let pending = false; let created = 0;
  class LocalWorker {
    onmessage?: (event: { data: ReturnType<typeof parseImportDocument> }) => void;
    onerror?: (event: unknown) => void;
    constructor() { created++; }
    postMessage({ name, bytes }: { name: string; bytes: ArrayBuffer }) { if (!pending) queueMicrotask(() => this.onmessage?.({ data: parseImportDocument(name, new Uint8Array(bytes)) })); }
    terminate() { terminated++; }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: LocalWorker });
  const factory = async () => new LocalWorker() as unknown as Worker;
  try {
    assert.deepEqual(await extractImportFile(new File(['Full name: Alex'], 'a.txt'), {}, factory), { text: 'Full name: Alex', fileName: 'a.txt' });
    assert.equal(terminated, 1);
    const manualOnly = await extractImportFile(new File(['[{"fullName":"Alex"},{"email":"pat@example.test"}]'], 'people.json'), {}, factory);
    assert.equal(manualOnly.manualOnly, true); assert.match(manualOnly.manualOnlyReason!, /flat applicant record/);
    pending = true;
    const controller = new AbortController();
    const promise = extractImportFile(new File(['Full name: Alex'], 'a.txt'), { signal: controller.signal }, factory);
    const rejection = assert.rejects(promise, { name: 'AbortError' });
    await new Promise(resolve => setImmediate(resolve)); controller.abort(); await rejection;
    assert.ok(terminated >= 2);
    const alreadyAborted = new AbortController(); alreadyAborted.abort(); const before = created;
    await assert.rejects(extractImportFile(new File(['x'], 'a.txt'), { signal: alreadyAborted.signal }, factory), { name: 'AbortError' });
    assert.equal(created, before);
    // Cancel while a lazy worker module is still loading; its eventual worker must also terminate.
    const loadingController = new AbortController(); let release: ((worker: Worker) => void) | undefined;
    const loadingPromise = extractImportFile(new File(['x'], 'a.txt'), { signal: loadingController.signal }, () => new Promise(resolve => { release = resolve; }));
    const loadingRejection = assert.rejects(loadingPromise, { name: 'AbortError' });
    await new Promise(resolve => setImmediate(resolve)); loadingController.abort(); await loadingRejection;
    const beforeLateWorker = terminated; release!(new LocalWorker() as unknown as Worker);
    await new Promise(resolve => setImmediate(resolve)); assert.equal(terminated, beforeLateWorker + 1);
  } finally { if (previous) Object.defineProperty(globalThis, 'Worker', previous); else Reflect.deleteProperty(globalThis, 'Worker'); }
});

test('timeout terminates the parser and reports a safe retry message', async context => {
  let terminated = 0;
  class PendingWorker { postMessage() {} terminate() { terminated++; } }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: PendingWorker });
  context.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const promise = extractImportFile(new File(['Full name: Alex'], 'a.txt'), {}, async () => new PendingWorker() as unknown as Worker);
    const rejection = assert.rejects(promise, /took too long/);
    await new Promise(resolve => setImmediate(resolve)); context.mock.timers.tick(IMPORT_LIMITS.timeoutMs + 1); await rejection;
    assert.ok(terminated >= 1);
  } finally { context.mock.timers.reset(); if (previous) Object.defineProperty(globalThis, 'Worker', previous); else Reflect.deleteProperty(globalThis, 'Worker'); }
});
