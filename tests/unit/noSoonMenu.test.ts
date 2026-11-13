import { describe, expect, it } from 'vitest';

/** เจ้าของตัดสิน 13 พ.ย. 2569: ตัดเมนู "เร็วๆ นี้" (แผนลงทุน, ปรับสมดุลพอร์ต) ออก — ไม่มีเมนูที่ยังไม่มีหน้า */
const ui = import.meta.glob('/src/ui/*.{tsx,css}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const shell = ui['/src/ui/Shell.tsx'] ?? '';
const css = ui['/src/ui/styles.css'] ?? '';

describe('เมนูหลัก', () => {
  it('ไม่มีเมนูเร็วๆ นี้/เมนูที่ไม่มีหน้า', () => {
    expect(shell).not.toContain('เร็วๆ นี้');
    expect(shell).not.toContain("label: 'แผนลงทุน'");
    expect(shell).not.toContain("label: 'ปรับสมดุลพอร์ต'");
    expect(shell).not.toContain('id: null');
    expect(css).not.toContain('.nav-item-soon');
  });
  it('ทุกเมนูมีหน้า (id เป็น ViewId เสมอ)', () => {
    expect(shell).toMatch(/id: ViewId;/);
  });
});
