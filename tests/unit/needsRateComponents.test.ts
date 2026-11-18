import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HoldingsCard } from '../../src/ui/invest/analysis/HoldingsCard';
import { buildAnalysisModel } from '../../src/ui/invest/analysis/analysisModel';
import { UsOverview } from '../../src/ui/UsOverview';
import type { Asset, InvestmentData, TradeRecord } from '../../src/domain/invest/types';

/**
 * component test (renderToStaticMarkup · โปรเจกต์ไม่มี jsdom/Testing Library): หุ้นที่มีรายการไม่มีเรตต้องขึ้น "Needs rate" และ "incomplete" ไม่ใช่ 0 เงียบ (R26)
 * ครอบ HoldingsCard (Realized/ปันผล) และ UsOverview (ยอดต้นทุนรวม) · UsStocksView โหลดข้อมูลใน useEffect (SSR ไม่เห็นข้อมูล) จึงทดสอบด้วย e2e ?investDemo=norate แทน
 */
const asset: Asset = { id: 'us1', name: 'หุ้น TEST', kind: 'stock', accountId: 'inv-us1', currency: 'USD', ticker: 'TEST', exchange: 'NASDAQ' };
const trade = (over: Partial<TradeRecord>): TradeRecord => ({
  id: 'b1', assetId: 'us1', kind: 'buy', date: '2026-10-03', createdAt: '2026-10-03T03:00:00.000Z', units: '1000000000', priceMicro: 100_000_000, amount: 100_000, fee: 0, withholding: 0, memo: '', fxRateMicro: 35_000_000, ...over,
});
const noRateBuy = trade({ id: 'n1' });
delete noRateBuy.fxRateMicro;
const data: InvestmentData = {
  assets: [asset],
  trades: [noRateBuy, trade({ id: 'd1', kind: 'dividend', date: '2026-10-20', amount: 5_000, units: undefined, priceMicro: undefined })],
  prices: [{ assetId: 'us1', date: '2026-11-12', priceMicro: 125_000_000 }],
  fxRates: [{ accountId: 'usd-cash', date: '2026-11-12', rateMicro: 34_000_000 }],
};
const TODAY = '2026-11-13';

describe('component: รายการไม่มีเรตไม่แสดงเป็น 0 เงียบ', () => {
  const model = buildAnalysisModel([], [], data, TODAY);
  it('HoldingsCard แท็บกำไร: Realized (THB) = Needs rate + Total (incomplete)', () => {
    const html = renderToStaticMarkup(createElement(HoldingsCard, { model, currency: 'THB', initialSub: 'profit' }));
    expect(html).toContain('Needs rate');
    expect(html).toContain('(incomplete)');
    expect(html).not.toMatch(/฿0.00/);
  });
  it('HoldingsCard แท็บปันผล: แถว = Needs rate, Total (incomplete)', () => {
    const html = renderToStaticMarkup(createElement(HoldingsCard, { model, currency: 'USD', initialSub: 'dividend' }));
    expect(html).toContain('Needs rate');
    expect(html).toContain('(incomplete)');
  });
  it('UsOverview: ต้นทุนรวมเป็น — + incomplete (ไม่ใช่ 0)', () => {
    const html = renderToStaticMarkup(createElement(UsOverview, { today: TODAY, accounts: [], entries: [], investments: data }));
    expect(html).toContain('Total cost basis (THB) · ⚠ incomplete');
    expect(html).toContain('incomplete');
  });
});
