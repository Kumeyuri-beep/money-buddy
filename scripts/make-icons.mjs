// สร้างไอคอนแอป (PNG) ด้วยโค้ดล้วน ไม่ใช้ไลบรารีรูปภาพ: node scripts/make-icons.mjs
// ออกแบบเอง ตามโทน Aurora Glass (พื้นมืดจาก --bg, ก้อนแสงออโรรา มิ้นต์/ฟ้า/ชมพู, การ์ดกระจก, เหรียญทอง --gold + ตัว M แบบเดียวกับ public/favicon.svg)
// ไม่ใช้โลโก้/ฟอนต์/ภาพของแบรนด์อื่น · ผลลัพธ์ถูก commit ไว้ใน public/ (ไม่ต้องรันตอน build)
// ไม่แตะเครือข่าย ไม่อ่านไฟล์ลับ · ไม่เกี่ยวกับข้อมูลการเงิน
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const BG = [0x07, 0x08, 0x0d];
const GOLD = [0xf2, 0xd0, 0x6b];
const MINT = [0x6f, 0xd9, 0xa8];
const BLUE = [0x8f, 0xb8, 0xff];
const PINK = [0xff, 0x7e, 0xb6];
const WHITE = [255, 255, 255];

const smooth = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
const mix = (base, color, alpha) => base.map((b, i) => b * (1 - alpha) + color[i] * alpha);

/** ระยะจากจุด (px,py) ถึงเส้นตรง a-b */
function segDist(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.min(1, Math.max(0, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
}

/** ระยะแบบมีเครื่องหมายของสี่เหลี่ยมมุมมน (ติดลบ = ข้างใน) */
function roundRectSdf(px, py, half, radius) {
  const qx = Math.abs(px) - (half - radius);
  const qy = Math.abs(py) - (half - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

/** g = สัดส่วนขนาดเนื้อหา (1 = เต็ม · maskable ใช้ 0.8 ให้อยู่ในโซนปลอดภัยวงกลม 80%) */
function render(size, g) {
  const px = new Uint8Array(size * size * 3);
  const aa = 1.2 / size; // ความกว้างขอบเรียบ
  // ตัว M ตามพิกัด favicon (กล่อง 64) ย้ายให้จุดศูนย์กลางอยู่ที่ (0,0) หน่วยเท่ากับสัดส่วนภาพ
  const m = (x, y) => [((x - 32) / 64) * g, ((y - 32) / 64) * g];
  const pts = [m(19, 42), m(19, 22), m(32, 36), m(45, 22), m(45, 42)];
  const ringR = (22 / 64) * g;
  const ringW = (4 / 64) * g;
  const strokeW = (4.5 / 64) * g;
  const cardHalf = 0.4 * g;
  const cardR = 0.16 * g;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      let c = BG;
      // ก้อนแสงออโรรา
      for (const [cx, cy, sigma, a, col] of [
        [0.12, 0.18, 0.36, 0.55, MINT],
        [0.92, 0.28, 0.32, 0.5, BLUE],
        [0.7, 1.0, 0.34, 0.42, PINK],
      ]) {
        const d2 = (u - cx) ** 2 + (v - cy) ** 2;
        c = mix(c, col, a * Math.exp(-d2 / (sigma * sigma)));
      }
      const dx = u - 0.5;
      const dy = v - 0.5;
      // การ์ดกระจก: พื้นขาวโปร่ง ไล่เฉดจากบนลงล่าง + ขอบไฮไลต์
      const sdf = roundRectSdf(dx, dy, cardHalf, cardR);
      const inside = 1 - smooth(-aa, aa, sdf);
      if (inside > 0) {
        const grad = 0.18 - 0.12 * smooth(-cardHalf, cardHalf, dy);
        c = mix(c, WHITE, inside * grad);
        const border = (1 - smooth(0, 0.012 * g + aa, Math.abs(sdf))) * 0.38;
        c = mix(c, WHITE, border);
      }
      // เหรียญทอง: วงแหวน
      const ring = 1 - smooth(ringW / 2 - aa, ringW / 2 + aa, Math.abs(Math.hypot(dx, dy) - ringR));
      c = mix(c, GOLD, ring);
      // ตัว M
      let md = Infinity;
      for (let i = 0; i < pts.length - 1; i++) md = Math.min(md, segDist(dx, dy, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
      const mAlpha = 1 - smooth(strokeW / 2 - aa, strokeW / 2 + aa, md);
      c = mix(c, GOLD, mAlpha);
      const o = (y * size + x) * 3;
      px[o] = Math.round(c[0]);
      px[o + 1] = Math.round(c[1]);
      px[o + 2] = Math.round(c[2]);
    }
  }
  return px;
}

// ---------- ตัวเข้ารหัส PNG (RGB 8 บิต ไม่มีความโปร่งใส) ----------
const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 บิตต่อช่อง
  ihdr[9] = 2; // RGB
  const rows = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    rows[y * (size * 3 + 1)] = 0; // filter: none
    Buffer.from(rgb.buffer, y * size * 3, size * 3).copy(rows, y * (size * 3 + 1) + 1);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const outDir = resolve(root, 'public');
mkdirSync(outDir, { recursive: true });
const targets = [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-maskable-512.png', 512, 0.8],
  ['apple-touch-icon.png', 180, 0.95],
];
for (const [name, size, g] of targets) {
  writeFileSync(resolve(outDir, name), encodePng(size, render(size, g)));
  console.log(`เขียน public/${name} (${size}x${size})`);
}
