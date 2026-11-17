import { describe, expect, it } from 'vitest';
import { buildTradeRecord, emptyTradeForm } from '../../src/app/tradeForm';
import { buildUsTradeRecord } from '../../src/app/usForms';
import { dcaPlanProblemCoded } from '../../src/domain/invest/dcaPlan';
import { parsePriceMicro, parseUnits } from '../../src/domain/invest/units';
import { checkTradeAddCoded } from '../../src/domain/invest/rules';
import { investError, investProblem } from '../../src/ui/invest/investError';
import { SettingsConflictError } from '../../src/storage/repository';

const THAI = /[\u0E00-\u0E7F]/;

describe('/invest shows English for real errors from every layer (other pages keep Thai)', () => {
  it('form field errors (app): English with the detail, Thai message untouched', () => {
    const r = buildTradeRecord({ ...emptyTradeForm('a1', 'buy', '2026-12-31'), amount: '100' }, 't1', '2026-11-17T00:00:00.000Z', '2026-11-17');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const date = r.errors.find((e) => e.field === 'date')!;
    expect(THAI.test(date.message)).toBe(true); // other pages: Thai exactly as before
    const en = investProblem(date);
    expect(en).not.toMatch(THAI);
    expect(en.length).toBeGreaterThan(5);
  });
  it('every error of an empty buy form is English', () => {
    const r = buildTradeRecord(emptyTradeForm('a1', 'buy', '2026-11-17'), 't1', '2026-11-17T00:00:00.000Z', '2026-11-17');
    if (r.ok) throw new Error('expected errors');
    for (const e of r.errors) expect(investProblem(e), e.field).not.toMatch(THAI);
  });
  it('domain errors thrown by parsers: English via investError, with the offending input', () => {
    let units: unknown;
    try { parseUnits('abc'); } catch (e) { units = e; }
    expect(investError(units)).toMatch(/abc/);
    expect(investError(units)).not.toMatch(THAI);
    let price: unknown;
    try { parsePriceMicro('0'); } catch (e) { price = e; }
    expect(investError(price)).not.toMatch(THAI);
  });
  it('trade check problems (sell more than held) carry numbers into English', () => {
    const buy = { id: 'b', assetId: 'a', kind: 'buy' as const, date: '2026-11-03', createdAt: '2026-11-03T03:00:00.000Z', units: '1000000000', priceMicro: 100_000_000, amount: 100_000, fee: 0, withholding: 0, memo: '' };
    const sell = { ...buy, id: 's', kind: 'sell' as const, date: '2026-11-04', createdAt: '2026-11-04T03:00:00.000Z', units: '2000000000', amount: undefined };
    const p = checkTradeAddCoded([buy], sell);
    expect(p).not.toBeNull();
    const en = investProblem(p!);
    expect(en).not.toMatch(THAI);
    expect(en.length).toBeGreaterThan(10);
  });
  it('dca plan problem', () => {
    const p = dcaPlanProblemCoded({ id: '', assetId: 'a', amount: 1000, dayOfMonth: 5, startMonth: '2026-11' });
    expect(investProblem(p!)).not.toMatch(THAI);
  });
  it('storage error (settings conflict) is English; the Thai message is unchanged for other pages', () => {
    const e = new SettingsConflictError();
    expect(e.message).toBe('ค่าตั้งค่าถูกแก้จากแท็บหรืออุปกรณ์อื่นแล้ว โหลดค่าล่าสุดแล้ว ลองบันทึกอีกครั้ง');
    expect(investError(e)).not.toMatch(THAI);
  });
  it('US form errors', () => {
    const r = buildUsTradeRecord({ assetId: 'a', kind: 'buy', date: '2026-11-17', units: '', price: '', amount: '', fee: '', withholding: '', memo: '', fxRate: '' } as never, 't', '2026-11-17T00:00:00.000Z', '2026-11-17');
    if (r.ok) throw new Error('expected errors');
    for (const e of r.errors) expect(investProblem(e), e.field).not.toMatch(THAI);
  });
  it('an uncoded Thai message never leaks into /invest', () => {
    expect(investProblem({ message: 'ข้อความไทยที่ไม่มีรหัส' })).toBe('Invalid input');
    expect(investError(new Error('ข้อความไทย'))).not.toMatch(THAI);
  });
});
