import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Resize the approved cutout without redrawing or simplifying the puzzle.
const root = new URL('../', import.meta.url);
const source = fileURLToPath(new URL('assets/brand/puzzle-mark-master.png', root));
const output = fileURLToPath(new URL('public/', root));
await mkdir(`${output}/brand`, { recursive: true });
const mark = await sharp(source).trim().png().toBuffer();
await sharp(mark).resize(256, 256, { fit: 'contain', background: '#00000000' })
  .webp({ quality: 90, alphaQuality: 100 }).toFile(`${output}/brand/puzzle-mark.webp`);

const forest = '#082f26';
async function icon(size) {
  const inset = Math.max(1, Math.round(size * 0.08));
  const puzzle = await sharp(mark).resize(size - inset * 2, size - inset * 2,
    { fit: 'contain', background: '#00000000' }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: forest } })
    .composite([{ input: puzzle, gravity: 'centre' }]).png().toBuffer();
}
for (const size of [16, 32, 192]) {
  await writeFile(`${output}/favicon-${size}.png`, await icon(size));
}
await writeFile(`${output}/apple-touch-icon.png`, await icon(180));

// Keep the historic SVG URL current for old bookmarks and direct requests.
const embedded = (await icon(128)).toString('base64');
await writeFile(`${output}/favicon.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><image width="128" height="128" href="data:image/png;base64,${embedded}"/></svg>\n`);

// Include a conventional multi-resolution favicon for browsers that request it.
const sizes = [16, 32, 48];
const frames = await Promise.all(sizes.map(icon));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
frames.forEach((frame, index) => {
  const entry = 6 + index * 16;
  header[entry] = sizes[index];
  header[entry + 1] = sizes[index];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frame.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
});
await writeFile(`${output}/favicon.ico`, Buffer.concat([header, ...frames]));
console.log('Built puzzle wordmark asset, favicons, and Apple touch icon.');
