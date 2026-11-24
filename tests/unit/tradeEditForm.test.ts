import { describe, expect, it } from 'vitest';
import type { Account, Entry } from '../../src/domain/ledger/types';
import type { TradeRecord } from '../../src/domain/invest/types';
import { buildTradeRecord } from '../../src/app/tradeForm';
import { buildUsTradeRecord } from '../../src/app/usForms';
import { linkedCashAccountId, minorToInput, tradeToForm, usTradeToForm } from '../../src/app/tradeEditForm';

const TODAY = '2026-11-24';
const base = { assetId: 'a1', createdAt: '2026-03-01T01:00:00.000Z', memo: 'm', fee: 0, withholding: 0 };
const U = (n: number): string => String(BigInt(Math.round(n * 1000)) * 100_000n); // หน่วย × 10^8

describe('minorToInput', () => {
  it.each([[0, '0.00'], [1, '0.01'], [99, '0.99'], [100, '1.00'], [123456, '1234.56'], [Number.MAX_SAFE_INTEGER, '90071992547409.91']])('%i → %s', (n, s) => {
    expect(minorToInput(n)).toBe(s);
  });
  it('ปฏิเสธค่าติดลบ ทศนิยม และเกินช่วง', () => {
    expect(() => minorToInput(-1)).toThrow(RangeError);
    expect(() => minorToInput(1.5)).toThrow(RangeError);
    expect(() => minorToInput(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});

describe('tradeToForm: เติมค่าเดิมแล้วสร้างกลับได้รายการเดิมเป๊ะ (สินทรัพย์บาท)', () => {
  const samples: TradeRecord[] = [
    { ...base, id: 'b', kind: 'buy', date: '2026-03-01', units: U(10.5), amount: 123456, fee: 25 },
    { ...base, id: 'b2', kind: 'buy', date: '2026-03-01', units: U(3), priceMicro: 12_345_600, amount: 37037, fee: 0 },
    { ...base, id: 's', kind: 'sell', date: '2026-03-02', units: '1', priceMicro: 99_999_999, fee: 1 },
    { ...base, id: 'd', kind: 'dividend', date: '2026-03-03', amount: 5000, withholding: 750 },
    { ...base, id: 'r', kind: 'reinvest', date: '2026-03-04', units: U(2), amount: 4250 },
  ];
  it.each(samples.map((t) => [t.kind + t.id, t] as const))('%s', (_n, t) => {
    const r = buildTradeRecord(tradeToForm(t), t.id, t.createdAt, TODAY);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.trade).toEqual(t);
  });
});

describe('usTradeToForm: หุ้นสหรัฐ มีอัตราแลกเปลี่ยน', () => {
  const samples: TradeRecord[] = [
    { ...base, id: 'ub', kind: 'buy', date: '2026-03-01', units: U(0.31), amount: 7315, fee: 99, fxRateMicro: 32_400_000 },
    { ...base, id: 'us', kind: 'sell', date: '2026-03-02', units: U(2), priceMicro: 235_960_000, fee: 0, fxRateMicro: 32_499_999 },
    { ...base, id: 'ud', kind: 'dividend', date: '2026-03-03', amount: 5000, withholding: 750, fxRateMicro: 34_567_891 },
  ];
  it.each(samples.map((t) => [t.kind, t] as const))('%s', (_n, t) => {
    const r = buildUsTradeRecord(usTradeToForm(t), t.id, t.createdAt, TODAY);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.trade).toEqual(t);
  });
  it('ปันผลลงทุนต่อไม่มีในฟอร์มหุ้นสหรัฐ = โยนข้อผิดพลาด (ไม่เดาชนิด)', () => {
    expect(() => usTradeToForm({ ...base, id: 'x', kind: 'reinvest', date: '2026-03-01', units: U(1), amount: 1, fee: 0, fxRateMicro: 1 })).toThrow();
  });
});

describe('linkedCashAccountId: กระเป๋า/เงินสด USD ที่รายการเดิมใช้', () => {
  const accounts: Account[] = [
    { id: 'w1', type: 'asset', name: 'Wallet', currency: 'THB' },
    { id: 'cost-a1', type: 'asset', name: 'Cost', currency: 'THB', kind: 'investment' },
    { id: 'gain', type: 'income', name: 'Gain', currency: 'THB' },
    { id: 'wht', type: 'expense', name: 'WHT', currency: 'THB' },
  ];
  const entry = (lines: Entry['lines']): Entry => ({ id: 'e', date: '2026-03-01', memo: '', source: 'system', lines });
  it('ซื้อ: บัญชีสินทรัพย์ตัวที่ไม่ใช่บัญชีต้นทุน', () => {
    expect(linkedCashAccountId(entry([{ accountId: 'cost-a1', amount: 100 }, { accountId: 'w1', amount: -100 }]), 'cost-a1', accounts)).toBe('w1');
  });
  it('ขายที่มีกำไร: ข้ามบรรทัดรายรับ', () => {
    expect(linkedCashAccountId(entry([{ accountId: 'w1', amount: 150 }, { accountId: 'cost-a1', amount: -100 }, { accountId: 'gain', amount: -50 }]), 'cost-a1', accounts)).toBe('w1');
  });
  it('ปันผล: ข้ามรายรับและภาษีหัก', () => {
    expect(linkedCashAccountId(entry([{ accountId: 'w1', amount: 90 }, { accountId: 'wht', amount: 10 }, { accountId: 'gain', amount: -100 }]), 'cost-a1', accounts)).toBe('w1');
  });
  it('ปันผลลงทุนต่อ (ไม่มีกระเป๋า) หรือไม่พบรายการ = undefined', () => {
    expect(linkedCashAccountId(entry([{ accountId: 'cost-a1', amount: 100 }, { accountId: 'gain', amount: -100 }]), 'cost-a1', accounts)).toBeUndefined();
    expect(linkedCashAccountId(undefined, 'cost-a1', accounts)).toBeUndefined();
  });
});
