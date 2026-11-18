import { describe, expect, it } from 'vitest';
import { splitTradesByRate } from '../../src/domain/invest/tradesFx';
import { computeDividendMetrics, computeIrr, computeMonthlyReturns, computeProfitSources } from '../../src/domain/invest/metrics';
import { buildUsPortfolio } from '../../src/app/usPortfolio';
import { buildHoldingsView } from '../../src/domain/invest/holdingsView';
import { buildDashboardView } from '../../src/ui/invest/dashboard/dashboardView';
import type { Asset, InvestmentData, TradeRecord } from '../../src/domain/invest/types';

const asset: Asset = { id: 'us1', name: 'หุ้น TEST', kind: 'stock', accountId: 'inv-us1', currency: 'USD', ticker: 'TEST', exchange: 'NASDAQ' };
let seq = 0;
const trade = (over: Partial<TradeRecord>): TradeRecord => ({
  id: `t${++seq}`, assetId: 'us1', kind: 'buy', date: '2026-10-03', createdAt: `${over.date ?? '2026-10-03'}T03:00:00.000Z`, units: '1000000000', priceMicro: 100_000_000, amount: 100_000, fee: 0, withholding: 0, memo: '', fxRateMicro: 35_000_000, ...over,
});
const noRate = (over: Partial<TradeRecord>): TradeRecord => { const t = trade(over); delete t.fxRateMicro; return t; };
const mk = (trades: TradeRecord[]): InvestmentData => ({
  assets: [asset], trades, prices: [{ assetId: 'us1', date: '2026-11-12', priceMicro: 125_000_000 }], fxRates: [{ accountId: 'usd-cash', date: '2026-11-12', rateMicro: 34_000_000 }],
});
const TODAY = '2026-11-13';

describe('splitTradesByRate', () => {
  it('0 รายการ', () => expect(splitTradesByRate([])).toEqual({ withRate: [], missingRate: [] }));
  it('ทุกรายการไม่มีเรต', () => {
    const r = splitTradesByRate([noRate({ id: 'a' }), noRate({ id: 'b', kind: 'dividend', date: '2026-10-05' })]);
    expect(r.withRate).toEqual([]);
    expect(r.missingRate).toEqual([{ id: 'a', assetId: 'us1', kind: 'buy', date: '2026-10-03' }, { id: 'b', assetId: 'us1', kind: 'dividend', date: '2026-10-05' }]);
  });
  it('รายการแรกไม่มีเรต + ผสม', () => {
    const r = splitTradesByRate([noRate({ id: 'a' }), trade({ id: 'b', date: '2026-10-04' })]);
    expect(r.withRate.map((t) => t.id)).toEqual(['b']);
    expect(r.missingRate.map((t) => t.id)).toEqual(['a']);
  });
});

describe('ข้อมูลครบเรต ผลเดิม ไม่ติดธง', () => {
  const d = mk([trade({ id: 'b1' }), trade({ id: 'd1', kind: 'dividend', date: '2026-10-20', amount: 5_000, units: undefined, priceMicro: undefined })]);
  it('ไม่ขาดเรต', () => {
    const p = computeProfitSources(d, TODAY, { strictRate: true });
    expect(p.complete).toBe(true);
    expect(p.missing).toEqual([]);
    expect(computeDividendMetrics(d, TODAY).incomplete).toBe(false);
    expect(buildUsPortfolio([], [], d, TODAY).missingRate).toEqual([]);
    expect(buildUsPortfolio([], [], d, TODAY).totals.complete).toBe(true);
  });
});

describe('ซื้อที่ไม่มีเรต: ไม่เป็น 0 ติดธง incomplete', () => {
  const d = mk([noRate({ id: 'b1' }), trade({ id: 'b2', date: '2026-10-10' })]);
  it('กำไรรวมเป็น null + missing ระบุรายการ', () => {
    const p = computeProfitSources(d, TODAY, { strictRate: true });
    expect(p.complete).toBe(false);
    expect(p.missing).toContainEqual({ kind: 'rate', tradeIds: ['b1'] });
    expect(p.thb).toBeNull();
    expect(p.usd).toBeNull();
    expect(p.parts).toBeNull();
  });
  it('IRR = na missing', () => expect(computeIrr(d, TODAY)).toEqual({ kind: 'na', reason: 'missing' }));
  it('ผลตอบแทนรายเดือน: เดือนตั้งแต่รายการนั้นเป็น missing และมีเดือนตุลาคม', () => {
    const r = computeMonthlyReturns(d, TODAY);
    expect(r.months[0]).toMatchObject({ month: '2026-10', bps: null, na: 'missing' });
    expect(r.months.every((m) => m.bps === null)).toBe(true);
    expect(r.years['2026']).toBeNull();
  });
  it('พอร์ต: totals.complete=false, missingRate, แถวติด needsRate ไม่มีมูลค่า', () => {
    const us = buildUsPortfolio([], [], d, TODAY);
    expect(us.totals.complete).toBe(false);
    expect(us.missingRate.map((m) => m.id)).toEqual(['b1']);
    expect(us.rows[0]).toMatchObject({ needsRate: true, valueUsd: null, valueThb: null });
    expect(us.totals.valueThb).toBe(0);
  });
  it('Holdings: missing = rate', () => {
    const v = buildHoldingsView(d, TODAY, 'USD');
    expect(v.rows[0]!.missing).toBe('rate');
    expect(v.rows[0]!.value).toBeNull();
  });
});

describe('ปันผลที่ไม่มีเรต', () => {
  const d = mk([trade({ id: 'b1' }), noRate({ id: 'd1', kind: 'dividend', date: '2026-10-20', amount: 5_000, units: undefined, priceMicro: undefined }), trade({ id: 'd2', kind: 'dividend', date: '2026-10-25', amount: 2_000, units: undefined, priceMicro: undefined })]);
  it('ยอดปันผลนับเฉพาะที่มีเรต แต่ติดธง incomplete และ yield null', () => {
    const m = computeDividendMetrics(d, TODAY);
    expect(m.incomplete).toBe(true);
    expect(m.grossUsd).toBe(2_000);
    expect(m.yieldBps).toBeNull();
    expect(m.yieldOnCostBps).toBeNull();
  });
  it('กำไรรวมไม่ครบ', () => expect(computeProfitSources(d, TODAY, { strictRate: true }).complete).toBe(false));
  it('พอร์ตแสดงรายการปันผลที่ขาดเรต', () => {
    const us = buildUsPortfolio([], [], d, TODAY);
    expect(us.missingRate).toEqual([{ id: 'd1', assetId: 'us1', kind: 'dividend', date: '2026-10-20' }]);
    expect(us.totals.complete).toBe(false);
  });
  it('ปันผลรายเดือน (แดชบอร์ด) ติดธง', () => {
    const v = buildDashboardView([], [], d, TODAY);
    expect(v.monthlyIncomplete).toBe(true);
    expect(buildDashboardView([], [], mk([trade({ id: 'b1' })]), TODAY).monthlyIncomplete).toBe(false);
  });
});
