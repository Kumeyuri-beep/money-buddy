import { describe, expect, it } from 'vitest';
import { stackColumn } from '../../src/ui/overview/sankeyLayout';
import type { FlowNode } from '../../src/domain/ledger/sankey';

const node = (key: string, shareBps: number): FlowNode => ({ key, name: key, amount: 1, shareBps, kind: 'expense' });

describe('stackColumn: จัดวางแท่ง (พิกเซลเพื่อวาดเท่านั้น)', () => {
  it('คอลัมน์ว่างสูง 0', () => {
    expect(stackColumn([], 300, 8, 10)).toEqual({ placed: [], height: 0, filled: 0 });
  });
  it('ความสูงเป็นสัดส่วนตาม shareBps และวางต่อกันมีช่องว่าง', () => {
    const { placed, height, filled } = stackColumn([node('a', 7000), node('b', 3000)], 300, 8, 10);
    expect(placed.map((p) => p.h)).toEqual([210, 90]);
    expect(placed.map((p) => p.y)).toEqual([0, 220]);
    expect(filled).toBe(300);
    expect(height).toBe(310);
  });
  it('แท่งเล็กมากได้ความสูงขั้นต่ำ เพื่อให้มองเห็น', () => {
    const { placed } = stackColumn([node('a', 9999), node('b', 1)], 300, 8, 10);
    expect(placed[1]?.h).toBe(8);
  });
  it('แท่งเดียว 100% เต็มความสูง ไม่มีช่องว่าง', () => {
    const { placed, height } = stackColumn([node('a', 10000)], 300, 8, 10);
    expect(placed[0]).toMatchObject({ y: 0, h: 300 });
    expect(height).toBe(300);
  });
});
