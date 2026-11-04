import { describe, expect, it } from 'vitest';
import { periodTotals } from '../../src/domain/ledger/balance';
import {
  cashBalance,
  incomeChannels,
  monthOverMonth,
  netWorthAt,
  netWorthDelta,
  runwayTenths,
  savingsRate,
} from '../../src/domain/ledger/overview';
import type { Account, Entry } from '../../src/domain/ledger/types';
import { safeAdd, safeSub } from '../../src/domain/money/safe';

const MAX = Number.MAX_SAFE_INTEGER;

const accounts: Account[] = [
  { id: 'w1', type: 'asset', name: 'w1', currency: 'THB' },
  { id: 'w2', type: 'asset', name: 'w2', currency: 'THB' },
  { id: 'debt', type: 'liability', name: 'debt', currency: 'THB' },
  { id: 'salary', type: 'income', name: 'salary', currency: 'THB' },
  { id: 'bonus', type: 'income', name: 'bonus', currency: 'THB' },
  { id: 'food', type: 'expense', name: 'food', currency: 'THB' },
  { id: 'usd', type: 'expense', name: 'usd', currency: 'USD' },
];

/** สร้าง Entry ตรงๆ (ข้าม createEntry) เพื่อทดสอบยอดใหญ่ผิดปกติ */
let seq = 0;
function raw(lines: [string, number][], date = '2026-11-01'): Entry {
  seq += 1;
  return { id: `r${seq}`, date, memo: '', source: 'manual', createdAt: seq, lines: lines.map(([accountId, amount]) => ({ accountId, amount })) } as unknown as Entry;
}
const RANGE = { from: '2026-11-01', to: '2026-11-30' };

describe('safeAdd / safeSub', () => {
  it('ปกติ รวมขอบ 0 และ -0', () => {
    expect(safeAdd(2, 3)).toBe(5);
    expect(safeAdd(0, 0)).toBe(0);
    expect(Object.is(safeAdd(-0, 0), 0)).toBe(true);
    expect(safeSub(5, 7)).toBe(-2);
    expect(safeAdd(MAX, 0)).toBe(MAX);
    expect(safeSub(-MAX, 0)).toBe(-MAX);
    expect(safeAdd(MAX, -MAX)).toBe(0);
  });
  it('ผลเกินช่วงปลอดภัย = RangeError', () => {
    expect(() => safeAdd(MAX, 1)).toThrow(RangeError);
    expect(() => safeAdd(-MAX, -1)).toThrow(RangeError);
    expect(() => safeSub(MAX, -1)).toThrow(RangeError);
    expect(() => safeSub(-MAX, 1)).toThrow(RangeError);
  });
  it('อินพุตไม่ใช่จำนวนเต็มปลอดภัย = RangeError', () => {
    expect(() => safeAdd(Number.NaN, 1)).toThrow(RangeError);
    expect(() => safeAdd(1.5, 1)).toThrow(RangeError);
    expect(() => safeSub(Infinity, 1)).toThrow(RangeError);
    expect(() => safeAdd(2 ** 53, 0)).toThrow(RangeError);
  });
});

describe('periodTotals: ช่วงปลอดภัย', () => {
  it('ว่าง = 0 ทั้งหมด', () => {
    expect(periodTotals(accounts, [], RANGE)).toEqual({ currency: 'THB', income: 0, expense: 0, net: 0 });
  });
  it('ยอดเท่าขอบยังคืนค่าได้', () => {
    const t = periodTotals(accounts, [raw([['food', MAX], ['w1', -MAX]])], RANGE);
    expect(t.expense).toBe(MAX);
    expect(t.net).toBe(-MAX);
  });
  it('รายจ่ายสะสมเกิน = RangeError', () => {
    const list = [raw([['food', MAX]]), raw([['food', 1]])];
    expect(() => periodTotals(accounts, list, RANGE)).toThrow(RangeError);
  });
  it('รายรับสะสมเกิน = RangeError', () => {
    const list = [raw([['salary', -MAX]]), raw([['bonus', -1]])];
    expect(() => periodTotals(accounts, list, RANGE)).toThrow(RangeError);
  });
  it('net = income - expense เกิน = RangeError (รายรับสูงสุด + รายจ่ายติดลบสูงสุด)', () => {
    const list = [raw([['salary', -MAX]]), raw([['food', -MAX]])];
    expect(() => periodTotals(accounts, list, RANGE)).toThrow(RangeError);
  });
  it('ค่ากลางทางเกินแม้ผลสุดท้ายกลับเข้าช่วง = RangeError', () => {
    const list = [raw([['food', MAX]]), raw([['food', MAX]]), raw([['food', -MAX]])];
    expect(() => periodTotals(accounts, list, RANGE)).toThrow(RangeError);
  });
  it('จำนวนไม่ใช่จำนวนเต็มปลอดภัยในบัญชีที่นับ = RangeError', () => {
    expect(() => periodTotals(accounts, [raw([['food', 1.5]])], RANGE)).toThrow(RangeError);
    expect(() => periodTotals(accounts, [raw([['salary', Number.NaN]])], RANGE)).toThrow(RangeError);
  });
  it('ไม่นับรายการนอกช่วง บัญชีสกุลอื่น หรือบัญชีที่ไม่รู้จัก แม้ยอดใหญ่', () => {
    const list = [
      raw([['food', MAX]], '2026-10-31'),
      raw([['food', MAX]], '2026-12-01'),
      raw([['usd', MAX]]),
      raw([['usd', MAX]]),
      raw([['ghost', MAX]]),
      raw([['food', 100]]),
    ];
    expect(periodTotals(accounts, list, RANGE).expense).toBe(100);
  });
});

describe('cashBalance / netWorthAt: ผลรวมข้ามกระเป๋า', () => {
  it('กระเป๋าละปลอดภัย แต่รวมกันเกิน = RangeError (เดิมเพี้ยนเงียบ)', () => {
    const list = [raw([['w1', MAX]]), raw([['w2', 1]])];
    expect(() => cashBalance(accounts, list, '2026-11-30')).toThrow(RangeError);
    expect(() => netWorthAt(accounts, list, '2026-11-30')).toThrow(RangeError);
  });
  it('ยอดเท่าขอบ ผ่าน', () => {
    expect(cashBalance(accounts, [raw([['w1', MAX]])], '2026-11-30')).toBe(MAX);
  });
  it('สินทรัพย์ − หนี้ เกิน = RangeError', () => {
    // asset = MAX, liability natural = -raw = -1 → MAX - (-1)
    const list = [raw([['w1', MAX]]), raw([['debt', 1]])];
    expect(() => netWorthAt(accounts, list, '2026-11-30')).toThrow(RangeError);
  });
  it('ไม่มีรายการ = 0', () => {
    expect(cashBalance(accounts, [], '2026-11-30')).toBe(0);
    expect(netWorthAt(accounts, [], '2026-11-30')).toBe(0);
  });
});

describe('netWorthDelta', () => {
  it('ผลต่างเกิน = RangeError', () => {
    expect(() =>
      netWorthDelta([
        { month: '2026-10', value: -1 },
        { month: '2026-11', value: MAX },
      ]),
    ).toThrow(RangeError);
  });
  it('ปกติ / ไม่มีจุดก่อนหน้า', () => {
    expect(netWorthDelta([{ month: '2026-10', value: 100 }, { month: '2026-11', value: 150 }])).toBe(50);
    expect(netWorthDelta([{ month: '2026-11', value: 150 }])).toBeNull();
  });
});

describe('runwayTenths: ยอดรวมรายเดือน', () => {
  it('ผลรวมรายจ่ายรายเดือนเกิน = RangeError', () => {
    expect(() => runwayTenths(100, [MAX, 1])).toThrow(RangeError);
  });
  it('ปกติและขอบ', () => {
    expect(runwayTenths(300_000, [100_000])).toBe(30);
    expect(runwayTenths(-5, [100])).toBe(0);
    expect(runwayTenths(5, [])).toBeNull();
  });
  it('เงินสด × 10 × จำนวนเดือน เกิน = RangeError', () => {
    expect(() => runwayTenths(MAX, [1, 1, 1])).toThrow(RangeError);
  });
});

describe('savingsRate', () => {
  it('รายรับ 0 = null, ยอดใหญ่ = RangeError', () => {
    expect(savingsRate(0, 0)).toBeNull();
    expect(() => savingsRate(MAX, MAX)).toThrow(RangeError);
    expect(savingsRate(10_000, 2_000)).toBe(2000);
  });
});

describe('incomeChannels: ยอดสะสมต่อบัญชี', () => {
  it('รายรับบัญชีเดียวสะสมเกิน = RangeError', () => {
    const list = [raw([['salary', -MAX], ['w1', MAX]]), raw([['salary', -1], ['w1', 1]])];
    expect(() => incomeChannels(accounts, list, '2026-11')).toThrow(RangeError);
  });
  it('เงินเข้ากระเป๋าสะสมเกิน = RangeError', () => {
    const list = [raw([['salary', -MAX], ['w1', MAX]]), raw([['bonus', -1], ['w1', 1]])];
    expect(() => incomeChannels(accounts, list, '2026-11')).toThrow(RangeError);
  });
  it('ปกติ: นับช่องทางและกระเป๋าที่รับมากสุด', () => {
    const list = [raw([['salary', -5_000], ['w1', 5_000]]), raw([['bonus', -1_000], ['w2', 1_000]])];
    expect(incomeChannels(accounts, list, '2026-11')).toEqual({ count: 2, topWalletId: 'w1', topWalletAmount: 5_000 });
  });
});

describe('monthOverMonth และ -0', () => {
  it('ผลต่างรายจ่ายเดือนนี้กับเดือนก่อนเกินช่วงปลอดภัย = RangeError', () => {
    // เดือนก่อน (1-3 ต.ค.) รายจ่ายรวมเล็ก, เดือนนี้ติดลบสุดขอบ → current - previous ต่ำกว่า -MAX
    const list = [raw([['food', MAX]], '2026-10-02'), raw([['food', -MAX]], '2026-11-02')];
    expect(() => monthOverMonth(accounts, list, '2026-11-03')).toThrow(RangeError);
  });
  it('ปกติ: รายจ่ายเพิ่มขึ้น 50% = 5000 bps', () => {
    const list = [raw([['food', 1_000]], '2026-10-02'), raw([['food', 1_500]], '2026-11-02')];
    expect(monthOverMonth(accounts, list, '2026-11-03')).toBe(5000);
  });
  it('ไม่มีรายจ่ายเดือนก่อน = null', () => {
    expect(monthOverMonth(accounts, [raw([['food', 100]], '2026-11-02')], '2026-11-03')).toBeNull();
  });
  it('ไม่เกิด -0 ที่ periodTotals / netWorthAt', () => {
    const t = periodTotals(accounts, [], RANGE);
    expect(Object.is(t.net, 0)).toBe(true);
    expect(Object.is(t.income, 0)).toBe(true);
    expect(Object.is(netWorthAt(accounts, [], '2026-11-30'), 0)).toBe(true);
    const zero = [raw([['food', 5], ['w1', -5]]), raw([['food', -5], ['w1', 5]])];
    expect(Object.is(periodTotals(accounts, zero, RANGE).expense, 0)).toBe(true);
  });
});
