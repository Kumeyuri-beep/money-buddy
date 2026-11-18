import { describe, expect, it } from 'vitest';
import cssRaw from '../../src/ui/styles.css?raw';
import { MAX_SERIES, SERIES_COLORS } from '../../src/ui/invest/report/chartModel';

/** สีของแท่งกราฟ Report ต้องต่างจากพื้นการ์ด (--surface-solid) อย่างน้อย 3:1 (WCAG 1.4.11) ทั้งธีมมืดและสว่าง · อ่านค่าจริงจาก styles.css */
const css = cssRaw;
const lum = (hex: string): number => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
const fb = [...css.matchAll(/--chart-fb(\d):\s*(#[0-9a-fA-F]{6})/g)].map((m) => ({ n: Number(m[1]), hex: m[2]! }));
const surfaces = [...css.matchAll(/--surface-solid:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1]!);

describe('สีชุดข้อมูลของกราฟ Report', () => {
  it('ใช้เฉพาะชุดสีกลาง fb1-fb4 (ไม่ใช้สีรายรับ/ขาดดุล) และจำกัด 4 ชุด', () => {
    expect(SERIES_COLORS).toEqual(['var(--chart-fb1)', 'var(--chart-fb2)', 'var(--chart-fb3)', 'var(--chart-fb4)']);
    expect(MAX_SERIES).toBe(4);
  });
  it('คอนทราสต์ ≥ 3:1 กับพื้นการ์ดทุกธีม', () => {
    expect(fb.length).toBe(surfaces.length * 4);
    expect(surfaces).toHaveLength(3); // มืด · สว่าง · สว่างตามเครื่อง
    surfaces.forEach((s, block) => { for (const f of fb.slice(block * 4, block * 4 + 4)) if (f.n <= MAX_SERIES) expect(ratio(f.hex, s), `fb${f.n} ${f.hex} บน ${s}`).toBeGreaterThanOrEqual(3); });
  });
});
