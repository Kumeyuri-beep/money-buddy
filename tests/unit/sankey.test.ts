import { describe, expect, it } from 'vitest';
import { createEntry } from '../../src/domain/ledger/entry';
import { periodTotals } from '../../src/domain/ledger/balance';
import { buildCashFlow, cashFlowMonths } from '../../src/domain/ledger/sankey';
import type { CashFlow } from '../../src/domain/ledger/sankey';
import type { Account, Entry } from '../../src/domain/ledger/types';

const EXPENSE_IDS = ['food', 'travel', 'rent', 'shop', 'fun', 'health', 'edu', 'other'];

const accounts: Account[] = [
  { id: 'w1', type: 'asset', name: 'CashFlow', currency: 'THB' },
  { id: 'w2', type: 'asset', name: 'Mainframe', currency: 'THB' },
  { id: 'usd', type: 'asset', name: 'Webull', currency: 'USD' },
  { id: 'card', type: 'liability', name: 'บัตร', currency: 'THB' },
  { id: 'opening', type: 'equity', name: 'ยอดยกมา', currency: 'THB' },
  { id: 'salary', type: 'income', name: 'เงินเดือน', currency: 'THB' },
  { id: 'side', type: 'income', name: 'งานเสริม', currency: 'THB' },
  { id: 'usd-inc', type: 'income', name: 'ปันผล USD', currency: 'USD' },
  { id: 'usd-exp', type: 'expense', name: 'ค่าธรรมเนียม USD', currency: 'USD' },
  { id: 'food', type: 'expense', name: 'อาหาร', currency: 'THB' },
  { id: 'travel', type: 'expense', name: 'เดินทาง', currency: 'THB' },
  { id: 'rent', type: 'expense', name: 'ที่อยู่', currency: 'THB' },
  { id: 'shop', type: 'expense', name: 'ช้อปปิ้ง', currency: 'THB' },
  { id: 'fun', type: 'expense', name: 'บันเทิง', currency: 'THB' },
  { id: 'health', type: 'expense', name: 'สุขภาพ', currency: 'THB' },
  { id: 'edu', type: 'expense', name: 'เรียน', currency: 'THB' },
  { id: 'other', type: 'expense', name: 'อื่นๆ', currency: 'THB' },
];

let seq = 0;
function e(date: string, lines: [string, number][], source: Entry['source'] = 'manual'): Entry {
  seq += 1;
  return createEntry(accounts, {
    id: `s${seq}`,
    date,
    memo: '',
    source,
    lines: lines.map(([accountId, amount]) => ({ accountId, amount })),
  });
}
const earn = (date: string, amount: number, inc = 'salary', wallet = 'w1') =>
  e(date, [[wallet, amount], [inc, -amount]]);
const spend = (date: string, amount: number, exp = 'food', wallet = 'w1') =>
  e(date, [[exp, amount], [wallet, -amount]]);

const sum = (nodes: readonly { amount: number }[]) => nodes.reduce((s, n) => s + n.amount, 0);

/** ผลรวมฝั่งซ้าย (แหล่งรายรับ) ต้องเท่ากับผลรวมฝั่งขวา (หมวด + เหลือเก็บ) เท่ากับยอดรวมพอดี */
function expectConserved(flow: CashFlow) {
  expect(sum(flow.sources)).toBe(flow.total);
  expect(sum(flow.categories)).toBe(flow.total);
  for (const node of [...flow.sources, ...flow.categories]) {
    expect(Number.isSafeInteger(node.amount)).toBe(true);
    expect(node.amount).toBeGreaterThan(0);
  }
}

const kinds = (nodes: readonly { kind: string }[]) => nodes.map((n) => n.kind);

describe('buildCashFlow: เดือนว่างและกรณีขอบ', () => {
  it('สมุดบัญชีว่าง = ไม่มีข้อมูล', () => {
    const flow = buildCashFlow(accounts, [], '2026-11');
    expect(flow.hasData).toBe(false);
    expect(flow.total).toBe(0);
    expect(flow.sources).toEqual([]);
    expect(flow.categories).toEqual([]);
  });

  it('เดือนที่ไม่มีรายการ แต่เดือนอื่นมี = ไม่มีข้อมูล', () => {
    const flow = buildCashFlow(accounts, [earn('2026-10-05', 100000)], '2026-11');
    expect(flow.hasData).toBe(false);
  });

  it('ยอดยกมา (system) ไม่ถูกนับเป็นรายรับ (R4)', () => {
    const entries = [e('2026-11-01', [['w1', 500000], ['opening', -500000]], 'system')];
    expect(buildCashFlow(accounts, entries, '2026-11').hasData).toBe(false);
  });

  it('Transfer และจ่ายบัตร ไม่โผล่ใน Sankey (R4)', () => {
    const entries = [
      earn('2026-11-02', 100000),
      e('2026-11-03', [['w2', 30000], ['w1', -30000]]),
      e('2026-11-04', [['card', 20000], ['w1', -20000]]),
    ];
    const flow = buildCashFlow(accounts, entries, '2026-11');
    expect(flow.income).toBe(100000);
    expect(flow.expense).toBe(0);
    expect(kinds(flow.categories)).toEqual(['leftover']);
    expect(flow.categories[0]?.amount).toBe(100000);
    expectConserved(flow);
  });

  it('ไม่นับบัญชีรายรับ/รายจ่ายต่างสกุลเงิน (R3/R10)', () => {
    const entries = [
      earn('2026-11-02', 100000),
      spend('2026-11-03', 5000),
      e('2026-11-04', [['usd', 9_000_000], ['usd-inc', -9_000_000]]),
      e('2026-11-05', [['usd-exp', 1_000_000], ['usd', -1_000_000]]),
    ];
    const flow = buildCashFlow(accounts, entries, '2026-11');
    expect(flow.income).toBe(100000);
    expect(flow.expense).toBe(5000);
    expect(flow.sources.map((n) => n.name)).toEqual(['เงินเดือน']);
    expectConserved(flow);
  });

  it('เดือนที่มีแต่รายรับ/รายจ่าย USD = ไม่มีข้อมูล และไม่อยู่ในรายการเดือน', () => {
    const entries = [e('2026-11-04', [['usd', 9_000_000], ['usd-inc', -9_000_000]])];
    expect(buildCashFlow(accounts, entries, '2026-11').hasData).toBe(false);
    expect(cashFlowMonths(accounts, entries)).toEqual([]);
  });
});

describe('buildCashFlow: รายรับ vs รายจ่าย', () => {
  it('เหลือเก็บ: รายรับ 100,000 รายจ่าย 30,000 -> เหลือเก็บ 70,000', () => {
    const flow = buildCashFlow(accounts, [earn('2026-11-01', 10000000), spend('2026-11-02', 3000000)], '2026-11');
    expect(flow.income).toBe(10000000);
    expect(flow.expense).toBe(3000000);
    expect(flow.total).toBe(10000000);
    const leftover = flow.categories.find((n) => n.kind === 'leftover');
    expect(leftover?.amount).toBe(7000000);
    expect(leftover?.shareBps).toBe(7000);
    expectConserved(flow);
  });

  it('รายจ่ายเท่ารายรับพอดี: ไม่มีโหนดเหลือเก็บ และไม่มีโหนดใช้เกิน', () => {
    const flow = buildCashFlow(accounts, [earn('2026-11-01', 50000), spend('2026-11-02', 50000)], '2026-11');
    expect(kinds(flow.categories)).toEqual(['expense']);
    expect(kinds(flow.sources)).toEqual(['income']);
    expectConserved(flow);
  });

  it('ใช้เกินรายรับ: เพิ่มแหล่ง "ใช้เงินเก็บ (เกินรายรับ)" ฝั่งซ้ายเท่าส่วนที่เกิน และไม่มีเหลือเก็บ', () => {
    const flow = buildCashFlow(accounts, [earn('2026-11-01', 60000), spend('2026-11-02', 100000)], '2026-11');
    expect(flow.total).toBe(100000);
    const shortfall = flow.sources.find((n) => n.kind === 'shortfall');
    expect(shortfall?.name).toBe('ใช้เงินเก็บ (เกินรายรับ)');
    expect(shortfall?.amount).toBe(40000);
    expect(kinds(flow.categories)).not.toContain('leftover');
    expectConserved(flow);
  });

  it('รายรับ 0 แต่มีรายจ่าย: แหล่งมีเฉพาะ "ใช้เงินเก็บ (เกินรายรับ)"', () => {
    const flow = buildCashFlow(accounts, [spend('2026-11-02', 25000)], '2026-11');
    expect(flow.hasData).toBe(true);
    expect(flow.income).toBe(0);
    expect(kinds(flow.sources)).toEqual(['shortfall']);
    expect(flow.sources[0]?.amount).toBe(25000);
    expectConserved(flow);
  });

  it('น้อยมาก: 1 สตางค์ ก็ยังผ่านการรักษายอด', () => {
    const flow = buildCashFlow(accounts, [earn('2026-11-01', 1), spend('2026-11-02', 1)], '2026-11');
    expect(flow.total).toBe(1);
    expectConserved(flow);
  });

  it('หลายแหล่งรายรับ: เรียงมากไปน้อย และผลรวมเท่ายอดรวม', () => {
    const flow = buildCashFlow(
      accounts,
      [earn('2026-11-01', 100000, 'salary'), earn('2026-11-05', 250000, 'side'), spend('2026-11-06', 50000)],
      '2026-11',
    );
    expect(flow.sources.map((n) => n.name)).toEqual(['งานเสริม', 'เงินเดือน']);
    expect(flow.income).toBe(350000);
    expectConserved(flow);
  });

  it('เงินคืนในบัญชีรายจ่ายเดียวกันหักกันในหมวดนั้น', () => {
    const refund = e('2026-11-04', [['w1', 2000], ['food', -2000]]);
    const flow = buildCashFlow(accounts, [earn('2026-11-01', 100000), spend('2026-11-03', 10000), refund], '2026-11');
    expect(flow.expense).toBe(8000);
    expect(flow.categories.find((n) => n.name === 'อาหาร')?.amount).toBe(8000);
    expectConserved(flow);
  });

  const range = { from: '2026-11-01', to: '2026-11-31' };

  it('หมวดที่สุทธิติดลบ (คืนเงินข้ามเดือน) ไม่เป็นแท่งลบ แต่หักจากหมวดใหญ่สุด ยอดรายจ่ายเท่า periodTotals (R4)', () => {
    const refund = e('2026-11-04', [['w1', 3000], ['food', -3000]]);
    const entries = [earn('2026-11-01', 100000), spend('2026-11-03', 10000, 'travel'), refund];
    const flow = buildCashFlow(accounts, entries, '2026-11');
    expect(flow.expense).toBe(7000);
    expect(flow.expense).toBe(periodTotals(accounts, entries, range).expense);
    expect(flow.leftover).toBe(93000);
    expect(flow.categories.find((n) => n.name === 'เดินทาง')?.amount).toBe(7000);
    expectConserved(flow);
  });

  it('เครดิตสุทธิมากกว่าหมวดบวกทั้งหมด: หักจนหมด รายจ่ายเป็น 0 ไม่ติดลบ', () => {
    const refund = e('2026-11-04', [['w1', 9000], ['food', -9000]]);
    const flow = buildCashFlow(accounts, [earn('2026-11-01', 5000), spend('2026-11-03', 4000, 'travel'), refund], '2026-11');
    expect(flow.expense).toBe(0);
    expectConserved(flow);
  });

  it('รายรับสุทธิติดลบในบัญชีหนึ่ง (ตีกลับรายรับ) หักจากแหล่งใหญ่สุด ยอดรายรับเท่า periodTotals', () => {
    const reversal = e('2026-11-04', [['side', 2000], ['w1', -2000]]);
    const entries = [earn('2026-11-01', 10000), reversal];
    const flow = buildCashFlow(accounts, entries, '2026-11');
    expect(flow.income).toBe(8000);
    expect(flow.income).toBe(periodTotals(accounts, entries, range).income);
    expectConserved(flow);
  });

  it('เดือนที่มีแต่เงินคืน (สุทธิ 0) ไม่มีข้อมูลและไม่อยู่ในรายการเดือน', () => {
    const refund = e('2026-11-04', [['w1', 3000], ['food', -3000]]);
    expect(buildCashFlow(accounts, [refund], '2026-11').hasData).toBe(false);
    expect(cashFlowMonths(accounts, [refund])).toEqual([]);
  });

  it('leftover และ shortfall: อย่างใดอย่างหนึ่งเป็น 0 เสมอ', () => {
    const over = buildCashFlow(accounts, [earn('2026-11-01', 100), spend('2026-11-02', 250)], '2026-11');
    expect([over.leftover, over.shortfall]).toEqual([0, 150]);
    const under = buildCashFlow(accounts, [earn('2026-11-01', 300), spend('2026-11-02', 250)], '2026-11');
    expect([under.leftover, under.shortfall]).toEqual([50, 0]);
  });
});

describe('buildCashFlow: การรวมหมวดเป็น "อื่นๆ"', () => {
  // รายรับ 1,000,000 สตางค์ -> 4% = 40,000
  const income = earn('2026-11-01', 1000000);

  it('หมวดตรง 4% พอดี ยังเป็นหมวดของตัวเอง ไม่ถูกรวม', () => {
    const flow = buildCashFlow(accounts, [income, spend('2026-11-02', 40000, 'food')], '2026-11');
    expect(flow.categories.map((n) => n.name)).toContain('อาหาร');
  });

  it('หมวดต่ำกว่า 4% ไปหนึ่งสตางค์ ถูกรวมเป็น "อื่นๆ"', () => {
    const flow = buildCashFlow(accounts, [income, spend('2026-11-02', 39999, 'food')], '2026-11');
    const names = flow.categories.map((n) => n.name);
    expect(names).not.toContain('อาหาร');
    const other = flow.categories.find((n) => n.kind === 'other');
    expect(other?.amount).toBe(39999);
    expectConserved(flow);
  });

  it('หมวดทั้งหมดต่ำกว่า 4%: ทุกหมวดรวมเป็น "อื่นๆ" ก้อนเดียว', () => {
    const entries = [income, spend('2026-11-02', 10000, 'food'), spend('2026-11-03', 20000, 'travel')];
    const flow = buildCashFlow(accounts, entries, '2026-11');
    expect(kinds(flow.categories)).toEqual(['other', 'leftover']);
    expect(flow.categories[0]?.amount).toBe(30000);
    expectConserved(flow);
  });

  it('หมวดเดียว: ได้หมวดนั้น + เหลือเก็บ', () => {
    const flow = buildCashFlow(accounts, [income, spend('2026-11-02', 300000, 'rent')], '2026-11');
    expect(flow.categories.map((n) => n.name)).toEqual(['ที่อยู่', 'เหลือเก็บ']);
    expectConserved(flow);
  });

  it('เกิน 5 หมวด: เหลือหมวดใหญ่สุด 5 หมวด ที่เหลือรวมเป็น "อื่นๆ"', () => {
    const entries = [
      income,
      spend('2026-11-02', 100000, 'food'),
      spend('2026-11-02', 90000, 'travel'),
      spend('2026-11-02', 80000, 'rent'),
      spend('2026-11-02', 70000, 'shop'),
      spend('2026-11-02', 60000, 'fun'),
      spend('2026-11-02', 50000, 'health'),
      spend('2026-11-02', 45000, 'edu'),
    ];
    const flow = buildCashFlow(accounts, entries, '2026-11');
    const named = flow.categories.filter((n) => n.kind === 'expense');
    expect(named.map((n) => n.name)).toEqual(['อาหาร', 'เดินทาง', 'ที่อยู่', 'ช้อปปิ้ง', 'บันเทิง']);
    expect(flow.categories.find((n) => n.kind === 'other')?.amount).toBe(95000);
    expectConserved(flow);
  });

  it('บัญชีชื่อ "อื่นๆ" ของระบบ รวมเข้าก้อน "อื่นๆ" ไม่ซ้ำเป็นสองแท่งชื่อเดียวกัน', () => {
    const entries = [income, spend('2026-11-02', 200000, 'other'), spend('2026-11-02', 10000, 'food')];
    const flow = buildCashFlow(accounts, entries, '2026-11');
    expect(flow.categories.filter((n) => n.name === 'อื่นๆ')).toHaveLength(1);
    expect(flow.categories.find((n) => n.kind === 'other')?.amount).toBe(210000);
    expectConserved(flow);
  });

  it('ฐาน 4% ใช้ยอดรวมของกระแส: ใช้เกินรายรับก็ยังคำนวณได้', () => {
    // รายรับ 0 รายจ่าย 100,000 -> total 100,000 -> 4% = 4,000
    const entries = [spend('2026-11-02', 3999, 'food'), spend('2026-11-02', 96001, 'rent')];
    const flow = buildCashFlow(accounts, entries, '2026-11');
    expect(flow.categories.find((n) => n.kind === 'other')?.amount).toBe(3999);
    expectConserved(flow);
  });

  it('มี 5 หมวดพอดี (ทุกหมวดเกิน 4%): ไม่เกิดก้อน "อื่นๆ"', () => {
    const entries = [
      income,
      spend('2026-11-02', 100000, 'food'),
      spend('2026-11-02', 90000, 'travel'),
      spend('2026-11-02', 80000, 'rent'),
      spend('2026-11-02', 70000, 'shop'),
      spend('2026-11-02', 60000, 'fun'),
    ];
    const flow = buildCashFlow(accounts, entries, '2026-11');
    expect(kinds(flow.categories)).toEqual(['expense', 'expense', 'expense', 'expense', 'expense', 'leftover']);
    expectConserved(flow);
  });

  it('ยอดเท่ากัน เรียงตามชื่อให้ผลคงที่', () => {
    const entries = [income, spend('2026-11-02', 50000, 'travel'), spend('2026-11-02', 50000, 'food')];
    const names = buildCashFlow(accounts, entries, '2026-11').categories.map((n) => n.name);
    expect(names).toEqual([...names.slice(0, 2)].sort().concat(names.slice(2)));
  });

  it('shareBps ที่เศษ .5 พอดีปัดออกจากศูนย์ (R8): 1/20000 -> 0.5 bps -> 1', () => {
    const flow = buildCashFlow(accounts, [earn('2026-11-01', 20000), spend('2026-11-02', 1)], '2026-11');
    expect(flow.categories.find((n) => n.kind === 'other')?.shareBps).toBe(1);
  });

  it('shareBps ของหมวดคิดจากสตางค์ด้วย roundHalfUp', () => {
    const flow = buildCashFlow(accounts, [earn('2026-11-01', 30000), spend('2026-11-02', 10000, 'rent')], '2026-11');
    expect(flow.categories.find((n) => n.name === 'ที่อยู่')?.shareBps).toBe(3333);
    expect(flow.categories.find((n) => n.kind === 'leftover')?.shareBps).toBe(6667);
  });
});

describe('buildCashFlow: ขอบเดือน', () => {
  it('นับเฉพาะวันที่ในเดือน: 1 และวันสุดท้ายรวม, วันก่อน/หลังไม่รวม', () => {
    const entries = [
      earn('2026-10-31', 999),
      earn('2026-11-01', 1000),
      earn('2026-11-30', 2000),
      earn('2026-12-01', 4000),
    ];
    expect(buildCashFlow(accounts, entries, '2026-11').income).toBe(3000);
  });

  it('29 ก.พ. ปีอธิกสุรทิน ถูกนับในเดือนก.พ.', () => {
    const flow = buildCashFlow(accounts, [earn('2028-02-29', 5000)], '2028-02');
    expect(flow.income).toBe(5000);
  });

  it('สิ้นปี: 31 ธ.ค. อยู่เดือนธ.ค. ไม่หลุดไปม.ค.', () => {
    const entries = [earn('2026-12-31', 700), earn('2027-01-01', 300)];
    expect(buildCashFlow(accounts, entries, '2026-12').income).toBe(700);
    expect(buildCashFlow(accounts, entries, '2027-01').income).toBe(300);
  });

  it('asOf: เดือนปัจจุบันนับถึงวันนี้เท่านั้น รายการลงวันล่วงหน้าไม่นับ (ตามนิยาม A2.1)', () => {
    const entries = [earn('2026-11-02', 1000), earn('2026-11-03', 2000), earn('2026-11-20', 4000)];
    expect(buildCashFlow(accounts, entries, '2026-11', '2026-11-03').income).toBe(3000);
  });

  it('asOf อยู่หลังสิ้นเดือน (เดือนที่ผ่านมาแล้ว) นับทั้งเดือน', () => {
    const entries = [earn('2026-10-02', 1000), earn('2026-10-31', 2000)];
    expect(buildCashFlow(accounts, entries, '2026-10', '2026-11-03').income).toBe(3000);
  });
});

describe('buildCashFlow: ยอดตรงกับ periodTotals และรักษายอด (property test, seed คงที่)', () => {
  function lcg(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  it('50 ชุดสุ่ม: ผลรวมซ้าย = ผลรวมขวา = total และตรง periodTotals เมื่อไม่มีหมวดติดลบ', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const rand = lcg(seed);
      const entries: Entry[] = [];
      const incomeCount = Math.floor(rand() * 4);
      const expenseCount = Math.floor(rand() * 40);
      for (let i = 0; i < incomeCount; i++) {
        const day = String(1 + Math.floor(rand() * 28)).padStart(2, '0');
        entries.push(earn(`2026-11-${day}`, 1 + Math.floor(rand() * 5_000_000), rand() < 0.5 ? 'salary' : 'side'));
      }
      for (let i = 0; i < expenseCount; i++) {
        const day = String(1 + Math.floor(rand() * 28)).padStart(2, '0');
        const cat = EXPENSE_IDS[Math.floor(rand() * EXPENSE_IDS.length)] as string;
        entries.push(spend(`2026-11-${day}`, 1 + Math.floor(rand() * 400_000), cat));
      }
      const flow = buildCashFlow(accounts, entries, '2026-11');
      const totals = periodTotals(accounts, entries, { from: '2026-11-01', to: '2026-11-31' });
      expect(flow.income).toBe(totals.income);
      expect(flow.expense).toBe(totals.expense);
      expect(flow.total).toBe(Math.max(totals.income, totals.expense));
      expect(flow.hasData).toBe(entries.length > 0);
      if (flow.hasData) expectConserved(flow);
      expect(flow.categories.filter((n) => n.kind === 'expense').length).toBeLessThanOrEqual(5);
    }
  });
});

describe('buildCashFlow: ยอดใหญ่', () => {
  it('ยอดสูงมากแต่ยังอยู่ในช่วงปลอดภัย (9×10^11 สตางค์) ผลรวมยังเท่ายอดรวมพอดี', () => {
    const big = 900_000_000_000;
    const flow = buildCashFlow(accounts, [earn('2026-11-01', big), spend('2026-11-02', big / 3, 'rent')], '2026-11');
    expectConserved(flow);
  });

  it('ยอดที่คูณ 10000 แล้วเกินช่วงปลอดภัย ต้อง throw RangeError ไม่ให้ได้ร้อยละผิดเงียบๆ (เหมือน ratioBps)', () => {
    const huge = 90_000_000_000_000;
    expect(() => buildCashFlow(accounts, [earn('2026-11-01', huge)], '2026-11')).toThrow(RangeError);
  });
});

describe('cashFlowMonths: เดือนที่มีรายการให้เลือก', () => {
  it('เรียงใหม่ไปเก่า เฉพาะเดือนที่มีรายรับ/รายจ่าย (THB)', () => {
    const entries = [
      e('2026-08-01', [['w1', 100], ['opening', -100]], 'system'),
      earn('2026-09-10', 1000),
      e('2026-09-12', [['w2', 50], ['w1', -50]]),
      spend('2026-11-02', 200),
      earn('2026-10-31', 500),
      spend('2026-11-05', 300),
    ];
    expect(cashFlowMonths(accounts, entries)).toEqual(['2026-11', '2026-10', '2026-09']);
  });

  it('สมุดว่าง = ไม่มีเดือนให้เลือก', () => {
    expect(cashFlowMonths(accounts, [])).toEqual([]);
  });
});
