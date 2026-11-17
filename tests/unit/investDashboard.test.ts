import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { emptyInvestments, type Asset, type InvestmentData, type TradeRecord } from '../../src/domain/invest/types';
import type { Account, Entry } from '../../src/domain/ledger/types';
import { LowerCards } from '../../src/ui/invest/dashboard/LowerCards';
import { PortfolioCard } from '../../src/ui/invest/dashboard/PortfolioCard';
import { StatCards } from '../../src/ui/invest/dashboard/StatCards';
import { barPercent, bpsText, buildDashboardView, monthlyDividends, profitSourceRows } from '../../src/ui/invest/dashboard/dashboardView';

/** ข้อมูลทดสอบสมมติ = ตัวอย่างหลัก R24 (เหมือน tests/unit/investMetrics.test.ts) · ห้ามใช้ข้อมูลจริง */
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
const accounts: Account[] = [];
const entries: Entry[] = [];


describe('แดชบอร์ดพอร์ต: view ตรงตัวอย่างหลัก R24', () => {
  const v = buildDashboardView(accounts, entries, MAIN, TODAY);
  it('6 แหล่งรวม 774,113 และแถวตรงชื่อป้ายที่เจ้าของกำหนด', () => {
    const rows = profitSourceRows(v.profit, 'THB')!;
    expect(rows.map((r) => r.value)).toEqual([510_000, 264_000, 0, 172_839, -140_000, -32_726]);
    expect(rows.reduce((n, r) => n + (r.value ?? 0), 0)).toBe(774_113);
    expect(rows[3]!.label).toBe('ปันผล (ก่อนภาษี)');
    expect(rows[5]!.label).toBe('ค่าธรรมเนียมและภาษีที่ถูกหัก');
  });
  it('มุมมอง USD: ค่าเงินเป็น null (แสดง "—") และรวม 27,050 เซนต์', () => {
    const rows = profitSourceRows(v.profit, 'USD')!;
    expect(rows.find((r) => r.key === 'fx')!.value).toBeNull();
    expect(rows.reduce((n, r) => n + (r.value ?? 0), 0)).toBe(27_050);
  });
  it('มูลค่าตลาดของ 6 หุ้นที่ถืออยู่ = $750.00 (฿25,500.00 ที่อัตรา 34.00)', () => {
    expect(v.valueUsd).toBe(75_000);
    expect(v.valueThb).toBe(2_550_000);
    expect(v.holding).toBe(true);
    expect(v.empty).toBe(false);
  });
  it('ปันผลรายเดือน: พ.ย. = ปันผลก่อนภาษี $50.00 / 172,839 สตางค์ เดือนอื่น 0', () => {
    const m = monthlyDividends(MAIN, TODAY);
    expect(m[10]).toEqual({ month: 11, grossThb: 172_839, grossUsd: 5_000 });
    expect(m.filter((x) => x.grossUsd > 0)).toHaveLength(1);
  });
});


const retirement = () => undefined;
const html = (data: InvestmentData, currency: 'THB' | 'USD', today = TODAY, onOpenRetirement?: () => void): string => {
  const view = buildDashboardView(accounts, entries, data, today);
  return renderToString(createElement('div', null, createElement(StatCards, { view, currency, onOpenRetirement }), createElement(PortfolioCard, { view, currency })));
};

describe('Dashboard (PR 1): หน้าจอ (เรนเดอร์ฝั่งเซิร์ฟเวอร์ · ภาษาอังกฤษ)', () => {
  it('THB view: Value, invested, Total profit (774,113 satang = ฿7,741.13) and card titles', () => {
    const h = html(MAIN, 'THB');
    expect(h).toContain('฿7,741.13');
    expect(h).toContain('฿25,500.00'); // value 600 shares x $125 x 34.00
    expect(h).toContain('Value');
    expect(h).toContain('Total profit');
    expect(h).toContain('IRR');
    expect(h).toContain('Passive income');
    expect(h).toContain('Portfolio');
  });
  it('the ฿/USD toggle changes the numbers: USD view shows +$270.50 and $750.00 and no ฿7,741.13', () => {
    const h = html(MAIN, 'USD');
    expect(h).toContain('+$270.50');
    expect(h).toContain('$750.00');
    expect(h).not.toContain('฿7,741.13');
  });
  it('IRR before 30 days: explains the rule, no fake number', () => {
    expect(html(MAIN, 'THB')).toContain('Available after 30 days of holding');
  });
  it('no holdings: every number card shows a dash and the Portfolio card gives a hint, no money amounts', () => {
    const h = html(emptyInvestments(), 'THB');
    expect(h).toContain('No holdings yet');
    expect(h).toContain('Use + Add');
    expect(h).not.toContain('฿');
  });
  it('no price: value and profit are dashes with a reason, cost is not used instead', () => {
    const noPrice: InvestmentData = { ...MAIN, prices: [] };
    const h = html(noPrice, 'THB');
    expect(h).toContain('Incomplete');
    expect(h).not.toContain('฿7,741.13');
    const v = buildDashboardView(accounts, entries, noPrice, TODAY);
    expect(v.valueThb).toBeNull();
    expect(profitSourceRows(v.profit, 'THB')).toBeNull();
  });
  it('the Today line is hidden until daily prices exist', () => {
    expect(html(MAIN, 'THB')).not.toContain('Today');
  });
  it('Value card: hide-amounts button and the "Worth in 10 years?" chip only when the app provides the retirement link', () => {
    expect(html(MAIN, 'THB')).toContain('Hide amounts');
    expect(html(MAIN, 'THB')).not.toContain('Worth in 10 years?');
    expect(html(MAIN, 'THB', TODAY, retirement)).toContain('Worth in 10 years?');
  });
  it('Passive income shows yield and the annual amount before tax', () => {
    const h = html(MAIN, 'THB');
    expect(h).toContain('annually (before tax)');
    expect(h).toContain('฿1,728.39'); // gross dividend 172,839 satang
  });
  it('Portfolio card: Holdings by default, Sector is disabled with a tooltip, Currency is available, no text under the donut', () => {
    const h = html(MAIN, 'THB');
    expect(h).toContain('Sector');
    expect(h).toContain('Available after automatic data is enabled');
    expect(h).toContain('aria-pressed="true">Holdings');
    expect(h).toContain('Value / Invested');
    expect(h).toContain('Allocation');
    expect(h).toContain('100%'); // one holding
  });
  it('Warning button appears only when one stock is over 20% (single holding = 100%)', () => {
    const h = html(MAIN, 'THB');
    expect(h).toContain('Warning');
    expect(h).toContain('Concentration risk');
    expect(h).toContain('Largest portfolio weights');
    expect(h).toContain('stocks held inside funds are not counted');
  });
});

describe('ตัวช่วยแสดงผล', () => {
  it('bpsText ด้วยจำนวนเต็ม: 355→3.55% · 350→3.5% · -120→-1.2% · 0→0% · +', () => {
    expect(bpsText(355)).toBe('3.55%');
    expect(bpsText(350)).toBe('3.5%');
    expect(bpsText(-120)).toBe('−1.2%');
    expect(bpsText(0, true)).toBe('0%');
    expect(bpsText(1234, true)).toBe('+12.34%');
    expect(bpsText(5)).toBe('0.05%');
    expect(() => bpsText(1.5)).toThrow();
  });
  it('barPercent: 0 / ตัวหาร 0 / เต็ม / ค่าลบใช้ค่าสัมบูรณ์', () => {
    expect(barPercent(0, 100)).toBe(0);
    expect(barPercent(5, 0)).toBe(0);
    expect(barPercent(100, 100)).toBe(100);
    expect(barPercent(-50, 100)).toBe(50);
    expect(barPercent(1, 3)).toBe(33);
  });
});


const soldOut = (): InvestmentData => ({
  ...MAIN,
  trades: [
    trade({ id: 'b', kind: 'buy', date: '2026-11-03', units: '1000000000', amount: 100_000, fee: 0, fxRateMicro: 35_000_000 }),
    trade({ id: 's', kind: 'sell', date: '2026-11-10', units: '1000000000', priceMicro: 120_000_000, amount: undefined, fee: 0, fxRateMicro: 33_000_000 }),
  ],
});

describe('R24.5 Total profit percentage', () => {
  it('main example: THB +36.83% and USD +45.04% with the caption', () => {
    const v = buildDashboardView(accounts, entries, MAIN, TODAY);
    expect([v.profitPctThb, v.profitPctUsd]).toEqual([3_683, 4_504]);
    expect(html(MAIN, 'THB')).toContain('+36.83%');
    expect(html(MAIN, 'USD')).toContain('+45.04%');
    expect(html(MAIN, 'THB')).toContain('Compared with the cost of what you still hold');
  });
  it('no price: percentage is null and not shown', () => {
    const noPrice = { ...MAIN, prices: [] };
    expect(buildDashboardView(accounts, entries, noPrice, TODAY).profitPctThb).toBeNull();
    expect(html(noPrice, 'THB')).not.toContain('36.83%');
  });
  it('sold out (held cost 0): percentage is null but the profit amount stays', () => {
    const v = buildDashboardView(accounts, entries, soldOut(), TODAY);
    expect([v.profitPctThb, v.profitPctUsd]).toEqual([null, null]);
    expect(v.profit.thb).not.toBeNull();
  });
  it('loss: negative percentage for both currencies', () => {
    const loss: InvestmentData = { ...MAIN, trades: [MAIN.trades[0]!], prices: [{ assetId: 'us1', date: '2026-11-12', priceMicro: 90_000_000 }] };
    const v = buildDashboardView(accounts, entries, loss, TODAY);
    expect(v.profitPctUsd!).toBeLessThan(0);
    expect(html(loss, 'USD')).toMatch(/−\d+(\.\d+)?%/);
  });
  it('price but no exchange rate: THB is null, USD still works (computed separately)', () => {
    const v = buildDashboardView(accounts, entries, { ...MAIN, fxRates: [] }, TODAY);
    expect(v.profitPctThb).toBeNull();
    expect(v.profitPctUsd).toBe(4_504);
  });
});

const lower = (data: InvestmentData, currency: 'THB' | 'USD', onOpenRetirement?: () => void): string =>
  renderToString(createElement(LowerCards, { view: buildDashboardView(accounts, entries, data, TODAY), currency, onOpenRetirement }));

describe('Dashboard (PR 2): lower cards', () => {
  it('movers, events and forecast are empty states with the required wording, no fake numbers', () => {
    const h = lower(MAIN, 'THB');
    for (const t of ['Top day gainers', 'Top day losers', 'Recent and upcoming events', 'Future payments', 'My goal']) expect(h).toContain(t);
    expect(h).toContain('Available after automatic data is enabled');
    expect(h).toContain('See all');
    expect(h).toContain('The change in the asset price (intraday). If the stock exchange is closed now, the change for the previous working day is shown.');
    expect(h).toContain('Forecast of future payments based on your current holdings. All values are shown BEFORE tax. To change the tax for specific holdings, go to Portfolio → Holdings.');
    expect(h).toContain('Sort by the asset price change as a percentage');
  });
  it('Future payments: Received bars use real dividends (gross, before tax) of this year, per currency', () => {
    expect(lower(MAIN, 'THB')).toContain('฿1,728.39'); // 172,839 satang gross (R20 dividend-day rate)
    expect(lower(MAIN, 'USD')).toContain('$50.00');
    const none = lower({ ...MAIN, trades: [MAIN.trades[0]!] }, 'THB');
    expect(none).toContain('No dividends received this year yet');
  });
  it('My goal: shows the question and a Set a target button that is live only when the retirement link exists', () => {
    expect(lower(MAIN, 'THB', () => undefined)).toContain('How far away is your target?');
    expect(lower(MAIN, 'THB', () => undefined)).toMatch(/<button type="button" class="iv-btn iv-btn-gold">Set a target<\/button>/);
    expect(lower(MAIN, 'THB')).toContain('aria-disabled="true"');
  });
});

describe('Portfolio table rows are labelled for screen readers', () => {
  it('each row names the holding, value, invested, gain (with the real minus sign) and allocation', () => {
    const h = html(MAIN, 'USD');
    expect(h).toContain('aria-label="หุ้น US1 (US1), value $750.00, invested $600.60, gain +$149.40 (+24.88%), allocation 100%"');
    expect(h).toMatch(/gain \+\$[\d,.]+ \(\+[\d.]+%\), allocation 100%/);
    const loss: InvestmentData = { ...MAIN, trades: [MAIN.trades[0]!], prices: [{ assetId: 'us1', date: '2026-11-12', priceMicro: 90_000_000 }] };
    expect(html(loss, 'USD')).toMatch(/gain −\$[\d,.]+ \(−[\d.]+%\)/);
  });
});
