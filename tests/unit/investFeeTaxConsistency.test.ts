import { describe, expect, it } from 'vitest';
import { buildReport } from '../../src/domain/invest/reportSeries';
import { computeProfitSources, replayWithFees } from '../../src/domain/invest/metrics';
import { toTradesFx } from '../../src/domain/invest/tradesFx';
import { buildTransactionsView, totalsOf } from '../../src/domain/invest/transactionsView';
import type { Asset, InvestmentData, TradeRecord } from '../../src/domain/invest/types';

// R24 แหล่ง (6) = R26 Fee & tax: แปลงทีละค่าแล้วบวก (เจ้าของอนุมัติ 20 พ.ย. 2569) · ข้อมูลสมมติทั้งหมด
const asset: Asset = { id: 'a1', name: 'Demo A', kind: 'stock', accountId: 'inv-a1', currency: 'USD', ticker: 'DEMA', exchange: 'NASDAQ' };
let seq = 0;
const trade = (over: Partial<TradeRecord>): TradeRecord => ({
  id: `t${++seq}`, assetId: 'a1', kind: 'buy', date: '2026-08-01', createdAt: `${over.date ?? '2026-08-01'}T03:00:00.000Z`, units: '100000000', priceMicro: 10_000, amount: 1, fee: 1, withholding: 0, memo: '', fxRateMicro: 32_500_000, ...over,
});
const TODAY = '2026-11-19';
const data = (trades: TradeRecord[], priceMicro = 10_000): InvestmentData => ({
  assets: [asset], trades, prices: [{ assetId: 'a1', date: '2026-11-18', priceMicro }], fxRates: [{ accountId: 'usd-cash', date: '2026-11-18', rateMicro: 32_500_000 }],
});
const txFeeTaxThb = (d: InvestmentData): number | null => totalsOf(buildTransactionsView({ data: d, accounts: [], entries: [], currency: 'THB', today: TODAY }).rows).feeTax;
const sources = (d: InvestmentData) => computeProfitSources(d, TODAY).thb!;

describe('ตัวอย่างมือในกฎ R24: ซื้อมูลค่า 1 เซนต์ ค่าธรรมเนียม 1 เซนต์ ที่ 32.50', () => {
  const d = data([trade({})]);
  it('ตาราง Transactions: Fee / tax = 33 สตางค์ · แหล่ง (6) ในรายงาน = −33 · ตรงกันพอดี', () => {
    expect(txFeeTaxThb(d)).toBe(33);
    expect(sources(d).feesAndTax).toBe(-33);
    expect(0 - sources(d).feesAndTax).toBe(txFeeTaxThb(d));
  });
  it('ต้นทุนบาทของที่ถืออยู่ยัง 65 สตางค์ (แปลง 2 เซนต์ก้อนเดียว · R20.3 ไม่เปลี่ยน) และ 6 แหล่งรวมเท่า P ตรงเป๊ะ', () => {
    const rep = replayWithFees(toTradesFx(d.trades));
    expect(rep.position.costThb).toBe(65);
    expect(rep.buyFeesThb).toBe(33);
    const s = sources(d);
    expect(s.priceUnrealized + s.priceRealized + s.options + s.dividendGross + s.fx + s.feesAndTax).toBe(s.total);
    expect(s.total).toBe(33 - 65); // มูลค่าตลาด 1 เซนต์ = 33 สตางค์ − ต้นทุน 65 (ไม่มีขาย/ปันผล)
  });
});

describe('ค่าธรรมเนียมขายและภาษีหักปันผล: ตารางเท่ากับแหล่ง (6) เสมอ', () => {
  it('ขาย 1 รายการ (ขาย 1 หุ้น ราคา $1.00 ค่าธรรมเนียม 1 เซนต์ที่ 32.50): ตาราง 33 · แหล่ง (6) −33 (แบบเดิมได้ 32)', () => {
    const buy = trade({ id: 'b', amount: 100, fee: 0, units: '200000000', priceMicro: 500_000 });
    const sell = trade({ id: 's', kind: 'sell', date: '2026-09-01', units: '100000000', priceMicro: 1_000_000, amount: undefined, fee: 1 });
    const d = data([buy, sell], 1_000_000);
    expect(txFeeTaxThb(d)).toBe(33);
    expect(sources(d).feesAndTax).toBe(-33);
    expect(replayWithFees(toTradesFx(d.trades)).sells[0]!.sellFeeThb).toBe(33);
  });
  it('ซื้อ + ขาย + ปันผลที่มีภาษี: ผลรวมตาราง = −(แหล่ง 6) ทุกชุดตัวเลข', () => {
    for (const [fee, wht, amount] of [[1, 1, 100], [3, 7, 1_001], [99, 1, 12_345], [0, 0, 5], [250, 33, 777]] as const) {
      const d = data([
        trade({ id: 'b1', amount: 100_000, fee, units: '1000000000', priceMicro: 100_000_000 }),
        trade({ id: 'd1', kind: 'dividend', date: '2026-09-10', amount, withholding: wht, fee: 0, units: undefined, priceMicro: undefined, fxRateMicro: 34_567_891 }),
        trade({ id: 's1', kind: 'sell', date: '2026-10-10', units: '300000000', priceMicro: 120_000_000, amount: undefined, fee, fxRateMicro: 33_000_000 }),
      ], 125_000_000);
      expect(0 - sources(d).feesAndTax, `fee=${fee} wht=${wht}`).toBe(txFeeTaxThb(d));
    }
  });
  it('ขอบ: ไม่มีค่าธรรมเนียมและภาษีเลย = 0 ทั้งสองที่ (ไม่ใช่ −0)', () => {
    const d = data([trade({ amount: 100, fee: 0, priceMicro: 100_000_000 })], 100_000_000);
    expect(txFeeTaxThb(d)).toBe(0);
    expect(Object.is(sources(d).feesAndTax, 0)).toBe(true);
  });
});

describe('ขอบเขตเพิ่ม (ผล money-auditor): ซื้อหลายรายการ · ขายบางส่วน · ปันผลหลายเรต · รายงานรายเดือน', () => {
  // ค่าธรรมเนียมแต่ละรายการ ×32.5 ลงท้าย .5 พอดี (1 เซนต์ → 32.5 → 33): ผลรวมแบบแปลงทีละค่ากับแบบผลต่างจะต่างกันชัด
  const many = data([
    trade({ id: 'b1', date: '2026-01-05', amount: 10_001, fee: 1, units: '100000000', priceMicro: 100_010_000 }),
    trade({ id: 'b2', date: '2026-02-05', amount: 10_003, fee: 3, units: '100000000', priceMicro: 100_030_000 }),
    trade({ id: 's1', kind: 'sell', date: '2026-03-05', units: '50000000', priceMicro: 120_000_000, amount: undefined, fee: 1 }),
    trade({ id: 'd1', kind: 'dividend', date: '2026-03-10', amount: 101, withholding: 1, fee: 0, units: undefined, priceMicro: undefined, fxRateMicro: 32_500_000 }),
    trade({ id: 'd2', kind: 'dividend', date: '2026-04-10', amount: 333, withholding: 5, fee: 0, units: undefined, priceMicro: undefined, fxRateMicro: 31_999_999 }),
    trade({ id: 'b3', date: '2026-05-05', amount: 10_005, fee: 5, units: '100000000', priceMicro: 100_050_000, fxRateMicro: 33_333_333 }),
    trade({ id: 's2', kind: 'sell', date: '2026-06-05', units: '100000000', priceMicro: 130_000_000, amount: undefined, fee: 3, fxRateMicro: 34_000_000 }),
  ], 125_000_000);
  it('ซื้อ 3 · ขายบางส่วน 2 · ปันผล 2 เรต: ตาราง Transactions = −แหล่ง (6) · 6 แหล่งรวมเท่า P', () => {
    const s = sources(many);
    expect(0 - s.feesAndTax).toBe(txFeeTaxThb(many));
    expect(s.priceUnrealized + s.priceRealized + s.options + s.dividendGross + s.fx + s.feesAndTax).toBe(s.total);
    // มือ: fee 1@32.5=33 · 3@32.5=98 (97.5) · ขาย 1@32.5=33 · 5@33.333333=167 (166.67) · ขาย 3@34=102 · wht 1@32.5=33 · 5@31.999999=160 (159.99995) → 33+98+33+167+102+33+160 = 626
    expect(s.feesAndTax).toBe(-626);
  });
  it('รายงานรายเดือน (บาท): ผลรวม fees + taxes ของทุกคอลัมน์ = แหล่ง (6) ตรงเป๊ะ', () => {
    // ราคาและเรตปลายทุกเดือน (รายงานต้องมีข้อมูลครบทุกเดือนจึงคำนวณได้)
    const ends = ['01-31', '02-28', '03-31', '04-30', '05-31', '06-30', '07-31', '08-31', '09-30', '10-31'].map((d) => `2026-${d}`);
    const full: InvestmentData = { ...many, prices: ends.map((date) => ({ assetId: 'a1', date, priceMicro: 125_000_000 })), fxRates: ends.map((date) => ({ accountId: 'usd-cash', date, rateMicro: 32_500_000 })) };
    const t = buildReport(full, '2026-06-30', 'THB', 'monthly', 'all');
    const fees = t.columns.reduce((n, c) => n + (c.fees ?? 0), 0);
    const taxes = t.columns.reduce((n, c) => n + (c.taxes ?? 0), 0);
    expect(t.columns.length).toBeGreaterThan(0);
    expect(fees + taxes).toBe(computeProfitSources(full, '2026-06-30').thb!.feesAndTax);
    expect(fees + taxes).toBe(-626); // ค่าเดียวกับตัวอย่างมือข้างบน (ไม่ใช่เทสต์ว่าง)
  });
});
