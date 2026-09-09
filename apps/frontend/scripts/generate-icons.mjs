/**
 * Generates placeholder app icons without any dependency.
 * Output: public/icons/*.png and public/icons/favicon.svg
 *
 * Replace these files with real brand icons before release.
 * Run: pnpm icons
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const outDir = path.resolve(import.meta.dirname, '../public/icons');
const background = [15, 23, 42]; // slate-900
const foreground = [255, 255, 255];

// ---- Minimal PNG encoder (RGBA, no filter) ----
const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(size, pixelAt) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);

  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0; // filter type: none
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixelAt(x, y);
      const offset = y * stride + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // color type RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- Icon drawing: rounded square background + white circle ----
function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function coverage(distance) {
  // 1px anti-aliasing edge
  return Math.min(1, Math.max(0, 0.5 - distance));
}

function drawIcon(size, { maskable }) {
  const center = size / 2;
  const radius = size * (maskable ? 0.22 : 0.3);
  const cornerRadius = maskable ? 0 : size * 0.22;

  return encodePng(size, (x, y) => {
    const px = x + 0.5;
    const py = y + 0.5;

    // Rounded-rectangle coverage for the background.
    let bgAlpha = 1;
    if (!maskable) {
      const dx = Math.max(Math.abs(px - center) - (center - cornerRadius), 0);
      const dy = Math.max(Math.abs(py - center) - (center - cornerRadius), 0);
      const outside = Math.sqrt(dx * dx + dy * dy) - cornerRadius;
      bgAlpha = coverage(outside);
    }

    // Circle coverage for the foreground.
    const dist = Math.sqrt((px - center) ** 2 + (py - center) ** 2) - radius;
    const fgAlpha = coverage(dist);

    const r = mix(background[0], foreground[0], fgAlpha);
    const g = mix(background[1], foreground[1], fgAlpha);
    const b = mix(background[2], foreground[2], fgAlpha);

    return [r, g, b, Math.round(bgAlpha * 255)];
  });
}

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0f172a"/>
  <circle cx="32" cy="32" r="19" fill="#ffffff"/>
</svg>
`;

mkdirSync(outDir, { recursive: true });

const files = [
  ['pwa-192x192.png', drawIcon(192, { maskable: false })],
  ['pwa-512x512.png', drawIcon(512, { maskable: false })],
  ['pwa-maskable-512x512.png', drawIcon(512, { maskable: true })],
  ['apple-touch-icon.png', drawIcon(180, { maskable: true })],
  ['favicon.svg', favicon],
];

for (const [name, content] of files) {
  writeFileSync(path.join(outDir, name), content);
  console.log(
    `icons: wrote ${path.relative(process.cwd(), path.join(outDir, name))}`,
  );
}
