// Generates the PWA / apple-touch icons as PNG files without any dependency.
// Run with: node scripts/make-icons.mjs
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/icons');

function crc32(buf) {
  let c, crc = 0xffffffff;
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
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function makeIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const px = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const src = a / 255;
    buf[i] = Math.round(buf[i] * (1 - src) + r * src);
    buf[i + 1] = Math.round(buf[i + 1] * (1 - src) + g * src);
    buf[i + 2] = Math.round(buf[i + 2] * (1 - src) + b * src);
    buf[i + 3] = Math.max(buf[i + 3], a);
  };
  const rect = (x0, y0, w, h, c, a = 255) => {
    for (let y = Math.round(y0); y < Math.round(y0 + h); y++) {
      for (let x = Math.round(x0); x < Math.round(x0 + w); x++) px(x, y, c[0], c[1], c[2], a);
    }
  };
  const s = size / 100; // work in a 100x100 design space

  // background
  rect(0, 0, size, size, [17, 20, 27]);
  // asphalt cross (city block look)
  rect(0, 34 * s, size, 32 * s, [38, 40, 47]);
  rect(34 * s, 0, 32 * s, size, [38, 40, 47]);
  // lane markings
  for (let i = 0; i < 100; i += 14) {
    rect(i * s, 49 * s, 8 * s, 2 * s, [201, 196, 106]);
    rect(49 * s, i * s, 2 * s, 8 * s, [201, 196, 106]);
  }
  // buildings in the corners
  const blocks = [[6, 6], [66, 6], [6, 66], [66, 66]];
  for (const [bx, by] of blocks) {
    rect(bx * s, by * s, 28 * s, 28 * s, [74, 79, 92]);
    rect((bx + 3) * s, (by + 3) * s, 22 * s, 22 * s, [90, 96, 112]);
  }
  // yellow car, top down, pointing right
  rect(38 * s, 44 * s, 26 * s, 13 * s, [255, 210, 63]);
  rect(36 * s, 46 * s, 4 * s, 9 * s, [255, 210, 63]);
  rect(46 * s, 45 * s, 10 * s, 11 * s, [40, 44, 56]);   // roof
  rect(57 * s, 46 * s, 4 * s, 9 * s, [140, 190, 230]);  // windscreen
  rect(38 * s, 42 * s, 26 * s, 2 * s, [0, 0, 0], 60);   // slight shading
  return encodePng(size, size, buf);
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of [180, 192, 512]) {
  fs.writeFileSync(path.join(OUT, `icon-${size}.png`), makeIcon(size));
  console.log('wrote', path.join(OUT, `icon-${size}.png`));
}
