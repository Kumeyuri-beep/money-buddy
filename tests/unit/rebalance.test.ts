import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/r29-examples.json';
import { rebalance, type RebalanceCategory, type RebalanceHolding, type RebalanceInput, type RebalanceResult, type RebalanceRow } from '../../src/domain/invest/rebalance';

// ตัวอย่างทั้งหมดอ่านจาก tests/fixtures/r29-examples.json ไฟล์เดียว (ห้ามคัดลอกตัวเลข)
const CATS: RebalanceCategory[] = Object.entries(fixture.targetsBps).map(([name, bps], i) => ({ id: name, name, sortOrder: i, targetBps: bps }));
const HOLDINGS: RebalanceHolding[] = fixture.holdings.map((h) => ({
  id: h.id,
  ticker: h.id,
  categoryId: h.category,
  currency: 'USD',
  units: BigInt(h.units),
  priceMicro: Number(h.priceMicro),
}));

const base = (over: Partial<RebalanceInput>): RebalanceInput => ({
  mode: 'deposit',
  amountCents: 0,
  allowSales: false,
  fractional: true,
  minOrderCents: 0,
  categories: CATS,
  holdings: HOLDINGS,
  ...over,
});

function ok(r: RebalanceResult) {
  if (!r.ok) throw new Error(`ไม่คำนวณ: ${r.reason}`);
  return r;
}
const simple = (rows: RebalanceRow[]) => rows.map((r) => ({ id: r.holdingId, units: r.units.toString(), cents: r.cents }));

type Case = {
  deposit?: number;
  withdraw?: number;
  allowSales?: boolean;
  fractional: boolean;
  categoryMoney?: Record<string, number>;
  buys: { id: string; units: string; cents: number }[];
  sells: { id: string; units: string; cents: number }[];
  droppedRows?: { id: string; reason: string }[];
  leftOver?: number;
  shortBy: number;
};

const cases = fixture.cases as unknown as Record<string, Case>;

describe('R29 ตัวอย่างมือจาก fixture', () => {
  for (const [name, c] of Object.entries(cases)) {
    it(`ตัวอย่าง ${name} ตรงทุกค่า`, () => {
      const r = ok(
        rebalance(
          base(
            c.withdraw !== undefined
              ? { mode: 'withdraw', amountCents: c.withdraw, fractional: c.fractional }
              : { amountCents: c.deposit ?? 0, allowSales: c.allowSales ?? false, fractional: c.fractional },
          ),
        ),
      );
      expect(simple(r.buys)).toEqual(c.buys);
      expect(simple(r.sells)).toEqual(c.sells);
      expect(r.shortByCents).toBe(c.shortBy);
      if (c.leftOver !== undefined) expect(r.leftOverCents).toBe(c.leftOver);
      if (c.categoryMoney) {
        for (const row of r.categoryRows) expect(row.allocatedCents).toBe(c.categoryMoney[row.categoryId]);
      }
      if (c.droppedRows) {
        const map = { 'units=0': 'unitsZero', belowMin: 'belowMinOrder' } as Record<string, string>;
        expect(r.droppedRows.map((d) => ({ id: d.holdingId, reason: d.reason }))).toEqual(
          c.droppedRows.map((d) => ({ id: d.id, reason: map[d.reason] ?? d.reason })),
        );
      }
    });
  }

  it('มูลค่าหมวดตรง fixture', () => {
    const r = ok(rebalance(base({ amountCents: 1 })));
    for (const row of r.categoryRows) expect(row.nowCents).toBe((fixture.valueCents as Record<string, number>)[row.categoryId]);
    expect(r.totalNowCents).toBe(fixture.valueCents.total);
  });
});
