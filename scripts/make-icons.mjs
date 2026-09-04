// Erzeugt die PWA-Icons als PNG – ohne externe Abhängigkeit.
// Aufruf: node scripts/make-icons.mjs
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/icons');

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // Filter: keiner
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 6; // Farbtyp RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** Blauer Kreis mit weißer Papierflieger-Silhouette. */
function makeIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const s = size / 100;
  const put = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (Math.round(y) * size + Math.round(x)) * 4;
    const src = a;
    buf[i] = Math.round(buf[i] * (1 - src) + r * src);
    buf[i + 1] = Math.round(buf[i + 1] * (1 - src) + g * src);
    buf[i + 2] = Math.round(buf[i + 2] * (1 - src) + b * src);
    buf[i + 3] = Math.min(255, Math.round(buf[i + 3] + 255 * src));
  };

  // Dreiecks-Test für die Flieger-Form
  const sign = (ax, ay, bx, by, cx, cy) => (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
  const inTriangle = (px, py, t) => {
    const d1 = sign(px, py, t[0], t[1], t[2], t[3]);
    const d2 = sign(px, py, t[2], t[3], t[4], t[5]);
    const d3 = sign(px, py, t[4], t[5], t[0], t[1]);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  };

  const wingBig = [22, 49, 74, 28, 47, 60].map((v) => v * s);
  const wingTail = [47, 60, 74, 28, 64, 74].map((v) => v * s);
  const wingFold = [39, 68, 47, 60, 41, 55].map((v) => v * s);

  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 0.5;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const edge = Math.min(1, Math.max(0, radius - dist));
      if (edge <= 0) continue;
      // Verlauf von hell nach dunkel
      const t = y / size;
      put(x, y, Math.round(94 - 43 * t), Math.round(181 - 37 * t), Math.round(247 - 11 * t), edge);
      if (inTriangle(x, y, wingBig) || inTriangle(x, y, wingTail)) put(x, y, 255, 255, 255, edge);
      else if (inTriangle(x, y, wingFold)) put(x, y, 214, 232, 250, edge);
    }
  }
  return encodePng(size, size, buf);
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of [180, 192, 512]) {
  const file = path.join(OUT, `icon-${size}.png`);
  fs.writeFileSync(file, makeIcon(size));
  console.log('geschrieben:', path.relative(process.cwd(), file));
}
