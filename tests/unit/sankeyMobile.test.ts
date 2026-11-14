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
    // 14 พ.ย. 2569: มือถือมีปุ่มสลับ แผนภาพกะทัดรัด (ค่าเริ่มต้น) / รายการแท่ง
    expect(block).toContain(".sankey[data-view='diagram'] .sankey-compact { display: block; }");
    expect(block).toContain(".sankey[data-view='list'] .sankey-bars { display: block; }");
    expect(css).toContain('.sankey-compact, .sankey-viewtoggle, .sankey-viewnote { display: none; }');
  });
  it('แผนภาพกะทัดรัด: หมวดเล็กหลายอันเรียงชิดสุดแล้วจุดแตะยังไม่ทับกัน (ระยะแท่งเล็กสุด + ช่องว่าง ≥ ความสูงจุดแตะ) และ viewBox เล็กพอให้วาด 1:1 ที่ 360px', () => {
    const num = (name: string): number => Number(new RegExp('const ' + name + ' = (\\d+)').exec(sankey)?.[1]);
    expect(num('C_MIN_BAR') + num('C_GAP')).toBeGreaterThanOrEqual(num('HIT_H'));
    expect(num('CW')).toBeLessThanOrEqual(280);
    expect(num('C_RIGHT') + num('C_BAR_W') + 6 + 60).toBeLessThanOrEqual(num('CW')); // เหลือที่ให้ป้ายฝั่งขวา ≥ 60 หน่วย
  });
});
