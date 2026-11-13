import { describe, expect, it } from 'vitest';

/** Sankey บนมือถือ (≤720px): แผนภาพกว้าง 640px ซ่อน แล้วโชว์ตารางข้อมูลเดียวกันเป็นรายการอ่านได้ · จอใหญ่ตารางยังซ่อนไว้ให้โปรแกรมอ่านจอ */
const ui = import.meta.glob('/src/ui/**/*.{tsx,css}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const sankey = ui['/src/ui/overview/CashFlowSankey.tsx'] ?? '';
const css = ui['/src/ui/styles.css'] ?? '';

describe('Sankey บนมือถือ', () => {
  it('ตารางข้อมูลมี role ครบ (เพราะจัดเป็น grid บนมือถือ) และยังเป็น sr-only บนจอใหญ่', () => {
    expect(sankey).toContain('<table className="sankey-table sr-only" role="table">');
    expect(sankey).toContain('<tr key={n.key} role="row">');
    expect((sankey.match(/role="cell"/g) ?? []).length).toBe(8);
    expect((sankey.match(/role="columnheader"/g) ?? []).length).toBe(4);
  });
  it('≤720px: ซ่อนแผนภาพ ไม่ต้องเลื่อนแนวนอน โชว์ตารางเป็นรายการ', () => {
    const block = /@media \(max-width: 720px\) \{\s*\.sankey \{ overflow-x: visible; \}[\s\S]*?\n\}/.exec(css)?.[0] ?? '';
    expect(block).toContain('.sankey-svg { display: none; }');
    expect(block).toMatch(/\.sankey-table\.sr-only \{ position: static;/);
    expect(block).toMatch(/\.sankey-table tr \{ display: grid;/);
  });
});
