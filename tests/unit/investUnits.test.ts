import { describe, expect, it } from 'vitest';
import { roundHalfUpBig } from '../../src/domain/money/round';
import { formatUnits, MAX_UNITS, parsePriceMicro, parseUnits, UNIT_SCALE, valueInSatang } from '../../src/domain/invest/units';

describe('roundHalfUpBig (R8 เวอร์ชัน BigInt)', () => {
  it('ปัดครึ่งออกจากศูนย์ ทั้งบวกและลบ', () => {
    expect(roundHalfUpBig(5n, 2n)).toBe(3n);
    expect(roundHalfUpBig(-5n, 2n)).toBe(-3n);
    expect(roundHalfUpBig(7n, 3n)).toBe(2n);
    expect(roundHalfUpBig(4n, 3n)).toBe(1n);
    expect(roundHalfUpBig(5n, -2n)).toBe(-3n);
    expect(roundHalfUpBig(0n, 7n)).toBe(0n);
  });
  it('ตัวหารศูนย์โยน RangeError', () => {
    expect(() => roundHalfUpBig(1n, 0n)).toThrow(RangeError);
  });
  it('เลขใหญ่เกิน 2^53 ยังแม่นยำ', () => {
    expect(roundHalfUpBig(10n ** 30n + 5n, 10n)).toBe(10n ** 29n + 1n);
  });
});

describe('parseUnits (จำนวนหน่วย 10^8, R9/R17)', () => {
  it('อ่านทศนิยมได้ถึง 8 ตำแหน่ง', () => {
    expect(parseUnits('1')).toBe(UNIT_SCALE);
    expect(parseUnits('0.00000001')).toBe(1n);
    expect(parseUnits('1,000.5')).toBe(100_050_000_000n);
    expect(parseUnits(' 12.345678 ')).toBe(1_234_567_800n);
  });
  it('เกิน 8 ตำแหน่งปัดครึ่งออกจากศูนย์ที่ตำแหน่งที่ 9', () => {
    expect(parseUnits('0.000000005')).toBe(1n);
    expect(parseUnits('1.000000014')).toBe(100_000_001n);
    expect(parseUnits('1.000000015')).toBe(100_000_002n);
  });
  it('ปัดแล้วเป็น 0 / ศูนย์ / ลบ / รูปแบบแปลก ถูกปฏิเสธ', () => {
    for (const bad of ['0', '0.0', '0.000000004', '-1', '-0', '+1', '1e-7', '1E3', '', ' ', 'abc', '1.2.3', '.', '0x10']) {
      expect(() => parseUnits(bad), bad).toThrow(SyntaxError);
    }
  });
  it('เพดาน = int64 สูงสุด (92,233,720,368.54775807 หน่วย) เพื่อเก็บใน bigint ของฐานข้อมูลได้', () => {
    expect(parseUnits('92233720368.54775807')).toBe(MAX_UNITS);
    expect(() => parseUnits('92233720368.54775808')).toThrow(RangeError);
    expect(() => parseUnits('999999999999')).toThrow(RangeError);
  });
  it('ตัวคั่นหลักพันต้องเป็นกลุ่มละ 3 หลัก · ช่องว่างกลางตัวเลขไม่รับ', () => {
    for (const bad of ['1,5', '1,2,3', '1 000', '12,34', ',5', '1,000,']) {
      expect(() => parseUnits(bad), bad).toThrow(SyntaxError);
      expect(() => parsePriceMicro(bad), bad).toThrow(SyntaxError);
    }
    expect(parseUnits('1,234,567.5')).toBe(123_456_750_000_000n);
  });
  it('".5" และ "5." อ่านได้', () => {
    expect(parseUnits('.5')).toBe(50_000_000n);
    expect(parseUnits('5.')).toBe(500_000_000n);
  });
});

describe('parsePriceMicro (ราคาต่อหน่วย micro-baht)', () => {
  it('อ่านได้ถึง 6 ตำแหน่ง', () => {
    expect(parsePriceMicro('12.3456')).toBe(12_345_600);
    expect(parsePriceMicro('0.000001')).toBe(1);
    expect(parsePriceMicro('1,234.5')).toBe(1_234_500_000);
  });
  it('ปัดครึ่งออกจากศูนย์ที่ตำแหน่งที่ 7', () => {
    expect(parsePriceMicro('0.0000005')).toBe(1);
    expect(parsePriceMicro('1.0000004')).toBe(1_000_000);
  });
  it('ต่ำกว่า 0.000001 / ศูนย์ / ลบ / scientific ถูกปฏิเสธ (ไม่ปัดเป็น 0 เงียบๆ)', () => {
    for (const bad of ['0', '0.0000004', '-1', '-0', '1.2.3', '.', '1e3', '', 'abc']) {
      expect(() => parsePriceMicro(bad), bad).toThrow(SyntaxError);
    }
  });
  it('เกินช่วงจำนวนเต็มปลอดภัยโยน RangeError', () => {
    expect(() => parsePriceMicro('99999999999999999')).toThrow(RangeError);
  });
});

describe('formatUnits', () => {
  it('ตัดศูนย์ท้ายและไม่ผ่าน float', () => {
    expect(formatUnits(150_000_000n)).toBe('1.5');
    expect(formatUnits(1n)).toBe('0.00000001');
    expect(formatUnits(UNIT_SCALE)).toBe('1');
    expect(formatUnits(0n)).toBe('0');
    expect(formatUnits(12_345_678_912_345_678n)).toBe('123456789.12345678');
  });
});

describe('valueInSatang (ปัดครั้งเดียว ตอนแปลงเป็นสตางค์)', () => {
  it('ตัวอย่างในกฎ: 1.5 หน่วย × 100.333333 บาท = 15,050 สตางค์', () => {
    expect(valueInSatang(parseUnits('1.5'), parsePriceMicro('100.333333'))).toBe(15_050);
  });
  it('1 หน่วย × 10 บาท = 1,000 สตางค์ · 0 หน่วย = 0', () => {
    expect(valueInSatang(UNIT_SCALE, 10_000_000)).toBe(1_000);
    expect(valueInSatang(0n, 10_000_000)).toBe(0);
  });
  it('ครึ่งสตางค์พอดีปัดขึ้น · ต่ำกว่าครึ่งนิดเดียวปัดลง', () => {
    // 1 หน่วย × 0.005 บาท (5,000 micro) = 0.5 สตางค์
    expect(valueInSatang(UNIT_SCALE, 5_000)).toBe(1);
    expect(valueInSatang(UNIT_SCALE, 4_999)).toBe(0);
  });
  it('1 step × 1 micro = 0 สตางค์ (ระดับฟังก์ชันคืน 0 ระดับรายการต้องปฏิเสธเอง)', () => {
    expect(valueInSatang(1n, 1)).toBe(0);
  });
  it('units × price เกิน 2^53 แต่ผลลัพธ์ยังปลอดภัย', () => {
    const units = 900_000_000n * UNIT_SCALE; // 9e8 หน่วย
    expect(valueInSatang(units, 1_000)).toBe(90_000_000); // 0.001 บาท/หน่วย = 900,000 บาท
  });
  it('ผลเกินช่วงปลอดภัยโยน RangeError', () => {
    expect(() => valueInSatang(10n ** 20n, 9_000_000_000_000_000)).toThrow(RangeError);
  });
  it('ราคาไม่ใช่จำนวนเต็มบวกปลอดภัย / หน่วยติดลบ ถูกปฏิเสธ', () => {
    expect(() => valueInSatang(UNIT_SCALE, 0)).toThrow(RangeError);
    expect(() => valueInSatang(UNIT_SCALE, -1)).toThrow(RangeError);
    expect(() => valueInSatang(UNIT_SCALE, 1.5)).toThrow(RangeError);
    expect(() => valueInSatang(-1n, 1_000)).toThrow(RangeError);
  });
  it('ไม่คืน -0', () => {
    expect(Object.is(valueInSatang(0n, 1), 0)).toBe(true);
  });
});
