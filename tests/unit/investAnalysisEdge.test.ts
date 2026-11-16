import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Asset, InvestmentData, TradeRecord } from '../../src/domain/invest/types';
import type { Account, Entry } from '../../src/domain/ledger/types';
import { computeProfitSources } from '../../src/domain/invest/metrics';
import { AnalysisTab } from '../../src/ui/invest/AnalysisTab';
import { InvestContext, type InvestContextValue } from '../../src/ui/invest/InvestContext';
import { buildAnalysisModel } from '../../src/ui/invest/analysis/analysisModel';
import { percentBps, signedPercentBps } from '../../src/ui/invest/analysis/format';
import { ProfitSources } from '../../src/ui/invest/analysis/HoldingsCard';

const asset = (id: string, ticker: string): Asset => ({ id, name: `หุ้น ${ticker}`, kind: 'stock', accountId: `inv-${id}`, currency: 'USD', ticker, exchange: 'NASDAQ' });
let seq = 0;
const trade = (over: Partial<TradeRecord>): TradeRecord => ({
  id: `e${++seq}`, assetId: 'us1', kind: 'buy', date: '2026-01-02', createdAt: `${over.date ?? '2026-01-02'}T03:00:00.000Z`, units: '1000000000', priceMicro: 100_000_000, amount: 100_000, fee: 0, withholding: 0, memo: '', fxRateMicro: 35_000_000, ...over,
});
const SINGLE: InvestmentData = {
  assets: [asset('us1', 'AAA')],
  trades: [trade({ id: 'b1' })],
  prices: [{ assetId: 'us1', date: '2026-01-31', priceMicro: 110_000_000 }, { assetId: 'us1', date: '2026-02-28', priceMicro: 121_000_000 }],
  fxRates: [{ accountId: 'usd-cash', date: '2026-01-01', rateMicro: 35_000_000 }],
};
const TODAY = '2026-02-28';
const entry = (id: string, lines: [string, number][]): Entry => ({ id, date: '2026-02-01', memo: '', source: 'manual', createdAt: '2026-02-01T00:00:00.000Z', lines: lines.map(([accountId, amount]) => ({ accountId, amount })) });
const accounts: Account[] = [
  { id: 'usd-cash', type: 'asset', name: 'เงินสด USD', currency: 'USD', kind: 'investment' },
  { id: 'thb-inv', type: 'asset', name: 'พักเงินลงทุน', currency: 'THB', kind: 'investment' },
];

describe('สัดส่วนสกุลเงิน (นิยามเดียวกับแดชบอร์ด)', () => {
  it('หุ้น + เงินสด USD + เงินสดบาทลงทุน: รวม 10,000 bps · USD 77,350 เทียบบาท 77,350 = 50/50', () => {
    const m = buildAnalysisModel(accounts, [entry('c1', [['usd-cash', 100_000]]), entry('t1', [['thb-inv', 7_735_000]])], SINGLE, TODAY);
    expect(m.currencyShares.kind).toBe('ok');
    if (m.currencyShares.kind !== 'ok') return;
    expect(m.currencyShares.shares.reduce((n, s) => n + s.bps, 0)).toBe(10_000);
    expect(m.currencyShares.shares.find((s) => s.key === 'USD')!.bps).toBe(5_000);
  });
  it('เงินสด USD ติดลบถูกหักออกตามเครื่องหมาย (USD น้อยลง) ไม่ถูกข้าม', () => {
    const base = [entry('t1', [['thb-inv', 7_735_000]])];
    const plus = buildAnalysisModel(accounts, [...base, entry('c1', [['usd-cash', 10_000]])], SINGLE, TODAY).currencyShares;
    const minus = buildAnalysisModel(accounts, [...base, entry('c1', [['usd-cash', -10_000]])], SINGLE, TODAY).currencyShares;
    expect(plus.kind === 'ok' && minus.kind === 'ok').toBe(true);
    if (plus.kind !== 'ok' || minus.kind !== 'ok') return;
    const usdBps = (c: typeof plus) => c.shares.find((s) => s.key === 'USD')!.bps;
    expect(usdBps(minus)).toBeLessThan(usdBps(plus));
    expect(minus.shares.reduce((n, s) => n + s.bps, 0)).toBe(10_000);
  });
  it('ไม่มีอัตรา = incomplete · ไม่มีหุ้น = none (คนละข้อความ)', () => {
    expect(buildAnalysisModel(accounts, [], { ...SINGLE, fxRates: [] }, TODAY).currencyShares.kind).toBe('incomplete');
    expect(buildAnalysisModel(accounts, [], { assets: [], trades: [], prices: [] }, TODAY).currencyShares.kind).toBe('none');
  });
});

// ตัวอย่างหลัก R24 (เจ้าของอนุมัติ 16 พ.ย. 2569): กำไรรวม 774,113 สตางค์
const MAIN: InvestmentData = {
  assets: [asset('us1', 'AAA')],
  trades: [
    trade({ id: 'b1', date: '2026-11-03', units: '1000000000', amount: 100_000, fee: 100, fxRateMicro: 35_000_000 }),
    trade({ id: 's1', kind: 'sell', date: '2026-11-10', units: '400000000', priceMicro: 120_000_000, amount: undefined, fee: 100, fxRateMicro: 33_000_000 }),
    trade({ id: 'd1', kind: 'dividend', date: '2026-11-12', units: undefined, priceMicro: undefined, amount: 5_000, fee: 0, withholding: 750, fxRateMicro: 34_567_891 }),
  ],
  prices: [{ assetId: 'us1', date: '2026-11-12', priceMicro: 125_000_000 }],
  fxRates: [{ accountId: 'usd-cash', date: '2026-11-12', rateMicro: 34_000_000 }],
};
describe('กำไรรวมแยกตามแหล่ง (ProfitSources)', () => {
  const profit = computeProfitSources(MAIN, '2026-11-13');
  const html = (c: 'THB' | 'USD', p = profit) => renderToStaticMarkup(createElement(ProfitSources, { profit: p, currency: c }));
  it('บาท: กำไรรวม 774,113 สตางค์ = +฿7,741.13 · มีป้ายแหล่งที่ถูกต้องและบรรทัดค่าเงิน', () => {
    const h = html('THB');
    expect(h).toContain('+฿7,741.13');
    expect(h).toContain('ปันผล (ก่อนภาษี)');
    expect(h).toContain('ค่าธรรมเนียมและภาษีที่ถูกหัก');
    expect(h).toContain('ค่าเงิน');
  });
  it('USD: ไม่มีบรรทัดค่าเงิน และกำไรรวม +$270.50', () => {
    const h = html('USD');
    expect(h).not.toContain('ค่าเงิน');
    expect(h).toContain('+$270.50');
  });
  it('ข้อมูลไม่ครบ (src เป็น null) = ข้อความไม่แสดง ไม่มีตัวเลข', () => {
    const h = html('THB', { ...profit, thb: null, usd: null });
    expect(h).toContain('ยังไม่แสดง');
    expect(h).not.toContain('฿');
  });
});

const ctx = (data: InvestmentData, currency: 'THB' | 'USD' = 'THB'): InvestContextValue => ({ today: TODAY, accounts: [], entries: [], wallets: [], data, loadError: '', reload: async () => undefined, onLedgerChanged: () => undefined, currency, setCurrency: () => undefined });
const render = (data: InvestmentData, currency: 'THB' | 'USD' = 'THB'): string => renderToStaticMarkup(createElement(InvestContext.Provider, { value: ctx(data, currency) }, createElement(AnalysisTab)));

describe('กรณีขอบ', () => {
  it('ผลตอบแทนติดลบผ่านโมเดล: ราคาปลาย ก.พ. $99 → -10.00% และทั้งปี -0.38%', () => {
    const d = { ...SINGLE, prices: [SINGLE.prices[0]!, { assetId: 'us1', date: TODAY, priceMicro: 99_000_000 }] };
    const y = buildAnalysisModel([], [], d, TODAY).monthly[0]!;
    expect(y.cells[1]).toEqual({ kind: 'ok', bps: -1_000 });
    expect(signedPercentBps(-1_000)).toBe('-10.00%');
    expect(percentBps(y.total as number)).toBe('-0.38%');
    expect(render(d)).toContain('-10.00%');
  });
  it('ขายหมด (มูลค่า 0): หน้าจอไม่ล้ม ไม่มีสัดส่วนปลอม', () => {
    const d: InvestmentData = { ...SINGLE, trades: [...SINGLE.trades, trade({ id: 's', kind: 'sell', date: '2026-02-10', priceMicro: 110_000_000, amount: undefined })] };
    const m = buildAnalysisModel([], [], d, TODAY);
    expect(m.rows[0]!.shareBps).toBeNull();
    expect(m.us.totals.valueThb).toBe(0);
    expect(() => render(d)).not.toThrow();
  });
  it('-0 และค่าไม่ใช่จำนวนเต็ม: -0 = 0.00% · NaN/Infinity = RangeError', () => {
    expect(percentBps(-0)).toBe('0.00%');
    expect(signedPercentBps(-0)).toBe('0.00%');
    expect(() => percentBps(NaN)).toThrow(RangeError);
    expect(() => percentBps(Infinity)).toThrow(RangeError);
  });
  it('ตัวเลขใหญ่ใกล้ 2^53: หน้าจอไม่ล้ม', () => {
    const d: InvestmentData = { ...SINGLE, trades: [trade({ id: 'big', amount: 9_007_199_254_740_000, units: '900719925474099100' })] };
    expect(() => render(d)).not.toThrow();
    expect(() => render(d, 'USD')).not.toThrow();
  });
  it('ไม่มีหุ้น: การ์ดว่างใบเดียว ไม่มีการ์ดอื่นและไม่มี "ขึ้นลงวันนี้"', () => {
    const h = render({ assets: [], trades: [], prices: [] });
    expect(h).toContain('ยังไม่มีหุ้นสหรัฐ');
    expect(h).not.toContain('an-mon-title');
    expect(h).not.toContain('ขึ้นลงวันนี้');
  });
  it('มีหุ้น: ไม่มีคอลัมน์ "วันนี้" ในตาราง แต่มีการ์ด "ขึ้นลงวันนี้"', () => {
    const h = render(SINGLE);
    expect(h).not.toContain('<th scope="col" class="num">วันนี้</th>');
    expect(h).toContain('ขึ้นลงวันนี้');
  });
});
