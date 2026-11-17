import { describe, expect, it } from 'vitest';
import { fxRateText, usd, usdPrice, usdSigned } from '../../src/app/usdFormat';

describe('usdFormat (A3-2)', () => {
  it('usd: เซนต์ → ดอลลาร์ ตรงทุกเซนต์ รวมศูนย์/น้อยมาก/ติดลบ/หลักล้าน', () => {
    expect(usd(0)).toBe('$0.00');
    expect(usd(1)).toBe('$0.01');
    expect(usd(99)).toBe('$0.99');
    expect(usd(100_100)).toBe('$1,001.00');
    expect(usd(-47_950)).toBe('−$479.50');
    expect(usd(Number.MAX_SAFE_INTEGER)).toBe('$90,071,992,547,409.91');
  });
  it('usd: ไม่ใช่จำนวนเต็มปลอดภัย = RangeError', () => {
    expect(() => usd(1.5)).toThrow(RangeError);
    expect(() => usd(NaN)).toThrow(RangeError);
    expect(() => usd(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
  it('usdSigned: ค่าบวกมี + ศูนย์และลบไม่เติม', () => {
    expect(usdSigned(7_860)).toBe('+$78.60');
    expect(usdSigned(0)).toBe('$0.00');
    expect(usdSigned(-5)).toBe('−$0.05');
  });
  it('fxRateText / usdPrice: ตัดศูนย์ท้ายแต่เหลืออย่างน้อย 2 ตำแหน่ง', () => {
    expect(fxRateText(35_000_000)).toBe('35.00 THB/USD');
    expect(fxRateText(34_567_891)).toBe('34.567891 THB/USD');
    expect(usdPrice(100_100_000)).toBe('$100.10');
    expect(usdPrice(1)).toBe('$0.000001');
    expect(usdPrice(1_234_500_000)).toBe('$1,234.50');
  });
});
