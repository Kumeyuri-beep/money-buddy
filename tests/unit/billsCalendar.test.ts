import { describe, expect, it } from 'vitest';
import { addMonths, daysBetween, daysInMonth, dueDateIn, monthOf, nextPayday } from '../../src/domain/bills/calendar';

describe('daysInMonth', () => {
  it('ทุกเดือนของปีไม่อธิกสุรทิน (2026)', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => daysInMonth(2026, m))).toEqual([
      31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ]);
  });

  it('ก.พ. ปีอธิกสุรทิน (2024, 2000) = 29 · ปีศตวรรษที่ไม่ใช่ (2100, 1900) = 28', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(1900, 2)).toBe(28);
  });

  it('เดือนหรือปีที่เป็นไปไม่ได้ -> RangeError', () => {
    expect(() => daysInMonth(2026, 0)).toThrow(RangeError);
    expect(() => daysInMonth(2026, 13)).toThrow(RangeError);
    expect(() => daysInMonth(2026, 1.5)).toThrow(RangeError);
    expect(() => daysInMonth(Number.NaN, 1)).toThrow(RangeError);
  });
});

describe('dueDateIn: วันครบกำหนดในรอบเดือน (วันที่ 29-31 บีบเป็นวันสุดท้ายของเดือน)', () => {
  it('วันปกติ', () => {
    expect(dueDateIn('2026-11', 5)).toBe('2026-11-05');
    expect(dueDateIn('2026-01', 1)).toBe('2026-01-01');
    expect(dueDateIn('2026-01', 31)).toBe('2026-01-31');
  });

  it('วันที่ 31 ในเดือนสั้น', () => {
    expect(dueDateIn('2026-04', 31)).toBe('2026-04-30');
    expect(dueDateIn('2026-11', 31)).toBe('2026-11-30');
    expect(dueDateIn('2026-02', 31)).toBe('2026-02-28');
    expect(dueDateIn('2026-02', 30)).toBe('2026-02-28');
    expect(dueDateIn('2026-02', 29)).toBe('2026-02-28');
  });

  it('ก.พ. ปีอธิกสุรทิน: 29, 30, 31 -> 29 ก.พ.', () => {
    expect(dueDateIn('2024-02', 29)).toBe('2024-02-29');
    expect(dueDateIn('2024-02', 31)).toBe('2024-02-29');
    expect(dueDateIn('2100-02', 29)).toBe('2100-02-28');
  });

  it('วันหรือรอบเดือนที่ไม่ถูกต้อง -> RangeError', () => {
    for (const day of [0, 32, -1, 1.5, Number.NaN]) {
      expect(() => dueDateIn('2026-11', day)).toThrow(RangeError);
    }
    for (const month of ['2026-13', '2026-00', '2026-1', '26-11', '2026-11-05', '', 'abcd-ef']) {
      expect(() => dueDateIn(month, 5)).toThrow(RangeError);
    }
  });
});

describe('addMonths', () => {
  it('ข้ามปี และบวก/ลบหลายเดือน', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-01', 13)).toBe('2027-02');
    expect(addMonths('2026-11', 0)).toBe('2026-11');
    expect(addMonths('2026-03', -15)).toBe('2024-12');
  });

  it('จำนวนเดือนที่ไม่ใช่จำนวนเต็ม -> RangeError', () => {
    expect(() => addMonths('2026-11', 0.5)).toThrow(RangeError);
  });
});

describe('monthOf', () => {
  it('ตัด YYYY-MM จากวันที่ และปฏิเสธวันที่ที่ไม่จริง', () => {
    expect(monthOf('2026-11-04')).toBe('2026-11');
    expect(monthOf('2024-02-29')).toBe('2024-02');
    expect(() => monthOf('2026-02-29')).toThrow(RangeError);
    expect(() => monthOf('2026-11-31')).toThrow(RangeError);
    expect(() => monthOf('hello')).toThrow(RangeError);
  });
});

describe('daysBetween', () => {
  it('จำนวนวันระหว่างสองวันที่ (ไม่ขึ้นกับเขตเวลา)', () => {
    expect(daysBetween('2026-11-05', '2026-11-25')).toBe(20);
    expect(daysBetween('2026-11-05', '2026-11-05')).toBe(0);
    expect(daysBetween('2026-11-25', '2026-11-05')).toBe(-20);
  });

  it('ข้ามสิ้นเดือนและปีอธิกสุรทิน', () => {
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
    expect(daysBetween('2028-01-01', '2029-01-01')).toBe(366);
  });
});

describe('nextPayday: วันเงินเดือนแรกที่ "หลัง" วันนี้', () => {
  it('ก่อนวันเงินเดือนในเดือนนี้', () => {
    expect(nextPayday(25, '2026-11-04')).toBe('2026-11-25');
    expect(nextPayday(25, '2026-11-24')).toBe('2026-11-25');
  });

  it('วันนี้คือวันเงินเดือน -> ถือว่าเงินเข้าแล้ว ถัดไปคือเดือนหน้า', () => {
    expect(nextPayday(25, '2026-11-25')).toBe('2026-12-25');
  });

  it('หลังวันเงินเดือน -> เดือนหน้า รวมข้ามปี', () => {
    expect(nextPayday(25, '2026-11-26')).toBe('2026-12-25');
    expect(nextPayday(25, '2026-12-26')).toBe('2027-01-25');
    expect(nextPayday(1, '2026-12-31')).toBe('2027-01-01');
  });

  it('วันเงินเดือน 31 ในเดือนสั้น (บีบเป็นวันสุดท้ายของเดือน)', () => {
    expect(nextPayday(31, '2026-02-10')).toBe('2026-02-28');
    expect(nextPayday(31, '2026-02-28')).toBe('2026-03-31'); // วันนี้คือวันเงินเดือน (28) -> เดือนหน้า
    expect(nextPayday(31, '2026-01-31')).toBe('2026-02-28');
    expect(nextPayday(31, '2026-04-30')).toBe('2026-05-31');
    expect(nextPayday(30, '2024-02-29')).toBe('2024-03-30');
  });

  it('วันเงินเดือนหรือวันนี้ที่ไม่ถูกต้อง -> RangeError', () => {
    expect(() => nextPayday(0, '2026-11-04')).toThrow(RangeError);
    expect(() => nextPayday(32, '2026-11-04')).toThrow(RangeError);
    expect(() => nextPayday(25, '2026-02-30')).toThrow(RangeError);
  });
});
