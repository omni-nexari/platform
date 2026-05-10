// Generate apps/nexari-windows/build/icon.ico from Docs/logo/nexari.png.
// Produces a multi-size PNG-encoded ICO (16/24/32/48/64/128/256).
// Run: node apps/nexari-windows/scripts/build-icon.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const SRC = path.join(repoRoot, 'Docs/logo/nexari.png');
const OUT = path.join(__dirname, '..', 'build', 'icon.ico');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  if (!fs.existsSync(SRC)) throw new Error('Source PNG not found: ' + SRC);

  // Trim near-white margins around the wordmark so the icon fills the canvas,
  // then pad to a square with transparent background before resizing.
  const trimmed = await sharp(SRC)
    .ensureAlpha()
    .trim({ threshold: 10 })
    .toBuffer();
  const meta = await sharp(trimmed).metadata();
  const side = Math.max(meta.width ?? 0, meta.height ?? 0);
  const square = await sharp(trimmed)
    .resize({
      width: side,
      height: side,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const pngs = [];
  for (const size of SIZES) {
    const buf = await sharp(square)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    pngs.push({ size, buf });
  }

  // Assemble ICO: ICONDIR (6) + ICONDIRENTRY*N (16 each) + payloads.
  const headerSize = 6 + 16 * pngs.length;
  let offset = headerSize;
  const dir = Buffer.alloc(headerSize);
  dir.writeUInt16LE(0, 0); // reserved
  dir.writeUInt16LE(1, 2); // type = icon
  dir.writeUInt16LE(pngs.length, 4); // count

  pngs.forEach(({ size, buf }, i) => {
    const e = 6 + i * 16;
    dir.writeUInt8(size === 256 ? 0 : size, e + 0); // width (0 means 256)
    dir.writeUInt8(size === 256 ? 0 : size, e + 1); // height
    dir.writeUInt8(0, e + 2); // colorCount
    dir.writeUInt8(0, e + 3); // reserved
    dir.writeUInt16LE(1, e + 4); // planes
    dir.writeUInt16LE(32, e + 6); // bpp
    dir.writeUInt32LE(buf.length, e + 8); // size
    dir.writeUInt32LE(offset, e + 12); // offset
    offset += buf.length;
  });

  const out = Buffer.concat([dir, ...pngs.map((p) => p.buf)]);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out);
  console.log(`Wrote ${OUT} (${out.length} bytes, sizes: ${SIZES.join(',')})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
