import { describe, expect, it } from 'vitest';
import { wealthSummary } from '../../src/domain/invest/portfolioMoney';
import { emptyInvestments, type Asset, type InvestmentData, type TradeRecord } from '../../src/domain/invest/types';
import type { Account, Entry } from '../../src/domain/ledger/types';
import { barPercent, bpsText, buildDashboardView, monthlyDividends } from '../../src/ui/invest/dashboard/dashboardView';

/** ข้อมูลทดสอบสมมติ = ตัวอย่างหลัก R24 · ห้ามใช้ข้อมูลจริง */
const asset: Asset = { id: 'us1', name: 'หุ้น US1', kind: 'stock', accountId: 'inv-us1', currency: 'USD', ticker: 'US1', exchange: 'NASDAQ' };
let seq = 0;
const trade = (over: Partial<TradeRecord>): TradeRecord => ({
  id: `t${++seq}`, assetId: 'us1', kind: 'buy', date: '2026-11-03', createdAt: `${over.date ?? '2026-11-03'}T03:00:00.000Z`, units: '1000000000', priceMicro: 100_000_000, amount: 100_000, fee: 0, withholding: 0, memo: '', fxRateMicro: 35_000_000, ...over,
});
const MAIN: InvestmentData = {
  assets: [asset],
  trades: [
    trade({ id: 'b1', kind: 'buy', date: '2026-11-03', units: '1000000000', amount: 100_000, fee: 100, fxRateMicro: 35_000_000 }),
    trade({ id: 's1', kind: 'sell', date: '2026-11-10', units: '400000000', priceMicro: 120_000_000, amount: undefined, fee: 100, fxRateMicro: 33_000_000 }),
    trade({ id: 'd1', kind: 'dividend', date: '2026-11-12', units: undefined, priceMicro: undefined, amount: 5_000, fee: 0, withholding: 750, fxRateMicro: 34_567_891 }),
  ],
  prices: [{ assetId: 'us1', date: '2026-11-12', priceMicro: 125_000_000 }],
  fxRates: [{ accountId: 'usd-cash', date: '2026-11-12', rateMicro: 34_000_000 }],
};
const TODAY = '2026-11-13';

const thbCash: Account = { id: 'thb-cash', type: 'asset', name: 'เงินสดลงทุน (สมมติ)', currency: 'THB', kind: 'investment' };
const usdCash: Account = { id: 'usd-cash', type: 'asset', name: 'เงินสด USD (สมมติ)', currency: 'USD', kind: 'investment' };
const deposit = (accountId: string, amount: number): Entry => ({ id: `e-${accountId}`, date: '2026-11-01', memo: '', lines: [{ accountId, amount }] }) as Entry;
const slicesOf = (data: InvestmentData, accs: Account[], ents: Entry[]) => buildDashboardView(accs, ents, data, TODAY).currencySlices;
const bps = (sl: ReturnType<typeof slicesOf>) => Object.fromEntries((sl ?? []).map((x) => [x.key, x.bps]));

describe('แดชบอร์ดพอร์ต: โดนัทสกุลเงิน (USD + บาท ต้องตรง wealthSummary.investmentThb)', () => {
  it('ปกติ (หุ้น USD ฿25,500 + เงินสดบาท ฿10,000): รวม 10,000 bps และผลรวมตรง', () => {
    const accs = [thbCash];
    const ents = [deposit('thb-cash', 1_000_000)];
    const sl = slicesOf(MAIN, accs, ents);
    expect(sl!.reduce((n, x) => n + x.bps, 0)).toBe(10_000);
    expect(bps(sl)).toEqual({ USD: 7_183, THB: 2_817 });
    expect(wealthSummary(accs, ents, MAIN, TODAY).investmentThb).toBe(2_550_000 + 1_000_000);
  });
  it('เงินสด USD บวก: นับเข้าส่วน USD (+฿3,400.00 ที่ 34.00)', () => {
    const accs = [thbCash, usdCash];
    const ents = [deposit('thb-cash', 1_000_000), deposit('usd-cash', 10_000)];
    expect(bps(slicesOf(MAIN, accs, ents))).toEqual({ USD: 7_429, THB: 2_571 });
    expect(wealthSummary(accs, ents, MAIN, TODAY).investmentThb).toBe(2_550_000 + 340_000 + 1_000_000);
  });
  it('เงินสด USD ติดลบ: หักออกจากส่วน USD เครื่องหมายเดียวกับ wealthSummary · ส่วนบาทไม่เพี้ยน', () => {
    const accs = [thbCash, usdCash];
    const ents = [deposit('thb-cash', 1_000_000), deposit('usd-cash', -10_000)];
    expect(bps(slicesOf(MAIN, accs, ents))).toEqual({ USD: 6_885, THB: 3_115 });
    expect(wealthSummary(accs, ents, MAIN, TODAY).investmentThb).toBe(2_550_000 - 340_000 + 1_000_000);
  });
  it('มีสินทรัพย์บาท (กองทุน ฿100.00): นับเป็นส่วนบาท', () => {
    const fund: Asset = { id: 'f1', name: 'กองทุนสมมติ', kind: 'fund', accountId: 'inv-f1' };
    const data: InvestmentData = {
      ...MAIN,
      assets: [asset, fund],
      trades: [...MAIN.trades, { id: 'fb', assetId: 'f1', kind: 'buy', date: '2026-11-03', createdAt: '2026-11-03T03:00:00.000Z', units: '1000000000', priceMicro: 10_000_000, amount: 10_000, fee: 0, withholding: 0, memo: '' }],
      prices: [...MAIN.prices, { assetId: 'f1', date: '2026-11-12', priceMicro: 10_000_000 }],
    };
    expect(bps(slicesOf(data, [], []))).toEqual({ USD: 9_961, THB: 39 });
  });
  it('ส่วนบาท = 0: เหลือชิ้นเดียว USD 100%', () => {
    expect(slicesOf(MAIN, [], [])).toEqual([{ key: 'USD', label: 'ดอลลาร์สหรัฐ (USD)', bps: 10_000 }]);
  });
  it('ส่วน USD ติดลบ (เงินสด USD ติดลบเกินมูลค่าหุ้น): null ไม่เดา ไม่โยน error', () => {
    expect(slicesOf(MAIN, [usdCash], [deposit('usd-cash', -100_000)])).toBeNull();
  });
  it('ไม่มีอัตราแลกเปลี่ยน: null', () => {
    expect(slicesOf({ ...MAIN, fxRates: [] }, [], [])).toBeNull();
  });
  it('มีแต่เงินสด USD ไม่มีหุ้น: เป็น empty state (ไม่มีโดนัท)', () => {
    const v = buildDashboardView([usdCash], [deposit('usd-cash', 10_000)], { ...emptyInvestments(), fxRates: MAIN.fxRates! }, TODAY);
    expect(v.empty).toBe(true);
    expect(v.currencySlices).toBeNull();
  });
});

describe('แดชบอร์ดพอร์ต: ปันผลรายเดือนและตัวช่วย (ขอบเขต)', () => {
  const div = (id: string, date: string, amount: number, over: Partial<TradeRecord> = {}): TradeRecord =>
    trade({ id, kind: 'dividend', date, units: undefined, priceMicro: undefined, amount, fee: 0, withholding: 0, fxRateMicro: 34_567_891, ...over });
  it('ต่างปีและหลังวันนี้ถูกกรอง', () => {
    const d: InvestmentData = { ...MAIN, trades: [div('x1', '2025-12-01', 5_000), div('x2', '2026-12-01', 5_000)] };
    expect(monthlyDividends(d, TODAY).every((m) => m.grossUsd === 0)).toBe(true);
  });
  it('ไม่มี fxRateMicro ถูกข้าม · สินทรัพย์บาทถูกกรองออก', () => {
    const thbAsset: Asset = { id: 'th', name: 'กองทุน', kind: 'fund', accountId: 'inv-th' };
    const d: InvestmentData = { ...MAIN, assets: [asset, thbAsset], trades: [div('x3', '2026-03-05', 5_000, { fxRateMicro: undefined }), div('x4', '2026-03-06', 5_000, { assetId: 'th' })] };
    expect(monthlyDividends(d, TODAY)[2]).toEqual({ month: 3, grossThb: 0, grossUsd: 0 });
  });
  it('หลายรายการในเดือนเดียว: ปัดต่อรายการ (1 เซนต์ x 34.567891 = 35 สตางค์ สองครั้ง = 70 ไม่ใช่ 69) และผลรวมทั้งปี = dividendGross ของ R24', () => {
    const d: InvestmentData = { ...MAIN, trades: [...MAIN.trades, div('x5', '2026-03-05', 1), div('x6', '2026-03-20', 1)] };
    const m = monthlyDividends(d, TODAY);
    expect(m[2]).toEqual({ month: 3, grossThb: 70, grossUsd: 2 });
    const sum = m.reduce((n, x) => n + x.grossThb, 0);
    expect(sum).toBe(buildDashboardView([], [], d, TODAY).profit.thb!.dividendGross);
  });
  it('bpsText ติดลบเล็ก: -5 → -0.05% · -0 → 0%', () => {
    expect(bpsText(-5)).toBe('−0.05%');
    expect(bpsText(-0)).toBe('0%');
    expect(bpsText(-0, true)).toBe('0%');
  });
  it('barPercent ใกล้ MAX_SAFE_INTEGER ไม่เพี้ยน', () => {
    const M = Number.MAX_SAFE_INTEGER;
    expect(barPercent(M, M)).toBe(100);
    expect(barPercent(M - 1, M)).toBe(99);
    expect(barPercent(-M, M)).toBe(100);
  });
});
