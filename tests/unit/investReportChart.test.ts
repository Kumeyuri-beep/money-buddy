import { describe, expect, it } from 'vitest';
import { buildChartModel, seriesColor, SERIES_COLORS } from '../../src/ui/invest/report/chartModel';

describe('buildChartModel', () => {
  it('null ไม่วาดแท่ง · 0 ไม่มีความสูง · เส้นศูนย์อยู่ระหว่างแท่งบวกและลบ', () => {
    const m = buildChartModel([{ id: 'a', values: [100, null, -50, 0] }], 4);
    expect(m.bars.map((b) => b.column)).toEqual([0, 2, 3]);
    const pos = m.bars.find((b) => b.column === 0)!;
    const neg = m.bars.find((b) => b.column === 2)!;
    expect(pos.y + pos.height).toBeCloseTo(m.zeroY);
    expect(neg.y).toBeCloseTo(m.zeroY);
    expect(m.bars.find((b) => b.column === 3)!.height).toBe(0);
  });
  it('ทุกค่า null หรือว่าง ไม่ล้ม', () => {
    expect(buildChartModel([{ id: 'a', values: [null, null] }], 2).bars).toEqual([]);
    expect(buildChartModel([], 0).bars).toEqual([]);
  });
  it('สองชุดข้อมูลได้แท่งแยกตำแหน่ง และสีต่างกัน', () => {
    const m = buildChartModel([{ id: 'a', values: [10] }, { id: 'b', values: [20] }], 1);
    expect(m.bars).toHaveLength(2);
    expect(m.bars[0]!.x).not.toBe(m.bars[1]!.x);
    expect(seriesColor(0)).not.toBe(seriesColor(1));
    expect(seriesColor(SERIES_COLORS.length)).toBe(seriesColor(0));
  });
});
