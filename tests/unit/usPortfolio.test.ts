import { describe, expect, it } from 'vitest';
import { buildUsPortfolio } from '../../src/app/usPortfolio';
import type { Asset, InvestmentData, TradeRecord } from '../../src/domain/invest/types';
import type { Account, Entry } from '../../src/domain/ledger/types';

// ข้อมูลสมมติ (ไม่ใช่ข้อมูลจริง) ค่าที่คาดคำนวณมือไว้แล้ว:
//  ซื้อ 10 หุ้น $1,000.00 + ค่าธรรมเนียม $1.00 ที่ 35.000000 → ต้นทุน 100,100 เซนต์ / 3,503,500 สตางค์
//  ขาย 4 หุ้น @ $120.00 ค่าธรรมเนียม $1.00 ที่ 33.000000 → ตัดต้นทุน 40,040 เซนต์ / 1,401,400 สตางค์ · รับสุทธิ 47,900 เซนต์ = 1,580,700 สตางค์ · กำไรบาท 179,300 (ส่วนราคา 259,380 ส่วนค่าเงิน −80,080)
//  เหลือ 6 หุ้น ต้นทุน 60,060 เซนต์ / 2,102,100 สตางค์ (เฉลี่ย $100.10)
//  ปันผล $50.00 หัก $7.50 ที่ 34.567891 → สุทธิ 4,250 เซนต์ / 146,913 สตางค์ (รวม 172,839 − ภาษี 25,926)
//  ราคาล่าสุด $125.00 · อัตราล่าสุด 34.000000 → มูลค่า 75,000 เซนต์ = 2,550,000 สตางค์ · กำไรยังไม่ขาย 447,900 (ส่วนราคา 507,960 ส่วนค่าเงิน −60,060)
const asset: Asset = { id: 'us1', name: 'ABC Corp', kind: 'stock', accountId: 'inv-us', currency: 'USD', ticker: 'ABC', exchange: 'NASDAQ' };
const trade = (over: Partial<TradeRecord>): TradeRecord => ({
  id: 'b1', assetId: 'us1', kind: 'buy', date: '2026-11-03', createdAt: '2026-11-03T03:00:00.000Z', units: '1000000000', priceMicro: 100_000_000, amount: 100_000, fee: 100, withholding: 0, memo: '', fxRateMicro: 35_000_000, ...over,
});
const trades: TradeRecord[] = [
  trade({}),
  trade({ id: 's1', kind: 'sell', date: '2026-11-10', createdAt: '2026-11-10T03:00:00.000Z', units: '400000000', priceMicro: 120_000_000, amount: undefined, fee: 100, fxRateMicro: 33_000_000 }),
  trade({ id: 'd1', kind: 'dividend', date: '2026-11-12', createdAt: '2026-11-12T03:00:00.000Z', units: undefined, priceMicro: undefined, amount: 5_000, fee: 0, withholding: 750, fxRateMicro: 34_567_891 }),
];
const data = (over: Partial<InvestmentData> = {}): InvestmentData => ({
  assets: [asset],
  trades,
  prices: [{ assetId: 'us1', date: '2026-11-12', priceMicro: 125_000_000 }],
  fxRates: [{ accountId: 'usd-cash', date: '2026-11-12', rateMicro: 34_000_000 }],
  fxExchanges: [{ id: 'fx1', date: '2026-11-02', createdAt: '2026-11-02T03:00:00.000Z', direction: 'thb_to_usd', thbSatang: 7_000_000, usdCents: 200_000, rateMicro: 35_000_000, memo: '', entryId: 'fx1-e' }],
  ...over,
});
const accounts: Account[] = [
  { id: 'w1', type: 'asset', name: 'กระเป๋า', currency: 'THB' },
  { id: 'usd-cash', type: 'asset', name: 'เงินสด USD', currency: 'USD', kind: 'investment' },
  { id: 'inv-us', type: 'asset', name: 'ABC Corp', currency: 'USD', kind: 'investment' },
];
const entry = (id: string, date: string, lines: [string, number][]): Entry => ({ id, date, memo: '', source: 'manual', createdAt: `${date}T00:00:00.000Z`, lines: lines.map(([accountId, amount]) => ({ accountId, amount })) });
const entries: Entry[] = [
  entry('fx1-e', '2026-11-02', [['usd-cash', 200_000]]),
  entry('b1-e', '2026-11-03', [['inv-us', 100_100], ['usd-cash', -100_100]]),
  entry('s1-e', '2026-11-10', [['usd-cash', 47_900], ['inv-us', -40_040]]),
  entry('d1-e', '2026-11-12', [['usd-cash', 4_250]]),
];
const TODAY = '2026-11-13';

describe('buildUsPortfolio (A3-2)', () => {
  const p = buildUsPortfolio(accounts, entries, data(), TODAY);
  const row = p.rows[0]!;

  it('แถวหุ้น: หน่วย ต้นทุน 2 ถัง ต้นทุนเฉลี่ยต่อหุ้น ตรงค่าที่คำนวณมือ', () => {
    expect(p.rows).toHaveLength(1);
    expect([row.ticker, row.exchange, row.name]).toEqual(['ABC', 'NASDAQ', 'ABC Corp']);
    expect(row.units).toBe(600_000_000n);
    expect([row.costUsd, row.costThb]).toEqual([60_060, 2_102_100]);
    expect(row.avgCostMicro).toBe(100_100_000);
  });

  it('มูลค่า กำไรยังไม่ขาย และการแยก "มาจากราคาหุ้น/ค่าเงิน" รวมกันตรงเป๊ะ', () => {
    expect([row.valueUsd, row.valueThb]).toEqual([75_000, 2_550_000]);
    expect(row.unrealizedThb).toBe(447_900);
    expect(row.priceGainThb).toBe(507_960);
    expect(row.fxGainThb).toBe(-60_060);
    expect(row.priceGainThb! + row.fxGainThb!).toBe(row.unrealizedThb);
  });

  it('กำไรที่ขายแล้ว และปันผลสะสมสุทธิ (เซนต์/สตางค์)', () => {
    expect(row.realizedGainThb).toBe(179_300);
    expect([row.dividendNetUsd, row.dividendNetThb]).toEqual([4_250, 146_913]);
    expect(p.dividends).toEqual([{ id: 'd1', date: '2026-11-12', assetName: 'ABC Corp', ticker: 'ABC', grossUsd: 5_000, whtUsd: 750, netUsd: 4_250, netThb: 146_913 }]);
  });

  it('ตัวรวมครบ: complete = true · ต้นทุนบาท · กำไรยังไม่ขาย · สัดส่วน 10,000 bps', () => {
    expect(p.totals).toEqual({ valueUsd: 75_000, valueThb: 2_550_000, costThb: 2_102_100, unrealizedThb: 447_900, priceGainThb: 507_960, fxGainThb: -60_060, dividendNetThb: 146_913, realizedGainThb: 179_300, complete: true });
    expect(p.allocation).toEqual([{ key: 'us1', bps: 10_000 }]);
  });

  it('เงินสด USD: ยอดรวมจากสมุด · ไม่ติดลบ · ประวัติแลกเงิน', () => {
    expect(p.cash).toEqual([{ accountId: 'usd-cash', name: 'เงินสด USD', cents: 152_050 }]);
    expect(p.cashUsd).toBe(152_050);
    expect(p.negativeCash).toEqual([]);
    expect(p.exchanges).toEqual([{ id: 'fx1', date: '2026-11-02', direction: 'thb_to_usd', thbSatang: 7_000_000, usdCents: 200_000, rateMicro: 35_000_000, memo: '' }]);
    expect(p.hasUsd).toBe(true);
    expect(p.fx).toEqual({ rateMicro: 34_000_000, date: '2026-11-12', days: 1, stale: false });
  });

  it('ไม่มีราคา: ไม่เดา ไม่ใช้ต้นทุนแทน · ตัวรวมไม่ครบ', () => {
    const q = buildUsPortfolio(accounts, entries, data({ prices: [] }), TODAY);
    expect(q.rows[0]).toMatchObject({ valueUsd: null, valueThb: null, unrealizedThb: null, priceGainThb: null, fxGainThb: null, price: null });
    expect(q.totals).toMatchObject({ valueUsd: 0, valueThb: 0, unrealizedThb: 0, complete: false });
    expect(q.totals.costThb).toBe(2_102_100);
    expect(q.allocation).toEqual([]);
  });

  it('ไม่มีอัตราแลกเปลี่ยน: ได้มูลค่า USD แต่บาท/กำไรเป็น null และไม่ครบ', () => {
    const q = buildUsPortfolio(accounts, entries, data({ fxRates: [] }), TODAY);
    expect(q.fx).toBeNull();
    expect(q.rows[0]).toMatchObject({ valueUsd: 75_000, valueThb: null, unrealizedThb: null });
    expect(q.totals.complete).toBe(false);
  });

  it('ราคา/อัตราเก่าเกิน 30 วันติดป้ายเก่า แต่ยังคำนวณ', () => {
    const q = buildUsPortfolio(accounts, entries, data(), '2026-12-20');
    expect(q.rows[0]!.price).toMatchObject({ days: 38, stale: true });
    expect(q.fx).toMatchObject({ days: 38, stale: true });
    expect(q.rows[0]!.valueThb).toBe(2_550_000);
  });

  it('ใช้ข้อมูลถึงวันนี้เท่านั้น: รายการและราคาในอนาคตไม่นับ', () => {
    const q = buildUsPortfolio(accounts, entries, data(), '2026-11-04');
    expect(q.rows[0]!.units).toBe(1_000_000_000n);
    expect(q.rows[0]!.price).toBeNull();
    expect(q.cashUsd).toBe(99_900);
    expect(q.dividends).toEqual([]);
  });

  it('เงินสด USD ติดลบ (ลบรายการแลกเงินหลังซื้อหุ้น): ตรวจพบและรายงานรายบัญชี', () => {
    const q = buildUsPortfolio(accounts, entries.filter((e) => e.id !== 'fx1-e'), data({ fxExchanges: [] }), TODAY);
    expect(q.cashUsd).toBe(-47_950);
    expect(q.negativeCash).toEqual([{ accountId: 'usd-cash', name: 'เงินสด USD', cents: -47_950 }]);
  });

  it('ไม่มีข้อมูล USD เลย: hasUsd = false ตัวเลขเป็นศูนย์ ไม่ throw', () => {
    const q = buildUsPortfolio([{ id: 'w1', type: 'asset', name: 'กระเป๋า', currency: 'THB' }], [], { assets: [], trades: [], prices: [] }, TODAY);
    expect(q.hasUsd).toBe(false);
    expect(q.rows).toEqual([]);
    expect(q.totals.complete).toBe(true);
    expect(q.cashUsd).toBe(0);
  });

  it('ขายหมดแล้ว: ไม่มีหน่วย → ไม่ต้องมีราคา ไม่นับเป็นไม่ครบ · แต่กำไรที่ขายแล้วยังอยู่', () => {
    const all = [trade({}), trade({ id: 's2', kind: 'sell', date: '2026-11-10', createdAt: '2026-11-10T03:00:00.000Z', units: '1000000000', priceMicro: 110_000_000, amount: undefined, fee: 0, fxRateMicro: 34_000_000 })];
    const q = buildUsPortfolio(accounts, entries, data({ trades: all, prices: [], fxRates: [] }), TODAY);
    expect(q.rows[0]!.units).toBe(0n);
    expect(q.totals.complete).toBe(true);
    expect(q.rows[0]!.realizedGainThb).toBe(110_000 * 34 - 3_503_500);
  });

  it('สัดส่วนตามหุ้น: สองหุ้นรวมเป็น 10,000 bps', () => {
    const asset2: Asset = { id: 'us2', name: 'XYZ Inc', kind: 'stock', accountId: 'inv-xyz', currency: 'USD', ticker: 'XYZ', exchange: 'NYSE' };
    const t2 = trade({ id: 'b2', assetId: 'us2', units: '100000000', priceMicro: 50_000_000, amount: 5_000, fee: 0 });
    const q = buildUsPortfolio(accounts, entries, data({ assets: [asset, asset2], trades: [...trades, t2], prices: [{ assetId: 'us1', date: '2026-11-12', priceMicro: 125_000_000 }, { assetId: 'us2', date: '2026-11-12', priceMicro: 50_000_000 }] }), TODAY);
    expect(q.allocation.reduce((n, s) => n + s.bps, 0)).toBe(10_000);
    expect(q.allocation.map((s) => s.key)).toEqual(['us1', 'us2']);
  });
});

describe('buildUsPortfolio: ขอบเขตตัวเลข (R14) และกติกาอัตราล่าสุด', () => {
  const one = (over: Partial<InvestmentData>) => buildUsPortfolio(accounts, entries, data(over), TODAY);

  it('อัตราวันเดียวกันหลายบัญชี USD: รหัสบัญชีมากสุดชนะ เหมือนการ์ดความมั่งคั่งรวม (ตัวเลขตรงกันทุกหน้า)', () => {
    const rates = [
      { accountId: 'usd-b', date: '2026-11-12', rateMicro: 36_000_000 },
      { accountId: 'usd-a', date: '2026-11-12', rateMicro: 35_000_000 },
      { accountId: 'usd-a', date: '2026-11-05', rateMicro: 99_000_000 },
    ];
    const q = one({ fxRates: rates });
    expect(q.fx).toMatchObject({ rateMicro: 36_000_000, date: '2026-11-12' });
    expect(q.rows[0]!.valueThb).toBe(75_000 * 36);
    // สลับลำดับในอาร์เรย์ ผลต้องเท่าเดิม
    expect(one({ fxRates: [...rates].reverse() }).fx).toMatchObject({ rateMicro: 36_000_000 });
  });

  it('ตัวเลขใหญ่เกินช่วงปลอดภัย: แถวนั้นคำนวณไม่ได้ (error + ไม่ครบ) ไม่ทำให้ทั้งหน้าล้ม', () => {
    // 1,000 หุ้น x ราคา $9,007,199,254 ต่อหุ้น = 9 x 10^14 เซนต์ · x อัตรา 40 = 3.6 x 10^16 สตางค์ เกินช่วงปลอดภัย
    const t = [trade({ id: 'big', units: '100000000000', amount: 100_000, fee: 0 })];
    const big = one({ trades: t, prices: [{ assetId: 'us1', date: '2026-11-12', priceMicro: Number.MAX_SAFE_INTEGER }], fxRates: [{ accountId: 'usd-cash', date: '2026-11-12', rateMicro: 40_000_000 }] });
    expect(big.rows[0]).toMatchObject({ valueUsd: null, valueThb: null, unrealizedThb: null, priceGainThb: null, fxGainThb: null });
    expect(big.rows[0]!.error).toContain('เกินช่วง');
    expect(big.totals.complete).toBe(false);
    expect(big.rows[0]!.units).toBe(100_000_000_000n); // หน่วยและต้นทุนยังถูกต้อง
  });

  it('ขาดทุนราคา 1 เซนต์ที่อัตราต่ำมาก (ปัดเป็น 0 สตางค์): ส่วนราคาเป็น 0 ไม่ใช่ -0', () => {
    // ซื้อ 1 หุ้น $100.00 ที่ 35 · ราคาตอนนี้ $99.99 (ขาดทุน 1 เซนต์) · อัตราตอนนี้ 0.4 บาท/USD → 1 เซนต์ x 0.4 = 0.4 สตางค์ ปัดเป็น 0
    const t = [trade({ id: 'one', units: '100000000', amount: 10_000, fee: 0 })];
    const q = one({ trades: t, prices: [{ assetId: 'us1', date: '2026-11-12', priceMicro: 99_990_000 }], fxRates: [{ accountId: 'usd-cash', date: '2026-11-12', rateMicro: 400_000 }] });
    expect(Object.is(q.rows[0]!.priceGainThb, -0)).toBe(false);
    expect(q.rows[0]!.priceGainThb).toBe(0);
    expect(q.rows[0]!.priceGainThb! + q.rows[0]!.fxGainThb!).toBe(q.rows[0]!.unrealizedThb);
  });

  it('มูลค่าบาทที่ลงที่ .5 สตางค์พอดีปัดครึ่งขึ้นครั้งเดียว · มูลค่าเล็กจนเป็น 0 สตางค์ไม่ crash', () => {
    // 1 หุ้น ราคา $0.01 = 1 เซนต์ ที่อัตรา 0.5 บาท/USD → 0.5 สตางค์ → ปัดเป็น 1
    const t = [trade({ id: 'half', units: '100000000', amount: 10, fee: 0 })];
    const half = one({ trades: t, prices: [{ assetId: 'us1', date: '2026-11-12', priceMicro: 10_000 }], fxRates: [{ accountId: 'usd-cash', date: '2026-11-12', rateMicro: 500_000 }] });
    expect(half.rows[0]).toMatchObject({ valueUsd: 1, valueThb: 1 });
    const tiny = one({ trades: t, prices: [{ assetId: 'us1', date: '2026-11-12', priceMicro: 1 }], fxRates: [{ accountId: 'usd-cash', date: '2026-11-12', rateMicro: 35_000_000 }] });
    expect(tiny.rows[0]).toMatchObject({ valueUsd: 0, valueThb: 0 });
  });

  it('ปันผลสุทธิ 1 เซนต์ (W = D − 1): ได้ net 1 เซนต์ และบาทไม่ติดลบ', () => {
    const t = [...trades, trade({ id: 'd2', kind: 'dividend', date: '2026-11-11', createdAt: '2026-11-11T03:00:00.000Z', units: undefined, priceMicro: undefined, amount: 100, fee: 0, withholding: 99, fxRateMicro: 35_000_000 })];
    const q = one({ trades: t });
    const d2 = q.dividends.find((d) => d.id === 'd2')!;
    expect([d2.grossUsd, d2.whtUsd, d2.netUsd]).toEqual([100, 99, 1]);
    expect(d2.netThb).toBe(3_500 - 3_465);
  });
});
