import { describe, expect, it } from 'vitest';
import {
  binarizeOtsu,
  fitWithin,
  MAX_OCR_SIDE,
  MAX_SLIP_DIMENSION,
  MAX_SLIP_PIXELS,
  MAX_SLIP_BYTES,
  MAX_SLIP_SIDE,
  ocrSize,
  readImageSize,
  toGrayscale,
  validateSlipDimensions,
  validateSlipFile,
} from '../../src/app/slipImage';

describe('validateSlipFile', () => {
  it('รูป PNG/JPEG/WebP ขนาดปกติผ่าน', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      expect(validateSlipFile({ type, size: 300_000 })).toEqual({ ok: true });
    }
  });

  it('ไม่ใช่รูป (PDF, ข้อความ, ไม่ระบุชนิด) -> แจ้งเป็นภาษาไทย', () => {
    for (const type of ['application/pdf', 'text/plain', '']) {
      const r = validateSlipFile({ type, size: 1000 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain('รูป');
    }
  });

  it('SVG ไม่รับ (ไม่ใช่รูปถ่ายหน้าจอ และอาจมีสคริปต์)', () => {
    expect(validateSlipFile({ type: 'image/svg+xml', size: 1000 }).ok).toBe(false);
  });

  it('ขนาดพอดี 15MB ผ่าน เกิน 1 ไบต์ไม่ผ่าน', () => {
    expect(MAX_SLIP_BYTES).toBe(15 * 1024 * 1024);
    expect(validateSlipFile({ type: 'image/png', size: MAX_SLIP_BYTES }).ok).toBe(true);
    const r = validateSlipFile({ type: 'image/png', size: MAX_SLIP_BYTES + 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('15');
  });

  it('ไฟล์ว่าง (0 ไบต์) ไม่ผ่าน', () => {
    expect(validateSlipFile({ type: 'image/png', size: 0 }).ok).toBe(false);
  });
});

describe('fitWithin: ย่อให้ด้านยาวไม่เกิน 1600px', () => {
  it('ค่าสูงสุดคือ 1600', () => {
    expect(MAX_SLIP_SIDE).toBe(1600);
  });

  it('รูปเล็กกว่าเกณฑ์ไม่ถูกขยาย', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600, scaled: false });
  });

  it('ด้านยาวเท่า 1600 พอดีไม่ย่อ', () => {
    expect(fitWithin(1600, 900)).toEqual({ width: 1600, height: 900, scaled: false });
    expect(fitWithin(900, 1600)).toEqual({ width: 900, height: 1600, scaled: false });
  });

  it('แนวตั้ง (สกรีนช็อตมือถือ) ย่อตามด้านสูง รักษาสัดส่วน', () => {
    expect(fitWithin(1080, 2400)).toEqual({ width: 720, height: 1600, scaled: true });
  });

  it('แนวนอนย่อตามด้านกว้าง', () => {
    expect(fitWithin(3200, 1800)).toEqual({ width: 1600, height: 900, scaled: true });
  });

  it('ด้านสั้นที่หารไม่ลงตัวปัดลง และไม่ต่ำกว่า 1px', () => {
    expect(fitWithin(1601, 1000)).toEqual({ width: 1600, height: 999, scaled: true });
    expect(fitWithin(100_000, 10)).toEqual({ width: 1600, height: 1, scaled: true });
  });

  it('ขนาดที่เป็นไปไม่ได้ (0, ติดลบ, NaN, ทศนิยม) -> โยน RangeError', () => {
    for (const [w, h] of [[0, 100], [100, 0], [-1, 100], [Number.NaN, 5], [10.5, 10]] as const) {
      expect(() => fitWithin(w, h)).toThrow(RangeError);
    }
  });
});

describe('ocrSize: ขนาดที่ส่งให้ Tesseract (ย่อไม่เกิน 1600 ก่อน แล้วขยายสูงสุด 2 เท่า แต่ด้านยาวไม่เกิน 2400)', () => {
  it('ค่าเพดานด้านยาวหลังขยายคือ 2400', () => {
    expect(MAX_OCR_SIDE).toBe(2400);
  });

  it('รูปจาก LINE ราว 1000px ขยาย 2 เท่า (ด้านยาว 2170 ไม่เกินเพดาน)', () => {
    expect(ocrSize(988, 1085)).toEqual({ width: 1976, height: 2170 });
  });

  it('ขยายพอดีเพดาน: ด้านยาว 1200 -> 2400', () => {
    expect(ocrSize(600, 1200)).toEqual({ width: 1200, height: 2400 });
  });

  it('ขยาย 2 เท่าแล้วเกินเพดาน -> ลดตัวคูณลงให้ด้านยาวเป็น 2400 พอดี (1300 -> 2400 ไม่ใช่ 2600)', () => {
    expect(ocrSize(1000, 1300)).toEqual({ width: 1846, height: 2400 });
  });

  it('สกรีนช็อตมือถือใหญ่: ย่อเป็น 720x1600 ตามกติกา แล้วขยาย 1.5 เท่าเหลือด้านยาว 2400', () => {
    expect(ocrSize(1080, 2400)).toEqual({ width: 1080, height: 2400 });
  });

  it('รูปใหญ่มาก (6000x3000) ก็ไม่เกิน 2400 และรักษาสัดส่วน', () => {
    expect(ocrSize(6000, 3000)).toEqual({ width: 2400, height: 1200 });
  });

  it('รูปแบนมาก (50000x100): ด้านสั้นไม่หาย ด้านยาวไม่เกิน 2400', () => {
    const r = ocrSize(50_000, 100);
    expect(r.width).toBe(2400);
    expect(r.height).toBeGreaterThanOrEqual(1);
  });

  it('ทุกขนาดที่ลอง ด้านยาวไม่เกิน 2400 และไม่เล็กกว่าเดิมเมื่อรูปไม่ใหญ่เกิน 1600', () => {
    for (const [w, h] of [[1, 1], [10, 5000], [800, 600], [1600, 1600], [1601, 900], [4000, 4000], [123, 4567]] as const) {
      const r = ocrSize(w, h);
      expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(2400);
      if (Math.max(w, h) <= 1600) {
        expect(r.width).toBeGreaterThanOrEqual(w);
        expect(r.height).toBeGreaterThanOrEqual(h);
      }
    }
  });

  it('รูปเล็กมากไม่เกิน 1px หาย', () => {
    expect(ocrSize(1, 1)).toEqual({ width: 2, height: 2 });
  });

  it('ขนาดที่เป็นไปไม่ได้โยน RangeError', () => {
    expect(() => ocrSize(0, 10)).toThrow(RangeError);
  });
});

/** พิกเซล RGBA ต่อกัน */
const px = (...rgba: number[]) => new Uint8ClampedArray(rgba);

describe('toGrayscale', () => {
  it('แปลงสีเป็นเทาด้วยน้ำหนักความสว่าง และไม่แตะช่องโปร่งใส', () => {
    const d = px(255, 0, 0, 200, 255, 255, 255, 255, 0, 0, 0, 255);
    toGrayscale(d);
    expect(Array.from(d)).toEqual([76, 76, 76, 200, 255, 255, 255, 255, 0, 0, 0, 255]);
  });

  it('ขยายคอนทราสต์: ช่วงความสว่างแคบ (100-200) ถูกยืดเป็น 0-255 และลำดับเดิมไม่สลับ', () => {
    const d = new Uint8ClampedArray(101 * 4);
    for (let i = 0; i <= 100; i++) d.set([100 + i, 100 + i, 100 + i, 255], i * 4);
    toGrayscale(d, true);
    const lum = Array.from({ length: 101 }, (_, i) => d[i * 4] ?? -1);
    expect(lum[0]).toBe(0);
    expect(lum[100]).toBe(255);
    expect([...lum].sort((a, b) => a - b)).toEqual(lum);
  });

  it('ภาพเรียบสีเดียว (ไม่มีคอนทราสต์) ไม่ถูกยืดจนเพี้ยน', () => {
    const d = px(128, 128, 128, 255, 130, 130, 130, 255);
    toGrayscale(d, true);
    expect(Array.from(d)).toEqual([128, 128, 128, 255, 130, 130, 130, 255]);
  });

  it('อาร์เรย์ว่างไม่โยนข้อผิดพลาด', () => {
    expect(() => toGrayscale(new Uint8ClampedArray(0), true)).not.toThrow();
  });
});

describe('binarizeOtsu', () => {
  it('ภาพมืด/สว่างสองกลุ่มถูกแยกเป็นดำสนิทกับขาวสนิท', () => {
    const d = px(20, 20, 20, 255, 30, 30, 30, 255, 220, 220, 220, 255, 230, 230, 230, 255);
    binarizeOtsu(d);
    expect(Array.from(d)).toEqual([0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
  });

  it('ภาพสีเดียวทั้งภาพไม่ถูกเปลี่ยน (ไม่มีอะไรให้แยก)', () => {
    const d = px(100, 100, 100, 255, 100, 100, 100, 255);
    binarizeOtsu(d);
    expect(Array.from(d)).toEqual([100, 100, 100, 255, 100, 100, 100, 255]);
  });

  it('อาร์เรย์ว่างไม่โยนข้อผิดพลาด', () => {
    expect(() => binarizeOtsu(new Uint8ClampedArray(0))).not.toThrow();
  });
});

// ---- รูปบอมบ์ (ไฟล์เล็กแต่ความกว้างยาวมหาศาล): อ่านขนาดจากหัวไฟล์ก่อนแตกรูปจริง ----

const bytes = (...parts: (number | number[])[]) => Uint8Array.from(parts.flat());
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

const png = (w: number, h: number) =>
  bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), ascii('IHDR'), be32(w), be32(h), [8, 6, 0, 0, 0]);

/** JPEG: SOI + (ส่วนนำที่ข้ามได้) + SOF */
const jpeg = (w: number, h: number, sof = 0xc0, before: number[] = []) =>
  bytes([0xff, 0xd8], before, [0xff, sof], be16(17), [8], be16(h), be16(w), [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
const jpegSegment = (marker: number, payloadLen: number) => [0xff, marker, ...be16(payloadLen + 2), ...new Array(payloadLen).fill(0)];

const riff = (chunk: number[]) => [...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...chunk];
const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const webpX = (w: number, h: number) => bytes(riff([...ascii('VP8X'), 10, 0, 0, 0, 0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]));
const webpLossy = (w: number, h: number) =>
  bytes(riff([...ascii('VP8 '), 10, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, w & 0xff, (w >> 8) & 0x3f, h & 0xff, (h >> 8) & 0x3f]));
const webpLossless = (w: number, h: number) => {
  const wb = w - 1;
  const hb = h - 1;
  return bytes(riff([...ascii('VP8L'), 5, 0, 0, 0, 0x2f, wb & 0xff, ((wb >> 8) & 0x3f) | ((hb & 0x03) << 6), (hb >> 2) & 0xff, (hb >> 10) & 0x0f]));
};

describe('readImageSize: อ่านความกว้างยาวจากหัวไฟล์ (ไม่แตกรูป)', () => {
  it('PNG', () => {
    expect(readImageSize(png(988, 1085))).toEqual({ width: 988, height: 1085 });
    expect(readImageSize(png(30_000, 30_000))).toEqual({ width: 30_000, height: 30_000 });
  });

  it('JPEG (baseline และ progressive)', () => {
    expect(readImageSize(jpeg(1080, 2400))).toEqual({ width: 1080, height: 2400 });
    expect(readImageSize(jpeg(1080, 2400, 0xc2))).toEqual({ width: 1080, height: 2400 });
  });

  it('JPEG ที่มี APP/EXIF/ตารางคั่นก่อนถึง SOF ต้องข้ามได้ (และไม่หยิบ DHT เป็น SOF)', () => {
    const before = [...jpegSegment(0xe1, 3000), ...jpegSegment(0xdb, 130), ...jpegSegment(0xc4, 40)];
    expect(readImageSize(jpeg(640, 480, 0xc0, before))).toEqual({ width: 640, height: 480 });
  });

  it('WebP ทั้งสามแบบ (VP8X, lossy, lossless)', () => {
    expect(readImageSize(webpX(1200, 800))).toEqual({ width: 1200, height: 800 });
    expect(readImageSize(webpLossy(1200, 800))).toEqual({ width: 1200, height: 800 });
    expect(readImageSize(webpLossless(1200, 800))).toEqual({ width: 1200, height: 800 });
    expect(readImageSize(webpLossless(16_384, 16_384))).toEqual({ width: 16_384, height: 16_384 });
  });

  it('ข้อมูลที่ไม่ใช่รูป ถูกตัดสั้น หรือว่าง -> undefined (ไม่โยนข้อผิดพลาด)', () => {
    expect(readImageSize(new Uint8Array(0))).toBeUndefined();
    expect(readImageSize(bytes(ascii('hello world, not an image at all')))).toBeUndefined();
    expect(readImageSize(png(10, 10).slice(0, 20))).toBeUndefined();
    expect(readImageSize(jpeg(10, 10).slice(0, 8))).toBeUndefined();
    expect(readImageSize(webpX(10, 10).slice(0, 20))).toBeUndefined();
    expect(readImageSize(bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00]))).toBeUndefined(); // ความยาวส่วนเป็น 0 กันวนไม่รู้จบ
  });

  it('GIF/BMP ที่ไม่รองรับ -> undefined', () => {
    expect(readImageSize(bytes(ascii('GIF89a'), [1, 0, 1, 0]))).toBeUndefined();
    expect(readImageSize(bytes(ascii('BM'), new Array(30).fill(0)))).toBeUndefined();
  });
});

describe('validateSlipDimensions: ปฏิเสธรูปที่ใหญ่เกิน (กันแท็บค้างจากรูปบอมบ์)', () => {
  it('เพดาน: ด้านละไม่เกิน 10000px และรวมไม่เกิน 40 ล้านพิกเซล', () => {
    expect(MAX_SLIP_DIMENSION).toBe(10_000);
    expect(MAX_SLIP_PIXELS).toBe(40_000_000);
  });

  it('ขนาดปกติและขอบเพดานพอดีผ่าน', () => {
    expect(validateSlipDimensions({ width: 1080, height: 2400 })).toEqual({ ok: true });
    expect(validateSlipDimensions({ width: 10_000, height: 4_000 })).toEqual({ ok: true });
  });

  it('เกินด้านละ 10000 หรือเกิน 40 ล้านพิกเซล -> ไม่ผ่านพร้อมข้อความไทย', () => {
    for (const d of [{ width: 10_001, height: 10 }, { width: 10, height: 10_001 }, { width: 8_000, height: 5_001 }, { width: 30_000, height: 30_000 }]) {
      const r = validateSlipDimensions(d);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain('ใหญ่เกิน');
    }
  });

  it('อ่านขนาดไม่ได้ (undefined) -> ปฏิเสธ ไม่ปล่อยผ่าน', () => {
    const r = validateSlipDimensions(undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('PNG');
  });

  it('ขนาด 0 หรือติดลบ -> ปฏิเสธ', () => {
    expect(validateSlipDimensions({ width: 0, height: 100 }).ok).toBe(false);
    expect(validateSlipDimensions({ width: 100, height: -1 }).ok).toBe(false);
  });
});

describe('validateSlipFile: รับเฉพาะ PNG/JPEG/WebP', () => {
  it('GIF/BMP/HEIC/TIFF ถูกปฏิเสธพร้อมบอกชนิดที่รองรับ', () => {
    for (const type of ['image/gif', 'image/bmp', 'image/heic', 'image/tiff']) {
      const r = validateSlipFile({ type, size: 1000 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain('WebP');
    }
  });
});
