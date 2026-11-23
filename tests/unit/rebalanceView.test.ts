import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/r29-examples.json';
import { rebalance } from '../../src/domain/invest/rebalance';
import {
  buildRebalanceCsv,
  buildRebalanceInput,
  buildRebalanceView,
  bpsText,
  formatShares,
  parseStoredSettings,
  parseUsdCents,
  REBALANCE_DISCLAIMER,
  REBALANCE_REASON_TEXT,
  type RebalanceOptions,
} from '../../src/domain/invest/rebalanceView';
import type { Asset, AssetCategory, InvestmentData, TradeRecord } from '../../src/domain/invest/types';

const TODAY = '2026-11-23';

// ข้อมูลสมมติจากตัวอย่าง R29 (tests/fixtures/r29-examples.json ไฟล์เดียว)
const categories: AssetCategory[] = Object.entries(fixture.targetsBps).map(([name, bps], i) => ({ id: name, name, targetBps: bps, sortOrder: i }));
const assets: Asset[] = fixture.holdings.map((h) => ({ id: h.id, name: `${h.id} Corp`, kind: 'stock', accountId: `inv-${h.id}`, currency: 'USD', ticker: h.id, categoryId: h.category }));
const trades: TradeRecord[] = fixture.holdings.map((h) => ({
  id: `b-${h.id}`, assetId: h.id, kind: 'buy', date: '2026-01-15', createdAt: '2026-01-15T03:00:00.000Z', units: h.units,
  priceMicro: Number(h.priceMicro), amount: 1, fee: 0, withholding: 0, memo: '', fxRateMicro: 34_000_000,
}));
const prices = fixture.holdings.map((h) => ({ assetId: h.id, date: '2026-11-20', priceMicro: Number(h.priceMicro) }));
const data = (over: Partial<InvestmentData> = {}): InvestmentData => ({ assets, trades, prices, categories, ...over }) as InvestmentData;

const opts = (o: Partial<RebalanceOptions> = {}): RebalanceOptions => ({ mode: 'deposit', amountCents: 35_000, allowSales: false, fractional: true, minOrderCents: 0, ...o });

function run(d: InvestmentData, o: RebalanceOptions) {
  const built = buildRebalanceInput(d, TODAY, o);
  if (!built.ok) throw new Error(`build: ${built.reason}`);
  return { input: built.input, result: rebalance(built.input) };
}

describe('parseUsdCents (ข้อความ → เซนต์ ไม่ใช้ float)', () => {
  it('ค่าปกติ', () => {
    expect(parseUsdCents('300')).toEqual({ ok: true, cents: 30_000, empty: false });
    expect(parseUsdCents('300.5')).toEqual({ ok: true, cents: 30_050, empty: false });
    expect(parseUsdCents('$1,234.56')).toEqual({ ok: true, cents: 123_456, empty: false });
    expect(parseUsdCents('.5')).toEqual({ ok: true, cents: 50, empty: false });
    expect(parseUsdCents('0.01')).toEqual({ ok: true, cents: 1, empty: false });
    expect(parseUsdCents('0')).toEqual({ ok: true, cents: 0, empty: false });
    expect(parseUsdCents('  ')).toEqual({ ok: true, cents: 0, empty: true });
    expect(parseUsdCents('')).toEqual({ ok: true, cents: 0, empty: true });
  });
  it('ไม่เกิดผิดพลาดแบบ float (เช่น 0.1+0.2 หรือ 1.005)', () => {
    expect(parseUsdCents('19.99')).toMatchObject({ cents: 1_999 });
    expect(parseUsdCents('1.1')).toMatchObject({ cents: 110 });
    expect(parseUsdCents('999999999999.99')).toMatchObject({ ok: true, cents: 99_999_999_999_999 });
  });
  it('ปฏิเสธ: ลบ · ทศนิยมเกิน 2 ตำแหน่ง · ไม่ใช่ตัวเลข · ใหญ่เกิน', () => {
    expect(parseUsdCents('-5')).toEqual({ ok: false, problem: 'negative' });
    expect(parseUsdCents('-0.01')).toEqual({ ok: false, problem: 'negative' });
    expect(parseUsdCents('1.005')).toEqual({ ok: false, problem: 'tooManyDecimals' });
    expect(parseUsdCents('abc')).toEqual({ ok: false, problem: 'notNumber' });
    expect(parseUsdCents('1e3')).toEqual({ ok: false, problem: 'notNumber' });
    expect(parseUsdCents('1,23')).toEqual({ ok: false, problem: 'notNumber' });
    expect(parseUsdCents('.')).toEqual({ ok: false, problem: 'notNumber' });
    expect(parseUsdCents('--')).toEqual({ ok: false, problem: 'notNumber' });
    expect(parseUsdCents('1'.repeat(13))).toEqual({ ok: false, problem: 'tooLarge' });
  });
});

describe('buildRebalanceInput + rebalance ตรงตัวอย่าง R29', () => {
  it('ตัวอย่าง A เปิดเศษหุ้น: CCC 2.187 = 131.22 · DDD 8.750 = 218.75 · Left over 0.03', () => {
    const { input, result } = run(data(), opts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const view = buildRebalanceView(result, { assets, categoryName: (id) => categories.find((c) => c.id === id)?.name ?? id, fractional: input.fractional });
    expect(view.trades.map((t) => [t.ticker, t.side, t.sharesText, t.cents])).toEqual([
      ['CCC', 'buy', '2.187', 13_122],
      ['DDD', 'buy', '8.750', 21_875],
    ]);
    expect(view.leftOverCents).toBe(3);
    expect(view.buyTotalCents + view.leftOverCents).toBe(35_000);
    expect(view.trades[0]?.priceDate).toBe('2026-11-20');
  });
  it('ตัวอย่าง A ปิดเศษหุ้น: เต็มหุ้น · Left over 30.00', () => {
    const { input, result } = run(data(), opts({ fractional: false }));
    if (!result.ok) throw new Error('x');
    const view = buildRebalanceView(result, { assets, categoryName: (id) => id, fractional: input.fractional });
    expect(view.trades.map((t) => [t.ticker, t.sharesText, t.cents])).toEqual([['CCC', '2', 12_000], ['DDD', '8', 20_000]]);
    expect(view.leftOverCents).toBe(3_000);
  });
  it('ตัวอย่าง C ถอน: ขายก่อน · Short by 0.05', () => {
    const { input, result } = run(data(), opts({ mode: 'withdraw', amountCents: 11_500 }));
    if (!result.ok) throw new Error('x');
    const view = buildRebalanceView(result, { assets, categoryName: (id) => id, fractional: input.fractional });
    expect(view.trades.map((t) => [t.ticker, t.side, t.sharesText, t.cents])).toEqual([['AAA', 'sell', '0.862', 8_620], ['BBB', 'sell', '0.575', 2_875]]);
    expect(view.shortByCents).toBe(5);
    expect(view.sellTotalCents).toBe(11_495);
  });
  it('ตาราง Now/After คิดจากหน่วยที่ปัดจริง และสัดส่วนรวม 100%', () => {
    const { input, result } = run(data(), opts());
    if (!result.ok) throw new Error('x');
    const view = buildRebalanceView(result, { assets, categoryName: (id) => id, fractional: input.fractional });
    expect(view.categories.map((c) => [c.name, c.nowCents, c.afterCents])).toEqual([['Tech', 80_000, 80_000], ['Health', 30_000, 43_122], ['Funds', 5_000, 26_875]]);
    expect(view.categories.reduce((s, c) => s + (c.nowBps ?? 0), 0)).toBe(10_000);
    expect(view.categories.reduce((s, c) => s + (c.afterBps ?? 0), 0)).toBe(10_000);
  });
  it('ราคาเก่ากว่า 30 วัน → คำเตือนมีชื่อหุ้นและข้อความไม่มีคำแนะนำ', () => {
    const old = data({ prices: prices.map((p) => (p.assetId === 'CCC' ? { ...p, date: '2026-09-01' } : p)) });
    const { input, result } = run(old, opts());
    if (!result.ok) throw new Error('x');
    const view = buildRebalanceView(result, { assets, categoryName: (id) => id, fractional: input.fractional });
    expect(view.warnings.join(' ')).toMatch(/older than 30 days for: CCC/);
  });
});

describe('buildRebalanceInput: เหตุที่ไม่คำนวณ', () => {
  it('ไม่มีหมวด', () => {
    expect(buildRebalanceInput(data({ categories: [] }), TODAY, opts())).toMatchObject({ ok: false, reason: 'noCategories' });
  });
  it('หุ้นสหรัฐมีรายการไม่มีเรต → ไม่คำนวณ (ไม่เดา)', () => {
    const t = trades.map((x) => (x.id === 'b-CCC' ? { ...x, fxRateMicro: undefined } : x)) as TradeRecord[];
    expect(buildRebalanceInput(data({ trades: t }), TODAY, opts())).toMatchObject({ ok: false, reason: 'needsRate', holdingIds: ['CCC'] });
  });
  it('หุ้นที่ถืออยู่ไม่มีหมวด → โดเมนบอก holdingWithoutCategory', () => {
    const a = assets.map((x) => (x.id === 'AAA' ? { ...x, categoryId: undefined } : x)) as Asset[];
    const { result } = run(data({ assets: a }), opts());
    expect(result).toMatchObject({ ok: false, reason: 'holdingWithoutCategory' });
    expect(REBALANCE_REASON_TEXT.holdingWithoutCategory).toMatch(/category/);
  });
  it('สินทรัพย์บาทที่ยังถืออยู่ในหมวด → bahtAssetInCategory · บาท 0 หน่วยข้ามได้', () => {
    const thb: Asset = { id: 'TH1', name: 'Thai Fund', kind: 'fund', accountId: 'inv-TH1', ticker: 'TH1', categoryId: 'Funds' };
    const buy: TradeRecord = { id: 'b-TH1', assetId: 'TH1', kind: 'buy', date: '2026-01-15', createdAt: '2026-01-15T03:00:00.000Z', units: '100000000', amount: 1_000, fee: 0, withholding: 0, memo: '' };
    expect(run(data({ assets: [...assets, thb], trades: [...trades, buy] }), opts()).result).toMatchObject({ ok: false, reason: 'bahtAssetInCategory' });
    const sell: TradeRecord = { id: 's-TH1', assetId: 'TH1', kind: 'sell', date: '2026-02-15', createdAt: '2026-02-15T03:00:00.000Z', units: '100000000', priceMicro: 10_000_000, amount: 0, fee: 0, withholding: 0, memo: '' };
    expect(run(data({ assets: [...assets, thb], trades: [...trades, buy, sell] }), opts()).result.ok).toBe(true);
  });
  it('ไม่มีราคา → needsPrice', () => {
    expect(run(data({ prices: prices.filter((p) => p.assetId !== 'DDD') }), opts()).result).toMatchObject({ ok: false, reason: 'needsPrice' });
  });
  it('ทุกเหตุของโดเมนมีข้อความ ไม่เดา', () => {
    for (const k of ['invalidAmount', 'invalidOption', 'invalidHolding', 'noTargets', 'targetsNotComplete', 'holdingWithoutCategory', 'bahtAssetInCategory', 'needsPrice', 'nothingToDo', 'withdrawExceedsValue'] as const) {
      expect(REBALANCE_REASON_TEXT[k].length).toBeGreaterThan(10);
    }
  });
});

describe('รูปตัวเลข', () => {
  it('formatShares: เศษหุ้น 3 ทศนิยมตายตัว · ไม่มีเศษ = จำนวนเต็ม', () => {
    expect(formatShares(218_700_000n, true)).toBe('2.187');
    expect(formatShares(875_000_000n, true)).toBe('8.750');
    expect(formatShares(100_000n, true)).toBe('0.001');
    expect(formatShares(0n, true)).toBe('0.000');
    expect(formatShares(800_000_000n, false)).toBe('8');
    expect(formatShares(123_456_700_000_000n, true)).toBe('1234567.000');
  });
  it('bpsText', () => {
    expect(bpsText(4_500)).toBe('45');
    expect(bpsText(750)).toBe('7.5');
    expect(bpsText(1_234)).toBe('12.34');
    expect(bpsText(0)).toBe('0');
    expect(bpsText(5)).toBe('0.05');
  });
  it('ค่าตั้งที่เก็บไว้: เสีย/ชนิดผิด = ค่าเริ่มต้น', () => {
    expect(parseStoredSettings(null)).toEqual({ allowSales: false, fractional: true, minOrder: '' });
    expect(parseStoredSettings('{bad')).toEqual({ allowSales: false, fractional: true, minOrder: '' });
    expect(parseStoredSettings('{"allowSales":true,"fractional":false,"minOrder":"5"}')).toEqual({ allowSales: true, fractional: false, minOrder: '5' });
    expect(parseStoredSettings('{"allowSales":"yes","fractional":1,"minOrder":9}')).toEqual({ allowSales: false, fractional: true, minOrder: '' });
  });
});

describe('ส่งออก CSV', () => {
  it('มีข้อความบังคับท้ายไฟล์ · หุ้นตรงกับที่คิด · ไม่มีคำต้องห้าม', () => {
    const { input, result } = run(data(), opts());
    if (!result.ok) throw new Error('x');
    const view = buildRebalanceView(result, { assets, categoryName: (id) => id, fractional: input.fractional });
    const csv = buildRebalanceCsv(view, { amountCents: 35_000, allowSales: false, fractional: true, minOrderCents: 0 });
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('Buy,CCC,CCC Corp,Health,2.187,60.00,2026-11-20,131.22');
    expect(csv).toContain('Buy,DDD,DDD Corp,Funds,8.750,25.00,2026-11-20,218.75');
    expect(csv).toContain('Left over (USD),0.03');
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[lines.length - 1]).toContain(REBALANCE_DISCLAIMER.replace(/"/g, '""'));
    expect(csv.replace(REBALANCE_DISCLAIMER, '')).not.toMatch(/recommend|advice|advis|คำแนะนำ|ควร/i);
  });
  it('กัน formula injection ในชื่อหุ้น', () => {
    const evil: Asset[] = assets.map((a) => (a.id === 'CCC' ? { ...a, name: '=HYPERLINK("x")', ticker: '@bad' } : a));
    const { input, result } = run(data({ assets: evil }), opts());
    if (!result.ok) throw new Error('x');
    const view = buildRebalanceView(result, { assets: evil, categoryName: (id) => id, fractional: input.fractional });
    const csv = buildRebalanceCsv(view, { amountCents: 35_000, allowSales: false, fractional: true, minOrderCents: 0 });
    expect(csv).toContain("'@bad");
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('ข้อความบังคับ', () => {
  it('ตรงกับ docs/money-rules.md R29 ตัวอักษรต่อตัวอักษร', async () => {
    const rules = (await import('../../docs/money-rules.md?raw')).default as string;
    expect(rules).toContain(REBALANCE_DISCLAIMER);
  });
});
