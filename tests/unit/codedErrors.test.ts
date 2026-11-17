import { describe, expect, it } from 'vitest';
import { codedMessage, defineMessages, hasCode, messageFor, withCode } from '../../src/domain/errors/coded';

const msg = defineMessages({
  'test.over': { th: (p) => `ขายเกิน ${p.n} หน่วย`, en: (p) => `Selling more than ${p.n} units` },
});

describe('coded errors', () => {
  it('keeps the original error type and the Thai message; adds code and params', () => {
    const e = withCode(new RangeError(msg('test.over', { n: 5 })), 'test.over', { n: 5 });
    expect(e).toBeInstanceOf(RangeError);
    expect(e.message).toBe('ขายเกิน 5 หน่วย');
    expect(hasCode(e)).toBe(true);
    expect(codedMessage(e, 'en')).toBe('Selling more than 5 units');
    expect(codedMessage(e, 'th')).toBe('ขายเกิน 5 หน่วย');
  });
  it('an unknown code or an uncoded error gives null (never guessed)', () => {
    expect(messageFor('nope', {}, 'en')).toBeNull();
    expect(codedMessage(new Error('x'), 'en')).toBeNull();
    expect(codedMessage('string', 'en')).toBeNull();
  });
  it('a duplicate code is rejected', () => {
    expect(() => defineMessages({ 'test.over': { th: () => '', en: () => '' } })).toThrow();
  });
});
