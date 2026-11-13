import { describe, expect, it } from 'vitest';

/** เจ้าของตัดสิน 13 พ.ย. 2569: ไม่มีปุ่มเพิ่มรายการลอย · "+ เพิ่มรายการ" เป็นรายการแรกในเมนู pop up มือถือ */
const ui = import.meta.glob('/src/ui/*.{tsx,css}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const menu = ui['/src/ui/MobileMenu.tsx'] ?? '';
const shell = ui['/src/ui/Shell.tsx'] ?? '';
const app = ui['/src/ui/App.tsx'] ?? '';
const css = ui['/src/ui/styles.css'] ?? '';

describe('เมนู pop up มือถือ', () => {
  it('รายการ "เพิ่มรายการ" มาก่อนรายการหน้าทั้งหมด (primaryAction ก่อน items.map) และปิดเมนูแล้วเปิดช่องเพิ่ม', () => {
    expect(menu.indexOf('primaryAction && (')).toBeGreaterThan(0);
    expect(menu.indexOf('primaryAction && (')).toBeLessThan(menu.indexOf('{items.map('));
    expect(menu).toMatch(/close\(false\);\s+primaryAction\.onSelect\(\);/);
  });
  it('Shell ส่ง onAdd เป็น primaryAction และ App ผูกกับ openAdd', () => {
    expect(shell).toContain("label: 'เพิ่มรายการ'");
    expect(app).toContain('onAdd={openAdd}');
  });
  it('ไม่มีปุ่มเพิ่มรายการลอยแยกจากเมนู (มี .fab เดียวคือปุ่มเมนู)', () => {
    expect((menu.match(/className="fab"/g) ?? []).length).toBe(1);
    expect(css).toContain('.sheet-primary { grid-column: 1 / -1; }');
  });
});
