import { describe, expect, it } from 'vitest';
import { replayTradesFx } from '../../src/domain/invest/costBasisFx';
import {
  addMonthsClamped, computeDividendMetrics, computeIrr, computeMonthlyReturns, computeProfitSources, replayWithFees, xirrBps,
} from '../../src/domain/invest/metrics';
import { toTradesFx } from '../../src/domain/invest/tradesFx';
import type { Asset, InvestmentData, TradeRecord } from '../../src/domain/invest/types';

const asset = (id: string, ticker = id.toUpperCase()): Asset => ({ id, name: `หุ้น ${ticker}`, kind: 'stock', accountId: `inv-${id}`, currency: 'USD', ticker, exchange: 'NASDAQ' });
let seq = 0;
const trade = (over: Partial<TradeRecord>): TradeRecord => ({
  id: `t${++seq}`, assetId: 'us1', kind: 'buy', date: '2026-11-03', createdAt: `${over.date ?? '2026-11-03'}T03:00:00.000Z`, units: '1000000000', priceMicro: 100_000_000, amount: 100_000, fee: 0, withholding: 0, memo: '', fxRateMicro: 35_000_000, ...over,
});
const data = (over: Partial<InvestmentData> = {}): InvestmentData => ({ assets: [asset('us1')], trades: [], prices: [], fxRates: [], ...over });

// ───── ตัวอย่างหลักที่เจ้าของอนุมัติ (16 พ.ย. 2569) ─────
//  ซื้อ 10 หุ้น $1,000.00 ค่าธรรมเนียม $1.00 ที่ 35.00 · ขาย 4 หุ้น @ $120 ค่าธรรมเนียม $1.00 ที่ 33.00
//  ปันผล $50.00 ภาษี $7.50 ที่ 34.567891 · ราคาล่าสุด $125 · อัตราล่าสุด 34.00
const MAIN = data({
  trades: [
    trade({ id: 'b1', kind: 'buy', date: '2026-11-03', units: '1000000000', amount: 100_000, fee: 100, fxRateMicro: 35_000_000 }),
    trade({ id: 's1', kind: 'sell', date: '2026-11-10', units: '400000000', priceMicro: 120_000_000, amount: undefined, fee: 100, fxRateMicro: 33_000_000 }),
    trade({ id: 'd1', kind: 'dividend', date: '2026-11-12', units: undefined, priceMicro: undefined, amount: 5_000, fee: 0, withholding: 750, fxRateMicro: 34_567_891 }),
  ],
  prices: [{ assetId: 'us1', date: '2026-11-12', priceMicro: 125_000_000 }],
  fxRates: [{ accountId: 'usd-cash', date: '2026-11-12', rateMicro: 34_000_000 }],
});
const TODAY = '2026-11-13';

describe('R24 กำไรรวม 6 แหล่ง: ตัวอย่างหลัก (ทุกแหล่งตรงทุกสตางค์ รวม 774,113)', () => {
  const r = computeProfitSources(MAIN, TODAY);
  it('6 แหล่งตรงตามตาราง และรวมได้ 774,113', () => {
    expect(r.complete).toBe(true);
    expect(r.thb).toEqual({
      priceUnrealized: 510_000, // (1) (75,000 − 60,000 เซนต์) × 34.00
      priceRealized: 264_000, //  (2) (48,000 − 40,000 เซนต์) × 33.00
      options: 0, //              (3)
      dividendGross: 172_839, //  (4) $50.00 × 34.567891
      fx: -140_000, //            (5) ส่วนที่เหลือ
      feesAndTax: -32_726, //     (6) −(3,500 + 3,300 + 25,926)
      total: 774_113,
    });
    const t = r.thb!;
    expect(t.priceUnrealized + t.priceRealized + t.options + t.dividendGross + t.fx + t.feesAndTax).toBe(774_113);
  });
  it('ส่วนประกอบเดิมของกำไรรวม (R20.4) ไม่เปลี่ยน: ยังไม่ขาย 447,900 + ขายแล้ว 179,300 + ปันผลสุทธิ 146,913 = 774,113', () => {
    expect(r.parts).toEqual({ unrealizedThb: 447_900, realizedThb: 179_300, dividendNetThb: 146_913 });
    expect(447_900 + 179_300 + 146_913).toBe(774_113);
  });
  it('มุมมอง USD: แหล่ง 1,2,4,6 เป็นเซนต์โดยตรง รวม = มูลค่า + เงินขายสุทธิ + ปันผลสุทธิ − เงินลงทุน = 27,050', () => {
    expect(r.usd).toEqual({ priceUnrealized: 15_000, priceRealized: 8_000, options: 0, dividendGross: 5_000, feesAndTax: -950, total: 27_050 });
    expect(75_000 + 47_900 + 4_250 - 100_100).toBe(27_050);
  });
  it('ส่วนค่าธรรมเนียมในต้นทุน: ซื้อ 3,500 สตางค์ · ตัด 1,400 ตอนขาย 4 ใน 10 · เหลือ 2,100 (60 เซนต์)', () => {
    const rep = replayWithFees(toTradesFx(MAIN.trades));
    expect(rep.buyFeesThb).toBe(3_500);
    expect([rep.heldFeeUsd, rep.heldFeeThb]).toEqual([60, 2_100]);
    expect(rep.sells[0]).toMatchObject({ principalOutUsd: 40_000, sellFeeThb: 3_300, priceGainThb: 264_000 });
  });
  it('ต้นทุน 2 ถังและกำไรขายเท่าเดิมทุกสตางค์เมื่อเทียบกับ replayTradesFx ตัวเดิม', () => {
    const old = replayTradesFx(toTradesFx(MAIN.trades));
    const rep = replayWithFees(toTradesFx(MAIN.trades));
    expect(rep.position).toEqual(old.position);
    expect(rep.realizedGainThb).toBe(old.realizedGainThb);
  });
});

describe('R24: กรณีไม่ครบ ขอบเขต และผลรวมตรงเป๊ะ', () => {
  it('ไม่มีราคา: ไม่เดา · ทั้งบาทและ USD เป็น null · บอกหุ้นที่ขาด', () => {
    const r = computeProfitSources({ ...MAIN, prices: [] }, TODAY);
    expect(r).toMatchObject({ complete: false, thb: null, usd: null, parts: null });
    expect(r.missing).toEqual([{ kind: 'price', assetId: 'us1' }]);
  });
  it('มีราคาแต่ไม่มีอัตรา: มุมมอง USD ยังได้ · บาทเป็น null', () => {
    const r = computeProfitSources({ ...MAIN, fxRates: [] }, TODAY);
    expect(r.complete).toBe(false);
    expect(r.thb).toBeNull();
    expect(r.usd).toMatchObject({ total: 27_050 });
    expect(r.missing).toEqual([{ kind: 'fx' }]);
  });
  it('ขายหมดแล้ว: ไม่ต้องมีราคา/อัตรา · ค่าเงินคือส่วนที่เหลือ · ค่าธรรมเนียมซื้อ+ขายครบ', () => {
    const d = data({
      trades: [
        trade({ id: 'b', kind: 'buy', amount: 100_000, fee: 100, fxRateMicro: 35_000_000 }),
        trade({ id: 's', kind: 'sell', date: '2026-11-10', units: '1000000000', priceMicro: 110_000_000, amount: undefined, fee: 100, fxRateMicro: 34_000_000 }),
      ],
    });
    const r = computeProfitSources(d, TODAY);
    expect(r.complete).toBe(true);
    // เงินลงทุน 3,503,500 · ขาย gross 110,000 − fee 100 = 109,900 เซนต์ × 34 = 3,736,600 · กำไร 233,100
    expect(r.thb!.total).toBe(3_736_600 - 3_503_500);
    expect(r.thb!.priceUnrealized).toBe(0);
    expect(r.thb!.priceRealized).toBe((110_000 - 100_000) * 34); // 340,000
    expect(r.thb!.feesAndTax).toBe(-(3_500 + (110_000 * 34 - 109_900 * 34))); // −(3,500 + 3,400)
    expect(r.usd).toEqual({ priceUnrealized: 0, priceRealized: 10_000, options: 0, dividendGross: 0, feesAndTax: -200, total: 9_800 });
  });
  it('ไม่มีรายการเลย: ทุกแหล่งเป็น 0 ไม่ throw', () => {
    const r = computeProfitSources(data(), TODAY);
    expect(r.thb).toEqual({ priceUnrealized: 0, priceRealized: 0, options: 0, dividendGross: 0, fx: 0, feesAndTax: 0, total: 0 });
  });
  it('ส่วนค่าธรรมเนียมตอนขายบางส่วนปัดครึ่งขึ้นครั้งเดียว: ซื้อ 4 หุ้น fee 1 เซนต์ ขาย 2 หุ้น (0.5 → 1) · ขายหมดตัดทั้งก้อน', () => {
    const rep = replayWithFees(toTradesFx([
      trade({ id: 'b', units: '400000000', amount: 400, fee: 1 }),
      trade({ id: 's1', kind: 'sell', date: '2026-11-04', units: '200000000', priceMicro: 1_000_000, amount: undefined, fee: 0 }),
    ]));
    // ต้นทุน 401 เซนต์ · ตัด round(401×2/4 = 200.5) = 201 · ส่วนค่าธรรมเนียมตัด round(1×2/4 = 0.5) = 1 · ต้นทุนไม่รวมค่าธรรมเนียมที่ตัด 200
    expect(rep.sells[0]!.principalOutUsd).toBe(200);
    expect(rep.heldFeeUsd).toBe(0);
    const all = replayWithFees(toTradesFx([
      trade({ id: 'b', units: '300000000', amount: 300, fee: 1 }),
      trade({ id: 's1', kind: 'sell', date: '2026-11-04', units: '100000000', priceMicro: 1_000_000, amount: undefined, fee: 0 }),
      trade({ id: 's2', kind: 'sell', date: '2026-11-05', units: '200000000', priceMicro: 1_000_000, amount: undefined, fee: 0 }),
    ]));
    expect(all.heldFeeUsd).toBe(0);
    expect(all.heldFeeThb).toBe(0);
    expect(all.position.units).toBe(0n);
  });
  it('สุ่มลำดับรายการ (หลายหุ้น/หลายอัตรา/ขายบางส่วน/ปันผล): ผลรวม 6 แหล่ง = กำไรรวม = ยังไม่ขาย + ขายแล้ว + ปันผลสุทธิ ตรงเป๊ะทั้งบาทและ USD', () => {
    let seed = 12345;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let round = 0; round < 60; round++) {
      const ts: TradeRecord[] = [];
      const units = new Map<string, bigint>();
      for (const id of ['us1', 'us2']) units.set(id, 0n);
      let day = 1;
      for (let i = 0; i < 14; i++) {
        const id = rnd(2) === 0 ? 'us1' : 'us2';
        const date = `2026-0${1 + Math.floor(day / 28)}-${String(1 + (day % 28)).padStart(2, '0')}`;
        day += 1 + rnd(3);
        const fx = 30_000_000 + rnd(10_000_000) + rnd(1000);
        const held = units.get(id)!;
        const kind = rnd(4);
        if (kind === 0 && held >= 100_000_000n) {
          const u = 100_000_000n + BigInt(rnd(Number((held > 5_000_000_000n ? 5_000_000_000n : held) - 100_000_000n) + 1));
          ts.push(trade({ id: `r${round}-${i}`, assetId: id, kind: 'sell', date, units: u.toString(), priceMicro: 50_000_000 + rnd(100_000_000), amount: undefined, fee: rnd(300), fxRateMicro: fx }));
          units.set(id, held - u);
        } else if (kind === 1 && held > 0n) {
          ts.push(trade({ id: `r${round}-${i}`, assetId: id, kind: 'dividend', date, units: undefined, priceMicro: undefined, amount: 1000 + rnd(9000), fee: 0, withholding: rnd(900), fxRateMicro: fx }));
        } else {
          const u = BigInt(200_000_000 + rnd(900_000_000));
          ts.push(trade({ id: `r${round}-${i}`, assetId: id, kind: 'buy', date, units: u.toString(), priceMicro: 10_000_000, amount: 5_000 + rnd(200_000), fee: rnd(500), fxRateMicro: fx }));
          units.set(id, held + u);
        }
      }
      const d = data({
        assets: [asset('us1'), asset('us2')],
        trades: ts,
        prices: [{ assetId: 'us1', date: '2026-03-01', priceMicro: 40_000_000 + rnd(80_000_000) }, { assetId: 'us2', date: '2026-03-01', priceMicro: 40_000_000 + rnd(80_000_000) }],
        fxRates: [{ accountId: 'usd-cash', date: '2026-03-01', rateMicro: 30_000_000 + rnd(10_000_000) }],
      });
      const r = computeProfitSources(d, '2026-04-30');
      expect(r.complete).toBe(true);
      const t = r.thb!;
      expect(t.priceUnrealized + t.priceRealized + t.options + t.dividendGross + t.fx + t.feesAndTax).toBe(t.total);
      expect(r.parts!.unrealizedThb + r.parts!.realizedThb + r.parts!.dividendNetThb).toBe(t.total);
      const u = r.usd!;
      expect(u.priceUnrealized + u.priceRealized + u.options + u.dividendGross + u.feesAndTax).toBe(u.total);
      expect(t.feesAndTax).toBeLessThanOrEqual(0);
    }
  });
});

describe('R25.1-R25.2 ปันผลต่อปีและ yield', () => {
  it('addMonthsClamped: ย้อนเดือนปฏิทิน ปรับวันสิ้นเดือน', () => {
    expect(addMonthsClamped('2026-11-16', -12)).toBe('2025-11-16');
    expect(addMonthsClamped('2024-02-29', -12)).toBe('2023-02-28');
    expect(addMonthsClamped('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonthsClamped('2026-01-15', -13)).toBe('2024-12-15');
    expect(addMonthsClamped('2026-12-31', 2)).toBe('2027-02-28');
  });
  const base = [trade({ id: 'b', date: '2025-01-02', units: '100000000', amount: 10_000, fee: 0, fxRateMicro: 35_000_000 })];
  const div = (id: string, date: string, cents: number, w = 0): TradeRecord => trade({ id, kind: 'dividend', date, units: undefined, priceMicro: undefined, amount: cents, fee: 0, withholding: w, fxRateMicro: 35_000_000 });
  it('ช่วง (วันนี้ − 12 เดือน, วันนี้]: ขอบล่างไม่รวม ขอบบนรวม · ก่อน/หลังภาษี บาทและ USD', () => {
    const d = data({
      trades: [...base, div('d0', '2025-11-16', 100), div('d1', '2025-11-17', 400, 60), div('d2', '2026-11-16', 200)],
      prices: [{ assetId: 'us1', date: '2026-11-10', priceMicro: 125_000_000 }],
      fxRates: [{ accountId: 'usd-cash', date: '2026-11-10', rateMicro: 35_000_000 }],
    });
    const m = computeDividendMetrics(d, '2026-11-16');
    expect(m.fromExclusive).toBe('2025-11-16');
    expect(m).toMatchObject({ grossUsd: 600, netUsd: 540, grossThb: 21_000, netThb: 18_900 });
  });
  it('yield และ yield on cost เป็น bps (มูลค่า 4,375,000 ต้นทุน 3,500,000 · ปันผล 140,000)', () => {
    const d = data({
      trades: [...base, div('d1', '2026-06-01', 400)],
      prices: [{ assetId: 'us1', date: '2026-11-10', priceMicro: 125_000_000 }],
      fxRates: [{ accountId: 'usd-cash', date: '2026-11-10', rateMicro: 35_000_000 }],
    });
    const m = computeDividendMetrics(d, '2026-11-16');
    expect(m.grossThb).toBe(14_000);
    expect(m.yieldBps).toBe(320); // 140,000 / 4,375,000
    expect(m.yieldOnCostBps).toBe(400); // 140,000 / 3,500,000
  });
  it('ไม่มีราคา/อัตรา หรือไม่มีหุ้นที่ถืออยู่: yield เป็น null (ไม่ใช้ต้นทุนแทน) แต่ยอดปันผลยังนับ', () => {
    const d = data({ trades: [...base, div('d1', '2026-06-01', 400)] });
    const m = computeDividendMetrics(d, '2026-11-16');
    expect([m.yieldBps, m.yieldOnCostBps]).toEqual([null, null]);
    expect(m.grossThb).toBe(14_000);
    const empty = computeDividendMetrics(data(), '2026-11-16');
    expect(empty).toMatchObject({ grossThb: 0, yieldBps: null, yieldOnCostBps: null });
  });
});

describe('R25.3 IRR (XIRR ด้วย BigInt)', () => {
  it('เคสคำนวณมือ: −1,000 แล้ว +1,100 หลัง 365 วัน = 1,000 bps · −1,000 แล้ว +1,210 หลัง 730 วัน = 1,000 bps', () => {
    expect(xirrBps([{ date: '2026-01-01', amount: -100_000n }, { date: '2027-01-01', amount: 110_000n }])).toEqual({ kind: 'ok', bps: 1_000 });
    expect(xirrBps([{ date: '2026-01-01', amount: -100_000n }, { date: '2028-01-01', amount: 121_000n }])).toEqual({ kind: 'ok', bps: 1_000 });
  });
  it('ผลติดลบและหลายกระแส: −1,000 แล้ว +900 หลัง 365 วัน = −1,000 bps · เงินเข้าระหว่างทางไม่เปลี่ยนคำตอบที่คำนวณมือ', () => {
    expect(xirrBps([{ date: '2026-01-01', amount: -100_000n }, { date: '2027-01-01', amount: 90_000n }])).toEqual({ kind: 'ok', bps: -1_000 });
    // −1,000 @0 · +100 @182.5 ไม่ใช่จำนวนวันเต็ม จึงใช้ปีธรรมดา: ลง 1,000 ได้ 600 ที่ 365 วัน และอีก 600 ที่ 730 วัน → r = 0.2…
    const r = xirrBps([{ date: '2026-01-01', amount: -100_000n }, { date: '2027-01-01', amount: 60_000n }, { date: '2028-01-01', amount: 60_000n }]);
    expect(r.kind).toBe('ok');
    // ตรวจกลับ: NPV ที่ r ที่ได้ ≈ 0 (ผิดพลาดไม่เกิน 1 สตางค์ ต่อ 1 bps ของอัตรา)
    if (r.kind === 'ok') {
      const rate = r.bps / 10_000;
      const npv = -100_000 + 60_000 / (1 + rate) + 60_000 / (1 + rate) ** 2;
      expect(Math.abs(npv)).toBeLessThan(60); // 1 bps ≈ 60 สตางค์ที่ขนาดนี้
    }
  });
  it('เกณฑ์ 30 วัน: 29 วันไม่คำนวณ · 30 วันคำนวณ', () => {
    expect(xirrBps([{ date: '2026-01-01', amount: -100_000n }, { date: '2026-01-30', amount: 110_000n }])).toEqual({ kind: 'na', reason: 'short' });
    expect(xirrBps([{ date: '2026-01-01', amount: -100_000n }, { date: '2026-01-31', amount: 110_000n }]).kind).toBe('ok');
  });
  it('ไม่คำนวณ: กระแสเงินน้อยกว่า 2 · ไม่มีทั้งเข้าและออก · ไม่มีคำตอบ', () => {
    expect(xirrBps([{ date: '2026-01-01', amount: -100_000n }])).toEqual({ kind: 'na', reason: 'few-flows' });
    expect(xirrBps([{ date: '2026-01-01', amount: 0n }, { date: '2026-06-01', amount: 0n }])).toEqual({ kind: 'na', reason: 'few-flows' });
    expect(xirrBps([{ date: '2026-01-01', amount: -100_000n }, { date: '2026-06-01', amount: -50_000n }])).toEqual({ kind: 'na', reason: 'no-sign' });
    expect(xirrBps([{ date: '2026-01-01', amount: 100_000n }, { date: '2026-06-01', amount: 50_000n }])).toEqual({ kind: 'na', reason: 'no-sign' });
  });
  it('พอร์ตหุ้นสหรัฐ: ตัวอย่างหลักถือยังไม่ถึง 30 วัน → ไม่แสดงตัวเลข ("ใช้ได้เมื่อถือครบ 30 วัน")', () => {
    expect(computeIrr(MAIN, TODAY)).toEqual({ kind: 'na', reason: 'short' });
  });
  it('พอร์ตหุ้นสหรัฐ ถือ 315 วัน: −3,500,000 แล้วมูลค่า 3,850,000 → (1.1)^(365/315) − 1 = 1,168 bps', () => {
    const d = data({
      trades: [trade({ id: 'b', date: '2026-01-02', units: '1000000000', amount: 100_000, fee: 0, fxRateMicro: 35_000_000 })],
      prices: [{ assetId: 'us1', date: '2026-11-10', priceMicro: 110_000_000 }],
      fxRates: [{ accountId: 'usd-cash', date: '2026-11-10', rateMicro: 35_000_000 }],
    });
    expect(computeIrr(d, '2026-11-13')).toEqual({ kind: 'ok', bps: 1_168 });
  });
  it('ไม่มีราคา/อัตราของหุ้นที่ถืออยู่: ไม่คำนวณ (missing) · ขายหมดแล้วไม่ต้องใช้ราคา', () => {
    const held = data({ trades: [trade({ id: 'b', date: '2026-01-02' })] });
    expect(computeIrr(held, '2026-11-13')).toEqual({ kind: 'na', reason: 'missing' });
    const sold = data({
      trades: [
        trade({ id: 'b', date: '2026-01-02', units: '1000000000', amount: 100_000, fee: 0, fxRateMicro: 35_000_000 }),
        trade({ id: 's', kind: 'sell', date: '2026-07-02', units: '1000000000', priceMicro: 110_000_000, amount: undefined, fee: 0, fxRateMicro: 35_000_000 }),
      ],
    });
    const r = computeIrr(sold, '2026-11-13');
    expect(r.kind).toBe('ok'); // −3,500,000 → +3,850,000 หลัง 181 วัน
    if (r.kind === 'ok') expect(r.bps).toBeGreaterThan(2_000);
  });
});

describe('R25.4 ผลตอบแทนรายเดือน (Modified Dietz)', () => {
  // ซื้อ 10 หุ้น $100.00 วันที่ 2 ม.ค. ที่ 35.00 · ราคาปลาย ม.ค. $110 ปลาย ก.พ. $121 · อัตรา 35.00
  const dietz = (over: Partial<InvestmentData> = {}): InvestmentData =>
    data({
      trades: [trade({ id: 'b', date: '2026-01-02', units: '1000000000', amount: 100_000, fee: 0, fxRateMicro: 35_000_000 })],
      prices: [{ assetId: 'us1', date: '2026-01-31', priceMicro: 110_000_000 }, { assetId: 'us1', date: '2026-02-28', priceMicro: 121_000_000 }],
      fxRates: [{ accountId: 'usd-cash', date: '2026-01-01', rateMicro: 35_000_000 }],
      ...over,
    });
  it('คำนวณมือ: ม.ค. 1,069 · ก.พ. 1,000 · เชื่อมทั้งปี 2,176 bps', () => {
    // ม.ค.: (3,850,000 − 0 − 3,500,000) ÷ (3,500,000 × 29/31) = 1,068.97 → 1,069 · ก.พ.: 385,000 ÷ 3,850,000 = 1,000 · (1.1069 × 1.1) − 1 = 21.759% → 2,176
    const r = computeMonthlyReturns(dietz(), '2026-02-28');
    expect(r.months).toEqual([{ month: '2026-01', bps: 1_069 }, { month: '2026-02', bps: 1_000 }]);
    expect(r.years).toEqual({ '2026': 2_176 });
  });
  it('เดือนติดลบ: ราคาปลาย ก.พ. $99 → −1,000 bps · ทั้งปีเชื่อมเป็น (1.1069 × 0.9) − 1 = −0.38% → −38 bps', () => {
    const r = computeMonthlyReturns(dietz({ prices: [{ assetId: 'us1', date: '2026-01-31', priceMicro: 110_000_000 }, { assetId: 'us1', date: '2026-02-28', priceMicro: 99_000_000 }] }), '2026-02-28');
    expect(r.months[1]).toEqual({ month: '2026-02', bps: -1_000 });
    expect(r.years['2026']).toBe(-38); // 11069 × 9000 / 10^4 = 9962.1 → 9962 − 10000
  });
  it('ไม่มีราคา: เดือนที่ต้องใช้ราคาเป็น null (missing) และทั้งปีเป็น null · ไม่เดา', () => {
    const r = computeMonthlyReturns(dietz({ prices: [] }), '2026-02-28');
    expect(r.months).toEqual([{ month: '2026-01', bps: null, na: 'missing' }, { month: '2026-02', bps: null, na: 'missing' }]);
    expect(r.years).toEqual({ '2026': null });
  });
  it('ปันผลในเดือนนับเป็นผลตอบแทน: ก.พ. มีปันผลสุทธิ 385,000 สตางค์ → +1,000 bps เพิ่ม (ราคาไม่เปลี่ยน)', () => {
    const d = dietz({
      prices: [{ assetId: 'us1', date: '2026-01-31', priceMicro: 110_000_000 }, { assetId: 'us1', date: '2026-02-28', priceMicro: 110_000_000 }],
      trades: [
        trade({ id: 'b', date: '2026-01-02', units: '1000000000', amount: 100_000, fee: 0, fxRateMicro: 35_000_000 }),
        trade({ id: 'dv', kind: 'dividend', date: '2026-02-10', units: undefined, priceMicro: undefined, amount: 11_000, fee: 0, withholding: 0, fxRateMicro: 35_000_000 }),
      ],
    });
    const r = computeMonthlyReturns(d, '2026-02-28');
    expect(r.months[1]).toEqual({ month: '2026-02', bps: 1_000 }); // 385,000 ÷ 3,850,000
  });
  it('เดือนที่ไม่มีหุ้นและไม่มีรายการถูกข้าม · ไม่มีรายการเลย = ว่าง · ตัวหารเป็น 0 (ซื้อวันสุดท้ายของเดือน) = null', () => {
    expect(computeMonthlyReturns(data(), '2026-02-28')).toEqual({ months: [], years: {} });
    const last = computeMonthlyReturns(
      dietz({ trades: [trade({ id: 'b', date: '2026-01-31', units: '1000000000', amount: 100_000, fee: 0, fxRateMicro: 35_000_000 })] }),
      '2026-02-28',
    );
    expect(last.months[0]).toEqual({ month: '2026-01', bps: null, na: 'zero-base' });
    expect(last.years['2026']).toBeNull();
    const skip = computeMonthlyReturns(
      dietz({
        trades: [
          trade({ id: 'b', date: '2026-01-02', units: '1000000000', amount: 100_000, fee: 0, fxRateMicro: 35_000_000 }),
          trade({ id: 's', kind: 'sell', date: '2026-01-20', units: '1000000000', priceMicro: 110_000_000, amount: undefined, fee: 0, fxRateMicro: 35_000_000 }),
        ],
      }),
      '2026-03-31',
    );
    expect(skip.months.map((m) => m.month)).toEqual(['2026-01']); // ก.พ./มี.ค. ไม่มีหุ้น ถูกข้าม
  });
  it('เดือนปัจจุบันใช้วันนี้เป็นวันสิ้นสุด', () => {
    const r = computeMonthlyReturns(dietz({ prices: [{ assetId: 'us1', date: '2026-01-31', priceMicro: 110_000_000 }, { assetId: 'us1', date: '2026-02-14', priceMicro: 121_000_000 }] }), '2026-02-14');
    expect(r.months[1]).toEqual({ month: '2026-02', bps: 1_000 });
  });
});
