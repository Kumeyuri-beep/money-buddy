/**
 * เรขาคณิตของกราฟแท่งในหน้า Report (ใช้แสดงผลเท่านั้น ไม่ใช่สูตรเงิน): แปลงค่าจำนวนเต็มเป็นตำแหน่งพิกเซล
 * ค่า null = ไม่วาดแท่ง (คำนวณไม่ได้ ไม่ใช่ 0) · เส้นศูนย์อยู่ในกราฟเสมอ
 */
import type { Cell } from '../../../domain/invest/reportSeries';

export interface BarSeries {
  id: string;
  /** ค่าต่อคอลัมน์ (ตามลำดับคอลัมน์) */
  values: readonly Cell[];
}

export interface Bar {
  seriesId: string;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
}

export interface ChartModel {
  width: number;
  height: number;
  zeroY: number;
  bars: Bar[];
  /** ค่าสูงสุด/ต่ำสุดของแกน (รวม 0) */
  max: number;
  min: number;
}

export const CHART_PAD = { top: 14, bottom: 32, left: 96, right: 8 } as const;

export function buildChartModel(series: readonly BarSeries[], columns: number, plotHeight = 180): ChartModel {
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const span = max - min;
  const groupW = Math.max(28, series.length * 12 + 10);
  const barW = Math.max(4, Math.floor((groupW - 10) / Math.max(1, series.length)));
  const width = CHART_PAD.left + CHART_PAD.right + columns * groupW;
  const height = CHART_PAD.top + CHART_PAD.bottom + plotHeight;
  const toY = (v: number): number => (span === 0 ? CHART_PAD.top + plotHeight : CHART_PAD.top + ((max - v) / span) * plotHeight);
  const zeroY = toY(0);
  const bars: Bar[] = [];
  series.forEach((s, si) => {
    s.values.forEach((v, ci) => {
      if (v === null) return;
      const y = toY(v);
      bars.push({
        seriesId: s.id,
        column: ci,
        x: CHART_PAD.left + ci * groupW + 5 + si * barW,
        y: Math.min(y, zeroY),
        width: barW - 1,
        height: Math.max(v === 0 ? 0 : 1, Math.abs(y - zeroY)),
        value: v,
      });
    });
  });
  return { width, height, zeroY, bars, max, min };
}

/** สีของแท่งตามลำดับที่เลือก (ตัวแปรสีเดิมของระบบ) */
export const SERIES_COLORS = ['var(--chart-fb1)', 'var(--chart-fb2)', 'var(--chart-fb3)', 'var(--chart-fb4)'] as const;
/** เลือกเทียบได้สูงสุดเท่าจำนวนสีกลางของระบบ (สีรายรับ/ขาดดุลมีความหมายอื่น จึงไม่นำมาใช้) */
export const MAX_SERIES = SERIES_COLORS.length;
export const seriesColor = (index: number): string => SERIES_COLORS[index % SERIES_COLORS.length]!;
