import { describe, expect, it } from 'vitest';
import { buildConcentration, buildDonutPieces, buildHoldingRows, CONCENTRATION_LIMIT_BPS, type HoldingRow } from '../../src/app/investPortfolioView';
import { buildUsPortfolio } from '../../src/app/usPortfolio';
import type { Asset, InvestmentData, TradeRecord } from '../../src/domain/invest/types';

/** ข้อมูลสมมติ: 3 หุ้น US ซื้อ 10 หุ้นเท่ากัน ราคาต่างกัน อัตรา 35.00 · ห้ามใช้ข้อมูลจริง */
const mk = (id: string, ticker: string): Asset => ({ id, name: `Stock ${ticker}`, kind: 'stock', accountId: `inv-${id}`, currency: 'USD', ticker, exchange: 'NASDAQ' });
let seq = 0;
const buy = (assetId: string): TradeRecord => ({ id: `b${++seq}`, assetId, kind: 'buy', date: '2026-11-03', createdAt: '2026-11-03T03:00:00.000Z', units: '1000000000', priceMicro: 100_000_000, amount: 100_000, fee: 0, withholding: 0, memo: '', fxRateMicro: 35_000_000 });
const data = (prices: Record<string, number | null>): InvestmentData => ({
  assets: [mk('a', 'AAA'), mk('b', 'BBB'), mk('c', 'CCC')],
  trades: [buy('a'), buy('b'), buy('c')],
  prices: Object.entries(prices).flatMap(([assetId, p]) => (p === null ? [] : [{ assetId, date: '2026-11-12', priceMicro: p }])),
  fxRates: [{ accountId: 'usd-cash', date: '2026-11-12', rateMicro: 35_000_000 }],
});
const us = (d: InvestmentData) => buildUsPortfolio([], [], d, '2026-11-13');

describe('buildHoldingRows', () => {
  const d = data({ a: 200_000_000, b: 100_000_000, c: 50_000_000 });
  it('allocation sums to exactly 10,000 bps and rows are sorted largest first', () => {
    const rows = buildHoldingRows(us(d), 'THB');
    expect(rows.map((r) => r.ticker)).toEqual(['AAA', 'BBB', 'CCC']);
    expect(rows.reduce((n, r) => n + (r.bps ?? 0), 0)).toBe(10_000);
    expect(rows.map((r) => r.bps)).toEqual([5_714, 2_857, 1_429]);
  });
  it('gain = value - invested per stock in both currencies, % uses the same half-away rounding as R24.5', () => {
    const [a, , c] = buildHoldingRows(us(d), 'USD');
    expect([a!.value, a!.invested, a!.gain, a!.gainBps]).toEqual([200_000, 100_000, 100_000, 10_000]); // +100%
    expect([c!.value, c!.invested, c!.gain, c!.gainBps]).toEqual([50_000, 100_000, -50_000, -5_000]); // -50%
    const [aThb] = buildHoldingRows(us(d), 'THB');
    expect(aThb!.gain).toBe(aThb!.value! - aThb!.invested);
  });
  it('a stock without a price: value/gain/allocation are null for everyone (never use cost instead)', () => {
    const rows = buildHoldingRows(us(data({ a: 200_000_000, b: 100_000_000, c: null })), 'THB');
    const c = rows.find((r) => r.ticker === 'CCC')!;
    expect([c.value, c.gain, c.gainBps]).toEqual([null, null, null]);
    expect(rows.every((r) => r.bps === null)).toBe(true);
    expect(buildDonutPieces(rows)).toEqual([]);
  });
  it('no holdings: no rows', () => {
    expect(buildHoldingRows(us({ ...d, trades: [] }), 'THB')).toEqual([]);
  });
});

describe('buildDonutPieces', () => {
  it('more than 9 stocks: the tail is grouped into Other and the total stays 10,000', () => {
    const rows: HoldingRow[] = Array.from({ length: 12 }, (_, i) => ({ assetId: `x${i}`, name: `N${i}`, ticker: `T${i}`, value: 1, invested: 1, gain: 0, gainBps: 0, bps: i < 11 ? 833 : 837 }));
    const pieces = buildDonutPieces(rows);
    expect(pieces).toHaveLength(9);
    expect(pieces[8]).toMatchObject({ key: 'other', label: 'Other' });
    expect(pieces.reduce((n, p) => n + p.bps, 0)).toBe(rows.reduce((n, r) => n + (r.bps ?? 0), 0));
  });
});

describe('buildConcentration (warning only when one stock is over 20%)', () => {
  const row = (id: string, bps: number): HoldingRow => ({ assetId: id, name: `N${id}`, ticker: id, value: 1, invested: 1, gain: 0, gainBps: 0, bps });
  it('limit is 20.00%', () => expect(CONCENTRATION_LIMIT_BPS).toBe(2000));
  it('exactly 20.00% = no warning; 20.01% = warning', () => {
    expect(buildConcentration([row('A', 2000), row('B', 2000), row('C', 4000)]).warn).toBe(true); // C = 4,000 is over
    expect(buildConcentration([row('A', 2000), row('B', 2000), row('C', 2000), row('D', 2000), row('E', 2000)]).warn).toBe(false);
    expect(buildConcentration([row('A', 2001), row('B', 1999), row('C', 2000), row('D', 2000), row('E', 2000)]).warn).toBe(true);
  });
  it('lists the 5 largest weights in order and counts holdings', () => {
    const c = buildConcentration([row('A', 3000), row('B', 2500), row('C', 1500), row('D', 1200), row('E', 900), row('F', 600), row('G', 300)]);
    expect(c.largest.map((e) => e.ticker)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(c.holdings).toBe(7);
    expect(c.top?.ticker).toBe('A');
  });
  it('incomplete portfolio (null allocation) never warns', () => {
    expect(buildConcentration([{ ...row('A', 0), bps: null }]).warn).toBe(false);
  });
});

describe('buildHoldingRows edge cases (money-auditor)', () => {
  it('a price of 0 counts as no price (R20.7): everything stays null, never 0% or -100%', () => {
    const rows = buildHoldingRows(us(data({ a: 0, b: 0, c: 0 })), 'USD');
    expect(rows.every((r) => r.bps === null && r.gain === null && r.gainBps === null)).toBe(true);
    expect(buildConcentration(rows).warn).toBe(false);
    const mixed = buildHoldingRows(us(data({ a: 200_000_000, b: 100_000_000, c: 0 })), 'THB');
    expect(mixed.every((r) => r.bps === null)).toBe(true);
  });
  it('sold-out stock is not listed', () => {
    const sold: InvestmentData = { ...data({ a: 200_000_000, b: 100_000_000, c: 50_000_000 }), trades: [buy('a'), buy('b'), buy('c'), { ...buy('c'), id: 'sell-c', kind: 'sell', date: '2026-11-10', createdAt: '2026-11-10T03:00:00.000Z', amount: undefined, priceMicro: 100_000_000 }] };
    expect(buildHoldingRows(us(sold), 'THB').map((r) => r.ticker)).toEqual(['AAA', 'BBB']);
  });
  it('a single holding is 100% (10,000 bps) and triggers the warning', () => {
    const one: InvestmentData = { ...data({ a: 100_000_000 }), trades: [buy('a')] };
    const rows = buildHoldingRows(us(one), 'THB');
    expect(rows.map((r) => r.bps)).toEqual([10_000]);
    expect(buildConcentration(rows).warn).toBe(true);
  });
  it('zero gain gives 0 bps with no negative zero', () => {
    const rows = buildHoldingRows(us(data({ a: 100_000_000, b: 100_000_000, c: 100_000_000 })), 'USD');
    expect(rows.map((r) => r.gain)).toEqual([0, 0, 0]);
    expect(Object.is(rows[0]!.gainBps, -0)).toBe(false);
  });
});

describe('R24.6 per-stock profit: the rule example and edge cases', () => {
  const one = (over: Partial<TradeRecord>, price: number | null, fxMicro = 32_400_000): InvestmentData => ({
    assets: [mk('a', 'AAA')],
    trades: [{ ...buy('a'), amount: 100_000, fee: 100, ...over }],
    prices: price === null ? [] : [{ assetId: 'a', date: '2026-11-12', priceMicro: price }],
    fxRates: [{ accountId: 'usd-cash', date: '2026-11-12', rateMicro: fxMicro }],
  });
  it('rule example: 10 shares at $100.00 + $1.00 fee at 35.00; now $130.00 at 32.40', () => {
    const d = one({ fxRateMicro: 35_000_000 }, 130_000_000);
    const [usd] = buildHoldingRows(us(d), 'USD');
    // 29,900 x 10,000 / 100,100 = 2,987.01 -> 2,987 (remainder 1,300 x 2 < 100,100: round down)
    expect([usd!.invested, usd!.value, usd!.gain, usd!.gainBps]).toEqual([100_100, 130_000, 29_900, 2_987]);
    const [thb] = buildHoldingRows(us(d), 'THB');
    // 708,500 x 10,000 / 3,503,500 = 2,022.26 -> 2,022 (remainder 923,000 x 2 < 3,503,500: round down)
    expect([thb!.invested, thb!.value, thb!.gain, thb!.gainBps]).toEqual([3_503_500, 4_212_000, 708_500, 2_022]);
  });
  it('exact .5 rounds away from zero for gains and losses; .4 and .6 are not truncated', () => {
    // cost 100,100 cents: gain x 10,000 / 100,100 -> pick gains giving .4 / .5 / .6 is awkward, so use cost 100,000 (fee 0)
    const bpsFor = (priceMicro: number) => buildHoldingRows(us(one({ fee: 0, fxRateMicro: 35_000_000 }, priceMicro)), 'USD')[0]!.gainBps;
    expect(bpsFor(110_004_000)).toBe(1_000); // +10,004 / 100,000 = 1,000.4
    expect(bpsFor(110_005_000)).toBe(1_001); // 1,000.5 exactly -> away from zero
    expect(bpsFor(110_006_000)).toBe(1_001); // 1,000.6
    expect(bpsFor(89_996_000)).toBe(-1_000); // -10,004 -> -1,000.4
    expect(bpsFor(89_995_000)).toBe(-1_001); // -1,000.5 exactly -> away from zero
    expect(bpsFor(89_994_000)).toBe(-1_001); // -1,000.6
  });
  it('a loss is negative in both views', () => {
    const [usd] = buildHoldingRows(us(one({ fxRateMicro: 35_000_000 }, 80_000_000)), 'USD');
    expect([usd!.gain, usd!.gainBps]).toEqual([-20_100, -2_008]); // -20,100 x 10,000 / 100,100 = -2,008.0
  });
  it('held cost of 0 (e.g. shares received free): the gain exists but the percentage is null, never a number', () => {
    const base = us(one({ fxRateMicro: 35_000_000 }, 130_000_000));
    const free = { ...base, rows: base.rows.map((r) => ({ ...r, costUsd: 0, costThb: 0 })) };
    for (const cur of ['USD', 'THB'] as const) {
      const [r] = buildHoldingRows(free, cur);
      expect(r!.invested).toBe(0);
      expect(r!.gain).toBe(r!.value);
      expect(r!.gainBps).toBeNull();
    }
  });
});
