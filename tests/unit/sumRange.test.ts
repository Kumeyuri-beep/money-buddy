import { describe, expect, it } from 'vitest';
import { describeEntry } from '../../src/app/describe';
import { findDuplicateEntry } from '../../src/app/slipDuplicates';
import { createEntry, indexAccounts, LedgerError, sumByCurrency } from '../../src/domain/ledger/entry';
import { runIntegrityCheck } from '../../src/domain/ledger/integrity';
import { buildCashFlow } from '../../src/domain/ledger/sankey';
import type { Account, Entry } from '../../src/domain/ledger/types';
import { getDerivedErrorState, shouldResetBoundary } from '../../src/ui/errorBoundaryState';

const MAX = Number.MAX_SAFE_INTEGER;

const accounts: Account[] = [
  { id: 'w1', type: 'asset', name: 'w1', currency: 'THB' },
  { id: 'w2', type: 'asset', name: 'w2', currency: 'THB' },
  { id: 'food', type: 'expense', name: 'food', currency: 'THB' },
  { id: 'salary', type: 'income', name: 'salary', currency: 'THB' },
  { id: 'usd', type: 'asset', name: 'usd', currency: 'USD' },
  { id: 'usd2', type: 'equity', name: 'usd2', currency: 'USD' },
];
const byId = indexAccounts(accounts);

let seq = 0;
/** สร้าง Entry ตรงๆ (ข้าม createEntry) เหมือนข้อมูลที่โหลดจากฐานข้อมูล/นำเข้า */
function raw(lines: [string, number][], date = '2026-11-01', memo = ''): Entry {
  seq += 1;
  return { id: `s${seq}`, date, memo, source: 'manual', lines: lines.map(([accountId, amount]) => ({ accountId, amount })) } as unknown as Entry;
}

describe('sumByCurrency', () => {
  it('ปกติ แยกตามสกุลเงิน', () => {
    const t = sumByCurrency(raw([['w1', 100], ['food', -100], ['usd', 5], ['usd2', -5]]), byId);
    expect(t.get('THB')).toBe(0);
    expect(t.get('USD')).toBe(0);
  });
  it('ขอบ: ยอดเท่า MAX และหักกลบพอดี', () => {
    expect(sumByCurrency(raw([['w1', MAX], ['w2', -MAX]]), byId).get('THB')).toBe(0);
  });
  it('ค่ากลางทางเกินช่วงปลอดภัย = RangeError แม้ผลสุดท้ายเป็นศูนย์ (เดิมเพี้ยนเงียบ)', () => {
    expect(() => sumByCurrency(raw([['w1', MAX], ['w2', 2], ['food', -MAX], ['salary', -2]]), byId)).toThrow(RangeError);
  });
  it('เรียงหักกลบก่อน (MAX, -MAX, 2, -2) ผ่าน', () => {
    expect(sumByCurrency(raw([['w1', MAX], ['food', -MAX], ['w2', 2], ['salary', -2]]), byId).get('THB')).toBe(0);
  });
});

describe('createEntry กับยอดที่ผลรวมระหว่างทางเกิน', () => {
  it('ปฏิเสธด้วย LedgerError ไม่ใช่ RangeError ที่ไม่มีใครจับ', () => {
    const make = () =>
      createEntry(accounts, {
        id: 'x',
        date: '2026-11-01',
        memo: '',
        lines: [
          { accountId: 'w1', amount: MAX },
          { accountId: 'w2', amount: 2 },
          { accountId: 'food', amount: -MAX },
          { accountId: 'salary', amount: -2 },
        ],
      });
    expect(make).toThrow(LedgerError);
  });
  it('ยอดใหญ่ที่หักกลบทันทีสร้างได้', () => {
    const e = createEntry(accounts, {
      id: 'y',
      date: '2026-11-01',
      memo: '',
      lines: [
        { accountId: 'w1', amount: MAX },
        { accountId: 'food', amount: -MAX },
      ],
    });
    expect(e.lines).toHaveLength(2);
  });
});

describe('runIntegrityCheck ไม่ล้มเมื่อยอดเกินช่วง', () => {
  it('รายงานเป็นปัญหา amount-overflow แทนการโยน', () => {
    const bad = raw([['w1', MAX], ['w2', 2], ['food', -MAX], ['salary', -2]]);
    const report = runIntegrityCheck(accounts, [bad]);
    expect(report.ok).toBe(false);
    expect(report.issues.map((i) => i.code)).toContain('amount-overflow');
  });
  it('ข้อมูลปกติผ่าน', () => {
    expect(runIntegrityCheck(accounts, [raw([['w1', 100], ['salary', -100]])]).ok).toBe(true);
  });
});

describe('describeEntry ไม่โยนใน render', () => {
  it('ยอดรวมเกินช่วง = ข้อความเตือน ยังจัดประเภทได้', () => {
    const bad = raw([['food', MAX], ['food', MAX], ['w1', -MAX], ['w2', -MAX]]);
    const d = describeEntry(accounts, bad);
    expect(d.kind).toBe('expense');
    expect(d.amountText).toBe('⚠ ยอดผิดปกติ');
  });
  it('รายการโอนยอดรวมฝั่งบวกเกินช่วง', () => {
    const bad = raw([['w1', MAX], ['w2', MAX], ['usd', -1]]);
    expect(describeEntry(accounts, bad).amountText).toBe('⚠ ยอดผิดปกติ');
  });
  it('ปกติ: รายจ่าย รายรับ โอน ไม่เปลี่ยน', () => {
    expect(describeEntry(accounts, raw([['food', 6500], ['w1', -6500]])).amountText).toBe('−฿65.00');
    expect(describeEntry(accounts, raw([['w1', 1_700_000], ['salary', -1_700_000]])).amountText).toBe('+฿17,000.00');
    expect(describeEntry(accounts, raw([['w1', 250_000], ['w2', -250_000]])).amountText).toBe('฿2,500.00');
  });
});

describe('findDuplicateEntry', () => {
  it('ข้ามรายการที่ยอดรวมเกินช่วง ยังหารายการซ้ำอื่นเจอ', () => {
    const bad = raw([['w1', MAX], ['w2', 2], ['food', -MAX], ['salary', -2]], '2026-11-03');
    const ok = raw([['food', 5500], ['w1', -5500]], '2026-11-03', 'ร้านข้าว');
    expect(findDuplicateEntry([bad, ok], { date: '2026-11-03', amount: '55' })).toBe(ok);
  });
  it('ไม่พบ = undefined', () => {
    expect(findDuplicateEntry([raw([['food', 100], ['w1', -100]], '2026-11-03')], { date: '2026-11-03', amount: '55' })).toBeUndefined();
  });
});

describe('buildCashFlow sumByAccount', () => {
  it('บัญชีเดียวสะสมระหว่างทางเกิน = RangeError (เดิมได้ 1 สตางค์เงียบๆ)', () => {
    const list = [raw([['food', MAX], ['w1', -MAX]]), raw([['food', 2], ['w1', -2]]), raw([['food', -MAX], ['w1', MAX]])];
    expect(() => buildCashFlow(accounts, list, '2026-11', '2026-11-30')).toThrow(RangeError);
  });
});

describe('ตรรกะ ErrorBoundary (ไม่ผูก DOM)', () => {
  it('error → สถานะล้ม', () => {
    expect(getDerivedErrorState()).toEqual({ hasError: true });
  });
  it('เปลี่ยนหน้า (resetKey) ขณะล้ม = รีเซ็ต; หน้าเดิม/ไม่ล้ม = ไม่รีเซ็ต', () => {
    expect(shouldResetBoundary(true, 'today', 'ledger')).toBe(true);
    expect(shouldResetBoundary(true, 'today', 'today')).toBe(false);
    expect(shouldResetBoundary(false, 'today', 'ledger')).toBe(false);
  });
});

describe('amountClass', () => {
  it('ยอดปกติใช้สีตามประเภท ยอดผิดปกติใช้ tx-warn', async () => {
    const { amountClass, OVERFLOW_AMOUNT_TEXT } = await import('../../src/app/describe');
    expect(amountClass('expense', '−฿65.00')).toBe('num tx-expense');
    expect(amountClass('income', '+฿1.00')).toBe('num tx-income');
    expect(amountClass('expense', OVERFLOW_AMOUNT_TEXT)).toBe('tx-warn');
  });
});

describe('cashFlowMonths (ผู้เรียกใน UI ต้องจับ RangeError)', () => {
  it('บัญชีเดียวสะสมระหว่างทางเกิน = RangeError ตรงกับ buildCashFlow', async () => {
    const { cashFlowMonths } = await import('../../src/domain/ledger/sankey');
    const list = [raw([['food', MAX], ['w1', -MAX]]), raw([['food', 2], ['w1', -2]]), raw([['food', -MAX], ['w1', MAX]])];
    expect(() => cashFlowMonths(accounts, list)).toThrow(RangeError);
  });
});
