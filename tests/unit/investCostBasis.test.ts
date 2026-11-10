import { describe, expect, it } from 'vitest';
import { applyBuy, applySell, averageCostMicro, emptyPosition, replayTrades, type Trade } from '../../src/domain/invest/costBasis';
import { parsePriceMicro, parseUnits, UNIT_SCALE } from '../../src/domain/invest/units';

const U = (s: string) => parseUnits(s);
const P = (s: string) => parsePriceMicro(s);

describe('ซื้อ: ต้นทุน = มูลค่าซื้อ + ค่าธรรมเนียม (ตรงกับเงินที่ออกจากกระเป๋า)', () => {
  it('ซื้อ 3 ครั้งมีค่าธรรมเนียม', () => {
    let p = emptyPosition();
    p = applyBuy(p, { units: UNIT_SCALE, amount: 10_000, fee: 7 });
    p = applyBuy(p, { units: UNIT_SCALE, amount: 10_001, fee: 3 });
    p = applyBuy(p, { units: UNIT_SCALE, amount: 10_002, fee: 6 });
    expect(p).toEqual({ units: 3n * UNIT_SCALE, cost: 30_019 });
  });
  it('ปฏิเสธ: หน่วย 0, ต้นทุนรวม 0, ค่าธรรมเนียมติดลบ, ไม่ใช่จำนวนเต็ม', () => {
    const p = emptyPosition();
    expect(() => applyBuy(p, { units: 0n, amount: 100, fee: 0 })).toThrow(RangeError);
    expect(() => applyBuy(p, { units: UNIT_SCALE, amount: 0, fee: 0 })).toThrow(RangeError);
    expect(() => applyBuy(p, { units: UNIT_SCALE, amount: 100, fee: -1 })).toThrow(RangeError);
    expect(() => applyBuy(p, { units: UNIT_SCALE, amount: 1.5, fee: 0 })).toThrow(RangeError);
  });
  it('ต้นทุนรวมเกินช่วงปลอดภัยโยน RangeError', () => {
    const p = applyBuy(emptyPosition(), { units: UNIT_SCALE, amount: Number.MAX_SAFE_INTEGER, fee: 0 });
    expect(() => applyBuy(p, { units: UNIT_SCALE, amount: 1, fee: 0 })).toThrow(RangeError);
  });
});

describe('ขาย: ต้นทุนเฉลี่ย + invariant (ตัวอย่างจากผลตรวจ money-auditor)', () => {
  const start = () => {
    let p = emptyPosition();
    p = applyBuy(p, { units: UNIT_SCALE, amount: 10_000, fee: 7 });
    p = applyBuy(p, { units: UNIT_SCALE, amount: 10_001, fee: 3 });
    return applyBuy(p, { units: UNIT_SCALE, amount: 10_002, fee: 6 });
  };
  it('ขาย 2 หน่วยแล้วขายหมด: costOut 20,013 + 10,006 = 30,019 พอดี ต้นทุนเหลือ 0', () => {
    const s1 = applySell(start(), { units: 2n * UNIT_SCALE, priceMicro: P('100'), fee: 0 });
    expect(s1.costOut).toBe(20_013);
    expect(s1.position).toEqual({ units: UNIT_SCALE, cost: 10_006 });
    const s2 = applySell(s1.position, { units: UNIT_SCALE, priceMicro: P('100'), fee: 0 });
    expect(s2.costOut).toBe(10_006);
    expect(s2.position).toEqual({ units: 0n, cost: 0 });
    expect(s1.costOut + s2.costOut).toBe(30_019);
  });
  it('ค่าธรรมเนียมขายหักจากเงินที่ได้: gain = (gross − F) − costOut', () => {
    const s = applySell(start(), { units: UNIT_SCALE, priceMicro: P('150'), fee: 25 });
    expect(s.gross).toBe(15_000);
    expect(s.net).toBe(14_975);
    expect(s.costOut).toBe(10_006); // 30,019 / 3 = 10,006.33
    expect(s.gain).toBe(14_975 - 10_006);
    expect(s.gain + s.costOut).toBe(s.net);
  });
  it('ขายขาดทุนได้ gain ติดลบ · กำไร 0 พอดี', () => {
    const loss = applySell(start(), { units: UNIT_SCALE, priceMicro: P('50'), fee: 0 });
    expect(loss.gain).toBe(5_000 - 10_006);
    const flat = applySell(start(), { units: UNIT_SCALE, priceMicro: P('100.06'), fee: 0 });
    expect(flat.gross).toBe(10_006);
    expect(flat.gain).toBe(0);
  });
  it('ขายเกินที่ถือปฏิเสธ · ขายหน่วย 0 ปฏิเสธ · ถือศูนย์แล้วขายปฏิเสธ', () => {
    expect(() => applySell(start(), { units: 3n * UNIT_SCALE + 1n, priceMicro: P('1'), fee: 0 })).toThrow(RangeError);
    expect(() => applySell(start(), { units: 0n, priceMicro: P('1'), fee: 0 })).toThrow(RangeError);
    expect(() => applySell(emptyPosition(), { units: 1n, priceMicro: P('1'), fee: 0 })).toThrow(RangeError);
  });
  it('ค่าธรรมเนียมขายเกินเงินที่ขายได้ปฏิเสธ · ติดลบปฏิเสธ', () => {
    expect(() => applySell(start(), { units: UNIT_SCALE, priceMicro: P('1'), fee: 101 })).toThrow(RangeError);
    expect(() => applySell(start(), { units: UNIT_SCALE, priceMicro: P('1'), fee: -1 })).toThrow(RangeError);
  });
  it('ขาย U − 1 step: ยังเหลือหน่วยก็ต้องเหลือต้นทุน ≥ 1 (clamp, H1)', () => {
    const p = applyBuy(emptyPosition(), { units: U('3'), amount: 100_000, fee: 0 });
    const s = applySell(p, { units: U('3') - 1n, priceMicro: P('1'), fee: 0 });
    expect(s.position.units).toBe(1n);
    expect(s.position.cost).toBeGreaterThanOrEqual(1);
    expect(s.costOut + s.position.cost).toBe(100_000);
  });
  it('C = 1 สตางค์ ขายบางส่วน: ต้นทุนไม่หายไปเมื่อยังถืออยู่ (clamp)', () => {
    const p = applyBuy(emptyPosition(), { units: U('2'), amount: 1, fee: 0 });
    const s = applySell(p, { units: U('1'), priceMicro: P('1'), fee: 0 });
    expect(s.costOut).toBe(0);
    expect(s.position).toEqual({ units: U('1'), cost: 1 });
  });
  it('ขาย 1 step จากหน่วยจำนวนมาก', () => {
    const p = applyBuy(emptyPosition(), { units: U('1000'), amount: 5_000_000, fee: 0 });
    const s = applySell(p, { units: 1n, priceMicro: P('50'), fee: 0 });
    expect(s.costOut).toBe(0);
    expect(s.gross).toBe(0);
    expect(s.position.cost).toBe(5_000_000);
  });
});

describe('replayTrades: เล่นซ้ำรายการเรียง (date, createdAt, id)', () => {
  const buy = (id: string, date: string, units: string, amount: number, fee = 0, createdAt = '1'): Trade => ({
    id, date, createdAt, kind: 'buy', units: U(units), amount, fee,
  });
  const sell = (id: string, date: string, units: string, price: string, fee = 0, createdAt = '1'): Trade => ({
    id, date, createdAt, kind: 'sell', units: U(units), priceMicro: P(price), fee,
  });

  it('เรียงตามวันที่ แม้ส่งมาสลับ และผลต้องตรง invariant', () => {
    const r = replayTrades([
      sell('s1', '2026-02-01', '1', '120'),
      buy('b1', '2026-01-01', '2', 20000),
      buy('b2', '2026-01-15', '1', 9000),
    ]);
    expect(r.totalCost).toBe(29_000);
    expect(r.totalCostOut).toBe(9_667); // 29,000 / 3 = 9,666.67
    expect(r.position).toEqual({ units: 2n * UNIT_SCALE, cost: 19_333 });
    expect(r.realizedGain).toBe(12_000 - 9_667);
    expect(r.totalCost).toBe(r.totalCostOut + r.position.cost);
  });
  it('เวลาเท่ากันเรียงด้วย createdAt แล้ว id (ผลคงที่ไม่ขึ้นกับลำดับอินพุต)', () => {
    const t = [buy('a', '2026-01-01', '1', 10000, 0, '2'), sell('b', '2026-01-01', '1', '100', 0, '3'), buy('c', '2026-01-01', '1', 10000, 0, '1')];
    expect(replayTrades(t)).toEqual(replayTrades([...t].reverse()));
  });
  it('ขายก่อนซื้อ (ถือไม่พอ ณ เวลานั้น) โยน RangeError', () => {
    expect(() => replayTrades([sell('s', '2026-01-01', '1', '100'), buy('b', '2026-01-02', '1', 10000)])).toThrow(RangeError);
  });
  it('ไม่มีรายการ = ตำแหน่งว่าง', () => {
    expect(replayTrades([]).position).toEqual(emptyPosition());
  });
  it('สุ่มซื้อขาย 1,000 รอบ (seed คงที่): Σ ต้นทุนซื้อ = ΣcostOut + C เหลือ และ U=0 ⇔ C=0 ทุกขั้น', () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    let p = emptyPosition();
    let bought = 0;
    let out = 0;
    for (let i = 0; i < 1000; i++) {
      if (p.units === 0n || rnd(3) !== 0) {
        const amount = 1 + rnd(50_000);
        const fee = rnd(30);
        p = applyBuy(p, { units: BigInt(1 + rnd(900_000_000)), amount, fee });
        bought += amount + fee;
      } else {
        const u = 1n + BigInt(rnd(Number(p.units)));
        const s = applySell(p, { units: u, priceMicro: 1 + rnd(5_000_000_000), fee: 0 });
        out += s.costOut;
        p = s.position;
      }
      expect(p.units === 0n).toBe(p.cost === 0);
      expect(p.cost).toBeGreaterThanOrEqual(0);
      expect(bought).toBe(out + p.cost);
    }
  });
});

describe('ราคาเฉลี่ยต่อหน่วย (ค่าแสดงผลเท่านั้น)', () => {
  it('= ต้นทุนรวม / หน่วย เป็น micro-baht ปัดครั้งเดียว · ไม่มีหน่วย = null', () => {
    const p = applyBuy(emptyPosition(), { units: U('3'), amount: 100_000, fee: 0 });
    expect(averageCostMicro(p)).toBe(333_333_333); // 333.333333 บาท
    expect(averageCostMicro(emptyPosition())).toBeNull();
  });
});
