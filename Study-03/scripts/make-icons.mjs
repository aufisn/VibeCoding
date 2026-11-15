// Generate the placeholder app icons (icons/icon-192.png, icons/icon-512.png)
// with no dependencies: a blue square with a white "Q" ring. Re-run after
// changing the colours:  node scripts/make-icons.mjs

import { writeFile, mkdir } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const BG = [0x3d, 0x5a, 0xfe]; // --color-primary (light)
const FG = [0xff, 0xff, 0xff];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Is pixel (x, y) part of the "Q" (ring plus tail)? Coordinates in 0..1. */
function inGlyph(x, y) {
  const dx = x - 0.5;
  const dy = y - 0.47;
  const r = Math.hypot(dx, dy);
  if (r >= 0.2 && r <= 0.29) return true;
  // Tail: a thick diagonal stroke towards the bottom right.
  const t = (dx + dy) / 2; // position along the diagonal
  const d = Math.abs(dx - dy) / Math.SQRT2; // distance from it
  return t > 0.12 && t < 0.27 && d < 0.05;
}

function png(size) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3); // filter byte 0, then RGB
    for (let x = 0; x < size; x++) {
      const color = inGlyph((x + 0.5) / size, (y + 0.5) / size) ? FG : BG;
      row.set(color, 1 + x * 3);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const dir = new URL("../icons/", import.meta.url);
await mkdir(dir, { recursive: true });
for (const size of [192, 512]) {
  await writeFile(new URL(`icon-${size}.png`, dir), png(size));
  console.log(`icons/icon-${size}.png`);
}
