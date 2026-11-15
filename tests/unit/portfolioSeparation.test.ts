import { describe, expect, it } from 'vitest';
import { buildOverview } from '../../src/app/overview';
import { checkAccountKindChange, classifyPortfolioTransfer, wealthSummary } from '../../src/domain/invest/portfolioMoney';
import type { InvestmentData } from '../../src/domain/invest/types';
import { createEntry } from '../../src/domain/ledger/entry';
import type { Account, Entry } from '../../src/domain/ledger/types';

// ข้อมูลสมมติทั้งหมด (ไม่ใช่ข้อมูลจริง) · กฎ R23: แยกเงินใช้จ่ายออกจากเงินลงทุนที่หน้าจอและตัวเลข สมุดบัญชียังเป็นเล่มเดียว
const L = (accountId: string, amount: number) => ({ accountId, amount });

describe('ล็อกค่า "ใช้ได้วันนี้" และตัวเลขสรุปของข้อมูลเดิม (ไม่มีบัญชีลงทุน) · ต้องเท่าเดิมทุกสตางค์', () => {
  const accounts: Account[] = [
    { id: 'w1', type: 'asset', name: 'กระเป๋าหลัก', currency: 'THB', sortOrder: 1 },
    { id: 'w2', type: 'asset', name: 'ออมทรัพย์', currency: 'THB', sortOrder: 2 },
    { id: 'open', type: 'equity', name: 'ยอดยกมา', currency: 'THB' },
    { id: 'salary', type: 'income', name: 'เงินเดือน', currency: 'THB' },
    { id: 'food', type: 'expense', name: 'อาหาร', currency: 'THB' },
    { id: 'rent', type: 'expense', name: 'ค่าเช่า', currency: 'THB' },
  ];
  const e = (list: readonly Account[], id: string, date: string, lines: { accountId: string; amount: number }[], source: Entry['source'] = 'manual') =>
    createEntry(list, { id, date, memo: id, source, lines });
  const baseEntries = (list: readonly Account[]): Entry[] => [
    e(list, 'sys', '2026-09-01', [L('w1', 5_000_000), L('w2', 20_000_000), L('open', -25_000_000)], 'system'),
    e(list, 'sal9', '2026-09-25', [L('w1', 4_500_000), L('salary', -4_500_000)]),
    e(list, 'rent9', '2026-09-26', [L('rent', 1_200_000), L('w1', -1_200_000)]),
    e(list, 'food9', '2026-09-27', [L('food', 350_050), L('w1', -350_050)]),
    e(list, 'sal10', '2026-10-25', [L('w1', 4_500_000), L('salary', -4_500_000)]),
    e(list, 'rent10', '2026-10-26', [L('rent', 1_200_000), L('w1', -1_200_000)]),
    e(list, 'food10', '2026-10-28', [L('food', 410_075), L('w1', -410_075)]),
    e(list, 'tr10', '2026-10-30', [L('w2', 300_000), L('w1', -300_000)]),
    e(list, 'food11', '2026-11-03', [L('food', 123_457), L('w1', -123_457)]),
    e(list, 'sal11', '2026-11-05', [L('w1', 100_001), L('salary', -100_001)]),
  ];
  const TODAY = '2026-11-12';
  const finance = { bills: [], settings: { payDay: 25 } };
  // ค่าที่ล็อก: คำนวณจากโค้ดบน main ก่อนเพิ่มงาน R23 (ไฟล์คำนวณเงินไม่ถูกแก้ใน PR นี้)
  const GOLDEN = {
    month: '2026-11',
    netWorth: { kind: 'value', value: 30_816_419, deltaVsPrevMonth: -23_456, series: [{ month: '2026-09', value: 27_949_950 }, { month: '2026-10', value: 30_839_875 }, { month: '2026-11', value: 30_816_419 }] },
    income: { kind: 'value', total: 100_001, channels: 1, topWalletId: 'w1' },
    outgoing: { kind: 'value', total: 123_457, bills: 0, spend: 123_457, budget: null },
    surplus: { kind: 'value', net: -23_456 },
    safeToSpend: { kind: 'value', perDay: 2_370_494, daysLeft: 13, nextPayday: '2026-11-25', available: 30_816_419, outstanding: 0, reserve: 0, shortfall: 0, lowDays: false, invalidBills: 0, overridden: false },
    savingsRate: { kind: 'value', bps: -2346, targetBps: 2000 },
    vsLastMonth: { kind: 'waiting-data' },
    runway: { kind: 'value', tenths: 195, targetTenths: 60 },
  };

  it('ข้อมูลเดิม: ทุกการ์ดเท่าค่าที่ล็อก (ใช้ได้วันนี้ = 30,816,419 สตางค์ ต่อวัน 2,370,494 สตางค์)', () => {
    expect(buildOverview(accounts, baseEntries(accounts), TODAY, finance)).toEqual(GOLDEN);
  });

  it('เพิ่มบัญชีลงทุนที่ยังไม่มีรายการ (ต้นทุนสินทรัพย์ เงินสดโบรกเกอร์ เงินสด USD): ตัวเลขเท่าเดิมทุกสตางค์', () => {
    const more: Account[] = [
      ...accounts,
      { id: 'inv-th', type: 'asset', name: 'กองทุน', currency: 'THB', kind: 'investment' },
      { id: 'brk', type: 'asset', name: 'เงินสดโบรกเกอร์', currency: 'THB', kind: 'investment' },
      { id: 'usd-cash', type: 'asset', name: 'เงินสด USD', currency: 'USD', kind: 'investment' },
      { id: 'inv-us', type: 'asset', name: 'หุ้นสหรัฐ', currency: 'USD', kind: 'investment' },
    ];
    expect(buildOverview(more, baseEntries(more), TODAY, finance)).toEqual(GOLDEN);
  });

  describe('โอนเข้า/ออกพอร์ต (R23): ไม่ใช่รายรับ/รายจ่าย · ออกจาก "ใช้ได้วันนี้" ทันที', () => {
    const list: Account[] = [...accounts, { id: 'brk', type: 'asset', name: 'เงินสดโบรกเกอร์', currency: 'THB', kind: 'investment' }];
    const byId = new Map(list.map((a) => [a.id, a] as const));
    const none = new Set<string>();
    const toPortfolio = e(list, 'to-brk', '2026-11-06', [L('brk', 1_000_000), L('w1', -1_000_000)]);
    const fromPortfolio = e(list, 'from-brk', '2026-11-07', [L('w1', 1_000_000), L('brk', -1_000_000)]);

    it('จัดชนิดถูก: เข้า/ออก/โอนระหว่างบัญชีใช้จ่าย/รายจ่าย/ผูกรายการลงทุน/บัญชีต้นทุนสินทรัพย์ ไม่ใช่การโอนพอร์ต', () => {
      expect(classifyPortfolioTransfer(toPortfolio, byId, none)).toBe('to-portfolio');
      expect(classifyPortfolioTransfer(fromPortfolio, byId, none)).toBe('from-portfolio');
      expect(classifyPortfolioTransfer(e(list, 'sp', '2026-11-06', [L('w2', 5), L('w1', -5)]), byId, none)).toBeNull(); // ใช้จ่าย↔ใช้จ่าย
      expect(classifyPortfolioTransfer(e(list, 'ex', '2026-11-06', [L('food', 5), L('w1', -5)]), byId, none)).toBeNull();
      expect(classifyPortfolioTransfer(toPortfolio, byId, none, new Set(['to-brk']))).toBeNull(); // ผูกกับรายการซื้อขาย/แลกเงิน
      expect(classifyPortfolioTransfer(toPortfolio, byId, new Set(['brk']))).toBeNull(); // บัญชีต้นทุนของสินทรัพย์
      expect(classifyPortfolioTransfer(e(list, 'three', '2026-11-06', [L('brk', 2), L('w1', -1), L('w2', -1)]), byId, none)).toBeNull();
    });

    it('โอนเข้าพอร์ต 10,000.00 บาท: ใช้ได้วันนี้ลดลงเท่าที่โอนพอดี · รายรับ รายจ่าย ส่วนเกิน อัตราออม เท่าเดิม · มูลค่าสุทธิ (ราคาทุน) เท่าเดิม', () => {
      const after = buildOverview(list, [...baseEntries(list), toPortfolio], TODAY, finance);
      expect(after.income).toEqual(GOLDEN.income);
      expect(after.outgoing).toEqual(GOLDEN.outgoing);
      expect(after.surplus).toEqual(GOLDEN.surplus);
      expect(after.savingsRate).toEqual(GOLDEN.savingsRate);
      expect(after.netWorth).toEqual(GOLDEN.netWorth);
      expect(after.safeToSpend).toMatchObject({ kind: 'value', available: 30_816_419 - 1_000_000, daysLeft: 13 });
      expect(after.runway).toMatchObject({ kind: 'value' });
      expect((after.runway as { tenths: number }).tenths).toBeLessThan(195);
    });

    it('โอนกลับออกจากพอร์ต: ทุกการ์ดกลับเท่าค่าที่ล็อกเป๊ะ', () => {
      expect(buildOverview(list, [...baseEntries(list), toPortfolio, fromPortfolio], TODAY, finance)).toEqual(GOLDEN);
    });
  });

  describe('เปลี่ยนป้าย kind (R23): สมุดไม่เปลี่ยน · ตัวเลขที่คำนวณจากป้ายเปลี่ยนย้อนหลังทั้งหมด · เปลี่ยนกลับได้ค่าเดิมเป๊ะ', () => {
    it('ติดป้ายลงทุนให้ออมทรัพย์ (ยอด 20,300,000 สตางค์): ใช้ได้วันนี้ลดลงเท่ายอดนั้น · รายรับรายจ่ายเท่าเดิม · เปลี่ยนกลับ = ค่าล็อก', () => {
      const entries = baseEntries(accounts);
      const relabeled: Account[] = accounts.map((a) => (a.id === 'w2' ? { ...a, kind: 'investment' as const } : a));
      const after = buildOverview(relabeled, entries, TODAY, finance); // รายการชุดเดียวกัน ไม่แตะสมุด
      expect(after.safeToSpend).toMatchObject({ available: 30_816_419 - 20_300_000 });
      expect(after.income).toEqual(GOLDEN.income);
      expect(after.outgoing).toEqual(GOLDEN.outgoing);
      expect(after.surplus).toEqual(GOLDEN.surplus);
      expect(buildOverview(accounts, entries, TODAY, finance)).toEqual(GOLDEN);
    });

    it('เปลี่ยนป้ายได้เฉพาะบัญชีเงินสดบาทที่ไม่ผูกสินทรัพย์ · ไม่ใช่กระเป๋าจ่ายของบิล (เมื่อจะเป็นลงทุน)', () => {
      const ctx = {
        accounts: [
          ...accounts,
          { id: 'inv-th', type: 'asset' as const, name: 'กองทุน', currency: 'THB', kind: 'investment' as const },
          { id: 'usd-cash', type: 'asset' as const, name: 'USD', currency: 'USD', kind: 'investment' as const },
        ],
        investments: { assets: [{ id: 'a1', name: 'กองทุน', kind: 'fund' as const, accountId: 'inv-th' }], trades: [], prices: [] } satisfies InvestmentData,
        bills: [{ walletId: 'w1' }, { walletId: 'w2', archived: true }],
      };
      expect(checkAccountKindChange(ctx, 'w2', 'investment')).toBeNull(); // บิลที่เก็บถาวรไม่กัน
      expect(checkAccountKindChange(ctx, 'w1', 'investment')).toMatch(/มีบิลที่จ่ายจากกระเป๋านี้/);
      expect(checkAccountKindChange(ctx, 'w1', 'normal')).toBeNull();
      expect(checkAccountKindChange(ctx, 'inv-th', 'normal')).toMatch(/ผูกกับสินทรัพย์/);
      expect(checkAccountKindChange(ctx, 'usd-cash', 'normal')).toMatch(/USD/);
      expect(checkAccountKindChange(ctx, 'food', 'investment')).toMatch(/เงินสด/);
      expect(checkAccountKindChange(ctx, 'nope', 'investment')).toMatch(/ไม่พบ/);
    });
  });
});

describe('ความมั่งคั่งรวม (ราคาตลาด) แยกเงินใช้จ่ายกับเงินลงทุน (R23)', () => {
  const accounts: Account[] = [
    { id: 'w1', type: 'asset', name: 'กระเป๋า', currency: 'THB' },
    { id: 'open', type: 'equity', name: 'ยอดยกมา', currency: 'THB' },
    { id: 'fx-suspense-thb', type: 'equity', name: 'พักบาท', currency: 'THB' },
    { id: 'fx-suspense-usd', type: 'equity', name: 'พัก USD', currency: 'USD' },
    { id: 'brk', type: 'asset', name: 'เงินสดโบรกเกอร์', currency: 'THB', kind: 'investment' },
    { id: 'inv-th', type: 'asset', name: 'กองทุนไทย', currency: 'THB', kind: 'investment' },
    { id: 'usd-cash', type: 'asset', name: 'เงินสด USD', currency: 'USD', kind: 'investment' },
    { id: 'inv-us', type: 'asset', name: 'หุ้นสหรัฐ', currency: 'USD', kind: 'investment' },
  ];
  const mk = (id: string, date: string, lines: { accountId: string; amount: number }[]) => createEntry(accounts, { id, date, memo: id, source: id === 'sys' ? 'system' : 'manual', lines });
  const entries: Entry[] = [
    mk('sys', '2026-11-01', [L('w1', 10_000_000), L('open', -10_000_000)]),
    mk('fx1-e', '2026-11-02', [L('w1', -7_000_000), L('fx-suspense-thb', 7_000_000), L('usd-cash', 200_000), L('fx-suspense-usd', -200_000)]),
    mk('b1-e', '2026-11-03', [L('inv-us', 100_100), L('usd-cash', -100_100)]),
    mk('th-buy-e', '2026-11-04', [L('inv-th', 50_000), L('w1', -50_000)]),
    mk('to-brk', '2026-11-05', [L('brk', 500_000), L('w1', -500_000)]),
  ];
  const investments: InvestmentData = {
    assets: [
      { id: 'a1', name: 'กองทุนไทย', kind: 'fund', accountId: 'inv-th' },
      { id: 'us1', name: 'หุ้นสหรัฐ', kind: 'stock', accountId: 'inv-us', currency: 'USD' },
    ],
    trades: [
      { id: 'th-buy', assetId: 'a1', kind: 'buy', date: '2026-11-04', createdAt: '2026-11-04T03:00:00.000Z', units: '1000000000', amount: 50_000, fee: 0, withholding: 0, memo: '', entryId: 'th-buy-e' },
      { id: 't-buy', assetId: 'us1', kind: 'buy', date: '2026-11-03', createdAt: '2026-11-03T03:00:00.000Z', units: '1000000000', priceMicro: 100_000_000, amount: 100_000, fee: 100, withholding: 0, memo: '', entryId: 'b1-e', fxRateMicro: 35_000_000 },
    ],
    prices: [
      { assetId: 'a1', date: '2026-11-10', priceMicro: 60_000_000 }, // 10 หน่วย x 60.00 บาท = 600.00 บาท = 60,000 สตางค์
      { assetId: 'us1', date: '2026-11-10', priceMicro: 120_000_000 }, // 10 หุ้น x $120.00 = $1,200.00 = 120,000 เซนต์
    ],
    fxRates: [{ accountId: 'usd-cash', date: '2026-11-10', rateMicro: 34_000_000 }],
  };
  const ASOF = '2026-11-12';

  it('ครบ: เงินใช้จ่าย 2,450,000 · เงินลงทุน = เงินสดโบรกเกอร์ 500,000 + กองทุน 60,000 + หุ้น USD 4,080,000 + เงินสด USD 3,396,600 · รวม 10,486,600 สตางค์', () => {
    const w = wealthSummary(accounts, entries, investments, ASOF);
    expect(w).toEqual({ spendingThb: 2_450_000, investmentThb: 500_000 + 60_000 + 4_080_000 + 3_396_600, totalThb: 10_486_600, incomplete: false, missing: [], stale: [] });
  });

  it('ไม่มีบัญชีลงทุน: เงินใช้จ่ายเท่ายอดสุทธิบาทเดิม เงินลงทุน 0 ไม่ครบไม่เตือน', () => {
    const only = accounts.filter((a) => a.kind !== 'investment' && a.currency === 'THB');
    const sys = [mk('sys', '2026-11-01', [L('w1', 10_000_000), L('open', -10_000_000)])];
    expect(wealthSummary(only, sys, undefined, ASOF)).toEqual({ spendingThb: 10_000_000, investmentThb: 0, totalThb: 10_000_000, incomplete: false, missing: [], stale: [] });
  });

  it('ไม่มีราคาของสินทรัพย์ที่ยังถืออยู่ = "ไม่ครบ" ห้ามใช้ราคาทุนแทน (ส่วนนั้นไม่นับ ไม่ใช่ 0 เงียบๆ)', () => {
    const noPrice: InvestmentData = { ...investments, prices: investments.prices.filter((p) => p.assetId !== 'a1') };
    const w = wealthSummary(accounts, entries, noPrice, ASOF);
    expect(w.incomplete).toBe(true);
    expect(w.missing).toEqual([{ kind: 'price', assetId: 'a1' }]);
    expect(w.investmentThb).toBe(500_000 + 4_080_000 + 3_396_600); // ไม่เอา 50,000 (ต้นทุน) มาแทน
  });

  it('มี USD แต่ไม่มีอัตรา = ไม่ครบ ส่วน USD ไม่นับ · ส่วนบาทยังนับ', () => {
    const w = wealthSummary(accounts, entries, { ...investments, fxRates: [] }, ASOF);
    expect(w.missing).toEqual([{ kind: 'fx' }]);
    expect(w.incomplete).toBe(true);
    expect(w.investmentThb).toBe(500_000 + 60_000);
  });

  it('ราคา/อัตราเก่ากว่า 30 วัน = เตือน (วันที่ 12 ธ.ค. ห่างจาก 10 พ.ย. 32 วัน) · 30 วันพอดียังไม่เตือน', () => {
    const w = wealthSummary(accounts, entries, investments, '2026-12-12');
    expect(w.incomplete).toBe(false);
    expect(w.stale).toEqual([
      { kind: 'price', assetId: 'a1', date: '2026-11-10', days: 32 },
      { kind: 'price', assetId: 'us1', date: '2026-11-10', days: 32 },
      { kind: 'fx', date: '2026-11-10', days: 32 },
    ]);
    expect(wealthSummary(accounts, entries, investments, '2026-12-10').stale).toEqual([]);
  });

  it('ใช้ราคา/อัตราล่าสุดไม่เกินวันที่คำนวณ · สินทรัพย์ที่ขายหมดแล้วไม่ต้องมีราคา · ข้อมูลหลังวันที่คำนวณไม่ถูกนับ', () => {
    const later: InvestmentData = {
      ...investments,
      prices: [...investments.prices, { assetId: 'a1', date: '2026-11-11', priceMicro: 70_000_000 }, { assetId: 'a1', date: '2026-11-20', priceMicro: 999_000_000 }],
    };
    expect(wealthSummary(accounts, entries, later, ASOF).investmentThb).toBe(500_000 + 70_000 + 4_080_000 + 3_396_600);
    const sold: InvestmentData = {
      ...investments,
      prices: investments.prices.filter((p) => p.assetId !== 'a1'),
      trades: [...investments.trades, { id: 'th-sell', assetId: 'a1', kind: 'sell', date: '2026-11-06', createdAt: '2026-11-06T03:00:00.000Z', units: '1000000000', priceMicro: 5_000_000, fee: 0, withholding: 0, memo: '' }],
    };
    expect(wealthSummary(accounts, entries, sold, ASOF).missing).toEqual([]);
  });

  it('เงินสด USD ติดลบแปลงเป็นบาทติดลบ (ปัดครึ่งออกจากศูนย์) · ใช้ทศนิยมลอยตัวไม่ได้', () => {
    const drained = [...entries, mk('b2-e', '2026-11-06', [L('inv-us', 200_000), L('usd-cash', -200_000)])];
    const w = wealthSummary(accounts, drained, investments, ASOF);
    expect(w.investmentThb).toBe(500_000 + 60_000 + 4_080_000 + -(100_100 * 34)); // เงินสด USD = 99,900 − 200,000 = −100,100 เซนต์
  });
});
