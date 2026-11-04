/**
 * ตรวจไฟล์รูปสลิปและคำนวณขนาดย่อ (ฟังก์ชันล้วน ไม่แตะ DOM)
 * รูปไม่ถูกส่งออกนอกเครื่องและไม่ถูกเก็บ ส่วนที่แตะรูปจริงอยู่ใน src/ocr/
 */

export const MAX_SLIP_BYTES = 15 * 1024 * 1024;
export const MAX_SLIP_SIDE = 1600;

export type SlipFileCheck = { ok: true } | { ok: false; message: string };

/** ชนิดรูปที่รับ (ตรงกับที่ readImageSize อ่านขนาดจากหัวไฟล์ได้) SVG ไม่รับ เพราะไม่ใช่สลิปที่แคปมาและอาจมีสคริปต์ */
const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

export function validateSlipFile(file: { type: string; size: number }): SlipFileCheck {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    return { ok: false, message: 'ไฟล์นี้ไม่ใช่รูปภาพ เลือกรูปสลิปที่เป็น PNG หรือ JPEG' };
  }
  if (!ACCEPTED_TYPES.has(file.type)) {
    return { ok: false, message: 'รองรับเฉพาะรูป PNG, JPEG หรือ WebP ลองแคปหน้าจอสลิปใหม่' };
  }
  if (file.size <= 0) return { ok: false, message: 'ไฟล์ว่างเปล่า เลือกรูปสลิปอีกครั้ง' };
  if (file.size > MAX_SLIP_BYTES) {
    return { ok: false, message: 'ไฟล์ใหญ่เกิน 15 MB ลองแคปหน้าจอสลิปใหม่แทนรูปต้นฉบับ' };
  }
  return { ok: true };
}

export interface FittedSize {
  width: number;
  height: number;
  /** true เมื่อรูปถูกย่อ */
  scaled: boolean;
}

/** ย่อให้ด้านยาวไม่เกิน max โดยรักษาสัดส่วน ไม่ขยายรูปเล็ก ด้านสั้นปัดลงและไม่ต่ำกว่า 1px */
export function fitWithin(width: number, height: number, max: number = MAX_SLIP_SIDE): FittedSize {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`ขนาดรูปไม่ถูกต้อง: ${String(width)}x${String(height)}`);
  }
  const long = Math.max(width, height);
  if (long <= max) return { width, height, scaled: false };
  const shrink = (side: number) => Math.max(1, Math.floor((side * max) / long));
  return width >= height
    ? { width: max, height: shrink(height), scaled: true }
    : { width: shrink(width), height: max, scaled: true };
}

/** ขยายรูปก่อนส่งให้ Tesseract (ทดลองกับสลิปจริงแล้ว ตัวอักษรเล็ก เช่น เดือน "พ.ย." อ่านได้ชัดขึ้นมาก) */
export const OCR_SCALE = 2;
/** เพดานด้านยาวของผืนผ้าใบหลังขยาย (เจ้าของกำหนด 4 พ.ย. 2569) กันรูปใหญ่กินหน่วยความจำและเวลา */
export const MAX_OCR_SIDE = 2400;

/**
 * ขนาดผืนผ้าใบที่ส่งให้ Tesseract: ย่อด้านยาวไม่เกิน 1600 ตามกติกาเดิมก่อน แล้วขยายสูงสุด OCR_SCALE เท่า
 * แต่ด้านยาวหลังขยายต้องไม่เกิน MAX_OCR_SIDE (ถ้าขยาย 2 เท่าแล้วเกิน ลดตัวคูณลงให้พอดีเพดาน)
 * (ต้นฉบับที่ใหญ่มากจึงไม่ถูกส่งตรง และรูปเล็กจากแชทได้ความละเอียดเพิ่ม)
 * ใช้เลขจำนวนเต็มคำนวณสัดส่วน ด้านสั้นปัดลงและไม่ต่ำกว่า 1px
 */
export function ocrSize(width: number, height: number): { width: number; height: number } {
  const fitted = fitWithin(width, height);
  const long = Math.max(fitted.width, fitted.height);
  const newLong = Math.min(long * OCR_SCALE, MAX_OCR_SIDE);
  const scaleSide = (side: number) => Math.max(1, Math.floor((side * newLong) / long));
  return fitted.width >= fitted.height
    ? { width: newLong, height: scaleSide(fitted.height) }
    : { width: scaleSide(fitted.width), height: newLong };
}

/**
 * แปลงพิกเซล RGBA เป็นสีเทาในที่เดิม (ไม่แตะช่องโปร่งใส)
 * stretch = ยืดช่วงความสว่างระหว่างเปอร์เซ็นไทล์ 2%-98% ให้เต็ม 0-255 (ภาพที่คอนทราสต์ต่ำมากไม่ถูกยืด)
 */
export function toGrayscale(data: Uint8ClampedArray, stretch = false): void {
  const pixels = Math.floor(data.length / 4);
  if (pixels === 0) return;
  const lum = new Uint8Array(pixels);
  const hist = new Uint32Array(256);
  for (let p = 0; p < pixels; p++) {
    const i = p * 4;
    const y = Math.floor(((data[i] ?? 0) * 299 + (data[i + 1] ?? 0) * 587 + (data[i + 2] ?? 0) * 114) / 1000);
    lum[p] = y;
    hist[y] = (hist[y] ?? 0) + 1;
  }
  let lo = 0;
  let hi = 255;
  if (stretch) {
    let acc = 0;
    for (lo = 0; lo < 255 && (acc += hist[lo] ?? 0) < pixels * 0.02; lo++);
    acc = 0;
    for (hi = 255; hi > 0 && (acc += hist[hi] ?? 0) < pixels * 0.02; hi--);
    if (hi - lo < 16) {
      lo = 0;
      hi = 255;
    }
  }
  const range = hi - lo;
  for (let p = 0; p < pixels; p++) {
    const i = p * 4;
    const v = Math.max(0, Math.min(255, Math.floor((((lum[p] ?? 0) - lo) * 255) / range)));
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }
}

/** แปลงภาพเทา (อ่านจากช่องแดง) เป็นดำสนิท/ขาวสนิทด้วยวิธีของ Otsu ในที่เดิม ภาพสีเดียวทั้งภาพไม่ถูกเปลี่ยน */
export function binarizeOtsu(data: Uint8ClampedArray): void {
  const pixels = Math.floor(data.length / 4);
  if (pixels === 0) return;
  const hist = new Uint32Array(256);
  for (let p = 0; p < pixels; p++) {
    const v = data[p * 4] ?? 0;
    hist[v] = (hist[v] ?? 0) + 1;
  }
  if (hist.filter((n) => n > 0).length < 2) return;

  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * (hist[t] ?? 0);
  let sumBelow = 0;
  let weightBelow = 0;
  let best = -1;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    weightBelow += hist[t] ?? 0;
    if (weightBelow === 0) continue;
    const weightAbove = pixels - weightBelow;
    if (weightAbove === 0) break;
    sumBelow += t * (hist[t] ?? 0);
    const meanBelow = sumBelow / weightBelow;
    const meanAbove = (sum - sumBelow) / weightAbove;
    const between = weightBelow * weightAbove * (meanBelow - meanAbove) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  for (let p = 0; p < pixels; p++) {
    const v = (data[p * 4] ?? 0) > threshold ? 255 : 0;
    data[p * 4] = v;
    data[p * 4 + 1] = v;
    data[p * 4 + 2] = v;
  }
}

/** เพดานความกว้างยาวของรูปที่ยอมแตกในหน่วยความจำ (กันรูปบอมบ์: ไฟล์เล็กแต่ภาพใหญ่มหาศาล) */
export const MAX_SLIP_DIMENSION = 10_000;
export const MAX_SLIP_PIXELS = 40_000_000;

export interface ImageSize {
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const u32be = (b: Uint8Array, i: number) => (u16be(b, i) * 65536 + u16be(b, i + 2)) >>> 0;
const startsWith = (b: Uint8Array, at: number, text: string) =>
  b.length >= at + text.length && [...text].every((c, k) => b[at + k] === c.charCodeAt(0));

/** ความกว้างยาวจากหัวไฟล์ PNG (IHDR) */
function pngSize(b: Uint8Array): ImageSize | undefined {
  if (b.length < 24 || !startsWith(b, 12, 'IHDR') || b[0] !== 0x89 || !startsWith(b, 1, 'PNG')) return undefined;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

/** ความกว้างยาวจาก JPEG: ข้ามส่วนนำ (APP/EXIF/ตาราง) ไปหา SOF ส่วนที่ความยาวผิดปกติให้เลิกอ่าน (กันวนไม่รู้จบ) */
function jpegSize(b: Uint8Array): ImageSize | undefined {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return undefined;
    while (b[i + 1] === 0xff) i += 1; // ไบต์เติมก่อนรหัส
    const marker = b[i + 1] ?? 0;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2; // รหัสที่ไม่มีเนื้อหา
      continue;
    }
    const length = u16be(b, i + 2);
    if (length < 2) return undefined;
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) {
      if (i + 9 > b.length) return undefined;
      return { width: u16be(b, i + 7), height: u16be(b, i + 5) };
    }
    i += 2 + length;
  }
  return undefined;
}

/** ความกว้างยาวจาก WebP ทั้งสามแบบ (VP8X, VP8 lossy, VP8L lossless) */
function webpSize(b: Uint8Array): ImageSize | undefined {
  if (!startsWith(b, 0, 'RIFF') || !startsWith(b, 8, 'WEBP')) return undefined;
  const at = (i: number) => b[i] ?? 0;
  if (startsWith(b, 12, 'VP8X') && b.length >= 30) {
    return {
      width: 1 + (at(24) | (at(25) << 8) | (at(26) << 16)),
      height: 1 + (at(27) | (at(28) << 8) | (at(29) << 16)),
    };
  }
  if (startsWith(b, 12, 'VP8 ') && b.length >= 30 && at(23) === 0x9d && at(24) === 0x01 && at(25) === 0x2a) {
    return { width: (at(26) | (at(27) << 8)) & 0x3fff, height: (at(28) | (at(29) << 8)) & 0x3fff };
  }
  if (startsWith(b, 12, 'VP8L') && b.length >= 25 && at(20) === 0x2f) {
    return {
      width: 1 + (at(21) | ((at(22) & 0x3f) << 8)),
      height: 1 + ((at(22) >> 6) | (at(23) << 2) | ((at(24) & 0x0f) << 10)),
    };
  }
  return undefined;
}

/** อ่านความกว้างยาวจากไบต์แรกๆ ของไฟล์ (PNG/JPEG/WebP) โดยไม่แตกรูป คืน undefined เมื่ออ่านไม่ได้ */
export function readImageSize(head: Uint8Array): ImageSize | undefined {
  return pngSize(head) ?? jpegSize(head) ?? webpSize(head);
}

/** ปฏิเสธรูปที่ใหญ่เกินเพดาน และรูปที่อ่านขนาดไม่ได้ (ไม่ปล่อยผ่าน เพราะอาจเป็นรูปบอมบ์) */
export function validateSlipDimensions(size: ImageSize | undefined): SlipFileCheck {
  if (!size || !(size.width > 0) || !(size.height > 0)) {
    return { ok: false, message: 'อ่านขนาดรูปไม่ได้ ใช้รูป PNG, JPEG หรือ WebP ที่ไม่เสียหาย' };
  }
  if (size.width > MAX_SLIP_DIMENSION || size.height > MAX_SLIP_DIMENSION || size.width * size.height > MAX_SLIP_PIXELS) {
    return { ok: false, message: 'รูปมีความละเอียดใหญ่เกินไป ลองแคปหน้าจอสลิปใหม่แทนรูปต้นฉบับ' };
  }
  return { ok: true };
}
