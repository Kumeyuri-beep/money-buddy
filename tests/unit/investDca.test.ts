import { describe, expect, it } from 'vitest';
import { applyBuy, emptyPosition } from '../../src/domain/invest/costBasis';
import { dcaUnits, marketSummary, projectDca } from '../../src/domain/invest/dca';
import { parsePriceMicro, parseUnits, UNIT_SCALE } from '../../src/domain/invest/units';

describe('dcaUnits: units = ปัดครั้งเดียว (A × 10^12 / ราคา)', () => {
  it('ตัวอย่างในกฎ: 1,000 บาท ราคา 333.3333 → 3.0000003 หน่วย', () => {
    expect(dcaUnits(100_000, parsePriceMicro('333.3333'))).toBe(parseUnits('3.0000003'));
  });
  it('ราคาเศษ 1/3 และ A = 1 สตางค์', () => {
    expect(dcaUnits(1, parsePriceMicro('3'))).toBe(parseUnits('0.00333333'));
    expect(dcaUnits(1, parsePriceMicro('0.01'))).toBe(UNIT_SCALE);
  });
  it('units เกินเพดาน int64 ถูกปฏิเสธ', () => {
    expect(() => dcaUnits(9_000_000_000_000_000, 1)).toThrow(RangeError);
  });
  it('units เป็น 0 / A ≤ 0 / ราคา 0 ถูกปฏิเสธ', () => {
    expect(() => dcaUnits(1, 10 ** 14)).toThrow(RangeError);
    expect(() => dcaUnits(0, 1_000_000)).toThrow(RangeError);
    expect(() => dcaUnits(-5, 1_000_000)).toThrow(RangeError);
    expect(() => dcaUnits(100, 0)).toThrow(RangeError);
  });
});

describe('projectDca: หลายงวด', () => {
  it('Σ เงินที่ออก = ΣA + ΣF ตรงเป๊ะ และต้นทุนบันทึก = A+F (ไม่คำนวณกลับจากหน่วย)', () => {
    const periods = [
      { amount: 100_000, fee: 5, priceMicro: parsePriceMicro('10') },
      { amount: 100_000, fee: 5, priceMicro: parsePriceMicro('12.5') },
      { amount: 100_000, fee: 0, priceMicro: parsePriceMicro('8.3333') },
    ];
    const r = projectDca(emptyPosition(), periods);
    expect(r.totalPaid).toBe(300_010);
    expect(r.position.cost).toBe(300_010);
    expect(r.steps).toHaveLength(3);
    expect(r.steps.map((s) => s.units)).toEqual(periods.map((p) => dcaUnits(p.amount, p.priceMicro)));
  });
  it('ต่อจากตำแหน่งเดิม', () => {
    const start = applyBuy(emptyPosition(), { units: UNIT_SCALE, amount: 10_000, fee: 0 });
    const r = projectDca(start, [{ amount: 10_000, fee: 0, priceMicro: parsePriceMicro('100') }]);
    expect(r.position).toEqual({ units: 2n * UNIT_SCALE, cost: 20_000 });
  });
  it('งวดที่ไม่ถูกต้องทำให้ทั้งชุดล้ม (ไม่ข้ามเงียบ)', () => {
    expect(() => projectDca(emptyPosition(), [{ amount: 100, fee: 0, priceMicro: 0 }])).toThrow(RangeError);
  });
  it('ไม่มีงวด = ตำแหน่งเดิม', () => {
    expect(projectDca(emptyPosition(), []).position).toEqual(emptyPosition());
  });
});

describe('marketSummary: มูลค่าตามราคาที่กรอก เทียบต้นทุน (ค่าแสดงผล)', () => {
  it('กำไร/ขาดทุนที่ยังไม่ขาย = มูลค่า − ต้นทุน', () => {
    const p = applyBuy(emptyPosition(), { units: parseUnits('100'), amount: 100_000, fee: 0 });
    expect(marketSummary(p, parsePriceMicro('12'))).toEqual({ value: 120_000, cost: 100_000, unrealized: 20_000 });
    expect(marketSummary(p, parsePriceMicro('9'))).toEqual({ value: 90_000, cost: 100_000, unrealized: -10_000 });
  });
  it('ยังไม่กรอกราคา = null (ห้ามใช้ต้นทุนแทนเงียบๆ)', () => {
    const p = applyBuy(emptyPosition(), { units: UNIT_SCALE, amount: 100, fee: 0 });
    expect(marketSummary(p, null)).toBeNull();
  });
});
