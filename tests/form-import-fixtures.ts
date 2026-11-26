import { strToU8, zipSync } from 'fflate';
import { createHash } from 'node:crypto';

export const applicantLines = ['Full name: Alex Applicant', 'Phone: +1 555 010 4422', 'Professional field: Engineering', 'Role: Research engineer'];
export function makeDocx(xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${applicantLines.map(line => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`, extra: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({ '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'), 'word/document.xml': strToU8(xml), ...extra });
}

/** Minimal real PDFs with exact byte offsets; no fixture-generation dependency. */
export function makePdf({ pages = 1, lines = applicantLines, imageOnly = false, password, fontSize = 12 }: { pages?: number; lines?: string[]; imageOnly?: boolean; password?: string; fontSize?: number } = {}): Uint8Array {
  const md5 = (data: Uint8Array) => createHash('md5').update(data).digest();
  const rc4 = (key: Uint8Array, data: Uint8Array) => {
    const permutation = Array.from({ length: 256 }, (_, index) => index); let second = 0;
    for (let first = 0; first < 256; first++) { second = (second + permutation[first] + key[first % key.length]) % 256; [permutation[first], permutation[second]] = [permutation[second], permutation[first]]; }
    let first = 0; second = 0;
    return Buffer.from(data.map(value => { first = (first + 1) % 256; second = (second + permutation[first]) % 256; [permutation[first], permutation[second]] = [permutation[second], permutation[first]]; return value ^ permutation[(permutation[first] + permutation[second]) % 256]; }));
  };
  const padding = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
  const documentId = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const padded = Buffer.concat([Buffer.from(password ?? ''), padding]).subarray(0, 32);
  const owner = rc4(md5(padded).subarray(0, 5), padded);
  const permissions = Buffer.alloc(4); permissions.writeInt32LE(-4);
  const encryptionKey = md5(Buffer.concat([padded, owner, permissions, documentId])).subarray(0, 5);
  const user = rc4(encryptionKey, padding);
  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, index) => `${4 + index * 2} 0 R`).join(' ')}] >>`;
  objects[3] = imageOnly ? '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 3 >>\nstream\nABC\nendstream' : '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  for (let page = 0; page < pages; page++) {
    const pageId = 4 + page * 2, streamId = pageId + 1;
    const resources = imageOnly ? '/XObject << /Im1 3 0 R >>' : '/Font << /F1 3 0 R >>';
    let content = imageOnly ? 'q 100 0 0 100 10 10 cm /Im1 Do Q' : `BT /F1 ${fontSize} Tf 50 740 Td ${lines.map((line, index) => `${index ? '0 -20 Td ' : ''}(${line.replace(/[\\()]/g, '\\$&')}) Tj`).join(' ')} ET`;
    if (password) { const objectNumber = Buffer.from([streamId & 255, (streamId >> 8) & 255, (streamId >> 16) & 255, 0, 0]); const key = md5(Buffer.concat([encryptionKey, objectNumber])).subarray(0, 10); content = rc4(key, Buffer.from(content)).toString('latin1'); }
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << ${resources} >> /Contents ${streamId} 0 R >>`;
    objects[streamId] = `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`;
  }
  const encryptionId = objects.length;
  if (password) objects[encryptionId] = `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${owner.toString('hex')}> /U <${user.toString('hex')}> /P -4 >>`;
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  for (let index = 1; index < objects.length; index++) { offsets[index] = Buffer.byteLength(pdf, 'latin1'); pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R${password ? ` /Encrypt ${encryptionId} 0 R /ID [<${documentId.toString('hex')}> <${documentId.toString('hex')}>]` : ''} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}
