import { describe, expect, it } from 'vitest';
import { buildReport, periodStartKey, type ReportColumn } from '../../src/domain/invest/reportSeries';
import type { Asset, InvestmentData, TradeRecord } from '../../src/domain/invest/types';

// ข้อมูลสมมติทั้งหมด (ห้ามข้อมูลจริง) · ตัวอย่างเดียวกับ tests/unit/investTwr.test.ts (ซื้อ ม.ค. · ขาย+ปันผล ก.พ.)
const asset = (id: string): Asset => ({ id, name: `Demo ${id}`, kind: 'stock', accountId: `inv-${id}`, currency: 'USD', ticker: id.toUpperCase(), exchange: 'NASDAQ' });
let seq = 0;
const trade = (over: Partial<TradeRecord>): TradeRecord => ({
  id: `t${++seq}`, assetId: 'us1', kind: 'buy', date: '2026-01-10', createdAt: `${over.date ?? '2026-01-10'}T03:00:00.000Z`,
  units: '1000000000', priceMicro: 100_000_000, amount: 100_000, fee: 0, withholding: 0, memo: '', fxRateMicro: 35_000_000, ...over,
});
const TRADES: TradeRecord[] = [
  trade({ id: 'b1', kind: 'buy', date: '2026-01-10', fxRateMicro: 35_000_000, amount: 100_000, fee: 100 }),
  trade({ id: 's1', kind: 'sell', date: '2026-02-10', units: '400000000', priceMicro: 120_000_000, amount: undefined, fee: 100, fxRateMicro: 33_000_000 }),
  trade({ id: 'd1', kind: 'dividend', date: '2026-02-12', units: undefined, priceMicro: undefined, amount: 5_000, fee: 0, withholding: 750, fxRateMicro: 34_567_891 }),
];
const data = (over: Partial<InvestmentData> = {}): InvestmentData => ({
  assets: [asset('us1')],
  trades: TRADES,
  prices: [
    { assetId: 'us1', date: '2026-01-31', priceMicro: 110_000_000 },
    { assetId: 'us1', date: '2026-02-28', priceMicro: 125_000_000 },
  ],
  fxRates: [
    { accountId: 'usd-cash', date: '2026-01-31', rateMicro: 34_000_000 },
    { accountId: 'usd-cash', date: '2026-02-28', rateMicro: 34_000_000 },
  ],
  ...over,
});
const ASOF = '2026-02-28';
const sources = (c: ReportColumn): number => (c.price ?? NaN) + (c.realized ?? NaN) + (c.dividends ?? NaN) + (c.fx ?? 0) + (c.fees ?? NaN) + (c.taxes ?? NaN);

describe('buildReport มุมมอง USD (เซนต์): ตัวอย่างมือ', () => {
  const t = buildReport(data(), ASOF, 'USD', 'monthly', 'all');
  const [jan, feb] = t.columns;
  it('ม.ค.: ต้นงวด 0 · ปลายงวด 10 x $110 = 110,000 · ซื้อ 100,100 · กำไร 9,900 = ราคา 10,000 + ค่าธรรมเนียม -100 · 1,460 bps', () => {
    expect(jan).toMatchObject({ key: '2026-01', begin: 0, end: 110_000, change: 110_000, profit: 9_900, profitBps: 1460, price: 10_000, realized: 0, dividends: 0, fx: null, fees: -100, taxes: 0, purchases: 100_100, sales: 0, buys: 1, sells: 0, missing: null });
  });
  it('ก.พ.: ต้นงวด 110,000 · ปลายงวด 6 x $125 = 75,000 · ขายสุทธิ 47,900 · กำไร 17,150 · 2,165 bps', () => {
    expect(feb).toMatchObject({ key: '2026-02', begin: 110_000, end: 75_000, change: -35_000, profit: 17_150, profitBps: 2165, price: 5_000, realized: 8_000, dividends: 5_000, fx: null, fees: -100, taxes: -750, purchases: 0, sales: 47_900, buys: 0, sells: 1 });
  });
  it('ผลรวม 5 แหล่ง (USD ไม่มีผลค่าเงิน) = กำไรรวมของเดือนตรงเป๊ะ · กำไรรวมสองเดือน = 27,050 (R24)', () => {
    expect(sources(jan!)).toBe(jan!.profit);
    expect(sources(feb!)).toBe(feb!.profit);
    expect(t.total).toMatchObject({ key: 'total', begin: 0, end: 75_000, change: 75_000, profit: 27_050, fx: null, purchases: 100_100, sales: 47_900, buys: 1, sells: 1 });
  });
  it('Total %: ต่อทบจากรายเดือน (R27) = 11,460 x 12,165 / 10,000 → +3,941 bps', () => {
    expect(t.total!.profitBps).toBe(3941);
  });
  it('ไม่ติดธง incomplete เมื่อข้อมูลครบ', () => {
    expect(t.incomplete).toBe(false);
    expect(t.missing).toEqual([]);
  });
});

describe('buildReport มุมมองบาท: 6 แหล่งรวมกันตรงเป๊ะ (R24 ผลต่างปลายเดือน)', () => {
  const t = buildReport(data(), ASOF, 'THB', 'monthly', 'all');
  const [jan, feb] = t.columns;
  it('ม.ค.: ต้นงวด 0 · ปลายงวด 110,000 x 34.00 = 3,740,000 · กำไร 236,500 = ราคา 340,000 + ค่าเงิน -100,000 + ค่าธรรมเนียม -3,500 · 996 bps', () => {
    expect(jan).toMatchObject({ begin: 0, end: 3_740_000, change: 3_740_000, profit: 236_500, profitBps: 996, price: 340_000, realized: 0, dividends: 0, fx: -100_000, fees: -3_500, taxes: 0, purchases: 3_503_500 });
  });
  it('ก.พ.: กำไร 537,613 = (774,113 ตามตัวอย่าง R24) - 236,500 · แยก ราคา 170,000 · ขายแล้ว 264,000 · ปันผล 172,839 · ค่าเงิน -40,000 · ค่าธรรมเนียม -3,300 · ภาษี -25,926', () => {
    expect(feb).toMatchObject({ profit: 537_613, price: 170_000, realized: 264_000, dividends: 172_839, fx: -40_000, fees: -3_300, taxes: -25_926, sales: 1_580_700, begin: 3_740_000, end: 2_550_000 });
    expect(sources(jan!)).toBe(236_500);
    expect(sources(feb!)).toBe(537_613);
    expect(t.total!.profit).toBe(774_113); // ตรงกับ R24 ตัวอย่างหลัก
    expect(t.total!.fx).toBe(-140_000);
  });
});

describe('ผลรวมแหล่งกำไร = กำไรรวมเดือน แม้สุ่มลำดับรายการ', () => {
  it('สลับลำดับรายการและสร้างหลายตัวหุ้น: ผลเหมือนกันทุกครั้งและรวมตรงทั้งสองสกุล', () => {
    const extra: TradeRecord[] = [
      trade({ id: 'b2', assetId: 'us2', kind: 'buy', date: '2026-02-03', units: '250000000', priceMicro: 80_000_000, amount: 20_000, fee: 55, fxRateMicro: 33_333_333 }),
      trade({ id: 'd2', assetId: 'us2', kind: 'dividend', date: '2026-02-20', units: undefined, priceMicro: undefined, amount: 301, fee: 0, withholding: 45, fxRateMicro: 33_000_001 }),
    ];
    const base = data({
      assets: [asset('us1'), asset('us2')],
      trades: [...TRADES, ...extra],
      prices: [
        { assetId: 'us1', date: '2026-01-31', priceMicro: 110_000_000 },
        { assetId: 'us1', date: '2026-02-28', priceMicro: 125_000_000 },
        { assetId: 'us2', date: '2026-02-28', priceMicro: 83_333_333 },
      ],
    });
    for (const cur of ['USD', 'THB'] as const) {
      const ref = buildReport(base, ASOF, cur, 'monthly', 'all');
      for (const c of ref.columns) expect(sources(c), `${cur} ${c.key}`).toBe(c.profit);
      expect(sources(ref.total!)).toBe(ref.total!.profit);
      // สุ่มลำดับ 6 รอบ (ตัวสร้างเลขสุ่มคงที่ ทำซ้ำได้)
      let s = 7;
      for (let k = 0; k < 6; k += 1) {
        const shuffled = [...base.trades];
        for (let i = shuffled.length - 1; i > 0; i -= 1) {
          s = (s * 1103515245 + 12345) % 2147483648;
          const j = s % (i + 1);
          [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
        }
        expect(buildReport({ ...base, trades: shuffled }, ASOF, cur, 'monthly', 'all')).toEqual(ref);
      }
    }
  });
});

describe('ไม่มีราคา/เรต: incomplete ไม่ใช่ 0', () => {
  it('ไม่มีราคาสิ้น ม.ค.: ม.ค. ปลายงวด/กำไร/% เป็น null และ ก.พ. ต้นงวด/กำไรเป็น null (ติดธง price) · ตัวเลขที่ไม่ต้องใช้ราคายังมี (เงินซื้อ)', () => {
    const t = buildReport(data({ prices: [{ assetId: 'us1', date: '2026-02-28', priceMicro: 125_000_000 }] }), ASOF, 'USD', 'monthly', 'all');
    const [jan, feb] = t.columns;
    expect(jan).toMatchObject({ begin: 0, end: null, change: null, profit: null, profitBps: null, price: null, missing: 'price', purchases: 100_100 });
    expect(feb).toMatchObject({ begin: null, end: 75_000, change: null, profit: null, profitBps: null, missing: 'price', sales: 47_900 });
    expect(t.total).toMatchObject({ begin: 0, end: 75_000, change: 75_000, profit: null, profitBps: null });
    expect(t.incomplete).toBe(true);
    expect(t.missing).toEqual(['price']);
  });
  it('มีราคาแต่ไม่มีเรต: มุมมอง USD ครบ · มุมมองบาทเป็น null ติดธง rate', () => {
    const noFx = data({ fxRates: [] });
    expect(buildReport(noFx, ASOF, 'USD', 'monthly', 'all').incomplete).toBe(false);
    const thb = buildReport(noFx, ASOF, 'THB', 'monthly', 'all');
    expect(thb.columns[0]).toMatchObject({ end: null, profit: null, profitBps: null, fx: null, missing: 'rate', purchases: 3_503_500 });
    expect(thb.missing).toEqual(['rate']);
  });
  it('ไม่มีรายการเลย → ไม่มีคอลัมน์ ไม่มี total', () => {
    expect(buildReport(data({ trades: [] }), ASOF, 'USD', 'monthly', 'all')).toEqual({ currency: 'USD', columns: [], total: null, incomplete: false, missing: [] });
  });
});

describe('จัดกลุ่มไตรมาส/ปี และช่วงเวลา', () => {
  it('ไตรมาส/ปี: ผลบวกของเดือน · ต้น/ปลายงวดของเดือนแรก/สุดท้าย · % ต่อทบจากรายเดือน (ไม่ต่อจากค่าปัดแล้ว)', () => {
    for (const g of ['quarterly', 'yearly'] as const) {
      const t = buildReport(data(), ASOF, 'USD', g, 'all');
      expect(t.columns).toHaveLength(1);
      expect(t.columns[0]).toMatchObject({ key: g === 'quarterly' ? '2026-Q1' : '2026', begin: 0, end: 75_000, change: 75_000, profit: 27_050, profitBps: 3941, purchases: 100_100, sales: 47_900, buys: 1, sells: 1 });
      expect(t.total).toMatchObject({ profit: 27_050, profitBps: 3941 });
    }
  });
  it('ไตรมาสข้ามปี: ม.ค. ก.พ. อยู่ Q1 · เดือนอื่นแยกไตรมาส · ปีแยกปี', () => {
    const d = data({
      trades: [...TRADES, trade({ id: 'b5', date: '2026-04-05', units: '100000000', amount: 10_000, fee: 0 }), trade({ id: 'b6', date: '2027-01-05', units: '100000000', amount: 10_000, fee: 0 })],
      prices: [{ assetId: 'us1', date: '2027-01-31', priceMicro: 100_000_000 }],
    });
    const q = buildReport(d, '2027-01-31', 'USD', 'quarterly', 'all');
    expect(q.columns.map((c) => c.key)).toEqual(['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4', '2027-Q1']);
    expect(buildReport(d, '2027-01-31', 'USD', 'yearly', 'all').columns.map((c) => c.key)).toEqual(['2026', '2027']);
  });
  it('periodStartKey: last1y = 12 เดือนรวมเดือนนี้ · last3y = 36 · ytd = ม.ค. ของปี · all = ทุกเดือน', () => {
    expect(periodStartKey('last1y', '2026-11-18')).toBe('2025-12');
    expect(periodStartKey('last3y', '2026-11-18')).toBe('2023-12');
    expect(periodStartKey('ytd', '2026-11-18')).toBe('2026-01');
    expect(periodStartKey('all', '2026-11-18')).toBe('');
    expect(periodStartKey('last1y', '2026-01-05')).toBe('2025-02');
    expect(periodStartKey('last1y', '2026-12-31')).toBe('2026-01');
  });
  it('ช่วงเวลากรองเดือน: ytd ปี 2027 เห็นเฉพาะ ม.ค. 2027 · total ต่อทบเฉพาะเดือนในช่วง', () => {
    const d = data({
      trades: [...TRADES, trade({ id: 'b6', date: '2027-01-05', units: '100000000', amount: 10_000, fee: 0 })],
      prices: [{ assetId: 'us1', date: '2026-12-31', priceMicro: 120_000_000 }, { assetId: 'us1', date: '2027-01-31', priceMicro: 100_000_000 }],
    });
    const t = buildReport(d, '2027-01-31', 'USD', 'monthly', 'ytd');
    expect(t.columns.map((c) => c.key)).toEqual(['2027-01']);
    expect(t.total!.begin).toBe(72_000); // 6 หุ้นคงเหลือ x $120.00 = $720.00 ณ ปลายปี
  });
});

describe('ขอบเขต', () => {
  it('ขายหมดแล้ว: เดือนถัดไปที่ไม่มีหุ้นและไม่มีรายการถูกข้าม', () => {
    const d = data({
      trades: [trade({ id: 'b1', fee: 0 }), trade({ id: 's1', kind: 'sell', date: '2026-02-10', units: '1000000000', priceMicro: 100_000_000, amount: undefined, fee: 0 })],
      prices: [],
    });
    const t = buildReport(d, '2026-04-30', 'USD', 'monthly', 'all');
    expect(t.columns.map((c) => c.key)).toEqual(['2026-01', '2026-02']);
    // ไม่ถือหุ้น ณ สิ้น ก.พ. จึงไม่ต้องใช้ราคา: ปลายงวด 0 กำไรขายแล้ว 0
    expect(t.columns[1]).toMatchObject({ begin: null, end: 0 }); // ต้นเดือน ก.พ. ถือหุ้นแต่ไม่มีราคา → null
    expect(t.columns[1]!.realized).toBeNull();
  });
});
