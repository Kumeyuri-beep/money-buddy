import { describe, expect, it } from 'vitest';
import { PAY_CONFIRM_PERCENT, payAmountProblem, payDeviation } from '../../src/domain/bills/payAmount';

describe('ยอดที่จ่ายจริงของบิล (R15: จ่ายต่างจากยอดบิลได้ แต่ต่างเกิน 20% ต้องยืนยัน)', () => {
  it('เกณฑ์คือ 20%', () => {
    expect(PAY_CONFIRM_PERCENT).toBe(20);
  });

  it('ยอดเท่ากัน = ไม่ต้องยืนยัน', () => {
    expect(payDeviation(10_000, 10_000)).toMatchObject({ needsConfirm: false, direction: 'same', diff: 0, percentTenths: 0 });
  });

  it('ขอบเขต 20% พอดี = ไม่ต้องยืนยัน · เกินแม้ 1 สตางค์ = ต้องยืนยัน (ทั้งสองทิศ)', () => {
    expect(payDeviation(10_000, 12_000).needsConfirm).toBe(false);
    expect(payDeviation(10_000, 12_001).needsConfirm).toBe(true);
    expect(payDeviation(10_000, 8_000).needsConfirm).toBe(false);
    expect(payDeviation(10_000, 7_999).needsConfirm).toBe(true);
    expect(payDeviation(10_000, 12_001)).toMatchObject({ direction: 'higher', diff: 2_001 });
    expect(payDeviation(10_000, 7_999)).toMatchObject({ direction: 'lower', diff: -2_001 });
  });

  it('เปอร์เซ็นต์ที่แสดงเป็นทศนิยม 1 ตำแหน่งจากจำนวนเต็ม (ปัดครึ่งขึ้น) ไม่ใช้ทศนิยมลอยตัว', () => {
    expect(payDeviation(10_000, 12_000).percentTenths).toBe(200);
    expect(payDeviation(10_000, 12_001).percentTenths).toBe(201); // 20.01% ปัดแล้วได้ 20.0 แต่ต้องยืนยัน -> แสดง 20.1 (ไม่ขัดกับเกณฑ์)
    expect(payDeviation(10_000, 7_999).percentTenths).toBe(201);
    // ไม่ต้องยืนยัน = ไม่ถูกดันขึ้น
    expect(payDeviation(10_000, 11_999).needsConfirm).toBe(false);
    expect(payDeviation(30_000, 31_000).percentTenths).toBe(33); // 3.333% -> 3.3
    expect(payDeviation(30_000, 31_010).percentTenths).toBe(34); // 3.3667% -> 3.4 (ปัดขึ้น)
    expect(payDeviation(3, 4).percentTenths).toBe(333);
  });

  it('บิลเล็กมาก (1 สตางค์) และยอดใหญ่ใกล้ขอบเขตปลอดภัย ไม่ล้น/ไม่เพี้ยน', () => {
    expect(payDeviation(1, 1).needsConfirm).toBe(false);
    expect(payDeviation(1, 2).needsConfirm).toBe(true); // +100%
    expect(payDeviation(5, 6).needsConfirm).toBe(false); // +20% พอดี
    expect(payDeviation(5, 7).needsConfirm).toBe(true);
    const max = Number.MAX_SAFE_INTEGER;
    expect(payDeviation(max, max).needsConfirm).toBe(false);
    expect(payDeviation(max, 1).needsConfirm).toBe(true);
    expect(payDeviation(1, max).needsConfirm).toBe(true);
    expect(payDeviation(max - 1, max).needsConfirm).toBe(false);
  });

  it('ยอดบิลหรือยอดจ่ายไม่ใช่จำนวนเต็มบวกที่ปลอดภัย = โยน RangeError (ห้ามเดา)', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2]) {
      expect(() => payDeviation(100, bad), String(bad)).toThrow(RangeError);
      expect(() => payDeviation(bad, 100), String(bad)).toThrow(RangeError);
    }
  });

  it('payAmountProblem: จำนวนเต็มสตางค์บวกที่ปลอดภัยเท่านั้นผ่าน', () => {
    expect(payAmountProblem(1)).toBeNull();
    expect(payAmountProblem(Number.MAX_SAFE_INTEGER)).toBeNull();
    for (const bad of [0, -5, 0.5, 100.01, Number.NaN, Number.MAX_SAFE_INTEGER + 2, '100' as unknown as number, null as unknown as number]) {
      expect(payAmountProblem(bad), String(bad)).not.toBeNull();
    }
  });
});
