import { describe, expect, it } from 'vitest';

/** Sankey: จอใหญ่คงแผนภาพ · มือถือ (≤720px) เป็นกราฟแท่งแนวนอน (เจ้าของตัดสิน 13 พ.ย. 2569) · ข้อมูลเดียวกันอยู่ในตารางที่โปรแกรมอ่านจออ่านทุกขนาดจอ */
const ui = import.meta.glob('/src/ui/**/*.{tsx,css}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const sankey = ui['/src/ui/overview/CashFlowSankey.tsx'] ?? '';
const css = ui['/src/ui/styles.css'] ?? '';

describe('Sankey / กราฟแท่งมือถือ', () => {
  it('ตารางข้อมูลเป็น sr-only ทุกขนาดจอ (โปรแกรมอ่านจอ) และมี role ครบ', () => {
    expect(sankey).toContain('<table className="sankey-table sr-only" role="table">');
    expect((sankey.match(/role="cell"/g) ?? []).length).toBe(8);
    expect(css).not.toContain('.sankey-table.sr-only { position: static;');
  });
  it('กราฟแท่งเป็นภาพ (aria-hidden) แหล่งเงิน + เงินไปไหน ใช้สีตามประเภทเดียวกับ Sankey', () => {
    expect(sankey).toContain('<div className="sankey-bars" aria-hidden="true">');
    expect(sankey).toContain('แหล่งเงิน');
    expect(sankey).toContain('เงินไปไหน');
    expect((sankey.match(/background: colorOf\(n, i\)/g) ?? []).length).toBe(2);
  });
  it('CSS: จอใหญ่ซ่อนกราฟแท่ง · ≤720px ซ่อนแผนภาพ SVG ไม่ต้องเลื่อนแนวนอน โชว์กราฟแท่ง', () => {
    expect(css).toContain('.sankey-bars { display: none; }');
    const block = /@media \(max-width: 720px\) \{\s*\.sankey \{ overflow-x: visible; \}[\s\S]*?\n\}/.exec(css)?.[0] ?? '';
    expect(block).toContain('.sankey-svg { display: none; }');
    expect(block).toContain('.sankey-bars { display: block; }');
  });
});
