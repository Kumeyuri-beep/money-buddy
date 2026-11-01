import { describe, expect, it } from 'vitest';
import { roundHalfUp } from '../../src/domain/money/round';
import {
  formatBaht,
  parseBahtToSatang,
  satang,
  sumSatang,
  toBaht,
  toBahtString,
} from '../../src/domain/money/satang';
import {
  convertToSatang,
  formatMicro,
  mulDivRound,
  mulMicro,
  parseMicro,
} from '../../src/domain/money/micro';

describe('roundHalfUp (R8)', () => {
  it('ปัดครึ่งออกจากศูนย์', () => {
    expect(roundHalfUp(5, 2)).toBe(3);
    expect(roundHalfUp(-5, 2)).toBe(-3);
    expect(roundHalfUp(5, -2)).toBe(-3);
    expect(roundHalfUp(9, 4)).toBe(2); // 2.25
    expect(roundHalfUp(-9, 4)).toBe(-2);
    expect(roundHalfUp(7, 3)).toBe(2); // 2.33
    expect(roundHalfUp(8, 3)).toBe(3); // 2.67
  });
  it('หารลงตัวและศูนย์', () => {
    expect(roundHalfUp(10, 5)).toBe(2);
    expect(roundHalfUp(0, 7)).toBe(0);
    expect(Object.is(roundHalfUp(0, -7), 0)).toBe(true); // ไม่เป็น -0
    expect(Object.is(roundHalfUp(-1, 3), 0)).toBe(true); // -0.33 ปัดเป็น 0 ไม่ใช่ -0
  });
  it('ปฏิเสธตัวหารศูนย์และเลขทศนิยม', () => {
    expect(() => roundHalfUp(1, 0)).toThrow(RangeError);
    expect(() => roundHalfUp(1.5, 2)).toThrow(RangeError);
  });
});

describe('parseBahtToSatang (R1, R2)', () => {
  it.each([
    ['0', 0],
    ['0.01', 1],
    ['0.1', 10],
    ['65', 6500],
    ['65.5', 6550],
    ['1,234.50', 123450],
    ['฿65', 6500],
    ['-65', -6500],
    ['+12.34', 1234],
    ['.5', 50],
    ['100.', 10000],
  ])('%s -> %i สตางค์', (text, expected) => {
    expect(parseBahtToSatang(text)).toBe(expected);
  });

  it('ปัดครึ่งออกจากศูนย์ที่ตำแหน่งที่ 3 โดยไม่ผิดแบบทศนิยมลอยตัว', () => {
    expect(parseBahtToSatang('1.005')).toBe(101); // Math.round(1.005*100) ได้ 100 (ผิด)
    expect(parseBahtToSatang('1.004')).toBe(100);
    expect(parseBahtToSatang('1.015')).toBe(102);
    expect(parseBahtToSatang('2.675')).toBe(268);
    expect(parseBahtToSatang('-1.005')).toBe(-101);
    expect(parseBahtToSatang('0.005')).toBe(1);
    expect(parseBahtToSatang('0.0049999')).toBe(0);
  });

  it('จำนวนเงินใหญ่มากยังแม่น และเกินช่วงปลอดภัยต้องโยน error', () => {
    expect(parseBahtToSatang('90,071,992,547,409.91')).toBe(9007199254740991);
    expect(() => parseBahtToSatang('90,071,992,547,409.92')).toThrow(RangeError);
  });

  it.each(['', ' ', 'abc', '1.2.3', '--5', '1,23', '12abc', '฿', '.', '-.'])(
    'ปฏิเสธข้อความที่อ่านไม่ได้: "%s"',
    (text) => {
      expect(() => parseBahtToSatang(text)).toThrow(SyntaxError);
    },
  );
});

describe('แสดงผลและรวมสตางค์', () => {
  it('toBahtString / formatBaht', () => {
    expect(toBahtString(satang(0))).toBe('0.00');
    expect(toBahtString(satang(1))).toBe('0.01');
    expect(toBahtString(satang(123450))).toBe('1,234.50');
    expect(toBahtString(satang(-6500))).toBe('-65.00');
    expect(formatBaht(satang(123450))).toBe('฿1,234.50');
    expect(formatBaht(satang(-6500))).toBe('−฿65.00');
    expect(formatBaht(satang(100000000))).toBe('฿1,000,000.00');
  });
  it('toBaht สำหรับแสดงผล', () => {
    expect(toBaht(satang(540841))).toBe(5408.41);
  });
  it('satang() ปฏิเสธทศนิยมและค่าเกินช่วง', () => {
    expect(() => satang(1.5)).toThrow(RangeError);
    expect(() => satang(Number.NaN)).toThrow(RangeError);
    expect(() => satang(2 ** 53)).toThrow(RangeError);
    expect(Object.is(satang(-0), 0)).toBe(true);
  });
  it('sumSatang ไม่มีเศษทศนิยมหลุดมา (0.1+0.2 ในหน่วยบาทคือปัญหาเดิม)', () => {
    const total = sumSatang([parseBahtToSatang('0.1'), parseBahtToSatang('0.2')]);
    expect(total).toBe(30);
    expect(sumSatang([])).toBe(0);
  });
});

describe('micro-units และ BigInt (R3, R9, R10)', () => {
  it('parseMicro / formatMicro', () => {
    expect(parseMicro('32.834')).toBe(32_834_000);
    expect(parseMicro('500')).toBe(500_000_000);
    expect(parseMicro('0.000001')).toBe(1);
    expect(parseMicro('0.0000005')).toBe(1); // หลักที่ 7 = 5 ปัดขึ้น
    expect(parseMicro('0.0000004')).toBe(0);
    expect(parseMicro('-1.5')).toBe(-1_500_000);
    expect(formatMicro(32_834_000)).toBe('32.834');
    expect(formatMicro(500_000_000)).toBe('500');
    expect(formatMicro(-1_500_000)).toBe('-1.5');
    expect(() => parseMicro('abc')).toThrow(SyntaxError);
  });

  it('ราคา $500 x 100 หุ้น: ผลคูณก่อนหารเกิน MAX_SAFE_INTEGER แต่ BigInt ยังแม่น', () => {
    const price = parseMicro('500');
    const shares = parseMicro('100');
    expect(price * shares).toBeGreaterThan(Number.MAX_SAFE_INTEGER); // ถ้าคูณธรรมดาจะเพี้ยน
    expect(mulMicro(price, shares)).toBe(50_000_000_000); // $50,000.000000
    expect(formatMicro(mulMicro(price, shares))).toBe('50000');
  });

  it('หุ้นเศษส่วน: 0.123456 หุ้น x $187.65', () => {
    const value = mulMicro(parseMicro('0.123456'), parseMicro('187.65'));
    // 123456 x 18765 = 2,316,651,840 -> 23.1665184 ปัดที่หลักที่ 6 ได้ 23.166518
    expect(formatMicro(value)).toBe('23.166518');
  });

  it('mulDivRound ปัดครึ่งออกจากศูนย์และกันตัวหารศูนย์', () => {
    expect(mulDivRound(5, 1, 2)).toBe(3);
    expect(mulDivRound(-5, 1, 2)).toBe(-3);
    expect(mulDivRound(3, 5, 10)).toBe(2);
    expect(() => mulDivRound(1, 1, 0)).toThrow(RangeError);
    expect(() => mulDivRound(1.5, 1, 1)).toThrow(RangeError);
    expect(() => mulDivRound(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 1)).toThrow(
      RangeError,
    );
  });

  it('convertToSatang: $100 ที่ 32.834 บาท = ฿3,283.40', () => {
    expect(convertToSatang(parseMicro('100'), parseMicro('32.834'))).toBe(328_340);
  });
  it('convertToSatang ปัดสตางค์ถูกต้อง', () => {
    // $0.01 ที่ 32.834 = 0.32834 บาท = 32.834 สตางค์ -> 33
    expect(convertToSatang(parseMicro('0.01'), parseMicro('32.834'))).toBe(33);
    // $0 = 0
    expect(convertToSatang(0, parseMicro('32.834'))).toBe(0);
  });
});
