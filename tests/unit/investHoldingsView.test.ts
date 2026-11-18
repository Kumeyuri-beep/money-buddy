import { describe, expect, it } from 'vitest';
import {
  buildHoldingsView, columnsFor, DEFAULT_HOLDINGS_QUERY, filterAndSort, HOLDINGS_TABS, perShareMinor, planHoldingDelete, pricePerShareMinor, totalsOf, type HoldingRow,
} from '../../src/domain/invest/holdingsView';
import type { Asset, InvestmentData, TradeRecord } from '../../src/domain/invest/types';

const asset = (id: string, ticker = id.toUpperCase()): Asset => ({ id, name: `หุ้น ${ticker}`, kind: 'stock', accountId: `inv-${id}`, currency: 'USD', ticker, exchange: 'NASDAQ' });
let seq = 0;
const trade = (over: Partial<TradeRecord>): TradeRecord => ({
  id: `t${++seq}`, assetId: 'us1', kind: 'buy', date: '2026-11-03', createdAt: `${over.date ?? '2026-11-03'}T03:00:00.000Z`, units: '1000000000', priceMicro: 100_000_000, amount: 100_000, fee: 0, withholding: 0, memo: '', fxRateMicro: 35_000_000, ...over,
});
const data = (over: Partial<InvestmentData> = {}): InvestmentData => ({ assets: [asset('us1')], trades: [], prices: [], fxRates: [], ...over });
const TODAY = '2026-11-13';

// ตัวอย่างหลักของ R24 (ข้อมูลสมมติของกฎ): ซื้อ 10 หุ้น $1,000.00 ค่าธรรมเนียม $1.00 ที่ 35.00 · ขาย 4 หุ้น @ $120 ค่าธรรมเนียม $1.00 ที่ 33.00 · ปันผล $50.00 ภาษี $7.50 ที่ 34.567891 · ราคา $125 · เรต 34.00
const MAIN = data({
  trades: [
    trade({ id: 'b1', kind: 'buy', date: '2026-11-03', units: '1000000000', amount: 100_000, fee: 100, fxRateMicro: 35_000_000 }),
    trade({ id: 's1', kind: 'sell', date: '2026-11-10', units: '400000000', priceMicro: 120_000_000, amount: undefined, fee: 100, fxRateMicro: 33_000_000 }),
    trade({ id: 'd1', kind: 'dividend', date: '2026-11-12', units: undefined, priceMicro: undefined, amount: 5_000, fee: 0, withholding: 750, fxRateMicro: 34_567_891 }),
  ],
  prices: [{ assetId: 'us1', date: '2026-11-12', priceMicro: 125_000_000 }],
  fxRates: [{ accountId: 'usd-cash', date: '2026-11-12', rateMicro: 34_000_000 }],
});

const only = (d: InvestmentData, cur: 'USD' | 'THB', id = 'us1'): HoldingRow => buildHoldingsView(d, TODAY, cur).rows.find((r) => r.assetId === id)!;

describe('แถวถือครองตามตัวอย่างหลัก R24 (หุ้นที่ยังถืออยู่ 6 หน่วย)', () => {
  it('มุมมองบาท: 6 แหล่ง = 510,000 / 264,000 / 0 / 172,839 / −140,000 / −32,726 รวม 774,113 ตรงเป๊ะ', () => {
    const r = only(MAIN, 'THB');
    expect(r.sources).toEqual({ priceUnrealized: 510_000, priceRealized: 264_000, options: 0, dividendGross: 172_839, fx: -140_000, feesAndTax: -32_726, total: 774_113 });
    const s = r.sources!;
    expect(s.priceUnrealized + s.priceRealized + s.options + s.dividendGross + (s.fx as number) + s.feesAndTax).toBe(s.total);
    expect(r.profit).toBe(774_113);
  });
  it('มุมมอง USD: แหล่งค่าเงินเป็น null ("—") · แหล่งอื่นเป็นเซนต์ตรงๆ รวม 27,050', () => {
    const r = only(MAIN, 'USD');
    expect(r.sources).toEqual({ priceUnrealized: 15_000, priceRealized: 8_000, options: 0, dividendGross: 5_000, fx: null, feesAndTax: -950, total: 27_050 });
    const s = r.sources!;
    expect(s.priceUnrealized + s.priceRealized + s.options + s.dividendGross + s.feesAndTax).toBe(s.total);
    expect(r.profit).toBe(27_050);
  });
  it('มูลค่า: USD = เซนต์ต้นทาง 75,000 · THB = แปลงครั้งเดียวที่เรตล่าสุด 34.00 = 2,550,000 สตางค์ · ต้นทุนบาทใช้ถังบาท (R20.3) ไม่ใช่มูลค่า×เรต', () => {
    const u = only(MAIN, 'USD');
    const t = only(MAIN, 'THB');
    expect(u.value).toBe(75_000);
    expect(t.value).toBe(2_550_000);
    expect(u.cost).toBe(60_060); // 0.6 × (100,000 + 100) เซนต์
    expect(t.cost).toBe(2_102_100); // 0.6 × (100,100 เซนต์ × 35.00) ที่เรตวันซื้อ
    expect(t.cost).not.toBe(Math.round((u.cost * 34_000_000) / 1_000_000));
    expect(t.unrealized).toBe(t.value! - t.cost);
  });
  it('% กำไร = กำไร ÷ ต้นทุนที่ยังถืออยู่ เป็น bps ปัดครึ่งออกจากศูนย์ (R24.5) · ปันผลสะสมสุทธิ USD 4,250', () => {
    const u = only(MAIN, 'USD');
    expect(u.profitBps).toBe(Math.round((27_050 * 10_000) / 60_060)); // 4,503.8 → 4,504
    expect(u.dividends).toBe(4_250);
    expect(u.unrealized).toBe(75_000 - 60_060);
  });
  it('ต่อหุ้น: ต้นทุนเฉลี่ย 60,060 เซนต์ ÷ 6 หุ้น = 10,010 เซนต์ · ราคา $125 = 12,500 เซนต์ (USD) · ที่เรต 34.00 = 425,000 สตางค์', () => {
    const u = only(MAIN, 'USD');
    expect(u.costPerShare).toBe(10_010);
    expect(u.pricePerShare).toBe(12_500);
    expect(only(MAIN, 'THB').pricePerShare).toBe(425_000);
  });
  it('yield 12 เดือนและปันผลสุทธิ 12 เดือน มาจาก R25 (ฟังก์ชัน computeDividendMetrics)', () => {
    const t = only(MAIN, 'THB');
    expect(t.dividends12m).toBe(146_913);
    expect(t.yieldBps).not.toBeNull();
    expect(only(MAIN, 'USD').dividends12m).toBe(4_250);
  });
});

describe('ไม่มีราคา/เรต: ติดธง ไม่เดา ไม่ใช้ต้นทุนแทน (R20.7 / R26)', () => {
  it('ไม่มีราคา → มูลค่า null · incomplete · กำไรรวม null ทั้งสองสกุล', () => {
    const d = data({ ...MAIN, prices: [] });
    for (const cur of ['USD', 'THB'] as const) {
      const r = only(d, cur);
      expect(r.value).toBeNull();
      expect(r.profit).toBeNull();
      expect(r.sources).toBeNull();
      expect(r.missing).toBe('price');
      expect(totalsOf([r], cur).complete).toBe(false);
    }
  });
  it('มีราคาแต่ไม่มีเรต → มุมมอง USD ใช้ได้ · มุมมอง THB = null ("Needs rate")', () => {
    const d = data({ ...MAIN, fxRates: [] });
    expect(only(d, 'USD').value).toBe(75_000);
    expect(only(d, 'USD').missing).toBeNull();
    const t = only(d, 'THB');
    expect(t.value).toBeNull();
    expect(t.missing).toBe('rate');
    expect(t.pricePerShare).toBeNull();
  });
  it('ราคา 0 = ไม่มีราคา (ไม่นับเป็น 0 บาท)', () => {
    expect(pricePerShareMinor(0, 'USD', null)).toBeNull();
    expect(pricePerShareMinor(0, 'THB', 34_000_000)).toBeNull();
  });
  it('เรต 0 หรือติดลบถือว่าไม่มีเรต', () => {
    expect(pricePerShareMinor(100_000_000, 'THB', 0)).toBeNull();
    expect(pricePerShareMinor(100_000_000, 'THB', -1)).toBeNull();
    expect(pricePerShareMinor(100_000_000, 'THB', null)).toBeNull();
  });
});

describe('ราคา/เฉลี่ยต่อหุ้น: ปัดครั้งเดียว ครึ่งออกจากศูนย์', () => {
  it('ราคา $0.005 = 0.5 เซนต์ → 1 เซนต์ (ครึ่งขึ้น) · $0.004999 → 0', () => {
    expect(pricePerShareMinor(5_000, 'USD', null)).toBe(1);
    expect(pricePerShareMinor(4_999, 'USD', null)).toBe(0);
  });
  it('$235.96 ที่เรต 32.40 = 7,645.104 บาท/100 → 764,510 สตางค์ ไม่ใช่ราคาที่ปัดเป็นเซนต์ก่อน', () => {
    // 235.96 × 32.40 = 7,645.104 บาท = 764,510.4 สตางค์ → 764,510
    expect(pricePerShareMinor(235_960_000, 'THB', 32_400_000)).toBe(764_510);
  });
  it('เฉลี่ยต่อหุ้น: ไม่มีหุ้น = null · 0.31 หุ้นต้นทุน 9,207 เซนต์ → 29,700 เซนต์/หุ้น', () => {
    expect(perShareMinor(100, 0n)).toBeNull();
    expect(perShareMinor(9_207, 31_000_000n)).toBe(29_700);
    expect(perShareMinor(0, 100_000_000n)).toBe(0);
  });
});

describe('Show sold · ค้นหา · เรียง', () => {
  const base = data({
    assets: [asset('a', 'AAA'), asset('b', 'BBB'), asset('c', 'CCC'), asset('d', 'DDD')],
    trades: [
      trade({ id: 'a1', assetId: 'a', amount: 10_000, units: '100000000' }), // ถือ 1 หุ้น
      trade({ id: 'b1', assetId: 'b', amount: 50_000, units: '500000000' }), // ถือ 5 หุ้น
      trade({ id: 'c1', assetId: 'c', amount: 20_000, units: '200000000' }), // ซื้อแล้วขายหมด
      trade({ id: 'c2', assetId: 'c', kind: 'sell', date: '2026-11-05', units: '200000000', priceMicro: 110_000_000, amount: undefined, fee: 0 }),
    ],
    prices: [
      { assetId: 'a', date: '2026-11-12', priceMicro: 120_000_000 },
      // b ไม่มีราคา
    ],
    fxRates: [{ accountId: 'usd-cash', date: '2026-11-12', rateMicro: 34_000_000 }],
  });
  const view = buildHoldingsView(base, TODAY, 'USD');
  const ids = (q: Partial<typeof DEFAULT_HOLDINGS_QUERY>) => filterAndSort(view.rows, { ...DEFAULT_HOLDINGS_QUERY, ...q }).map((r) => r.assetId);

  it('ขายหมด (ถือ 0 หน่วย) อยู่ใน Show sold เท่านั้น · สินทรัพย์ที่ยังไม่มีรายการยังแสดงปกติ', () => {
    expect(ids({})).toEqual(['a', 'b', 'd']);
    expect(ids({ showSold: true })).toEqual(['a', 'b', 'c', 'd']);
    const c = view.rows.find((r) => r.assetId === 'c')!;
    expect(c.sold).toBe(true);
    expect(c.value).toBe(0); // ถือ 0 หน่วย = มูลค่า 0 ไม่ต้องมีราคา
    expect(view.rows.find((r) => r.assetId === 'd')!.sold).toBe(false);
  });
  it('ค้นหาจากชื่อย่อหรือชื่อ ไม่สนตัวพิมพ์ใหญ่เล็ก · ไม่เจอ = ว่าง', () => {
    expect(ids({ query: 'bb' })).toEqual(['b']);
    expect(ids({ query: ' ccc ', showSold: true })).toEqual(['c']);
    expect(ids({ query: 'หุ้น' })).toEqual(['a', 'b', 'd']);
    expect(ids({ query: 'zzz' })).toEqual([]);
  });
  it('เรียงตามชื่อ · มูลค่า (ไม่มีราคาอยู่ท้ายเสมอทั้งขึ้นและลง) · จำนวนหุ้น · ปันผล', () => {
    expect(ids({ sortKey: 'holding', dir: 'desc' })).toEqual(['d', 'b', 'a']);
    expect(ids({ sortKey: 'value', dir: 'desc' })).toEqual(['a', 'd', 'b']); // a=12,000 · d=0 (ยังไม่มีรายการ) · b ไม่มีราคา = null อยู่ท้าย
    expect(ids({ sortKey: 'value', dir: 'asc' })).toEqual(['d', 'a', 'b']); // null (b) ท้ายเสมอแม้เรียงขึ้น
    expect(ids({ sortKey: 'shares', dir: 'desc' })).toEqual(['b', 'a', 'd']);
    expect(ids({ sortKey: 'shares', dir: 'asc' })).toEqual(['d', 'a', 'b']);
    expect(ids({ sortKey: 'dividends', dir: 'asc' })).toEqual(['a', 'b', 'd']); // เท่ากันหมด → ตามชื่อ
  });
});

describe('แถวรวม (R26): ผลรวม = ผลบวกค่าที่แปลงแล้วของแต่ละแถว', () => {
  // สองหุ้น มูลค่าตลาดหุ้นละ 1 เซนต์ (1 หุ้น × $0.01) ที่เรต 32.50 → แถวละ 33 สตางค์ (ปัดครึ่งขึ้น) รวม 66 · ไม่ใช่แปลง 2 เซนต์ = 65
  const d = data({
    assets: [asset('x', 'XXX'), asset('y', 'YYY')],
    trades: [
      trade({ id: 'x1', assetId: 'x', amount: 1, units: '100000000', priceMicro: 10_000 }),
      trade({ id: 'y1', assetId: 'y', amount: 1, units: '100000000', priceMicro: 10_000 }),
    ],
    prices: [
      { assetId: 'x', date: '2026-11-12', priceMicro: 10_000 },
      { assetId: 'y', date: '2026-11-12', priceMicro: 10_000 },
    ],
    fxRates: [{ accountId: 'usd-cash', date: '2026-11-12', rateMicro: 32_500_000 }],
  });
  it('THB: แถวละ 33 รวม 66 (ไม่ใช่ 65) · USD: 1+1 = 2', () => {
    const t = buildHoldingsView(d, TODAY, 'THB');
    expect(t.rows.map((r) => r.value)).toEqual([33, 33]);
    expect(totalsOf(t.rows, 'THB').value).toBe(66);
    expect(totalsOf(buildHoldingsView(d, TODAY, 'USD').rows, 'USD').value).toBe(2);
  });
  it('มีแถวที่ไม่มีมูลค่าแม้แถวเดียว = รวมเป็น null และ complete = false (ไม่นับเป็น 0)', () => {
    const t = totalsOf(buildHoldingsView({ ...d, prices: [d.prices[0]!] }, TODAY, 'USD').rows, 'USD');
    expect(t.value).toBeNull();
    expect(t.complete).toBe(false);
    expect(t.count).toBe(2);
  });
  it('ผลรวม 6 แหล่งของแถวรวม = กำไรรวมของแถวรวม ตรงเป๊ะ (ตัวอย่างหลักสองหุ้น คนละลำดับ)', () => {
    const two = data({ assets: [asset('us1'), asset('us2')], trades: [...MAIN.trades, ...MAIN.trades.map((t) => ({ ...t, id: `z${t.id}`, assetId: 'us2' }))], prices: [...MAIN.prices, { assetId: 'us2', date: '2026-11-12', priceMicro: 125_000_000 }], fxRates: MAIN.fxRates! });
    const rows = buildHoldingsView(two, TODAY, 'THB').rows;
    const tot = totalsOf(rows, 'THB');
    const s = tot.sources!;
    expect(tot.profit).toBe(774_113 * 2);
    expect(s.priceUnrealized + s.priceRealized + s.options + s.dividendGross + (s.fx as number) + s.feesAndTax).toBe(s.total);
    expect(s.total).toBe(tot.profit);
    const u = totalsOf(buildHoldingsView(two, TODAY, 'USD').rows, 'USD');
    expect(u.sources!.fx).toBeNull();
    expect(u.sources!.total).toBe(27_050 * 2);
  });
  it('ไม่มีแถว: รวมศูนย์ ไม่พัง', () => {
    const t = totalsOf([], 'USD');
    expect(t).toMatchObject({ count: 0, cost: 0, value: 0, dividends: 0, profit: 0, complete: true, sources: null });
    expect(t.profitBps).toBeNull(); // ต้นทุน 0 = ไม่คำนวณ %
  });
});

describe('ชุดคอลัมน์ต่อแท็บ', () => {
  it('4 แท็บ ชุดคอลัมน์ต่างกัน · ไม่มีคอลัมน์ Daily จนกว่าจะมีราคาเฟส B', () => {
    expect(HOLDINGS_TABS.map((t) => t.label)).toEqual(['My holdings', 'General', 'Dividends', 'Returns']);
    expect(columnsFor('holdings')).toEqual(['shares', 'costBasis', 'currentValue', 'dividends', 'dividendYield', 'totalProfit']);
    expect(columnsFor('general')).toContain('weight');
    expect(columnsFor('dividends')).toEqual(['dividends', 'div12m', 'yieldCurrent', 'yieldOnCost']);
    expect(columnsFor('returns')).toHaveLength(7); // 6 แหล่ง + รวม
    for (const t of HOLDINGS_TABS) expect(columnsFor(t.id).some((c) => String(c).toLowerCase().includes('daily'))).toBe(false);
  });
});

describe('สัดส่วน (weight) และกรณีขอบ', () => {
  it('สัดส่วนของแถวที่ถืออยู่รวม 10,000 bps เมื่อมีมูลค่าครบ · ไม่ครบ = null ทุกแถว', () => {
    const d = data({
      assets: [asset('a'), asset('b')],
      trades: [trade({ id: 'a1', assetId: 'a', amount: 100, units: '100000000' }), trade({ id: 'b1', assetId: 'b', amount: 100, units: '100000000' })],
      prices: [{ assetId: 'a', date: '2026-11-12', priceMicro: 10_000_000 }, { assetId: 'b', date: '2026-11-12', priceMicro: 20_000_000 }],
    });
    const ok = buildHoldingsView(d, TODAY, 'USD').rows;
    expect(ok.reduce((n, r) => n + (r.weightBps ?? 0), 0)).toBe(10_000);
    const bad = buildHoldingsView({ ...d, prices: [d.prices[0]!] }, TODAY, 'USD').rows;
    expect(bad.every((r) => r.weightBps === null)).toBe(true);
  });
  it('ไม่มีสินทรัพย์ USD เลย = ไม่มีแถว · สินทรัพย์บาทไม่ถูกนับ', () => {
    const thb: Asset = { id: 't', name: 'กองบาท', kind: 'fund', accountId: 'inv-t' };
    expect(buildHoldingsView(data({ assets: [thb] }), TODAY, 'USD').rows).toEqual([]);
  });
  it('วันที่ในอนาคตของรายการไม่ถูกนับ (วัน ณ today)', () => {
    const d = data({ trades: [trade({ id: 'f1', date: '2026-12-01' })] });
    const r = only(d, 'USD');
    expect(r.units).toBe(0n);
    expect(r.hasTrades).toBe(false);
  });
  it('ราคาเกินช่วงปลอดภัย: แถวนั้นไม่แสดงมูลค่า ไม่ทำให้ทั้งตารางล้ม', () => {
    const d = data({ trades: [trade({ id: 'b1' })], prices: [{ assetId: 'us1', date: '2026-11-12', priceMicro: Number.MAX_SAFE_INTEGER }], fxRates: MAIN.fxRates! });
    expect(() => buildHoldingsView(d, TODAY, 'THB')).not.toThrow();
  });
});

describe('planHoldingDelete: ลบทั้งสินทรัพย์ตามลำดับที่ R17 อนุญาต (ล่าสุดก่อน · ขายก่อนซื้อในวันเดียวกัน)', () => {
  it('ซื้อ 2 ครั้ง ขาย 1 ครั้ง → ลำดับ ขาย แล้วซื้อใหม่ แล้วซื้อเก่า · ปันผลไม่ติดเงื่อนไข', () => {
    const tr = [
      trade({ id: 'p1', assetId: 'x', date: '2026-10-01' }),
      trade({ id: 'p2', assetId: 'x', date: '2026-10-05' }),
      trade({ id: 'p3', assetId: 'x', kind: 'sell', date: '2026-10-10', units: '500000000', priceMicro: 110_000_000, amount: undefined }),
      trade({ id: 'p4', assetId: 'x', kind: 'dividend', date: '2026-10-12', units: undefined, priceMicro: undefined, amount: 1_000 }),
      trade({ id: 'other', assetId: 'y', date: '2026-10-02' }),
    ];
    const r = planHoldingDelete(tr, 'x');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ids).toEqual(['p4', 'p3', 'p2', 'p1']);
  });
  it('ซื้อวันเดียวกับขาย → ลบขายก่อน แล้วค่อยลบซื้อ (ไม่ติดกติกาวันที่ ณ หรือก่อนการขาย)', () => {
    const tr = [
      trade({ id: 'q1', assetId: 'x', date: '2026-10-01' }),
      trade({ id: 'q2', assetId: 'x', kind: 'sell', date: '2026-10-01', units: '500000000', priceMicro: 110_000_000, amount: undefined }),
    ];
    const r = planHoldingDelete(tr, 'x');
    expect(r.ok && r.ids).toEqual(['q2', 'q1']);
  });
  it('ไม่มีรายการ → ids ว่าง · รหัสสินทรัพย์ไม่มี = ids ว่าง', () => {
    const r = planHoldingDelete([], 'x');
    expect(r.ok && r.ids).toEqual([]);
  });
});
