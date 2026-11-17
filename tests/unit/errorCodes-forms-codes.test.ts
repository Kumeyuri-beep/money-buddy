import { describe, expect, it } from 'vitest';
import { messageFor, registeredCodes, type ErrorParams } from '../../src/domain/errors/coded';
import { buildTradeRecord, emptyTradeForm } from '../../src/app/tradeForm';
import { buildFxExchange, buildUsTradeRecord, emptyFxExchangeForm, emptyUsTradeForm } from '../../src/app/usForms';

const TODAY = '2026-11-13';
const NOW = '2026-11-13T03:00:00.000Z';

describe('รหัส error ของฟอร์ม: params + อังกฤษ', () => {
  const sample: Record<string, ErrorParams> = {
    'form.memoInvalid': { max: 2000 },
    'form.memoTooLong': { max: 2000 },
    'form.moneyRequired': { what: 'buyAmount' },
    'form.moneyPositive': { what: 'buyAmount', ccy: 'USD' },
    'form.moneyNonNegative': { what: 'fee' },
    'form.moneyInvalid': { what: 'dividendAmount' },
    'form.mustBeBlank': { what: 'withholding' },
    'form.fxMinorRequired': { what: 'thb' },
    'form.fxMinorPositive': { what: 'usd' },
    'form.fxMinorMin': { what: 'thb' },
    'form.fxMinorInvalid': { what: 'usd' },
  };
  const codes = registeredCodes().filter((c) => c.startsWith('form.') || c.startsWith('usp.'));

  it('ทุกรหัสมีอังกฤษที่ไม่เหลือตัวอักษรไทย', () => {
    expect(codes.length).toBe(25);
    for (const c of codes) {
      const en = messageFor(c, sample[c] ?? {}, 'en');
      expect(en, c).toBeTruthy();
      expect(en, c).not.toMatch(/[฀-๿]/);
      expect(en, c).not.toMatch(/undefined|NaN/);
    }
  });
  it('อังกฤษแสดงค่า params ครบ (ค่าสูงสุด สกุลเงิน ชื่อช่อง)', () => {
    expect(messageFor('form.memoInvalid', { max: 2000 }, 'en')).toContain('2000');
    expect(messageFor('form.memoTooLong', { max: 2000 }, 'en')).toContain('2000');
    expect(messageFor('form.moneyPositive', { what: 'buyAmount', ccy: 'USD' }, 'en')).toBe('Amount invested must be greater than 0 (at least 0.01 USD).');
    expect(messageFor('form.moneyPositive', { what: 'buyAmount', ccy: 'THB' }, 'en')).toContain('0.01 THB');
    expect(messageFor('form.mustBeBlank', { what: 'withholding' }, 'en')).toContain('Withholding tax');
    expect(messageFor('form.fxMinorMin', { what: 'thb' }, 'en')).toContain('THB amount');
  });
  it('ฟอร์มแปะ code + params บนทุก error ของตัวเอง (ข้อความไทยเดิมอยู่ใน message)', () => {
    const f = { ...emptyTradeForm('a1', 'dividend', '2026-11-03'), amount: '', units: '1', memo: 'a'.repeat(2001) };
    const r = buildTradeRecord(f, 'x', NOW, TODAY);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => [e.field, e.code])).toEqual([['memo', 'form.memoInvalid'], ['amount', 'form.moneyRequired'], ['units', 'form.mustBeBlank']]);
    expect(r.errors[0]!.params).toEqual({ max: 2000 });
    expect(r.errors[1]!.params).toEqual({ what: 'dividendAmount' });
    for (const e of r.errors) expect(messageFor(e.code!, e.params!, 'th')).toBe(e.message);
  });
  it('หุ้นสหรัฐ: ข้อความเงินส่ง ccy=USD · อัตราแลกเปลี่ยนมีรหัส', () => {
    const r = buildUsTradeRecord({ ...emptyUsTradeForm('u1', 'buy', '2026-11-03', ''), amount: '0', units: '1' }, 'x', NOW, TODAY);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const byField = Object.fromEntries(r.errors.map((e) => [e.field, e]));
    expect(byField.amount).toMatchObject({ code: 'form.moneyPositive', params: { what: 'buyAmount', ccy: 'USD' } });
    expect(messageFor(byField.amount!.code!, byField.amount!.params!, 'en')).toContain('0.01 USD');
    expect(byField.fxRate).toMatchObject({ code: 'form.fxRateRequired' });
  });
  it('แลกเงิน: ทุก error มีรหัส', () => {
    const r = buildFxExchange({ ...emptyFxExchangeForm('2026-11-14'), thb: '0', usd: 'x' }, 'x', NOW, TODAY);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.code)).toEqual(['form.dateFuture', 'form.fxMinorMin', 'form.fxMinorInvalid']);
    for (const e of r.errors) expect(messageFor(e.code!, e.params!, 'th')).toBe(e.message);
  });
});
