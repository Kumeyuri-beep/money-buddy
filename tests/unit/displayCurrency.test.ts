import { describe, expect, it } from 'vitest';
import { parseUnits, valueInSatang } from '../../src/domain/invest/units';
import {
  centsToSatangSigned,
  DEFAULT_DISPLAY_CURRENCY,
  resolveDisplayCurrency,
  satangToCentsSigned,
  sumDisplayed,
  toDisplayMinor,
} from '../../src/domain/invest/displayCurrency';

/** กฎ R26 (ตัวอย่างคำนวณมือในกฎ · ตัวเลขทั้งหมดเป็นข้อมูลสมมติ) */
describe('R26: สกุลที่แสดงผล', () => {
  it('ค่าเริ่มต้นเป็น USD · ค่าที่ตั้งไว้แล้วคงเดิม · ค่าแปลกปลอมใช้ค่าเริ่มต้น', () => {
    expect(DEFAULT_DISPLAY_CURRENCY).toBe('USD');
    expect(resolveDisplayCurrency(undefined)).toBe('USD');
    expect(resolveDisplayCurrency('THB')).toBe('THB');
    expect(resolveDisplayCurrency('USD')).toBe('USD');
    expect(resolveDisplayCurrency('EUR')).toBe('USD');
  });

  it('5,000.00 บาท (500,000 สตางค์) เรต 32.400000 → 15,432 เซนต์', () => {
    expect(satangToCentsSigned(500_000, 32_400_000)).toBe(15_432);
  });

  it('ปัดครึ่งออกจากศูนย์ สมมาตรกับค่าติดลบ', () => {
    expect(centsToSatangSigned(1, 32_500_000)).toBe(33); // 32.5 → 33
    expect(centsToSatangSigned(-1, 32_500_000)).toBe(-33);
    expect(centsToSatangSigned(1, 32_499_999)).toBe(32); // 32.499999 → 32
    expect(centsToSatangSigned(-1, 32_499_999)).toBe(-32);
  });

  it('0.31 หุ้น ราคา $235.96 → 7,315 เซนต์ → ที่เรต 32.40 = 237,006 สตางค์ (ปัดครั้งเดียวจากเซนต์)', () => {
    const cents = valueInSatang(parseUnits('0.31'), 235_960_000); // ตัวคูณเดียวกันให้หน่วยเป็นเซนต์ (ตัวหาร 10^12)
    expect(cents).toBe(7_315);
    expect(centsToSatangSigned(cents, 32_400_000)).toBe(237_006);
  });

  it('สตางค์ → เซนต์: ติดลบสมมาตร · ปัดครึ่ง · ใกล้ 2^53', () => {
    expect(satangToCentsSigned(-500_000, 32_400_000)).toBe(-15_432);
    expect(satangToCentsSigned(325, 32_500_000)).toBe(10); // 10.0 พอดี
    expect(satangToCentsSigned(1, 2_000_000)).toBe(1); // 0.5 → 1
    expect(satangToCentsSigned(-1, 2_000_000)).toBe(-1);
    expect(() => satangToCentsSigned(Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError);
    expect(toDisplayMinor('THB', 100, 'USD', null)).toBeNull();
    expect(() => sumDisplayed([Number.MAX_SAFE_INTEGER, 1])).toThrow(RangeError);
  });

  it('ศูนย์เป็นศูนย์ (ไม่เป็น -0)', () => {
    expect(Object.is(centsToSatangSigned(0, 32_400_000), 0)).toBe(true);
    expect(Object.is(satangToCentsSigned(-0, 32_400_000), 0)).toBe(true);
  });

  it('เรต 0 / ติดลบ / ไม่ใช่จำนวนเต็ม ปฏิเสธ', () => {
    expect(() => centsToSatangSigned(100, 0)).toThrow(RangeError);
    expect(() => centsToSatangSigned(100, -1)).toThrow(RangeError);
    expect(() => satangToCentsSigned(100, 0)).toThrow(RangeError);
    expect(() => satangToCentsSigned(100, 1.5)).toThrow(RangeError);
  });

  it('จำนวนเงินที่ไม่ใช่จำนวนเต็มปลอดภัย ปฏิเสธ', () => {
    expect(() => centsToSatangSigned(1.5, 32_400_000)).toThrow(RangeError);
    expect(() => satangToCentsSigned(Number.NaN, 32_400_000)).toThrow(RangeError);
  });

  it('ผลใกล้ 2^53 เกินช่วงปลอดภัย = RangeError', () => {
    expect(() => centsToSatangSigned(Number.MAX_SAFE_INTEGER, 32_400_000)).toThrow(RangeError);
  });

  it('toDisplayMinor: สกุลเดียวกันไม่ต้องใช้เรต · ต่างสกุลไม่มีเรต = null (ไม่เดา)', () => {
    expect(toDisplayMinor('USD', 12_345, 'USD', null)).toBe(12_345);
    expect(toDisplayMinor('THB', -500, 'THB', undefined)).toBe(-500);
    expect(toDisplayMinor('USD', 12_345, 'THB', null)).toBeNull();
    expect(toDisplayMinor('USD', 12_345, 'THB', undefined)).toBeNull();
    expect(toDisplayMinor('USD', 100, 'THB', 32_400_000)).toBe(3_240);
    expect(toDisplayMinor('THB', 3_240, 'USD', 32_400_000)).toBe(100);
    expect(toDisplayMinor('USD', -100, 'THB', 32_400_000)).toBe(-3_240);
  });

  it('ผลรวมมุมมอง THB = ผลบวกของค่าที่แปลงแล้วของแต่ละแถว (อาจต่างจากแปลงยอดรวมก้อนเดียว ≤ ½ สตางค์ต่อแถว)', () => {
    const rows = [1, 1, 1].map((c) => toDisplayMinor('USD', c, 'THB', 32_500_000));
    expect(rows).toEqual([33, 33, 33]);
    expect(sumDisplayed(rows)).toBe(99);
    // แปลงก้อนเดียว: 3 เซนต์ × 32.5 = 97.5 → 98 (ต่างจาก 99 ได้ ตามที่กฎยอมรับ)
    expect(centsToSatangSigned(3, 32_500_000)).toBe(98);
    expect(Math.abs(99 - 98)).toBeLessThanOrEqual(rows.length / 2);
  });

  it('sumDisplayed: ว่าง = 0 · มี null แม้แถวเดียว = null · ติดลบรวมได้', () => {
    expect(sumDisplayed([])).toBe(0);
    expect(sumDisplayed([100, null, 5])).toBeNull();
    expect(sumDisplayed([100, -250])).toBe(-150);
  });
});
