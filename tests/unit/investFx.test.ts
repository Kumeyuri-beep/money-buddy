import { describe, expect, it } from 'vitest';
import { applyBuyFx, applySellFx, emptyPositionFx, replayTradesFx, type TradeFx } from '../../src/domain/invest/costBasisFx';
import { assertFxRateMicro, convertMinor, dividendInThb, fxRateFromExchange, suggestWithholding } from '../../src/domain/invest/fx';
import { DEFAULT_FOREIGN_DIVIDEND_WHT_BPS } from '../../src/domain/invest/fxConfig';
import { valueInSatang } from '../../src/domain/invest/units';

/**
 * R20 หลายสกุลเงิน (docs/plans/phase-a-us-stocks.md): ตัวอย่าง A/B/C ต้องตรงทุกสตางค์ + invariant + ขอบเขต
 * ข้อมูลสมมติทั้งหมด · หน่วย = x10^8 · ราคา = micro-USD · เงิน USD = เซนต์ · อัตรา = micro-บาทต่อดอลลาร์
 */
const U = (shares: number): bigint => BigInt(Math.round(shares * 1e8));

describe('convertMinor / fxRateFromExchange / assertFxRateMicro', () => {
  it('เซนต์ -> สตางค์ ปัดครึ่งขึ้นครั้งเดียว · 0 เซนต์ = 0 · อัตรา 1.000000 เท่ากัน', () => {
    expect(convertMinor(100_100, 35_000_000)).toBe(3_503_500);
    expect(convertMinor(0, 35_000_000)).toBe(0);
    expect(convertMinor(12_345, 1_000_000)).toBe(12_345);
    expect(convertMinor(1, 500_000)).toBe(1); // 0.5 สตางค์ -> ปัดขึ้น 1 (ครึ่งออกจากศูนย์)
    expect(convertMinor(1, 499_999)).toBe(0);
    expect(convertMinor(3, 500_000)).toBe(2); // 1.5 -> 2
  });
  it('อัตราต่ำสุด 1 micro · ผลเกินช่วงปลอดภัย = RangeError · อัตรา 0/ติดลบ/ทศนิยม/NaN/Infinity ปฏิเสธ', () => {
    expect(convertMinor(1_000_000, 1)).toBe(1);
    expect(() => convertMinor(Number.MAX_SAFE_INTEGER, 35_000_000)).toThrow(RangeError);
    for (const bad of [0, -1, 1.5, Number.NaN, Infinity]) {
      expect(() => assertFxRateMicro(bad)).toThrow(RangeError);
      expect(() => convertMinor(100, bad)).toThrow(RangeError);
    }
    for (const bad of [-1, 1.5, Number.NaN]) expect(() => convertMinor(bad, 35_000_000)).toThrow(RangeError);
  });
  it('อัตราจากการแลกเงิน = roundHalfUp(สตางค์ x 10^6 / เซนต์) · ตรวจย้อนกลับ · ค่าไม่ถูกต้องปฏิเสธ', () => {
    expect(fxRateFromExchange(3_500_000, 100_000)).toBe(35_000_000); // 35,000.00 บาท -> $1,000.00
    expect(fxRateFromExchange(3_456_789, 100_000)).toBe(34_567_890); // 34.56789
    expect(fxRateFromExchange(1, 3)).toBe(333_333); // 0.3333333 -> ปัดลง
    expect(fxRateFromExchange(2, 3)).toBe(666_667);
    expect(() => fxRateFromExchange(0, 100)).toThrow(RangeError);
    expect(() => fxRateFromExchange(100, 0)).toThrow(RangeError);
    expect(() => fxRateFromExchange(1, 10_000_000_000)).toThrow(RangeError); // อัตราที่ได้ปัดเป็น 0 micro
    expect(() => fxRateFromExchange(1.5, 100)).toThrow(RangeError);
  });
});

describe('suggestWithholding / dividendInThb', () => {
  it('ตัวช่วยเติม 15% ปัดครึ่งขึ้น: $50.00 -> $7.50 · 1 เซนต์ -> 0 · 3 เซนต์ -> 0 (0.45) · 7 เซนต์ -> 1 (1.05)', () => {
    expect(DEFAULT_FOREIGN_DIVIDEND_WHT_BPS).toBe(1500);
    expect(suggestWithholding(5_000)).toBe(750);
    expect(suggestWithholding(1)).toBe(0);
    expect(suggestWithholding(3)).toBe(0);
    expect(suggestWithholding(7)).toBe(1);
    expect(suggestWithholding(10_000, 3_000)).toBe(3_000); // 30% ตัวเลือก
    expect(() => suggestWithholding(-1)).toThrow(RangeError);
    expect(() => suggestWithholding(100, 10_001)).toThrow(RangeError);
  });
  it('ตัวอย่าง C: ปันผล $50.00 ภาษี $7.50 อัตรา 34.567891 → 172,839 / 25,926 / สุทธิ 146,913 (หักเอา ไม่ใช่ 146,914)', () => {
    const r = dividendInThb(5_000, 750, 34_567_891);
    expect(r).toEqual({ grossThb: 172_839, whtThb: 25_926, netThb: 146_913 });
    expect(convertMinor(4_250, 34_567_891)).toBe(146_914); // ปัดสุทธิแยก = ต่าง 1 สตางค์ (นี่คือเหตุผลของกฎ "หักเอา")
    expect(r.grossThb - r.whtThb).toBe(r.netThb);
  });
  it('ขอบเขต: W = 0 · W = D−1 · W ≥ D ปฏิเสธ · D = 0 ปฏิเสธ', () => {
    expect(dividendInThb(100, 0, 35_000_000)).toEqual({ grossThb: 3_500, whtThb: 0, netThb: 3_500 });
    expect(dividendInThb(100, 99, 35_000_000)).toEqual({ grossThb: 3_500, whtThb: 3_465, netThb: 35 });
    expect(() => dividendInThb(100, 100, 35_000_000)).toThrow(RangeError);
    expect(() => dividendInThb(0, 0, 35_000_000)).toThrow(RangeError);
  });
});

describe('ตัวอย่าง A: กำไรหุ้นแต่ขาดทุนค่าเงิน', () => {
  it('ซื้อ 10 หุ้น $100.00 ค่าธรรมเนียม $1.00 อัตรา 35 → ถัง USD 100,100 เซนต์ · ถังบาท 3,503,500 สตางค์', () => {
    const p = applyBuyFx(emptyPositionFx(), { units: U(10), amount: 100_000, fee: 100, fxRateMicro: 35_000_000 });
    expect(p).toEqual({ units: U(10), costUsd: 100_100, costThb: 3_503_500 });
  });
  it('ขาย 4 หุ้น $120.00 ค่าธรรมเนียม $1.00 อัตรา 33 → ทุกตัวเลขตรงตามเอกสาร', () => {
    const bought = applyBuyFx(emptyPositionFx(), { units: U(10), amount: 100_000, fee: 100, fxRateMicro: 35_000_000 });
    const s = applySellFx(bought, { units: U(4), priceMicro: 120_000_000, fee: 100, fxRateMicro: 33_000_000 });
    expect(s.grossUsd).toBe(48_000);
    expect(s.netUsd).toBe(47_900);
    expect(s.costOutUsd).toBe(40_040);
    expect(s.costOutThb).toBe(1_401_400);
    expect(s.proceedsThb).toBe(1_580_700);
    expect(s.gainThb).toBe(179_300);
    expect(s.priceGainUsd).toBe(7_860);
    expect(s.priceGainThb).toBe(259_380);
    expect(s.fxGainThb).toBe(-80_080);
    expect(s.priceGainThb + s.fxGainThb).toBe(s.gainThb);
    expect(s.fxGainThb).toBe(Math.round((40_040 * (33_000_000 - 35_000_000)) / 1_000_000)); // ตรวจย้อน: costOutUsd x (อัตราขาย − อัตราต้นทุนเฉลี่ย)
    expect(s.position).toEqual({ units: U(6), costUsd: 60_060, costThb: 2_102_100 });
  });
  it('บรรทัดสมุด USD ของการซื้อและขายรวมเป็น 0 (ตรวจตัวเลขของ Entry)', () => {
    // ซื้อ: +สินทรัพย์ 100,100 · −เงินสด 100,100 · ขาย: +เงินสด 47,900 · −สินทรัพย์ 40,040 · −กำไร(USD) 7,860
    expect(100_100 - 100_100).toBe(0);
    expect(47_900 - 40_040 - 7_860).toBe(0);
  });
});

describe('ตัวอย่าง B: หุ้นเศษส่วนและการปัดเศษ ขายหมดไม่มีเศษค้าง', () => {
  it('ซื้อ 1.25 หุ้น $333.33 → 41,666 เซนต์ (ปัดลงที่ .25) · ถังบาท 1,463,454', () => {
    expect(valueInSatang(U(1.25), 333_330_000)).toBe(41_666);
    const p = applyBuyFx(emptyPositionFx(), { units: U(1.25), amount: 41_666, fee: 0, fxRateMicro: 35_123_456 });
    expect(p).toEqual({ units: U(1.25), costUsd: 41_666, costThb: 1_463_454 });
  });
  it('ขายหมด $340.00 ค่าธรรมเนียม $0.99 อัตรา 34.987654 → กำไรรวม 20,058 = ราคา 25,716 + ค่าเงิน −5,658 · คงเหลือ 0 ทั้งสองถัง', () => {
    const bought = applyBuyFx(emptyPositionFx(), { units: U(1.25), amount: 41_666, fee: 0, fxRateMicro: 35_123_456 });
    const s = applySellFx(bought, { units: U(1.25), priceMicro: 340_000_000, fee: 99, fxRateMicro: 34_987_654 });
    expect(s.grossUsd).toBe(42_500);
    expect(s.netUsd).toBe(42_401);
    expect(s.costOutUsd).toBe(41_666);
    expect(s.costOutThb).toBe(1_463_454);
    expect(s.proceedsThb).toBe(1_483_512);
    expect(s.gainThb).toBe(20_058);
    expect(s.priceGainUsd).toBe(735);
    expect(s.priceGainThb).toBe(25_716);
    expect(s.fxGainThb).toBe(-5_658);
    expect(s.position).toEqual({ units: 0n, costUsd: 0, costThb: 0 });
  });
});

describe('ขอบเขตของ applyBuyFx / applySellFx', () => {
  const buy = (amount: number, fee: number, fx: number, units = U(1)) => applyBuyFx(emptyPositionFx(), { units, amount, fee, fxRateMicro: fx });
  it('ซื้อ 1 เซนต์ที่อัตรา 0.4 บาท/USD ต้นทุนบาทปัดเป็น 0 → ปฏิเสธ (กันข้อมูลหน่วย>0 แต่ต้นทุนบาท 0)', () => {
    expect(() => buy(1, 0, 400_000)).toThrow(/ปัดเป็น 0 สตางค์/);
    expect(buy(1, 0, 500_000).costThb).toBe(1); // 0.5 -> 1 ผ่าน
  });
  it('มูลค่าซื้อ 0 / ค่าธรรมเนียมติดลบ / หน่วย 0 / ทศนิยม ปฏิเสธ', () => {
    expect(() => buy(0, 0, 35_000_000)).toThrow(RangeError);
    expect(() => buy(100, -1, 35_000_000)).toThrow(RangeError);
    expect(() => buy(100, 0, 35_000_000, 0n)).toThrow(RangeError);
    expect(() => buy(1.5, 0, 35_000_000)).toThrow(RangeError);
  });
  it('ขายเกินที่ถือ / หน่วย 0 / ค่าธรรมเนียมเกินเงินขาย / ขายได้ 0 เซนต์ ปฏิเสธ · ตำแหน่งว่างขายไม่ได้', () => {
    const p = buy(100_000, 0, 35_000_000, U(10));
    expect(() => applySellFx(p, { units: U(11), priceMicro: 100_000_000, fee: 0, fxRateMicro: 35_000_000 })).toThrow(/เกิน/);
    expect(() => applySellFx(p, { units: 0n, priceMicro: 100_000_000, fee: 0, fxRateMicro: 35_000_000 })).toThrow(RangeError);
    expect(() => applySellFx(p, { units: U(1), priceMicro: 100_000_000, fee: 10_001, fxRateMicro: 35_000_000 })).toThrow(/ค่าธรรมเนียม/); // gross = 10,000
    expect(() => applySellFx(p, { units: 1n, priceMicro: 1, fee: 0, fxRateMicro: 35_000_000 })).toThrow(/0 เซนต์/);
    expect(() => applySellFx(emptyPositionFx(), { units: 1n, priceMicro: 100_000_000, fee: 0, fxRateMicro: 35_000_000 })).toThrow(RangeError);
  });
  it('อัตราซื้อ = อัตราขาย: ส่วนค่าเงินอยู่ในขอบ ± (⌈fx/2/10^6⌉+1) สตางค์ ไม่ใช่ 0 เป๊ะ · ผลรวมสองส่วนเท่ากำไรรวมเป๊ะเสมอ', () => {
    // ตัวอย่างที่ money-auditor พบ: ซื้อ/ขายที่ 37.499237 ได้ fxGain ≠ 0 จากการปัด costOutUsd เป็นเซนต์
    const fx = 37_499_237;
    const p = applyBuyFx(emptyPositionFx(), { units: U(5), amount: 223_084, fee: 0, fxRateMicro: fx });
    const s = applySellFx(p, { units: U(2), priceMicro: 465_800_000, fee: 0, fxRateMicro: fx }); // 2 x 465.80 = 931.60 USD
    expect(s.priceGainThb + s.fxGainThb).toBe(s.gainThb);
    expect(Math.abs(s.fxGainThb)).toBeLessThanOrEqual(Math.ceil(fx / 2 / 1_000_000) + 1);
  });
  it('ขาดทุนราคาแต่กำไรค่าเงิน: ส่วนราคาติดลบ ส่วนค่าเงินบวก ผลรวมตรง', () => {
    const p = applyBuyFx(emptyPositionFx(), { units: U(10), amount: 100_000, fee: 0, fxRateMicro: 30_000_000 });
    const s = applySellFx(p, { units: U(10), priceMicro: 90_000_000, fee: 0, fxRateMicro: 36_000_000 }); // ราคาลง 10% บาทอ่อน 20%
    expect(s.priceGainUsd).toBe(-10_000);
    expect(s.priceGainThb).toBe(-360_000);
    expect(s.fxGainThb).toBe(s.gainThb + 360_000);
    expect(s.gainThb).toBe(3_240_000 - 3_000_000);
    expect(s.priceGainThb + s.fxGainThb).toBe(s.gainThb);
  });
  it('ตัวเลขใหญ่ใกล้ช่วงปลอดภัยไม่เพี้ยน: ต้นทุน $9,000,000,000.00 ที่อัตรา 35 ยังคำนวณได้ · เกินแล้ว RangeError', () => {
    const p = applyBuyFx(emptyPositionFx(), { units: U(1), amount: 900_000_000_000, fee: 0, fxRateMicro: 35_000_000 });
    expect(p.costThb).toBe(31_500_000_000_000);
    expect(() => applyBuyFx(emptyPositionFx(), { units: U(1), amount: Number.MAX_SAFE_INTEGER, fee: 0, fxRateMicro: 35_000_000 })).toThrow(RangeError);
  });
});

/** ตัวสุ่มคงที่ (LCG) เพื่อให้เทสต์ทำซ้ำได้ */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('invariant ของ R20.8 (สุ่มลำดับซื้อ/ขายหลายร้อยชุด)', () => {
  it('Σต้นทุนซื้อ = ΣcostOut + C เหลือ ทั้งสองถัง · U=0 ⇔ C=0 · กำไรรวม = ราคา + ค่าเงิน · เล่นซ้ำสลับลำดับอินพุตได้ผลเดิม', () => {
    const rnd = lcg(20261115);
    for (let round = 0; round < 300; round++) {
      const trades: TradeFx[] = [];
      let held = 0n;
      const n = 2 + Math.floor(rnd() * 10);
      for (let i = 0; i < n; i++) {
        const date = `2026-03-${String(i + 1).padStart(2, '0')}`; // วันที่เรียงตามลำดับสร้างเสมอ (ไม่ซ้ำ) ให้การขายตามหลังการซื้อ
        const fx = 30_000_000 + Math.floor(rnd() * 8_000_000);
        const base = { id: `t${String(i).padStart(2, '0')}`, date, createdAt: `${date}T00:00:00Z`, fxRateMicro: fx };
        if (held === 0n || rnd() < 0.55) {
          const units = BigInt(1 + Math.floor(rnd() * 5_000_000_000)); // 0.00000001 - 50 หุ้น
          trades.push({ kind: 'buy', ...base, units, amount: 1 + Math.floor(rnd() * 5_000_000), fee: Math.floor(rnd() * 500) });
          held += units;
        } else {
          const u = held === 1n ? 1n : BigInt(1 + Math.floor(rnd() * Number(held > 4_000_000_000n ? 4_000_000_000n : held)));
          const take = u > held ? held : u;
          const price = 1_000_000 + Math.floor(rnd() * 900_000_000);
          // ขายต้องได้เงินอย่างน้อย 1 เซนต์ และค่าธรรมเนียมไม่เกินเงินขาย
          const gross = valueInSatang(take, price);
          if (gross < 1) continue;
          trades.push({ kind: 'sell', ...base, units: take, priceMicro: price, fee: Math.floor(rnd() * Math.min(gross, 300)) });
          held -= take;
        }
      }
      let r;
      try {
        r = replayTradesFx(trades);
      } catch (e) {
        // ซื้อที่ต้นทุนบาทปัดเป็น 0 ถูกปฏิเสธตามกฎ (ไม่นับเป็นความผิดของ invariant) · ข้ามชุดนั้น
        expect((e as Error).message).toMatch(/ปัดเป็น 0 สตางค์/);
        continue;
      }
      expect(r.totalCostUsd).toBe(r.totalCostOutUsd + r.position.costUsd);
      expect(r.totalCostThb).toBe(r.totalCostOutThb + r.position.costThb);
      expect(r.position.units === 0n).toBe(r.position.costUsd === 0);
      expect(r.position.units === 0n).toBe(r.position.costThb === 0);
      expect(r.realizedGainThb).toBe(r.realizedPriceGainThb + r.realizedFxGainThb);
      for (const { result } of r.sells) {
        expect(result.priceGainThb + result.fxGainThb).toBe(result.gainThb);
        expect(result.costOutUsd).toBeGreaterThanOrEqual(1);
        expect(result.position.costUsd).toBeGreaterThanOrEqual(0);
      }
      const shuffled = [...trades].reverse();
      expect(replayTradesFx(shuffled).position).toEqual(r.position); // เรียงตาม (date, createdAt, id) ไม่ขึ้นกับลำดับอินพุต
    }
  });
  it('replayTradesFx: ตัวอย่าง A เล่นซ้ำทั้งชุดได้ผลเท่าคำนวณทีละขั้น', () => {
    const r = replayTradesFx([
      { kind: 'sell', id: 's1', date: '2026-02-01', createdAt: '2026-02-01T00:00:00Z', units: U(4), priceMicro: 120_000_000, fee: 100, fxRateMicro: 33_000_000 },
      { kind: 'buy', id: 'b1', date: '2026-01-01', createdAt: '2026-01-01T00:00:00Z', units: U(10), amount: 100_000, fee: 100, fxRateMicro: 35_000_000 },
    ]);
    expect(r.position).toEqual({ units: U(6), costUsd: 60_060, costThb: 2_102_100 });
    expect(r.realizedGainThb).toBe(179_300);
    expect(r.realizedPriceGainThb).toBe(259_380);
    expect(r.realizedFxGainThb).toBe(-80_080);
    expect(r.totalCostUsd).toBe(100_100);
    expect(r.totalCostThb).toBe(3_503_500);
  });
});
