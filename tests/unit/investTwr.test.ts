import { describe, expect, it } from 'vitest';
import { computeMonthlyReturns } from '../../src/domain/invest/metrics';
import { activeMonths, compoundBps, computeMonthlyReturnsUsd } from '../../src/domain/invest/twr';
import type { Asset, InvestmentData, TradeRecord } from '../../src/domain/invest/types';

// ข้อมูลสมมติทั้งหมด (ห้ามข้อมูลจริง)
const asset = (id: string): Asset => ({ id, name: `Demo ${id}`, kind: 'stock', accountId: `inv-${id}`, currency: 'USD', ticker: id.toUpperCase(), exchange: 'NASDAQ' });
let seq = 0;
const trade = (over: Partial<TradeRecord>): TradeRecord => ({
  id: `t${++seq}`, assetId: 'us1', kind: 'buy', date: '2026-01-10', createdAt: `${over.date ?? '2026-01-10'}T03:00:00.000Z`,
  units: '1000000000', priceMicro: 100_000_000, amount: 100_000, fee: 0, withholding: 0, memo: '', fxRateMicro: 35_000_000, ...over,
});
const data = (over: Partial<InvestmentData> = {}): InvestmentData => ({ assets: [asset('us1')], trades: [], prices: [], fxRates: [], ...over });

describe('R27 compoundBps: ต่อทบผลตอบแทนรายเดือน (ตัวอย่างมือในกฎ)', () => {
  it('+1,069 กับ +1,000 → +2,176', () => expect(compoundBps([1069, 1000])).toBe(2176));
  it('-500 กับ -1,000 → -1,450', () => expect(compoundBps([-500, -1000])).toBe(-1450));
  it('+50 กับ +50 → +100 (10,100.25 ปัดลง)', () => expect(compoundBps([50, 50])).toBe(100));
  it('-3 กับ -3 → -6 (9,994.0009 ปัดเป็น 9,994)', () => expect(compoundBps([-3, -3])).toBe(-6));
  it('เดือนเดียว = ค่าเดือนนั้นตรงๆ', () => {
    expect(compoundBps([1234])).toBe(1234);
    expect(compoundBps([-777])).toBe(-777);
    expect(compoundBps([0])).toBe(0);
  });
  it('มี null → null (ไม่ข้ามเดือนแล้วคิดต่อ) · ไม่มีเดือน → null', () => {
    expect(compoundBps([100, null, 200])).toBeNull();
    expect(compoundBps([null])).toBeNull();
    expect(compoundBps([])).toBeNull();
  });
  it('ผลคูณเป็น 0 (-10,000) → -10,000 · ต่ำกว่า -10,000 ปฏิเสธ', () => {
    expect(compoundBps([-10_000, 500])).toBe(-10_000);
    expect(() => compoundBps([-10_001, 100])).toThrow(RangeError);
    expect(() => compoundBps([1.5])).toThrow(RangeError);
  });
  it('เศษปัดครั้งเดียวตอนท้าย ออกจากศูนย์ ทั้งบวกและลบ', () => {
    // 10,010 x 10,005 = 100,150,050 → 10,015.005 → 10,015
    expect(compoundBps([10, 5])).toBe(15);
    // 9,950 x 9,950 = 99,002,500 → 9,900.25 → 9,900
    expect(compoundBps([-50, -50])).toBe(-100);
    // 3 เดือน: 10,100^3 = 1,030,301,000,000 ÷ 10^8 = 10,303.01 → 303
    expect(compoundBps([100, 100, 100])).toBe(303);
    // 10,050 x 10,150 = 102,007,500 → 10,200.75 → 10,201
    expect(compoundBps([50, 150])).toBe(201);
    // 9,950 x 9,850 = 98,007,500 → 9,800.75 → 9,801 → -199
    expect(compoundBps([-50, -150])).toBe(-199);
    // เศษ .5 พอดี: 10,001 x 10,005 = 100,060,005 → 10,006.0005 (ไม่ใช่ .5) · ใช้ 3 เดือน 10,000 x 10,000 x 10,005 → ตรง
    // 10,010 x 10,010 x 9,990 = 1,000,999,... ตรวจเฉพาะว่าไม่ตัดเศษทิ้ง: 10,001 x 10,001 = 100,020,001 → 10,002.0001 → 2
    expect(compoundBps([1, 1])).toBe(2);
  });
});

// ───── ตัวอย่างมือ Modified Dietz แบบเซนต์ ─────
//  ม.ค.: ซื้อ 10 หุ้น $1,000.00 + ค่าธรรมเนียม $1.00 วันที่ 10 · ปลายเดือนราคา $110
//        ตัวเศษ 110,000 - 0 - 100,100 = 9,900 · ตัวหาร 0x31 + 100,100x(31-10) = 2,102,100 · bps = 9,900x10,000x31 / 2,102,100 = 1,459.97 → 1,460
//  ก.พ.: ขาย 4 หุ้น @ $120 ค่าธรรมเนียม $1.00 วันที่ 10 (สุทธิ 47,900) · ปันผล $50.00 ภาษี $7.50 วันที่ 12 · ปลายเดือนราคา $125
//        ตัวเศษ 75,000 - 110,000 + 47,900 + 4,250 = 17,150 · ตัวหาร 110,000x28 - 47,900x(28-10) = 2,217,800 · bps = 17,150x10,000x28 / 2,217,800 = 2,165.2 → 2,165
const MAIN = data({
  trades: [
    trade({ id: 'b1', kind: 'buy', date: '2026-01-10', fxRateMicro: 35_000_000, amount: 100_000, fee: 100 }),
    trade({ id: 's1', kind: 'sell', date: '2026-02-10', units: '400000000', priceMicro: 120_000_000, amount: undefined, fee: 100, fxRateMicro: 33_000_000 }),
    trade({ id: 'd1', kind: 'dividend', date: '2026-02-12', units: undefined, priceMicro: undefined, amount: 5_000, fee: 0, withholding: 750, fxRateMicro: 34_567_891 }),
  ],
  prices: [
    { assetId: 'us1', date: '2026-01-31', priceMicro: 110_000_000 },
    { assetId: 'us1', date: '2026-02-28', priceMicro: 125_000_000 },
  ],
  fxRates: [
    { accountId: 'usd-cash', date: '2026-01-31', rateMicro: 34_000_000 },
    { accountId: 'usd-cash', date: '2026-02-28', rateMicro: 34_000_000 },
  ],
});

describe('computeMonthlyReturnsUsd: Modified Dietz แบบเซนต์ (R25.4 · มุมมอง USD)', () => {
  it('ตัวอย่างมือ: ม.ค. 1,460 · ก.พ. 2,165 · ทั้งปีต่อทบ = compoundBps (+3,941)', () => {
    const r = computeMonthlyReturnsUsd(MAIN, '2026-02-28');
    expect(r.months).toEqual([
      { month: '2026-01', bps: 1460 },
      { month: '2026-02', bps: 2165 },
    ]);
    expect(compoundBps([1460, 2165])).toBe(3941); // 11,460 x 12,165 / 10,000 = 13,941.09
    expect(r.years).toEqual({ '2026': 3941 });
  });
  it('ผลต่างจากมุมมองบาทได้ (ค่าเงิน): ม.ค. บาท 996 bps ส่วน USD 1,460 bps', () => {
    const thb = computeMonthlyReturns(MAIN, '2026-02-28');
    expect(thb.months[0]).toEqual({ month: '2026-01', bps: 996 });
    expect(computeMonthlyReturnsUsd(MAIN, '2026-02-28').months[0]!.bps).not.toBe(996);
  });
  it('USD ไม่ต้องใช้อัตรา: ไม่มี fxRates เลยก็ยังคำนวณได้ (บาทเป็น null)', () => {
    const noFx = { ...MAIN, fxRates: [] };
    expect(computeMonthlyReturnsUsd(noFx, '2026-02-28').months.map((m) => m.bps)).toEqual([1460, 2165]);
    expect(computeMonthlyReturns(noFx, '2026-02-28').months.map((m) => m.bps)).toEqual([null, null]);
  });
  it('ขาดราคาของหุ้นที่ถืออยู่ = null (missing) ไม่นับเป็น 0 · ทั้งปีเป็น null', () => {
    const noPrice = { ...MAIN, prices: [{ assetId: 'us1', date: '2026-02-28', priceMicro: 125_000_000 }] };
    const r = computeMonthlyReturnsUsd(noPrice, '2026-02-28');
    expect(r.months).toEqual([
      { month: '2026-01', bps: null, na: 'missing' },
      { month: '2026-02', bps: null, na: 'missing' }, // ต้นเดือน ก.พ. ต้องใช้มูลค่าสิ้น ม.ค.
    ]);
    expect(r.years['2026']).toBeNull();
  });
  it('ซื้อวันสุดท้ายของเดือน (ไม่มีมูลค่าต้นเดือนและน้ำหนักเป็น 0) → null (zero-base) ไม่หารศูนย์', () => {
    const d = data({ trades: [trade({ id: 'b9', date: '2026-01-31' })], prices: [{ assetId: 'us1', date: '2026-01-31', priceMicro: 100_000_000 }] });
    expect(computeMonthlyReturnsUsd(d, '2026-01-31').months).toEqual([{ month: '2026-01', bps: null, na: 'zero-base' }]);
  });
  it('ไม่มีรายการ = ไม่มีเดือน · ขาดทุนเป็นค่าติดลบ', () => {
    expect(computeMonthlyReturnsUsd(data(), '2026-02-28')).toEqual({ months: [], years: {} });
    const loss = data({ trades: [trade({ id: 'b1', fee: 0 })], prices: [{ assetId: 'us1', date: '2026-01-31', priceMicro: 90_000_000 }] });
    // ตัวเศษ 90,000 - 100,000 = -10,000 · ตัวหาร 100,000x21 = 2,100,000 · bps = -10,000x10,000x31 / 2,100,000 = -1,476.19 → -1,476
    expect(computeMonthlyReturnsUsd(loss, '2026-01-31').months[0]).toEqual({ month: '2026-01', bps: -1476 });
  });
});

describe('activeMonths: เดือนที่มีหุ้นหรือมีรายการ ตรงกับ computeMonthlyReturns', () => {
  it('ข้ามเดือนที่ไม่มีหุ้นและไม่มีรายการ (ขายหมดแล้วเงียบ 2 เดือน แล้วซื้อใหม่)', () => {
    const d = data({
      trades: [
        trade({ id: 'b1', date: '2026-01-10', fee: 0 }),
        trade({ id: 's1', kind: 'sell', date: '2026-02-10', units: '1000000000', priceMicro: 100_000_000, amount: undefined, fee: 0 }),
        trade({ id: 'b2', date: '2026-05-05', fee: 0 }),
      ],
      prices: [{ assetId: 'us1', date: '2026-05-31', priceMicro: 100_000_000 }],
    });
    const keys = activeMonths(d, '2026-05-31').map((m) => m.key);
    expect(keys).toEqual(['2026-01', '2026-02', '2026-05']);
    expect(computeMonthlyReturns(d, '2026-05-31').months.map((m) => m.month)).toEqual(keys);
    expect(computeMonthlyReturnsUsd(d, '2026-05-31').months.map((m) => m.month)).toEqual(keys);
  });
  it('เดือนของ asOf ใช้ asOf เป็นวันสิ้นสุด', () => {
    const m = activeMonths(MAIN, '2026-02-15');
    expect(m[m.length - 1]).toMatchObject({ key: '2026-02', end: '2026-02-15', prevEnd: '2026-01-31', start: '2026-02-01' });
  });
});

describe('R27/R25.4 ขอบเขตการปัด: ตกกึ่งกลาง .5 พอดี ปัดออกจากศูนย์', () => {
  it('compoundBps [50,100] = 10,150.5 → +151 · [-50,-100] = −149.5 → ปัดครึ่งออกจากศูนย์ = −150 (สมมาตรกับบวก · เจ้าของสั่ง 18 พ.ย. 2569)', () => {
    expect(compoundBps([50, 100])).toBe(151);
    expect(compoundBps([-50, -100])).toBe(-150);
  });
  it('compoundBps ผลเป็นศูนย์ไม่ใช่ -0', () => {
    expect(Object.is(compoundBps([0]), 0)).toBe(true);
    expect(Object.is(compoundBps([0, 0]), 0)).toBe(true);
  });
  // ซื้อ 1 หน่วย 100.00 USD วันที่ 29 (เหลือ 2 วันจาก 31) → ตัวหาร = 10,000×2 · ส่วนต่าง 1 เซนต์ → 31×1/2 = 15.5 bps
  const tie = (priceAtEnd: number) => data({
    trades: [trade({ id: 'tie', date: '2026-01-29', units: '100000000', priceMicro: 100_000_000, amount: 10_000 })],
    prices: [{ assetId: 'us1', date: '2026-01-31', priceMicro: priceAtEnd }],
  });
  it('Dietz USD กำไร 1 เซนต์ = 15.5 bps → +16', () => {
    expect(computeMonthlyReturnsUsd(tie(100_010_000), '2026-01-31').months[0]!.bps).toBe(16);
  });
  it('Dietz USD ขาดทุน 1 เซนต์ = −15.5 bps → −16 (ปัดออกจากศูนย์)', () => {
    expect(computeMonthlyReturnsUsd(tie(99_990_000), '2026-01-31').months[0]!.bps).toBe(-16);
  });
});

describe('computeMonthlyReturnsUsd: รายการไม่มีอัตรา → needs-rate (R26)', () => {
  const d0 = data({ trades: [trade({ id: 'a', date: '2026-01-10' })], prices: [{ assetId: 'us1', date: '2026-01-31', priceMicro: 110_000_000 }, { assetId: 'us1', date: '2026-02-28', priceMicro: 120_000_000 }] });
  it('ครบเรต → ผลเดิม (ไม่มี na)', () => {
    const r = computeMonthlyReturnsUsd(d0, '2026-02-28');
    expect(r.months.map((m) => m.na)).toEqual([undefined, undefined]);
    expect(r.months.every((m) => m.bps !== null)).toBe(true);
  });
  it('ปันผลไม่มีเรตเดือนก.พ. → ก.พ. needs-rate · ม.ค. เท่าเดิม · ทั้งปี null', () => {
    const div = trade({ id: 'dv', kind: 'dividend', date: '2026-02-12', units: undefined, priceMicro: undefined, amount: 500, fxRateMicro: undefined });
    const r = computeMonthlyReturnsUsd({ ...d0, trades: [...d0.trades, div] }, '2026-02-28');
    expect(r.months[0]).toEqual(computeMonthlyReturnsUsd(d0, '2026-02-28').months[0]);
    expect(r.months[1]).toEqual({ month: '2026-02', bps: null, na: 'needs-rate' });
    expect(r.years['2026']).toBeNull();
  });
  it('ซื้อไม่มีเรตเดือนม.ค. → ทุกเดือนตั้งแต่ม.ค. needs-rate (เดือนของรายการนับเป็นเดือนที่มีกิจกรรม แม้เป็นรายการแรก)', () => {
    const noRate = data({ trades: [trade({ id: 'x', date: '2026-01-10', fxRateMicro: undefined })], prices: d0.prices });
    const r = computeMonthlyReturnsUsd(noRate, '2026-02-28');
    expect(r.months.map((m) => [m.month, m.na])).toEqual([['2026-01', 'needs-rate'], ['2026-02', 'needs-rate']]);
  });
});
