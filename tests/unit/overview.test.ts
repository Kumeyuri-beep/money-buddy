import { describe, expect, it } from 'vitest';
import { createEntry } from '../../src/domain/ledger/entry';
import {
  cashBalance,
  completedMonthExpenses,
  incomeChannels,
  monthOverMonth,
  netWorthAt,
  netWorthDelta,
  netWorthMonthlySeries,
  ratioBps,
  runwayTenths,
  savingsRate,
} from '../../src/domain/ledger/overview';
import type { Account, Entry } from '../../src/domain/ledger/types';
import { parseBahtToSatang as baht } from '../../src/domain/money/satang';
import { buildOverview } from '../../src/app/overview';

const accounts: Account[] = [
  { id: 'w1', type: 'asset', name: 'CashFlow', currency: 'THB', sortOrder: 0 },
  { id: 'w2', type: 'asset', name: 'Mainframe', currency: 'THB', sortOrder: 1 },
  { id: 'w-old', type: 'asset', name: 'เก่า', currency: 'THB', archived: true },
  { id: 'usd', type: 'asset', name: 'Webull', currency: 'USD' },
  { id: 'card', type: 'liability', name: 'บัตร', currency: 'THB' },
  { id: 'opening', type: 'equity', name: 'ยอดยกมา', currency: 'THB' },
  { id: 'fx-thb', type: 'equity', name: 'พัก THB', currency: 'THB' },
  { id: 'fx-usd', type: 'equity', name: 'พัก USD', currency: 'USD' },
  { id: 'salary', type: 'income', name: 'เงินเดือน', currency: 'THB' },
  { id: 'other-inc', type: 'income', name: 'รายรับอื่น', currency: 'THB' },
  { id: 'food', type: 'expense', name: 'อาหาร', currency: 'THB' },
  { id: 'interest', type: 'expense', name: 'ดอกเบี้ย', currency: 'THB' },
];

let seq = 0;
function e(date: string, lines: [string, number][], source: Entry['source'] = 'manual'): Entry {
  seq += 1;
  return createEntry(accounts, {
    id: `e${seq}`,
    date,
    memo: '',
    source,
    lines: lines.map(([accountId, amount]) => ({ accountId, amount })),
  });
}

const opening = (date: string, wallet: string, satang: number) =>
  e(date, [[wallet, satang], ['opening', -satang]], 'system');
const earn = (date: string, wallet: string, satang: number, inc = 'salary') =>
  e(date, [[wallet, satang], [inc, -satang]]);
const spend = (date: string, wallet: string, satang: number, exp = 'food') =>
  e(date, [[exp, satang], [wallet, -satang]]);

describe('ratioBps: อัตราส่วนเป็น basis points จำนวนเต็ม', () => {
  it('ปัดครึ่งออกจากศูนย์ทั้งบวกและลบ (R8)', () => {
    expect(ratioBps(1, 3)).toBe(3333);
    expect(ratioBps(2, 3)).toBe(6667);
    expect(ratioBps(1, 20000)).toBe(1); // 0.5 bps -> 1
    expect(ratioBps(-1, 20000)).toBe(-1);
  });
  it('ตัวตั้ง 0 ได้ 0 ไม่ใช่ -0', () => {
    expect(Object.is(ratioBps(0, 5), 0)).toBe(true);
    expect(Object.is(ratioBps(-0, 5), 0)).toBe(true);
  });
  it('ตัวหาร 0 ต้อง throw ไม่ให้ได้ Infinity', () => {
    expect(() => ratioBps(1, 0)).toThrow(RangeError);
  });
  it('ยอดใหญ่จนคูณ 10000 เกินช่วงปลอดภัย ต้อง throw ไม่ให้ได้ค่าผิดเงียบๆ', () => {
    expect(() => ratioBps(Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError);
  });
});

describe('netWorthAt: ทรัพย์สิน − หนี้สิน ณ สิ้นวัน', () => {
  it('สมุดบัญชีว่างได้ 0', () => {
    expect(netWorthAt(accounts, [], '2026-11-02')).toBe(0);
  });
  it('นับยอดยกมา (system) เป็นทรัพย์สิน แต่ไม่ใช่รายรับ', () => {
    const entries = [opening('2026-11-01', 'w1', baht('1000'))];
    expect(netWorthAt(accounts, entries, '2026-11-01')).toBe(baht('1000'));
  });
  it('หนี้บัตรลดมูลค่าสุทธิ ยอดติดลบได้', () => {
    const entries = [e('2026-11-01', [['food', baht('500')], ['card', -baht('500')]])];
    expect(netWorthAt(accounts, entries, '2026-11-01')).toBe(-baht('500'));
  });
  it('ไม่นับรายการหลังวันที่อ้างอิง และนับรายการวันเดียวกัน (สิ้นวัน)', () => {
    const entries = [opening('2026-11-01', 'w1', 10000), earn('2026-11-02', 'w1', 500), earn('2026-11-03', 'w1', 700)];
    expect(netWorthAt(accounts, entries, '2026-11-02')).toBe(10500);
  });
  it('ไม่นับสกุลเงินอื่นรวมกับบาท (R3/R10)', () => {
    const entries = [e('2026-11-01', [['usd', 5_000_000], ['fx-usd', -5_000_000]], 'system')];
    expect(netWorthAt(accounts, entries, '2026-11-01')).toBe(0);
  });
  it('นับกระเป๋าที่เก็บถาวรแต่ยังมีเงิน (เงินยังเป็นของผู้ใช้)', () => {
    const entries = [opening('2026-11-01', 'w-old', 777)];
    expect(netWorthAt(accounts, entries, '2026-11-01')).toBe(777);
  });
  it('ยอด 1 สตางค์', () => {
    expect(netWorthAt(accounts, [opening('2026-11-01', 'w1', 1)], '2026-11-01')).toBe(1);
  });
});

describe('cashBalance: เงินสด = บัญชี asset THB ที่ไม่เก็บถาวร', () => {
  it('ไม่รวมกระเป๋าเก็บถาวร สกุลอื่น และหนี้', () => {
    const entries = [
      opening('2026-11-01', 'w1', 1000),
      opening('2026-11-01', 'w-old', 5000),
      e('2026-11-01', [['usd', 9_000_000], ['fx-usd', -9_000_000]], 'system'),
      e('2026-11-01', [['food', 300], ['card', -300]]),
    ];
    expect(cashBalance(accounts, entries, '2026-11-01')).toBe(1000);
  });
  it('ว่าง = 0', () => {
    expect(cashBalance(accounts, [], '2026-11-01')).toBe(0);
  });
});

describe('netWorthMonthlySeries', () => {
  it('ว่าง = []', () => {
    expect(netWorthMonthlySeries(accounts, [], '2026-11-02')).toEqual([]);
  });
  it('เริ่มที่เดือนของรายการแรก จุดสุดท้ายคือวันที่อ้างอิง ไม่ใช่สิ้นเดือน', () => {
    const entries = [opening('2026-09-15', 'w1', 1000), earn('2026-10-31', 'w1', 200), earn('2026-11-05', 'w1', 50)];
    expect(netWorthMonthlySeries(accounts, entries, '2026-11-02')).toEqual([
      { month: '2026-09', value: 1000 },
      { month: '2026-10', value: 1200 },
      { month: '2026-11', value: 1200 },
    ]);
  });
  it('รายการวันสิ้นเดือนนับเข้าเดือนนั้น (ก.พ. ปีอธิกสุรทิน 29 วัน)', () => {
    const entries = [opening('2028-02-29', 'w1', 100), earn('2028-03-01', 'w1', 1)];
    expect(netWorthMonthlySeries(accounts, entries, '2028-03-31')).toEqual([
      { month: '2028-02', value: 100 },
      { month: '2028-03', value: 101 },
    ]);
  });
  it('ข้ามปีและจำกัดสูงสุด 12 จุดล่าสุด', () => {
    const entries = [opening('2025-01-10', 'w1', 100)];
    const series = netWorthMonthlySeries(accounts, entries, '2026-02-10');
    expect(series).toHaveLength(12);
    expect(series[0]?.month).toBe('2025-03');
    expect(series[11]?.month).toBe('2026-02');
  });
  it('เดือนที่ไม่มีรายการยังมีจุด (ยกยอดเดิม)', () => {
    const entries = [opening('2026-08-01', 'w1', 100)];
    const series = netWorthMonthlySeries(accounts, entries, '2026-10-02');
    expect(series.map((p) => p.value)).toEqual([100, 100, 100]);
  });
});

describe('monthOverMonth: รายจ่ายเดือนนี้เทียบเดือนก่อน (bps)', () => {
  it('เดือนก่อนไม่มีรายจ่าย = null (ไม่หารศูนย์)', () => {
    const entries = [spend('2026-11-02', 'w1', 100)];
    expect(monthOverMonth(accounts, entries, '2026-11-30')).toBeNull();
  });
  it('เพิ่มขึ้น/ลดลง/เท่าเดิม', () => {
    const base = [spend('2026-10-05', 'w1', 10000)];
    expect(monthOverMonth(accounts, [...base, spend('2026-11-05', 'w1', 12500)], '2026-11-30')).toBe(2500);
    expect(monthOverMonth(accounts, [...base, spend('2026-11-05', 'w1', 7500)], '2026-11-30')).toBe(-2500);
    expect(monthOverMonth(accounts, [...base, spend('2026-11-05', 'w1', 10000)], '2026-11-30')).toBe(0);
  });
  it('เดือนนี้ไม่มีรายจ่ายเลย = -10000 (ลด 100%)', () => {
    expect(monthOverMonth(accounts, [spend('2026-10-30', 'w1', 500)], '2026-11-30')).toBe(-10000);
  });
  it('ข้ามปี ม.ค. เทียบ ธ.ค. ปีก่อน และสิ้นเดือน 31 ธ.ค. นับเข้า ธ.ค.', () => {
    const entries = [spend('2026-12-31', 'w1', 200), spend('2027-01-01', 'w1', 300)];
    expect(monthOverMonth(accounts, entries, '2027-01-31')).toBe(5000);
  });
  it('Transfer และการจ่ายเงินต้นหนี้ไม่นับเป็นรายจ่าย (R4)', () => {
    const entries = [
      spend('2026-10-05', 'w1', 1000),
      e('2026-11-05', [['card', baht('5000')], ['w1', -baht('5000')]]), // จ่ายบัตร
      e('2026-11-06', [['w2', 900], ['w1', -900]]), // โอน
    ];
    expect(monthOverMonth(accounts, entries, '2026-11-30')).toBe(-10000);
  });
  it('ดอกเบี้ยนับเป็นรายจ่าย (R4)', () => {
    const entries = [spend('2026-10-05', 'w1', 100, 'interest'), spend('2026-11-05', 'w1', 200, 'interest')];
    expect(monthOverMonth(accounts, entries, '2026-11-30')).toBe(10000);
  });
});

describe('monthOverMonth: เทียบช่วงเดียวกันของเดือนก่อน', () => {
  it('31 มี.ค. เทียบ ก.พ. ทั้งเดือน (ตัดที่ 28 ปีปกติ)', () => {
    const entries = [spend('2026-02-28', 'w1', 1000), spend('2026-03-31', 'w1', 500)];
    expect(monthOverMonth(accounts, entries, '2026-03-31')).toBe(-5000);
  });
  it('31 มี.ค. ปีอธิกสุรทิน เทียบ ก.พ. ถึง 29', () => {
    const entries = [spend('2028-02-29', 'w1', 1000), spend('2028-03-31', 'w1', 2000)];
    expect(monthOverMonth(accounts, entries, '2028-03-31')).toBe(10000);
  });
  it('กลางเดือน: ตัดเดือนก่อนที่วันเดียวกัน ไม่นับส่วนหลังจากนั้น', () => {
    const entries = [
      spend('2026-02-10', 'w1', 1000),
      spend('2026-02-20', 'w1', 9000), // หลังวันที่ 15 ไม่นับ
      spend('2026-03-12', 'w1', 1000),
    ];
    expect(monthOverMonth(accounts, entries, '2026-03-15')).toBe(0);
  });
  it('ไม่นับรายการเดือนนี้ที่ลงวันหลังวันนี้ (ลงวันล่วงหน้า)', () => {
    const entries = [spend('2026-10-05', 'w1', 1000), spend('2026-11-03', 'w1', 500), spend('2026-11-20', 'w1', 9000)];
    expect(monthOverMonth(accounts, entries, '2026-11-10')).toBe(-5000);
  });
  it('29 ก.พ. เทียบ 1-29 ม.ค. (30-31 ม.ค. ไม่นับ)', () => {
    const entries = [spend('2028-01-29', 'w1', 1000), spend('2028-01-31', 'w1', 9000), spend('2028-02-29', 'w1', 1000)];
    expect(monthOverMonth(accounts, entries, '2028-02-29')).toBe(0);
  });
  it('30 เม.ย. เทียบ 1-30 มี.ค. (31 มี.ค. ไม่นับ)', () => {
    const entries = [spend('2026-03-30', 'w1', 1000), spend('2026-03-31', 'w1', 9000), spend('2026-04-30', 'w1', 1500)];
    expect(monthOverMonth(accounts, entries, '2026-04-30')).toBe(5000);
  });
  it('วันที่ 1: เทียบวันที่ 1 ของเดือนก่อนวันเดียว', () => {
    const entries = [spend('2026-10-01', 'w1', 1000), spend('2026-10-02', 'w1', 9000), spend('2026-11-01', 'w1', 2000)];
    expect(monthOverMonth(accounts, entries, '2026-11-01')).toBe(10000);
  });
  it('ช่วงเดียวกันของเดือนก่อนไม่มีรายจ่าย = null แม้ท้ายเดือนก่อนมี', () => {
    const entries = [spend('2026-10-20', 'w1', 1000), spend('2026-11-02', 'w1', 500)];
    expect(monthOverMonth(accounts, entries, '2026-11-02')).toBeNull();
  });
});

describe('ตัวหารติดลบ (เครดิตคืนเข้าบัญชีรายจ่าย) ต้องไม่ให้ร้อยละหลอก', () => {
  it('monthOverMonth: รายจ่ายสุทธิเดือนก่อนติดลบ = null', () => {
    const refund = e('2026-10-05', [['w1', 100], ['food', -100]]);
    expect(monthOverMonth(accounts, [refund, spend('2026-11-05', 'w1', 100)], '2026-11-30')).toBeNull();
  });
  it('savingsRate: รายรับติดลบ = null', () => {
    expect(savingsRate(-100, -50)).toBeNull();
  });
  it('monthOverMonth: เดือนนี้รายจ่ายสุทธิติดลบ (เครดิตคืนเกิน) ได้ต่ำกว่า -10000', () => {
    const entries = [spend('2026-10-05', 'w1', 1000), e('2026-11-05', [['w1', 500], ['food', -500]])];
    expect(monthOverMonth(accounts, entries, '2026-11-30')).toBe(-15000);
  });
  it('monthOverMonth: 28 ก.พ. เทียบ 1-28 ม.ค. (29-31 ม.ค. ไม่นับ)', () => {
    const entries = [spend('2026-01-28', 'w1', 1000), spend('2026-01-31', 'w1', 9000), spend('2026-02-28', 'w1', 2000)];
    expect(monthOverMonth(accounts, entries, '2026-02-28')).toBe(10000);
  });
  it('monthOverMonth: ส่วนต่างใหญ่เกินช่วงปลอดภัยต้อง throw ไม่คืนค่าผิด', () => {
    const entries = [spend('2026-10-05', 'w1', 1), spend('2026-11-05', 'w1', 1_000_000_000_000)];
    expect(() => monthOverMonth(accounts, entries, '2026-11-30')).toThrow(RangeError);
  });
  it('monthOverMonth: ปัดครึ่งลบออกจากศูนย์ (-0.5 bps -> -1)', () => {
    const entries = [spend('2026-10-05', 'w1', 20000), spend('2026-11-05', 'w1', 19999)];
    expect(monthOverMonth(accounts, entries, '2026-11-30')).toBe(-1);
  });
});

describe('netWorthDelta', () => {
  it('ไม่มีเดือนก่อน = null, มี = ผลต่างสตางค์ (ติดลบได้)', () => {
    expect(netWorthDelta([])).toBeNull();
    expect(netWorthDelta([{ month: '2026-11', value: 5 }])).toBeNull();
    expect(
      netWorthDelta([
        { month: '2026-10', value: 500 },
        { month: '2026-11', value: 200 },
      ]),
    ).toBe(-300);
  });
});

describe('ยอดใหญ่', () => {
  it('netWorthAt ถูกต้องที่ 9×10^15 สตางค์ (ยังในช่วงปลอดภัย)', () => {
    expect(netWorthAt(accounts, [opening('2026-11-01', 'w1', 9_000_000_000_000_000)], '2026-11-01')).toBe(9_000_000_000_000_000);
  });
  it('runwayTenths เกินช่วงปลอดภัยต้อง throw ไม่คืนค่าผิด', () => {
    expect(() => runwayTenths(Number.MAX_SAFE_INTEGER, [1000])).toThrow(RangeError);
  });
});

describe('savingsRate(income, net)', () => {
  it('รายรับ 0 = null', () => {
    expect(savingsRate(0, 0)).toBeNull();
    expect(savingsRate(0, -500)).toBeNull();
  });
  it('ปกติ / เต็ม 100% / ติดลบได้', () => {
    expect(savingsRate(10000, 2000)).toBe(2000);
    expect(savingsRate(10000, 10000)).toBe(10000);
    expect(savingsRate(10000, -5000)).toBe(-5000);
    expect(savingsRate(10000, 0)).toBe(0);
  });
  it('ปัดครึ่งออกจากศูนย์', () => {
    expect(savingsRate(3, 1)).toBe(3333);
    expect(savingsRate(3, -1)).toBe(-3333);
  });
});

describe('completedMonthExpenses + runwayTenths', () => {
  const start = opening('2026-05-01', 'w1', baht('100000'));

  it('ไม่นับเดือนปัจจุบัน และได้ไม่เกิน 3 เดือนล่าสุดที่มีรายจ่าย เรียงเก่า→ใหม่', () => {
    const entries = [
      start,
      spend('2026-06-10', 'w1', 100),
      spend('2026-07-10', 'w1', 200),
      spend('2026-08-10', 'w1', 300),
      spend('2026-09-10', 'w1', 400),
      spend('2026-11-02', 'w1', 999), // เดือนปัจจุบัน ห้ามนับ
    ];
    expect(completedMonthExpenses(accounts, entries, '2026-11-02')).toEqual([200, 300, 400]);
  });
  it('เดือนที่ไม่มีรายจ่ายถูกข้าม ไม่ดึงค่าเฉลี่ยให้ต่ำ', () => {
    const entries = [start, spend('2026-07-10', 'w1', 200), spend('2026-09-10', 'w1', 400)];
    expect(completedMonthExpenses(accounts, entries, '2026-11-02')).toEqual([200, 400]);
  });
  it('เดือนแรกที่เริ่มใช้กลางเดือนถือว่าไม่ครบสมบูรณ์', () => {
    const entries = [opening('2026-10-15', 'w1', 5000), spend('2026-10-20', 'w1', 100)];
    expect(completedMonthExpenses(accounts, entries, '2026-11-02')).toEqual([]);
  });
  it('เดือนแรกที่เริ่มวันที่ 1 ถือว่าครบ', () => {
    const entries = [opening('2026-10-01', 'w1', 5000), spend('2026-10-20', 'w1', 100)];
    expect(completedMonthExpenses(accounts, entries, '2026-11-02')).toEqual([100]);
  });
  it('สมุดบัญชีว่าง = []', () => {
    expect(completedMonthExpenses(accounts, [], '2026-11-02')).toEqual([]);
  });

  it('runway = เงินสด ÷ ค่าใช้จ่ายเฉลี่ย (×10)', () => {
    expect(runwayTenths(baht('4300'), [baht('1000')])).toBe(43);
    expect(runwayTenths(baht('6000'), [baht('1000'), baht('2000'), baht('3000')])).toBe(30);
  });
  it('ไม่มีประวัติ หรือรายจ่ายรวม 0 = null', () => {
    expect(runwayTenths(1000, [])).toBeNull();
    expect(runwayTenths(1000, [0, 0])).toBeNull();
  });
  it('เงินสด 0 = 0 เดือน, เงินสดติดลบแสดง 0 (ไม่แสดงเดือนติดลบ)', () => {
    expect(runwayTenths(0, [500])).toBe(0);
    expect(runwayTenths(-500, [500])).toBe(0);
  });
  it('ปัดครึ่งออกจากศูนย์: 1 สตางค์ ÷ 20 สตางค์ต่อเดือน = 0.05 เดือน -> 0.5 -> 1', () => {
    expect(runwayTenths(1, [20])).toBe(1);
  });
});

describe('incomeChannels', () => {
  it('ไม่มีรายรับ = count 0, ไม่มีกระเป๋า', () => {
    expect(incomeChannels(accounts, [opening('2026-11-01', 'w1', 5000)], '2026-11')).toEqual({
      count: 0,
      topWalletId: null,
      topWalletAmount: 0,
    });
  });
  it('นับบัญชีรายรับที่มียอดสุทธิในเดือน และหากระเป๋าที่รับมากสุด', () => {
    const entries = [
      earn('2026-11-01', 'w1', 1000),
      earn('2026-11-15', 'w2', 3000, 'other-inc'),
      earn('2026-11-30', 'w2', 500),
      earn('2026-10-31', 'w1', 99999), // นอกเดือน
    ];
    expect(incomeChannels(accounts, entries, '2026-11')).toEqual({
      count: 2,
      topWalletId: 'w2',
      topWalletAmount: 3500,
    });
  });
  it('บัญชีรายรับที่ยอดสุทธิในเดือนเป็น 0 (กลับรายการ) ไม่นับเป็นช่องทาง', () => {
    const entries = [
      earn('2026-11-01', 'w1', 1000),
      e('2026-11-02', [['salary', 1000], ['w1', -1000]]),
    ];
    expect(incomeChannels(accounts, entries, '2026-11').count).toBe(0);
  });
  it('กลับรายการทั้งก้อน: ไม่มีกระเป๋าที่รับมากสุด (สอดคล้องกับรายรับสุทธิ 0)', () => {
    const entries = [earn('2026-11-01', 'w1', 1000), e('2026-11-02', [['salary', 1000], ['w1', -1000]])];
    expect(incomeChannels(accounts, entries, '2026-11')).toEqual({ count: 0, topWalletId: null, topWalletAmount: 0 });
  });
  it('กลับรายการบางส่วน: ยอดกระเป๋าเป็นยอดสุทธิ', () => {
    const entries = [earn('2026-11-01', 'w1', 1000), e('2026-11-02', [['salary', 400], ['w1', -400]])];
    expect(incomeChannels(accounts, entries, '2026-11')).toMatchObject({ count: 1, topWalletId: 'w1', topWalletAmount: 600 });
  });
  it('ยอดเท่ากัน เลือกกระเป๋าที่เรียงก่อน (sortOrder)', () => {
    const entries = [earn('2026-11-01', 'w2', 100), earn('2026-11-02', 'w1', 100)];
    expect(incomeChannels(accounts, entries, '2026-11').topWalletId).toBe('w1');
  });
});

describe('buildOverview: สถานะการ์ด (value / needs-setup / waiting-data)', () => {
  it('สมุดบัญชีว่าง: ไม่มีตัวเลขปลอม', () => {
    const o = buildOverview(accounts, [], '2026-11-02');
    expect(o.netWorth.kind).toBe('waiting-data');
    expect(o.savingsRate.kind).toBe('waiting-data');
    expect(o.vsLastMonth.kind).toBe('waiting-data');
    expect(o.runway.kind).toBe('waiting-data');
    expect(o.income).toMatchObject({ kind: 'value', total: 0 });
    expect(o.outgoing).toMatchObject({ kind: 'value', total: 0 });
  });

  it('SAFE-TO-SPEND เป็น needs-setup เสมอในรอบ A (R15)', () => {
    const entries = [opening('2026-11-01', 'w1', baht('1000'))];
    expect(buildOverview(accounts, entries, '2026-11-02').safeToSpend.kind).toBe('needs-setup');
    expect(buildOverview(accounts, [], '2026-11-02').safeToSpend.kind).toBe('needs-setup');
  });

  it('มีข้อมูลครบ: ค่าถูกต้องและยอดยกมาไม่ถูกนับเป็นรายรับ', () => {
    const entries = [
      opening('2026-09-01', 'w1', baht('10000')),
      spend('2026-09-10', 'w1', baht('1000')),
      spend('2026-10-02', 'w1', baht('1000')),
      earn('2026-11-01', 'w1', baht('2000')),
      spend('2026-11-02', 'w1', baht('500')),
    ];
    const o = buildOverview(accounts, entries, '2026-11-02');
    expect(o.income).toMatchObject({ kind: 'value', total: baht('2000'), channels: 1 });
    expect(o.outgoing).toMatchObject({ kind: 'value', total: baht('500') });
    expect(o.surplus).toMatchObject({ kind: 'value', net: baht('1500') });
    expect(o.savingsRate).toMatchObject({ kind: 'value', bps: 7500, targetBps: 2000 });
    expect(o.vsLastMonth).toMatchObject({ kind: 'value', bps: -5000 });
    // เงินสด = 10000-1000-1000+2000-500 = 9500 ; ค่าใช้จ่ายเฉลี่ย (ก.ย. เริ่มวันที่ 1 ครบ, ต.ค.) = 1000 -> 9.5 เดือน
    expect(o.runway).toMatchObject({ kind: 'value', tenths: 95, targetTenths: 60 });
    expect(o.netWorth).toMatchObject({ kind: 'value', value: baht('9500') });
  });

  it('netWorth: ส่วนต่างเทียบสิ้นเดือนก่อน เป็นสตางค์ ไม่มีเดือนก่อน = null', () => {
    const first = buildOverview(accounts, [opening('2026-11-01', 'w1', 1000)], '2026-11-02');
    expect(first.netWorth).toMatchObject({ kind: 'value', deltaVsPrevMonth: null });
    const entries = [opening('2026-10-01', 'w1', 1000), earn('2026-11-01', 'w1', 300)];
    const o = buildOverview(accounts, entries, '2026-11-02');
    expect(o.netWorth).toMatchObject({ kind: 'value', value: 1300, deltaVsPrevMonth: 300 });
  });

  it('รายรับเดือนนี้ 0: savingsRate รอข้อมูล แต่ surplus ยังแสดงยอด (ติดลบได้)', () => {
    const entries = [opening('2026-11-01', 'w1', 5000), spend('2026-11-02', 'w1', 700)];
    const o = buildOverview(accounts, entries, '2026-11-02');
    expect(o.savingsRate.kind).toBe('waiting-data');
    expect(o.surplus).toMatchObject({ kind: 'value', net: -700 });
  });

  it('runway ไม่นับกระเป๋าเก็บถาวรในเงินสด', () => {
    const entries = [
      opening('2026-09-01', 'w1', 1000),
      opening('2026-09-01', 'w-old', 999999),
      spend('2026-09-10', 'w1', 100),
    ];
    // เงินสด 900 ÷ 100 = 9 เดือน
    expect(buildOverview(accounts, entries, '2026-11-02').runway).toMatchObject({ tenths: 90 });
  });

  it('Transfer ไม่ทำให้รายรับรายจ่ายเปลี่ยน (R4)', () => {
    const entries = [
      opening('2026-11-01', 'w1', 5000),
      e('2026-11-02', [['w2', 1000], ['w1', -1000]]),
      e('2026-11-02', [['card', 400], ['w1', -400]]),
    ];
    const o = buildOverview(accounts, entries, '2026-11-02');
    expect(o.income).toMatchObject({ total: 0 });
    expect(o.outgoing).toMatchObject({ total: 0 });
  });
});
