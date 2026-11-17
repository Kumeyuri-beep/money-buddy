import { describe, expect, it } from 'vitest';
import { formatDateEn, formatDayMonthEn } from '../../src/app/dateEn';

describe('dateEn', () => {
  it('formats ISO dates in the Gregorian calendar', () => {
    expect(formatDateEn('2026-11-16')).toBe('16 Nov 2026');
    expect(formatDateEn('2026-01-05')).toBe('5 Jan 2026');
    expect(formatDateEn('2028-02-29')).toBe('29 Feb 2028');
    expect(formatDayMonthEn('2026-12-31')).toBe('31 Dec');
  });
  it('rejects malformed input instead of guessing', () => {
    expect(() => formatDateEn('2026-13-01')).toThrow(RangeError);
    expect(() => formatDateEn('16/11/2026')).toThrow(RangeError);
    expect(() => formatDateEn('')).toThrow(RangeError);
  });
});
