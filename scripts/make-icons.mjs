import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "static", "icons");
const BLUE = [26, 115, 232];
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function roundedRectSdf(x, y, size, radius) {
  const half = size / 2;
  const px = Math.abs(x - half + 0.5) - (half - radius);
  const py = Math.abs(y - half + 0.5) - (half - radius);
  const dx = Math.max(px, 0);
  const dy = Math.max(py, 0);
  return Math.hypot(dx, dy) + Math.min(Math.max(px, py), 0) - radius;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) {
    return Math.hypot(px - ax, py - ay);
  }
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) {
    return Math.hypot(px - bx, py - by);
  }
  const t = c1 / c2;
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function coverage(distance, width) {
  return Math.max(0, Math.min(1, 0.5 - distance / width));
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  const stroke = size * 0.11;
  const ax = size * 0.28;
  const ay = size * 0.3;
  const cx = size * 0.5;
  const cy = size * 0.74;
  const bx = size * 0.72;
  const by = size * 0.3;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const bg = coverage(roundedRectSdf(x, y, size, radius), 1);
      const v =
        coverage(distToSegment(x + 0.5, y + 0.5, ax, ay, cx, cy) - stroke / 2, 1) +
        coverage(distToSegment(x + 0.5, y + 0.5, bx, by, cx, cy) - stroke / 2, 1);
      const fg = Math.min(1, v);
      const a = Math.min(1, bg);
      const r = BLUE[0] * (1 - fg) + WHITE[0] * fg;
      const g = BLUE[1] * (1 - fg) + WHITE[1] * fg;
      const b = BLUE[2] * (1 - fg) + WHITE[2] * fg;
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(r);
      rgba[i + 1] = Math.round(g);
      rgba[i + 2] = Math.round(b);
      rgba[i + 3] = Math.round(a * 255);
    }
  }
  return encodePng(size, size, rgba);
}

mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(resolve(outDir, `icon${size}.png`), drawIcon(size));
}
console.log(`[API Source] wrote icons in ${outDir}`);
