import { describe, expect, it } from 'vitest';
import { floorDivBig } from '../../src/domain/money/round';

describe('floorDivBig (R29)', () => {
  it('ปัดลง', () => {
    expect(floorDivBig(7n, 2n)).toBe(3n);
    expect(floorDivBig(8n, 2n)).toBe(4n);
    expect(floorDivBig(1n, 3n)).toBe(0n);
  });
  it('ตัวตั้ง 0 ได้ 0', () => {
    expect(floorDivBig(0n, 5n)).toBe(0n);
  });
  it('ตัวหาร 1 ได้ตัวตั้ง', () => {
    expect(floorDivBig(123n, 1n)).toBe(123n);
  });
  it('ค่าใหญ่เกิน 2^53 ไม่เพี้ยน', () => {
    const big = 2n ** 80n + 5n;
    expect(floorDivBig(big, 2n ** 40n)).toBe(2n ** 40n);
  });
  it('ตัวหาร 0 หรือติดลบ โยน RangeError', () => {
    expect(() => floorDivBig(1n, 0n)).toThrow(RangeError);
    expect(() => floorDivBig(1n, -2n)).toThrow(RangeError);
  });
  it('ตัวตั้งติดลบ โยน RangeError (ไม่ปัดเข้าหาศูนย์เงียบๆ)', () => {
    expect(() => floorDivBig(-1n, 2n)).toThrow(RangeError);
  });
});
