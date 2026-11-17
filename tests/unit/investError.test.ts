import { describe, expect, it } from 'vitest';
import { defineMessages, withCode } from '../../src/domain/errors/coded';
import { investError } from '../../src/ui/invest/investError';

defineMessages({ 'test.invest': { th: (p) => `ไทย ${p.n}`, en: (p) => `English ${p.n}` } });

describe('investError', () => {
  it('coded error: English with the parameters', () => {
    expect(investError(withCode(new Error('ไทย 3'), 'test.invest', { n: 3 }))).toBe('English 3');
  });
  it('uncoded errors never show Thai text', () => {
    expect(investError(new Error('ข้อความไทย'))).toBe('Could not save. Please try again.');
    expect(investError(new RangeError('ตัวเลขใหญ่'))).toMatch(/too large/);
    expect(investError(new TypeError('Failed to fetch'))).toMatch(/Cannot connect/);
    expect(investError(withCode(new Error('ไทย'), 'unknown.code'))).toBe('Could not save. Please try again.');
  });
});
