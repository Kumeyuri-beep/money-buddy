import { describe, expect, it } from 'vitest';
import { fitWithin, MAX_SLIP_BYTES, MAX_SLIP_SIDE, validateSlipFile } from '../../src/app/slipImage';

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
