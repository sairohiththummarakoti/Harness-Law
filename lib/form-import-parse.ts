import { Unzip, UnzipInflate } from 'fflate';
import { checkedImportText, FormImportError, IMPORT_LIMITS, importFormat, type ParsedImportDocument } from './form-import-limits.ts';

function decodeText(bytes: Uint8Array): string {
  try {
    const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    const text = new TextDecoder(utf16, { fatal: true }).decode(bytes);
    if (/[\u0000-\u0008\u000E-\u001F]/.test(text)) throw new Error('binary');
    return checkedImportText(text);
  } catch (error) {
    if (error instanceof FormImportError) throw error;
    throw new FormImportError('This is not readable text. Save a UTF-8 text copy or choose a supported document.');
  }
}

function jsonText(text: string): ParsedImportDocument {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new FormImportError('This JSON file is malformed. Check the file or choose a TXT copy.'); }
  const lines: string[] = [];
  let length = 0;
  let manualOnly = value === null || Array.isArray(value) || typeof value !== 'object';
  const add = (line: string) => { length += line.length + 1; if (length > IMPORT_LIMITS.textCharacters) throw new FormImportError('The extracted JSON is too long. Choose a shorter document.'); lines.push(line); };
  const scalar = (item: unknown): string => item === null ? 'null' : String(item);
  const visit = (item: unknown, key: string, depth: number): void => {
    if (depth > IMPORT_LIMITS.jsonDepth) throw new FormImportError('This JSON is nested too deeply. Use a simpler file.');
    if (/[\r\n\u2028\u2029]/.test(key) || typeof item === 'string' && /[\r\n\u2028\u2029]/.test(item)) manualOnly = true;
    if (Array.isArray(item)) {
      if (item.every(entry => entry === null || typeof entry !== 'object')) {
        if (item.some(entry => typeof entry === 'string' && /[\r\n\u2028\u2029]/.test(entry))) manualOnly = true;
        add(`${key ? `${key}: ` : ''}${item.map(scalar).join('; ')}`);
      }
      else { manualOnly = true; if (key) add(`${key}:`); item.forEach((entry, index) => { add(`Record ${index + 1}`); visit(entry, '', depth + 1); }); }
    } else if (item !== null && typeof item === 'object') {
      if (depth > 0) manualOnly = true;
      if (key) add(`${key}:`);
      for (const [label, child] of Object.entries(item)) visit(child, label, depth + 1);
    } else add(`${key ? `${key}: ` : ''}${scalar(item)}`);
  };
  visit(value, '', 0);
  return { text: checkedImportText(lines.join('\n')), ...(manualOnly ? { manualOnly: true, manualOnlyReason: 'This JSON does not describe one flat applicant record, or contains multiline values. Select the applicant’s text and assign fields manually.' } : {}) };
}

function csvText(text: string): ParsedImportDocument {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false; let endedQuote = false;
  const endCell = () => { row.push(cell); cell = ''; endedQuote = false; if (row.length > IMPORT_LIMITS.csvColumns) throw new FormImportError('This CSV has too many columns. Use up to 100 columns.'); };
  const endRow = () => { endCell(); if (row.some(value => value.trim())) rows.push(row); row = []; if (rows.length > IMPORT_LIMITS.csvRows) throw new FormImportError('This CSV has too many rows. Use up to 2,000 rows.'); };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') { quoted = false; endedQuote = true; }
      else cell += char;
    } else if (char === ',' ) endCell();
    else if (char === '\n') endRow();
    else if (char === '"' && !cell && !endedQuote) quoted = true;
    else if (endedQuote && char.trim()) throw new FormImportError('This CSV has malformed quoted values. Check the file or choose a TXT copy.');
    else cell += char;
  }
  if (quoted) throw new FormImportError('This CSV has an unfinished quoted value. Check the file or choose a TXT copy.');
  if (cell || row.length) endRow();
  if (!rows.length) return { text: '' };
  const multiline = rows.some(entry => entry.some(value => /[\r\n\u2028\u2029]/.test(value)));
  const result = (value: string): ParsedImportDocument => ({ text: checkedImportText(value), ...(multiline ? { manualOnly: true, manualOnlyReason: 'This CSV contains multiline cells. Select the applicant’s text and assign fields manually.' } : {}) });
  if (rows.every(entry => entry.length === 2) && /^(field|label|question|key)$/i.test(rows[0][0].trim()) && /^(value|answer)$/i.test(rows[0][1].trim())) return result(rows.slice(1).map(([key, value]) => `${key.trim()}: ${value}`).join('\n'));
  const headerLabels = new Set(['name', 'full name', 'legal name', 'full legal name', 'preferred name', 'prior names', 'phone', 'phone number', 'email', 'country', 'address', 'field', 'professional field', 'role', 'current role', 'organization', 'employer', 'timeline', 'experience', 'achievements', 'intended work', 'visa', 'visa type', 'birth country', 'country of birth', 'citizenships', 'citizenship', 'criteria', 'criteria unsure', 'major award', 'help for', 'notes', 'case name', 'text', 'value', 'reason']);
  const isHeader = (label: string) => headerLabels.has(label.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase());
  if (rows.length === 2 && rows[0].length === rows[1].length && rows[0].every(isHeader)) return result(rows[0].map((key, index) => `${key.trim()}: ${rows[1][index]}`).join('\n'));
  // Multiple records have no reliable applicant identity. Preserve text for manual assignment.
  return { text, manualOnly: true, manualOnlyReason: 'This CSV contains multiple records or an ambiguous table. Select the applicant’s text and assign fields manually.' };
}

type ZipEntry = { size: number; compressed: number; method: number; offset: number; crc: number };
const crcTable = Uint32Array.from({ length: 256 }, (_, initial) => {
  let value = initial;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
function zipDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const malformed = () => new FormImportError('This DOCX archive is malformed or unsupported. Save a fresh DOCX or TXT copy.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => { if (at < 0 || at + 2 > bytes.length) throw malformed(); return view.getUint16(at, true); };
  const u32 = (at: number) => { if (at < 0 || at + 4 > bytes.length) throw malformed(); return view.getUint32(at, true); };
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length) break;
  if (end < 0 || u32(end) !== 0x06054b50) throw malformed();
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) throw malformed();
  const count = u16(end + 10); const directorySize = u32(end + 12); let position = u32(end + 16);
  if (!count || count > IMPORT_LIMITS.archiveEntries) throw new FormImportError('This DOCX has too many archive entries. Choose a simpler document.');
  if (position + directorySize !== end) throw malformed(); // also rejects ZIP64/multidisk archives
  const directoryStart = position; const entries = new Map<string, ZipEntry>(); let expanded = 0;
  for (let index = 0; index < count; index++) {
    if (u32(position) !== 0x02014b50) throw malformed();
    const flags = u16(position + 8), method = u16(position + 10), crc = u32(position + 16), compressed = u32(position + 20), size = u32(position + 24);
    const nameLength = u16(position + 28), extraLength = u16(position + 30), commentLength = u16(position + 32), offset = u32(position + 42);
    if (flags & 1) throw new FormImportError('Encrypted DOCX files are not supported. Choose an unencrypted copy.');
    if (![0, 8].includes(method) || compressed > bytes.length || offset >= directoryStart || position + 46 + nameLength + extraLength + commentLength > end) throw malformed();
    expanded += size;
    if (expanded > IMPORT_LIMITS.archiveBytes) throw new FormImportError('This DOCX expands beyond the 20 MB limit. Choose a smaller document.');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(position + 46, position + 46 + nameLength));
    if (entries.has(name) || name.includes('..') || name.includes('\\')) throw malformed();
    if (u32(offset) !== 0x04034b50 || u16(offset + 8) !== method || u16(offset + 6) !== flags) throw malformed();
    const localNameLength = u16(offset + 26), localExtraLength = u16(offset + 28);
    if (localNameLength !== nameLength || offset + 30 + localNameLength + localExtraLength + compressed > directoryStart) throw malformed();
    const localName = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 30, offset + 30 + localNameLength));
    if (localName !== name) throw malformed();
    entries.set(name, { size, compressed, method, offset, crc }); position += 46 + nameLength + extraLength + commentLength;
  }
  if (position !== end || !entries.has('word/document.xml') || !entries.has('[Content_Types].xml')) throw malformed();
  return entries;
}

function xmlEntities(value: string): string {
  return value.replace(/&([^;\s]*);|&/g, (whole, entity: string | undefined) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (entity && Object.hasOwn(named, entity)) return named[entity];
    if (entity && /^#(?:[0-9]+|x[\da-f]+)$/i.test(entity)) {
      const number = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      if (number > 0 && number <= 0x10ffff && (number < 0xd800 || number > 0xdfff)) return String.fromCodePoint(number);
    }
    throw new FormImportError('This DOCX contains unsupported XML entities. Save a fresh copy.');
  });
}

/** A bounded XML text reader, not an HTML renderer. Never follows relationships or entities. */
export function docxXmlText(xml: string): string {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new FormImportError('This DOCX contains unsupported XML declarations. Save a fresh copy.');
  type Frame = { name: string; local: string; suppressed: boolean; namespaces: Record<string, string>; alternate?: { selected: boolean }; run?: { parts: string[]; hidden: boolean } };
  const parts: string[] = []; const stack: Frame[] = []; let position = 0; let root = ''; let length = 0;
  const activeRun = () => stack.findLast(frame => frame.run)?.run;
  const append = (text: string, alreadyCounted = false) => {
    const run = activeRun();
    if (stack.at(-1)?.suppressed || run?.hidden) return;
    if (!alreadyCounted) length += text.length;
    if (length > IMPORT_LIMITS.textCharacters) throw new FormImportError('This document contains too much text. Choose a shorter document.');
    (run?.parts ?? parts).push(text);
  };
  // Choices requiring drawing, math, or newer Word extension namespaces are not
  // supported by this text reader. Use their fallback instead of duplicating both.
  const supportedChoiceNamespaces = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']);
  const malformed = () => new FormImportError('This DOCX contains malformed document text. Save a fresh DOCX or TXT copy.');
  while (position < xml.length) {
    if (xml[position] !== '<') {
      const next = xml.indexOf('<', position), end = next < 0 ? xml.length : next;
      const text = xml.slice(position, end);
      if (stack.at(-1)?.local === 't') append(xmlEntities(text));
      else if (!stack.length && text.trim()) throw malformed();
      position = end; continue;
    }
    if (xml.startsWith('<!--', position)) { const end = xml.indexOf('-->', position + 4); if (end < 0) throw malformed(); position = end + 3; continue; }
    if (xml.startsWith('<?xml ', position) && !root) { const end = xml.indexOf('?>', position + 6); if (end < 0) throw malformed(); position = end + 2; continue; }
    if (xml.startsWith('<![CDATA[', position)) { const end = xml.indexOf(']]>', position + 9); if (end < 0) throw malformed(); if (stack.at(-1)?.local === 't') append(xml.slice(position + 9, end)); position = end + 3; continue; }
    let end = position + 1; let quote = '';
    for (; end < xml.length; end++) { const char = xml[end]; if (quote) { if (char === quote) quote = ''; } else if (char === '"' || char === "'") quote = char; else if (char === '>') break; }
    if (end >= xml.length || quote) throw malformed();
    const tag = xml.slice(position + 1, end); const match = tag.match(/^(\/)?([A-Za-z_][\w.:-]*)([\s\S]*?)\s*(\/)?$/);
    if (!match) throw malformed();
    const [, closing, name, attributes, selfClosing] = match; const local = name.split(':').pop()!;
    if (closing) {
      const frame = stack.pop();
      if (attributes.trim() || selfClosing || frame?.name !== name) throw malformed();
      if (!frame.suppressed) {
        if (frame.run && !frame.run.hidden) append(frame.run.parts.join(''), true);
        if (local === 'p' || local === 'tr') append('\n'); else if (local === 'tc') append('\t');
      }
    }
    else {
      const parsedAttributes: Record<string, string> = Object.create(null);
      if (attributes.replace(/\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/g, (_match, attribute: string, doubleQuoted: string | undefined, singleQuoted: string | undefined) => {
        if (Object.hasOwn(parsedAttributes, attribute)) throw malformed();
        parsedAttributes[attribute] = xmlEntities(doubleQuoted ?? singleQuoted ?? ''); return '';
      }).trim()) throw malformed();
      const parent = stack.at(-1);
      const namespaces: Record<string, string> = Object.assign(Object.create(null), parent?.namespaces);
      for (const [attribute, value] of Object.entries(parsedAttributes)) if (attribute.startsWith('xmlns:')) namespaces[attribute.slice(6)] = value;
      let suppressed = parent?.suppressed ?? false;
      if (['del', 'moveFrom', 'rPrChange', 'pPrChange'].includes(local)) suppressed = true;
      if (parent?.alternate && (local === 'Choice' || local === 'Fallback')) {
        const requires = parsedAttributes.Requires?.trim().split(/\s+/) ?? [];
        const supported = local === 'Fallback' || requires.length > 0 && requires.every(prefix => supportedChoiceNamespaces.has(namespaces[prefix]));
        suppressed ||= parent.alternate.selected || !supported;
        if (!suppressed) parent.alternate.selected = true;
      }
      const frame: Frame = { name, local, suppressed, namespaces, ...(local === 'AlternateContent' ? { alternate: { selected: false } } : {}), ...(local === 'r' ? { run: { parts: [], hidden: false } } : {}) };
      if (!root) { root = local; if (!['document', 'hdr', 'ftr'].includes(root)) throw malformed(); }
      else if (!stack.length) throw malformed();
      if (!suppressed && (local === 'vanish' || local === 'webHidden') && stack.some(entry => entry.local === 'rPr')) {
        const value = Object.entries(parsedAttributes).find(([attribute]) => attribute.split(':').pop() === 'val')?.[1];
        if (!value || !['0', 'false', 'off'].includes(value.toLowerCase())) { const run = activeRun(); if (run) { run.hidden = true; run.parts = []; } }
      }
      if (!suppressed) { if (local === 'tab') append('\t'); else if (local === 'br' || local === 'cr') append('\n'); }
      if (!selfClosing) { stack.push(frame); if (stack.length > 100) throw malformed(); }
    }
    position = end + 1;
  }
  if (!root || stack.length) throw malformed();
  return checkedImportText(parts.join(''));
}

function docxDocument(bytes: Uint8Array): ParsedImportDocument {
  const entries = zipDirectory(bytes); const xmlFiles = new Map<string, Uint8Array[]>(); const finished = new Set<string>(); const seen = new Set<string>();
  let totalXml = 0;
  const unzip = new Unzip(file => {
    const entry = entries.get(file.name);
    if (!entry || seen.has(file.name)) throw new FormImportError('This DOCX archive is malformed. Save a fresh copy.');
    seen.add(file.name);
    if (file.originalSize !== undefined && file.originalSize !== entry.size) throw new FormImportError('This DOCX archive has inconsistent sizes. Save a fresh copy.');
    if (!/^word\/(?:document|styles|header\d*|footer\d*)\.xml$/.test(file.name)) return;
    if (entry.size > IMPORT_LIMITS.xmlBytes) throw new FormImportError('This DOCX contains too much document markup. Choose a simpler document.');
    const chunks: Uint8Array[] = []; let size = 0; let crc = 0xffffffff; xmlFiles.set(file.name, chunks);
    file.ondata = (error, data, final) => {
      if (error) throw error instanceof FormImportError ? error : new FormImportError('This DOCX could not be expanded. Save a fresh copy.');
      size += data.length; totalXml += data.length;
      if (size > entry.size || size > IMPORT_LIMITS.xmlBytes || totalXml > IMPORT_LIMITS.xmlBytes) throw new FormImportError('This DOCX expands beyond the document text limit. Choose a simpler document.');
      for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
      chunks.push(data);
      if (final) { if (size !== entry.size || (crc ^ 0xffffffff) >>> 0 !== entry.crc) throw new FormImportError('This DOCX archive has damaged document text. Save a fresh copy.'); finished.add(file.name); }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  // Small input chunks bound temporary inflater output even for misleading ZIP size metadata.
  for (let offset = 0; offset < bytes.length; offset += 1024) unzip.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
  const texts: string[] = []; let hiddenStyles = false;
  for (const [name, chunks] of [...xmlFiles.entries()].sort(([a], [b]) => a === 'word/document.xml' ? -1 : b === 'word/document.xml' ? 1 : a.localeCompare(b))) {
    if (!finished.has(name)) throw new FormImportError('This DOCX is incomplete. Save a fresh copy.');
    const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0); const output = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    const xml = new TextDecoder('utf-8', { fatal: true }).decode(output);
    if (name === 'word/styles.xml') {
      // Resolving arbitrary style inheritance is outside this raw-text reader.
      // Keep ambiguous visibility out of automatic matching rather than assuming
      // the style is applied, or guessing which runs are visible in Word.
      hiddenStyles = /<(?:[\w.-]+:)?(?:vanish|webHidden)(?:\s|\/?>)/.test(xml);
    } else texts.push(docxXmlText(xml));
  }
  if (!finished.has('word/document.xml')) throw new FormImportError('This DOCX has no readable document part. Save a fresh copy.');
  return { text: checkedImportText(texts.join('\n\n')), ...(hiddenStyles ? { manualOnly: true, manualOnlyReason: 'This DOCX uses hidden-text styles. The extracted text may include text hidden by those styles. Select only visible applicant text and assign fields manually.' } : {}) };
}

/** Pure byte extraction used only inside a terminable browser worker (and parser tests). */
export function parseImportDocument(name: string, bytes: Uint8Array): ParsedImportDocument {
  const format = importFormat(name, bytes.length);
  if (format === 'pdf') throw new FormImportError('Use the PDF text parser for this file.');
  if (format === 'docx') {
    const parsed = docxDocument(bytes);
    if (!parsed.text) throw new FormImportError('This DOCX has no readable text. Images and scans need OCR first.');
    return parsed;
  }
  const text = decodeText(bytes);
  return format === 'json' ? jsonText(text) : format === 'csv' ? csvText(text) : { text };
}

/** Text-only compatibility helper; callers generating suggestions must use parseImportDocument. */
export function parseImportBytes(name: string, bytes: Uint8Array): string { return parseImportDocument(name, bytes).text; }
