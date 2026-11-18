import { describe, expect, it } from 'vitest';
import { buildCashAdjustmentEntry, CASH_ADJUST_ACCOUNT_IDS, CashAdjustmentError, type CashAdjustmentInput } from '../../src/domain/invest/cashAdjustment';

const base: CashAdjustmentInput = {
  id: 'ca1', date: '2026-11-02', createdAt: '2026-11-02T03:00:00.000Z', cashAccountId: 'cash-usd', currency: 'USD', direction: 'deposit', amountMinor: 12_037, memo: '',
};

describe('buildCashAdjustmentEntry (หน้า Cash · ปรับยอดเงินสดพอร์ต)', () => {
  it('ฝาก USD: เงินสด + · บัญชีพัก USD − · ผลรวม 0 · บัญชีพักตามสกุล', () => {
    const r = buildCashAdjustmentEntry(base);
    expect(r.entry.lines).toEqual([
      { accountId: 'cash-usd', amount: 12_037 },
      { accountId: 'inv-cash-adjust-usd', amount: -12_037 },
    ]);
    expect(r.entry.lines.reduce((s, l) => s + l.amount, 0)).toBe(0);
    expect(r.adjustAccountIds).toEqual(['inv-cash-adjust-usd']);
    expect(r.entry.source).toBe('manual');
  });
  it('ถอนบาท: เงินสด − · บัญชีพักบาท + · ใช้บัญชีพักของสกุลบาท', () => {
    const r = buildCashAdjustmentEntry({ ...base, cashAccountId: 'cash-thb', currency: 'THB', direction: 'withdraw', amountMinor: 500_000 });
    expect(r.entry.lines).toEqual([
      { accountId: 'cash-thb', amount: -500_000 },
      { accountId: CASH_ADJUST_ACCOUNT_IDS.THB, amount: 500_000 },
    ]);
  });
  it('หมายเหตุต่อท้ายหัวข้อ · ว่าง = ไม่มีต่อท้าย', () => {
    expect(buildCashAdjustmentEntry(base).entry.memo).toBe('เงินเข้าพอร์ต (ปรับยอดเงินสด)');
    expect(buildCashAdjustmentEntry({ ...base, memo: '  ตรงใบแจ้งยอด ' }).entry.memo).toBe('เงินเข้าพอร์ต (ปรับยอดเงินสด) · ตรงใบแจ้งยอด');
  });
  it('จำนวน 0 / ติดลบ / ทศนิยม / เกินช่วงปลอดภัย / NaN ปฏิเสธ · 1 หน่วยและค่าสูงสุดปลอดภัยผ่าน', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY]) {
      expect(() => buildCashAdjustmentEntry({ ...base, amountMinor: bad }), String(bad)).toThrow(CashAdjustmentError);
    }
    expect(buildCashAdjustmentEntry({ ...base, amountMinor: 1 }).entry.lines[0]!.amount).toBe(1);
    expect(buildCashAdjustmentEntry({ ...base, amountMinor: Number.MAX_SAFE_INTEGER }).entry.lines[0]!.amount).toBe(Number.MAX_SAFE_INTEGER);
  });
  it('ไม่ได้เลือกบัญชี / วันที่ไม่มีจริง ปฏิเสธ', () => {
    expect(() => buildCashAdjustmentEntry({ ...base, cashAccountId: '' })).toThrow(CashAdjustmentError);
    expect(() => buildCashAdjustmentEntry({ ...base, date: '2026-02-30' })).toThrow(CashAdjustmentError);
    expect(() => buildCashAdjustmentEntry({ ...base, date: '' })).toThrow(CashAdjustmentError);
  });
  it('ข้อความ error มีรหัส (ระบบ {code, params}) ทั้งไทยและอังกฤษ', () => {
    try {
      buildCashAdjustmentEntry({ ...base, amountMinor: 0 });
      expect.unreachable();
    } catch (e) {
      expect((e as { code?: string }).code).toBe('link.cashAmountInvalid');
    }
  });
});
