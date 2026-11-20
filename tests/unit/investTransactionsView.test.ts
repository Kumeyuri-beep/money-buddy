import { describe, expect, it } from 'vitest';
import { CASH_ADJUST_ACCOUNT_IDS } from '../../src/domain/invest/cashAdjustment';
import {
  buildTransactionsView, classifyCashAdjustEntry, DEFAULT_TX_QUERY, dateRangeReversed, filterTransactions, hasActiveFilters, planTransactionDelete, totalsOf, TX_KIND_LABEL, TX_KINDS,
  type TxQuery, type TxRow,
} from '../../src/domain/invest/transactionsView';
import type { Asset, FxExchangeRecord, InvestmentData, TradeRecord } from '../../src/domain/invest/types';
import type { Account, Entry } from '../../src/domain/ledger/types';

// ข้อมูลสมมติทั้งหมด (ไม่ใช่ข้อมูลจริง)
const USD_A: Asset = { id: 'a1', name: 'Demo Alpha', kind: 'stock', accountId: 'inv-a1', currency: 'USD', ticker: 'DEMA', exchange: 'NASDAQ' };
const USD_B: Asset = { id: 'a2', name: 'Demo Beta', kind: 'stock', accountId: 'inv-a2', currency: 'USD', ticker: 'DEMB', exchange: 'NASDAQ' };
const FUND: Asset = { id: 'f1', name: 'Demo Fund', kind: 'fund', accountId: 'inv-f1' };

const trade = (p: Partial<TradeRecord> & Pick<TradeRecord, 'id' | 'assetId' | 'kind' | 'date'>): TradeRecord => ({
  createdAt: `${p.date}T03:00:00.000Z`, fee: 0, withholding: 0, memo: '', ...p,
});
const U = (n: number): string => String(n * 100_000_000);

const accounts: Account[] = [
  { id: 'w1', type: 'asset', name: 'Wallet', currency: 'THB' },
  { id: 'brk', type: 'asset', name: 'Broker THB', currency: 'THB', kind: 'investment' },
  { id: 'usd-cash', type: 'asset', name: 'USD cash', currency: 'USD', kind: 'investment' },
  { id: 'inv-a1', type: 'asset', name: 'A1 cost', currency: 'USD', kind: 'investment' },
];

const base = (over: Partial<InvestmentData> = {}): InvestmentData => ({
  assets: [USD_A, USD_B],
  trades: [],
  prices: [],
  fxRates: [{ accountId: 'usd-cash', date: '2026-11-10', rateMicro: 32_500_000 }],
  ...over,
});
const build = (data: InvestmentData, currency: 'USD' | 'THB' = 'USD', entries: Entry[] = []) => buildTransactionsView({ data, accounts, entries, currency, today: '2026-11-19' });

describe('buildTransactionsView: รวมรายการทุกชนิดและเรียงใหม่ก่อน', () => {
  it('ว่าง = ไม่มีแถว ไม่มีตัวเลือกสินทรัพย์', () => {
    const v = build(base({ assets: [] }));
    expect(v.rows).toEqual([]);
    expect(v.assets).toEqual([]);
    expect(totalsOf(v.rows)).toMatchObject({ count: 0, buy: 0, sell: 0, feeTax: 0, dividendNet: 0, incomplete: false });
  });

  it('รวมซื้อ ขาย ปันผล ปันผลลงทุนต่อ แลกเงิน โอนเข้า/ออก ปรับยอดเงินสด และเรียงวันที่ใหม่ก่อน', () => {
    const fx: FxExchangeRecord = { id: 'x1', date: '2026-03-05', createdAt: '2026-03-05T02:00:00.000Z', direction: 'thb_to_usd', thbSatang: 325_000, usdCents: 10_000, rateMicro: 32_500_000, memo: '', entryId: 'ex1' };
    const data = base({
      trades: [
        trade({ id: 't1', assetId: 'a1', kind: 'buy', date: '2026-03-10', units: U(2), amount: 20_000, fee: 100, fxRateMicro: 33_000_000, entryId: 'e-t1' }),
        trade({ id: 't2', assetId: 'a1', kind: 'sell', date: '2026-06-01', units: U(1), priceMicro: 120_000_000, fee: 50, fxRateMicro: 34_000_000 }),
        trade({ id: 't3', assetId: 'a1', kind: 'dividend', date: '2026-08-01', amount: 500, withholding: 75, fxRateMicro: 33_500_000 }),
        trade({ id: 't4', assetId: 'f1', kind: 'reinvest', date: '2026-09-01', units: U(3), amount: 3_000 }),
      ],
      assets: [USD_A, FUND],
      fxExchanges: [fx],
    });
    const entries: Entry[] = [
      { id: 'ex1', date: '2026-03-05', memo: 'fx', source: 'manual', lines: [{ accountId: 'w1', amount: -1 }, { accountId: 'usd-cash', amount: 1 }] }, // ผูกกับแลกเงิน: ไม่นับซ้ำ
      { id: 'e-t1', date: '2026-03-10', memo: 'buy', source: 'manual', lines: [{ accountId: 'inv-a1', amount: 1 }, { accountId: 'usd-cash', amount: -1 }] },
      { id: 'tin', date: '2026-02-01', memo: 'Transfer to portfolio', source: 'manual', createdAt: '2026-02-01T01:00:00.000Z', lines: [{ accountId: 'brk', amount: 50_000 }, { accountId: 'w1', amount: -50_000 }] },
      { id: 'tout', date: '2026-10-01', memo: 'Transfer from portfolio', source: 'manual', lines: [{ accountId: 'w1', amount: 10_000 }, { accountId: 'brk', amount: -10_000 }] },
      { id: 'dep', date: '2026-04-01', memo: 'เงินเข้าพอร์ต (ปรับยอดเงินสด)', source: 'manual', lines: [{ accountId: 'usd-cash', amount: 7_000 }, { accountId: CASH_ADJUST_ACCOUNT_IDS.USD, amount: -7_000 }] },
      { id: 'wd', date: '2026-04-02', memo: 'out', source: 'manual', lines: [{ accountId: 'usd-cash', amount: -2_000 }, { accountId: CASH_ADJUST_ACCOUNT_IDS.USD, amount: 2_000 }] },
      { id: 'groc', date: '2026-04-03', memo: 'ข้าว', source: 'manual', lines: [{ accountId: 'w1', amount: -100 }, { accountId: 'brk', amount: 100 }] }, // โอนธรรมดาที่เป็นการโอนเข้าพอร์ต (นับเป็นโอน)
    ];
    const v = build(data, 'USD', entries);
    expect(v.rows.map((r) => r.key)).toEqual([
      'entry:tout', 'trade:t4', 'trade:t3', 'trade:t2', 'entry:groc', 'entry:wd', 'entry:dep', 'trade:t1', 'fx:x1', 'entry:tin',
    ]);
    expect(v.rows.map((r) => r.kind)).toEqual(['transfer_out', 'reinvest', 'dividend', 'sell', 'transfer_in', 'cash_out', 'cash_in', 'buy', 'fx', 'transfer_in']);
    expect(v.assets.map((a) => a.label)).toEqual(['DEMA', 'Demo Fund']);
  });

  it('วันเดียวกัน เวลาบันทึกเท่ากัน ตัดสินด้วยรหัส (ย้อนลำดับเหมือน cmpKey)', () => {
    const same = { date: '2026-05-05', createdAt: '2026-05-05T03:00:00.000Z' };
    const data = base({
      trades: [
        trade({ id: 'b', assetId: 'a1', kind: 'buy', units: U(1), amount: 100, fxRateMicro: 33_000_000, ...same }),
        trade({ id: 'c', assetId: 'a1', kind: 'buy', units: U(1), amount: 100, fxRateMicro: 33_000_000, ...same }),
        trade({ id: 'a', assetId: 'a1', kind: 'buy', units: U(1), amount: 100, fxRateMicro: 33_000_000, ...same }),
        trade({ id: 'z', assetId: 'a1', kind: 'buy', units: U(1), amount: 100, fxRateMicro: 33_000_000, date: '2026-05-05', createdAt: '2026-05-05T09:00:00.000Z' }),
      ],
    });
    expect(build(data).rows.map((r) => r.sourceId)).toEqual(['z', 'c', 'b', 'a']);
  });
});

describe('แปลงสกุลที่แสดง (R26): ปัดครั้งเดียวต่อค่า', () => {
  const buy = trade({ id: 'b1', assetId: 'a1', kind: 'buy', date: '2026-03-10', units: U(1), amount: 1, fee: 1, fxRateMicro: 32_500_000 });

  it('USD view = เซนต์ต้นทางตรงๆ ไม่ต้องใช้เรต (แม้รายการไม่มีเรต)', () => {
    const noRate = { ...buy };
    delete noRate.fxRateMicro;
    const r = build(base({ trades: [noRate] }), 'USD').rows[0]!;
    expect(r.value).toEqual({ minor: 1, currency: 'USD' });
    expect(r.feeTax).toEqual({ minor: 1, currency: 'USD' });
    expect(r.needsRate).toBe(false);
  });

  it('THB view: 1 เซนต์ที่เรต 32.500000 = 33 สตางค์ (ค่าธรรมเนียมก็ 33)', () => {
    const r = build(base({ trades: [buy] }), 'THB').rows[0]!;
    expect(r.value).toEqual({ minor: 33, currency: 'THB' });
    expect(r.feeTax).toEqual({ minor: 33, currency: 'THB' });
  });

  it('เรต 32.499999 → 32 สตางค์ · เรตของ "รายการ" ไม่ใช่เรตล่าสุด', () => {
    const r = build(base({ trades: [{ ...buy, fxRateMicro: 32_499_999 }] }), 'THB').rows[0]!;
    expect(r.value?.minor).toBe(32);
  });

  it('ค่าธรรมเนียม + ภาษีหัก แปลงครั้งเดียวจากผลบวก (ไม่ใช่แปลงสองครั้งแล้วบวก)', () => {
    // ปันผล 1 เซนต์ ภาษี 1 เซนต์ที่เรต 32.5: ผลบวก 2 เซนต์ = 65 สตางค์ (ถ้าแปลงทีละค่า = 33+33 = 66)
    const d = trade({ id: 'd1', assetId: 'a1', kind: 'dividend', date: '2026-08-01', amount: 100, withholding: 1, fee: 1, fxRateMicro: 32_500_000 });
    const r = build(base({ trades: [d] }), 'THB').rows[0]!;
    expect(r.feeTax?.minor).toBe(65); // 2 × 32.5 = 65.0
    expect(r.dividendNet?.minor).toBe(3_218); // (100 − 1) × 32.5 = 3217.5 → 3218
    expect(r.value?.minor).toBe(3_250);
  });

  it('0.31 หุ้น ราคา $235.96 → 7,315 เซนต์ → เรต 32.40 = 237,006 สตางค์ (ขาย) · ตัวอย่างในกฎ R26 เขียน 236,982 แต่ 7,315 × 32.4 = 237,006', () => {
    const sell = trade({ id: 's1', assetId: 'a1', kind: 'sell', date: '2026-06-01', units: String(31_000_000), priceMicro: 235_960_000, fxRateMicro: 32_400_000 });
    const usdRow = build(base({ trades: [sell] }), 'USD').rows[0]!;
    expect(usdRow.value).toEqual({ minor: 7_315, currency: 'USD' });
    expect(usdRow.price).toEqual({ minor: 23_596, currency: 'USD' });
    const thbRow = build(base({ trades: [sell] }), 'THB').rows[0]!;
    expect(thbRow.value).toEqual({ minor: 237_006, currency: 'THB' });
    expect(thbRow.price).toEqual({ minor: 764_510, currency: 'THB' }); // 235.96 × 32.4 = 7,645.104 บาท → 764,510 สตางค์
  });

  it('ราคาซื้อเฉลี่ยต่อหุ้น: มูลค่า ÷ หน่วย ปัดครั้งเดียว (USD และ THB)', () => {
    const b = trade({ id: 'b2', assetId: 'a1', kind: 'buy', date: '2026-03-10', units: String(31_000_000), amount: 7_315, fxRateMicro: 32_400_000 });
    expect(build(base({ trades: [b] }), 'USD').rows[0]!.price).toEqual({ minor: 23_597, currency: 'USD' }); // 7315 ÷ 0.31 = 23596.77
    expect(build(base({ trades: [b] }), 'THB').rows[0]!.price).toEqual({ minor: 764_535, currency: 'THB' }); // 7315 × 32.4 ÷ 0.31 = 764,535.48
  });

  it('ขอบเขต: ซื้อ 0 หน่วยหรือไม่มีหน่วย = ไม่มีราคา · ยอด 0 ของค่าธรรมเนียม = 0', () => {
    const b = trade({ id: 'b3', assetId: 'a1', kind: 'buy', date: '2026-03-10', amount: 500, fxRateMicro: 32_000_000 });
    const r = build(base({ trades: [b] }), 'USD').rows[0]!;
    expect(r.price).toBeNull();
    expect(r.feeTax).toEqual({ minor: 0, currency: 'USD' });
  });
});

describe('ไม่มีเรต (R26): Needs rate ที่แถว + incomplete ที่ยอดรวม ไม่ข้ามเงียบ', () => {
  const noRateDiv = trade({ id: 'd1', assetId: 'a1', kind: 'dividend', date: '2026-08-01', amount: 500, withholding: 75 }); // ไม่มี fxRateMicro
  const buy = trade({ id: 'b1', assetId: 'a1', kind: 'buy', date: '2026-03-10', units: U(1), amount: 1_000, fee: 10, fxRateMicro: 32_000_000 });

  it('THB view: แถวไม่มีเรต = ค่าเป็น null + needsRate · ยอดรวมของชนิดนั้นเป็น null (ไม่ใช่ 0) · ยอดอื่นยังคำนวณได้', () => {
    const v = build(base({ trades: [buy, noRateDiv] }), 'THB');
    const div = v.rows.find((r) => r.sourceId === 'd1')!;
    expect(div).toMatchObject({ value: null, feeTax: null, dividendNet: null, needsRate: true });
    const t = totalsOf(v.rows);
    expect(t.dividendNet).toBeNull();
    expect(t.feeTax).toBeNull(); // ค่าธรรมเนียมรวมมีแถวที่ไม่มีเรต
    expect(t.buy).toBe(32_000);
    expect(t.incomplete).toBe(true);
  });

  it('USD view: ไม่ต้องใช้เรต → ครบ ไม่ incomplete', () => {
    const t = totalsOf(build(base({ trades: [buy, noRateDiv] }), 'USD').rows);
    expect(t).toMatchObject({ buy: 1_000, dividendNet: 425, feeTax: 10 + 75, incomplete: false });
  });

  it('เงินสด/โอนบาท ไม่มีเรตล่าสุด: THB→USD และ USD→THB = Needs rate', () => {
    const entries: Entry[] = [
      { id: 'tin', date: '2026-02-01', memo: '', source: 'manual', lines: [{ accountId: 'brk', amount: 50_000 }, { accountId: 'w1', amount: -50_000 }] },
      { id: 'dep', date: '2026-04-01', memo: '', source: 'manual', lines: [{ accountId: 'usd-cash', amount: 7_000 }, { accountId: CASH_ADJUST_ACCOUNT_IDS.USD, amount: -7_000 }] },
    ];
    const noFx = base({ fxRates: [] });
    const usdView = build(noFx, 'USD', entries).rows;
    expect(usdView.find((r) => r.sourceId === 'tin')).toMatchObject({ value: null, needsRate: true });
    expect(usdView.find((r) => r.sourceId === 'dep')).toMatchObject({ value: { minor: 7_000, currency: 'USD' }, needsRate: false });
    const thbView = build(noFx, 'THB', entries).rows;
    expect(thbView.find((r) => r.sourceId === 'dep')).toMatchObject({ value: null, needsRate: true });
    expect(thbView.find((r) => r.sourceId === 'tin')).toMatchObject({ value: { minor: 50_000, currency: 'THB' }, needsRate: false });
    expect(totalsOf(thbView).incomplete).toBe(true);
  });

  it('เงินสด/โอนบาท ใช้เรตล่าสุดที่กรอก ปัดครั้งเดียว (7,000 เซนต์ × 32.5 = 227,500 สตางค์ · 50,000 สตางค์ ÷ 32.5 = 1,538 เซนต์)', () => {
    const entries: Entry[] = [
      { id: 'tin', date: '2026-02-01', memo: '', source: 'manual', lines: [{ accountId: 'brk', amount: 50_000 }, { accountId: 'w1', amount: -50_000 }] },
      { id: 'dep', date: '2026-04-01', memo: '', source: 'manual', lines: [{ accountId: 'usd-cash', amount: 7_000 }, { accountId: CASH_ADJUST_ACCOUNT_IDS.USD, amount: -7_000 }] },
    ];
    expect(build(base(), 'THB', entries).rows.find((r) => r.sourceId === 'dep')!.value).toEqual({ minor: 227_500, currency: 'THB' });
    expect(build(base(), 'USD', entries).rows.find((r) => r.sourceId === 'tin')!.value).toEqual({ minor: 1_538, currency: 'USD' });
  });

  it('เรตล่าสุดไม่ใช้เรตที่อยู่หลังวันนี้', () => {
    const data = base({ fxRates: [{ accountId: 'usd-cash', date: '2026-11-30', rateMicro: 50_000_000 }] });
    const e: Entry = { id: 'dep', date: '2026-04-01', memo: '', source: 'manual', lines: [{ accountId: 'usd-cash', amount: 100 }, { accountId: CASH_ADJUST_ACCOUNT_IDS.USD, amount: -100 }] };
    expect(build(data, 'THB', [e]).rows[0]!.needsRate).toBe(true);
  });
});

describe('แลกเงิน และสินทรัพย์บาท', () => {
  const fx: FxExchangeRecord = { id: 'x1', date: '2026-03-05', createdAt: '2026-03-05T02:00:00.000Z', direction: 'usd_to_thb', thbSatang: 325_001, usdCents: 10_000, rateMicro: 32_500_100, memo: 'note', entryId: 'ex1' };

  it('แลกเงินแสดงฝั่งตามสกุลที่เลือกตรงๆ ไม่แปลง ไม่ต้องใช้เรต', () => {
    const data = base({ fxExchanges: [fx], fxRates: [] });
    expect(build(data, 'USD').rows[0]).toMatchObject({ kind: 'fx', value: { minor: 10_000, currency: 'USD' }, needsRate: false, fxRateMicro: 32_500_100, memo: 'note' });
    expect(build(data, 'THB').rows[0]).toMatchObject({ value: { minor: 325_001, currency: 'THB' }, needsRate: false });
  });

  it('สินทรัพย์บาทในมุมมอง USD: แสดงเป็นบาทตามต้นทาง (native) ไม่แปลง ไม่เดา และไม่นับในยอดรวม', () => {
    const t = trade({ id: 'f-buy', assetId: 'f1', kind: 'buy', date: '2026-03-10', units: U(10), amount: 100_000, fee: 99 });
    const data = base({ assets: [FUND, USD_A], trades: [t, trade({ id: 'b1', assetId: 'a1', kind: 'buy', date: '2026-03-11', units: U(1), amount: 500, fxRateMicro: 32_000_000 })] });
    const r = build(data, 'USD').rows.find((x) => x.sourceId === 'f-buy')!;
    expect(r).toMatchObject({ native: true, needsRate: false, value: { minor: 100_000, currency: 'THB' }, feeTax: { minor: 99, currency: 'THB' } });
    const totals = totalsOf(build(data, 'USD').rows);
    expect(totals).toMatchObject({ buy: 500, excluded: 1, incomplete: false });
    // มุมมอง THB: นับตามปกติ
    const thb = build(data, 'THB').rows.find((x) => x.sourceId === 'f-buy')!;
    expect(thb).toMatchObject({ native: false, value: { minor: 100_000, currency: 'THB' } });
  });
});

describe('classifyCashAdjustEntry: ระบุด้วยบรรทัดบัญชีพัก ไม่ใช่ memo', () => {
  const mk = (a: number, adj: string): Entry => ({ id: 'e', date: '2026-04-01', memo: 'อะไรก็ได้', source: 'manual', lines: [{ accountId: 'usd-cash', amount: a }, { accountId: adj, amount: -a }] });
  it('เงินเข้า/ออก และสกุลจากบัญชีพัก', () => {
    expect(classifyCashAdjustEntry(mk(700, CASH_ADJUST_ACCOUNT_IDS.USD))).toEqual({ currency: 'USD', direction: 'deposit', amountMinor: 700 });
    expect(classifyCashAdjustEntry(mk(-700, CASH_ADJUST_ACCOUNT_IDS.THB))).toEqual({ currency: 'THB', direction: 'withdraw', amountMinor: 700 });
  });
  it('ไม่ใช่: ไม่มีบัญชีพัก · มากกว่า 2 บรรทัด · ไม่สมดุล · ทั้งคู่เป็นบัญชีพัก', () => {
    expect(classifyCashAdjustEntry(mk(700, 'other'))).toBeNull();
    expect(classifyCashAdjustEntry({ ...mk(700, CASH_ADJUST_ACCOUNT_IDS.USD), lines: [{ accountId: 'usd-cash', amount: 700 }, { accountId: CASH_ADJUST_ACCOUNT_IDS.USD, amount: -600 }] })).toBeNull();
    expect(classifyCashAdjustEntry({ ...mk(700, CASH_ADJUST_ACCOUNT_IDS.USD), lines: [{ accountId: CASH_ADJUST_ACCOUNT_IDS.THB, amount: 700 }, { accountId: CASH_ADJUST_ACCOUNT_IDS.USD, amount: -700 }] })).toBeNull();
    expect(classifyCashAdjustEntry({ ...mk(700, CASH_ADJUST_ACCOUNT_IDS.USD), lines: [] })).toBeNull();
  });
});

describe('filterTransactions: ตัวกรอง ค้นหา แท็บ', () => {
  const data = base({
    assets: [USD_A, USD_B],
    trades: [
      trade({ id: 't1', assetId: 'a1', kind: 'buy', date: '2026-01-10', units: U(1), amount: 100, fxRateMicro: 33_000_000, memo: 'first lot' }),
      trade({ id: 't2', assetId: 'a2', kind: 'sell', date: '2026-02-10', units: U(1), priceMicro: 10_000_000, fxRateMicro: 33_000_000 }),
      trade({ id: 't3', assetId: 'a1', kind: 'dividend', date: '2026-03-10', amount: 50, fxRateMicro: 33_000_000 }),
    ],
    fxExchanges: [{ id: 'x1', date: '2026-02-01', createdAt: '2026-02-01T00:00:00.000Z', direction: 'thb_to_usd', thbSatang: 3_300, usdCents: 100, rateMicro: 33_000_000, memo: '', entryId: 'ex' }],
  });
  const rows = build(data).rows;
  const q = (p: Partial<TxQuery>): TxQuery => ({ ...DEFAULT_TX_QUERY, ...p });
  const ids = (r: TxRow[]) => r.map((x) => x.sourceId);

  it('ค่าเริ่มต้น = ทุกแถว · hasActiveFilters = false', () => {
    expect(filterTransactions(rows, DEFAULT_TX_QUERY)).toHaveLength(4);
    expect(hasActiveFilters(DEFAULT_TX_QUERY)).toBe(false);
  });
  it('แท็บ Trades / Incomes / All', () => {
    expect(ids(filterTransactions(rows, q({ tab: 'trades' })))).toEqual(['t2', 't1']);
    expect(ids(filterTransactions(rows, q({ tab: 'incomes' })))).toEqual(['t3']);
  });
  it('ชนิด · สินทรัพย์ (แถวแลกเงินไม่มีสินทรัพย์ จึงไม่ออก) · ช่วงวันที่รวมวันขอบ', () => {
    expect(ids(filterTransactions(rows, q({ kind: 'fx' })))).toEqual(['x1']);
    expect(ids(filterTransactions(rows, q({ assetId: 'a1' })))).toEqual(['t3', 't1']);
    expect(ids(filterTransactions(rows, q({ from: '2026-02-01', to: '2026-02-10' })))).toEqual(['t2', 'x1']);
    expect(ids(filterTransactions(rows, q({ from: '2026-03-10' })))).toEqual(['t3']);
    expect(ids(filterTransactions(rows, q({ to: '2026-01-09' })))).toEqual([]);
  });
  it('ช่วงวันที่ย้อนกัน = ไม่มีผลลัพธ์ และ dateRangeReversed บอกได้', () => {
    const rev = q({ from: '2026-03-01', to: '2026-01-01' });
    expect(filterTransactions(rows, rev)).toEqual([]);
    expect(dateRangeReversed(rev)).toBe(true);
    expect(dateRangeReversed(q({ from: '2026-01-01', to: '2026-01-01' }))).toBe(false);
  });
  it('ค้นหา: ticker ชื่อ ชนิด หมายเหตุ ไม่สนตัวพิมพ์/ช่องว่างหัวท้าย', () => {
    expect(ids(filterTransactions(rows, q({ query: '  dema ' })))).toEqual(['t3', 't1']);
    expect(ids(filterTransactions(rows, q({ query: 'beta' })))).toEqual(['t2']);
    expect(ids(filterTransactions(rows, q({ query: 'first LOT' })))).toEqual(['t1']);
    expect(ids(filterTransactions(rows, q({ query: 'exchange' })))).toEqual(['x1']);
    expect(ids(filterTransactions(rows, q({ query: 'zzz' })))).toEqual([]);
  });
  it('รวมหลายตัวกรอง (AND) และ hasActiveFilters', () => {
    const f = q({ assetId: 'a1', kind: 'buy', query: 'lot' });
    expect(ids(filterTransactions(rows, f))).toEqual(['t1']);
    expect(hasActiveFilters(f)).toBe(true);
    expect(hasActiveFilters(q({ tab: 'trades' }))).toBe(false);
    expect(hasActiveFilters(q({ query: '   ' }))).toBe(false);
  });
});

describe('totalsOf: แถวรวม = ผลบวกของแถวที่แปลงแล้ว (R26)', () => {
  it('THB view: ผลรวมของค่าที่แปลงแล้วต่อแถว ไม่ใช่แปลงยอดรวมก้อนเดียว', () => {
    // 3 รายการซื้อ 1 เซนต์ที่เรต 32.5 = 33 ต่อแถว → 99 (ก้อนเดียว 3 เซนต์ × 32.5 = 97.5 → 98)
    const buys = ['a', 'b', 'c'].map((id) => trade({ id, assetId: 'a1', kind: 'buy', date: '2026-03-10', units: U(1), amount: 1, fxRateMicro: 32_500_000 }));
    expect(totalsOf(build(base({ trades: buys }), 'THB').rows).buy).toBe(99);
    expect(totalsOf(build(base({ trades: buys }), 'USD').rows).buy).toBe(3);
  });
  it('ชิป Buy/Sell/Fee/Dividends แยกกัน และนับเฉพาะแถวที่แสดง', () => {
    const data = base({
      trades: [
        trade({ id: 'b', assetId: 'a1', kind: 'buy', date: '2026-03-10', units: U(1), amount: 1_000, fee: 10, fxRateMicro: 33_000_000 }),
        trade({ id: 's', assetId: 'a1', kind: 'sell', date: '2026-04-10', units: U(1), priceMicro: 2_000_000, fee: 5, fxRateMicro: 33_000_000 }),
        trade({ id: 'd', assetId: 'a1', kind: 'dividend', date: '2026-05-10', amount: 200, withholding: 30, fxRateMicro: 33_000_000 }),
      ],
    });
    const rows = build(data, 'USD').rows;
    expect(totalsOf(rows)).toMatchObject({ count: 3, buy: 1_000, sell: 200, feeTax: 45, dividendNet: 170 });
    expect(totalsOf(filterTransactions(rows, { ...DEFAULT_TX_QUERY, kind: 'sell' }))).toMatchObject({ count: 1, buy: 0, sell: 200, feeTax: 5, dividendNet: 0 });
  });
});

describe('planTransactionDelete: R17', () => {
  const data = base({
    trades: [
      trade({ id: 'b1', assetId: 'a1', kind: 'buy', date: '2026-01-10', units: U(2), amount: 200, fxRateMicro: 33_000_000 }),
      trade({ id: 'b2', assetId: 'a1', kind: 'buy', date: '2026-02-10', units: U(2), amount: 200, fxRateMicro: 33_000_000 }),
      trade({ id: 's1', assetId: 'a1', kind: 'sell', date: '2026-03-10', units: U(1), priceMicro: 100_000_000, fxRateMicro: 33_000_000 }),
      trade({ id: 's2', assetId: 'a1', kind: 'sell', date: '2026-04-10', units: U(1), priceMicro: 100_000_000, fxRateMicro: 33_000_000 }),
      trade({ id: 'd1', assetId: 'a1', kind: 'dividend', date: '2026-05-10', amount: 50, fxRateMicro: 33_000_000 }),
      trade({ id: 'o1', assetId: 'a2', kind: 'buy', date: '2026-01-10', units: U(1), amount: 100, fxRateMicro: 33_000_000 }),
    ],
  });
  const row = (id: string) => build(data).rows.find((r) => r.sourceId === id)!;

  it('ลบได้: ขายล่าสุด · ปันผลเงินสด', () => {
    expect(planTransactionDelete(row('s2'), data)).toEqual({ ok: true, source: 'trade', id: 's2' });
    expect(planTransactionDelete(row('d1'), data)).toEqual({ ok: true, source: 'trade', id: 'd1' });
  });
  it('ลบไม่ได้: ขายที่ไม่ใช่ล่าสุด · ซื้อก่อนการขายล่าสุด (เหตุผลมีรหัสให้แปล)', () => {
    const a = planTransactionDelete(row('s1'), data);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.problem.code).toBe('rules.deleteOnlyLastSell');
    const b = planTransactionDelete(row('b1'), data);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.problem.code).toBe('rules.deleteBeforeLastSell');
  });
  it('ไม่นับรายการของสินทรัพย์อื่น · ไม่พบรายการ = ปฏิเสธ', () => {
    expect(planTransactionDelete(row('o1'), data).ok).toBe(true); // a2 ไม่มีการขาย แม้ a1 จะมี
    const gone = planTransactionDelete({ source: 'trade', sourceId: 'nope', assetId: 'a1' }, data);
    expect(gone.ok).toBe(false);
  });
  it('แลกเงิน/โอน/ปรับยอด: ลบได้ (ไม่มีกฎลำดับของ R17)', () => {
    expect(planTransactionDelete({ source: 'fx', sourceId: 'x1', assetId: null }, data)).toEqual({ ok: true, source: 'fx', id: 'x1' });
    expect(planTransactionDelete({ source: 'entry', sourceId: 'e1', assetId: null }, data)).toEqual({ ok: true, source: 'entry', id: 'e1' });
  });
});

describe('เงินสด USD ติดลบ (เตือน)', () => {
  it('negativeCash มีเมื่อยอดบัญชีเงินสด USD ติดลบ', () => {
    const entries: Entry[] = [{ id: 'e', date: '2026-01-01', memo: '', source: 'manual', lines: [{ accountId: 'usd-cash', amount: -500 }, { accountId: 'inv-a1', amount: 500 }] }];
    expect(build(base(), 'USD', entries).negativeCash).toEqual([{ accountId: 'usd-cash', name: 'USD cash', cents: -500 }]);
    expect(build(base(), 'USD', []).negativeCash).toEqual([]);
  });
});

describe('ป้ายชนิด', () => {
  it('ทุกชนิดมีป้ายภาษาอังกฤษ และไม่มี "Fee or tax" (เจ้าของตัดออก)', () => {
    for (const k of TX_KINDS) expect(TX_KIND_LABEL[k]).toMatch(/^[A-Z]/);
    expect(Object.values(TX_KIND_LABEL).some((l) => /fee or tax/i.test(l))).toBe(false);
  });
});
