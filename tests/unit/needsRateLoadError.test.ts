import { describe, expect, it, vi } from 'vitest';
import type { Asset, InvestmentData, TradeRecord } from '../../src/domain/invest/types';

// ปันผลคำนวณล้ม (RangeError) ต้องไม่กลายเป็น 0 เงียบ: ติดธง loadError + incomplete (R26)
let failDividends = false;
vi.mock('../../src/domain/invest/metrics', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/domain/invest/metrics')>();
  return {
    ...orig,
    computeDividendMetrics: (...a: Parameters<typeof orig.computeDividendMetrics>) => {
      if (failDividends) throw new RangeError('boom');
      return orig.computeDividendMetrics(...a);
    },
  };
});

const { buildAnalysisModel } = await import('../../src/ui/invest/analysis/analysisModel');
const { buildHoldingsView } = await import('../../src/domain/invest/holdingsView');

const asset: Asset = { id: 'us1', name: 'หุ้น TEST', kind: 'stock', accountId: 'inv-us1', currency: 'USD', ticker: 'TEST', exchange: 'NASDAQ' };
const t = (over: Partial<TradeRecord>): TradeRecord => ({
  id: 'b1', assetId: 'us1', kind: 'buy', date: '2026-10-03', createdAt: '2026-10-03T03:00:00.000Z', units: '1000000000', priceMicro: 100_000_000, amount: 100_000, fee: 0, withholding: 0, memo: '', fxRateMicro: 35_000_000, ...over,
});
const data: InvestmentData = {
  assets: [asset],
  trades: [t({}), t({ id: 'd1', kind: 'dividend', date: '2026-10-20', amount: 5_000, units: undefined, priceMicro: undefined })],
  prices: [{ assetId: 'us1', date: '2026-11-12', priceMicro: 125_000_000 }],
  fxRates: [{ accountId: 'usd-cash', date: '2026-11-12', rateMicro: 34_000_000 }],
};

describe('ปันผลโหลด/คำนวณล้ม ไม่เป็น 0 เงียบ', () => {
  it('ปกติ: ไม่มีธง ผลเดิม', () => {
    failDividends = false;
    const m = buildAnalysisModel([], [], data, '2026-11-13');
    expect(m.dividend.loadError).toBeUndefined();
    expect(m.dividend.incomplete).toBe(false);
    expect(m.dividend.grossUsd).toBe(5_000);
    expect(m.dividendNetUsdTotal).toBe(5_000);
    expect(buildHoldingsView(data, '2026-11-13', 'USD').rows[0]!.dividends12m).toBe(5_000);
  });
  it('ล้ม: loadError + incomplete, yield null', () => {
    failDividends = true;
    const m = buildAnalysisModel([], [], data, '2026-11-13');
    failDividends = false;
    expect(m.dividend).toMatchObject({ loadError: true, incomplete: true, yieldBps: null, yieldOnCostBps: null });
  });
  it('Holdings: ปันผล 12 เดือนล้ม = null (ไม่ใช่ 0)', () => {
    failDividends = true;
    const v = buildHoldingsView(data, '2026-11-13', 'USD');
    failDividends = false;
    expect(v.rows[0]!.dividends12m).toBeNull();
  });
});
