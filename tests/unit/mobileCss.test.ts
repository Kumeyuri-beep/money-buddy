import { describe, expect, it } from 'vitest';

/** มือถือ (360px): ตัวควบคุมที่แตะบ่อยสูง ≥44px · dialog ใช้ dvh · ตรวจจากซอร์ส CSS (ผลบนหน้าจอจริงดูด้วยภาพจาก harness) */
const css = Object.values(import.meta.glob('/src/ui/styles.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
const mobileBlocks = [...css.matchAll(/@media \(max-width: 720px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1] ?? '').join('\n');

describe('มือถือ ≤720px', () => {
  it('ปุ่มเล็ก ปุ่มใน toast ตัวเลือกประเภท select ของการจดด่วน สูงอย่างน้อย 44px', () => {
    expect(mobileBlocks).toMatch(/\.btn-small, \.toast-btn, \.seg-item, \.quick-field select \{ min-height: 44px; \}/);
  });
  it('ปุ่มแสดงรหัสผ่านกว้างสูง 44px และช่องเว้นที่ให้', () => {
    expect(mobileBlocks).toMatch(/\.password-toggle \{ width: 44px; height: 44px; \}/);
    expect(mobileBlocks).toMatch(/\.password-row input \{ padding-right: 60px; \}/);
  });
  it('ปุ่มแก้ไข/ลบในรายการเว้นช่อง ≥10px กันกดผิด', () => {
    expect(mobileBlocks).toMatch(/\.tx-actions \{ gap: 10px; \}/);
  });
  it('dialog ใช้ความสูงที่เห็นจริง (dvh) เมื่อแป้นพิมพ์ขึ้น มีตัวสำรอง vh', () => {
    expect(css).toMatch(/\.entry-dialog \{ max-height: calc\(100vh - 32px\); overflow-y: auto; \}/);
    expect(css).toMatch(/@supports \(height: 100dvh\) \{\s*\.entry-dialog \{ max-height: calc\(100dvh - 32px\); \}/);
  });
});

describe('การ์ดสรุปบนมือถือ', () => {
  it('สูงตามเนื้อหา (ไม่ fix 168px) ช่องไฟกระชับ', () => {
    expect(css).toMatch(/@media \(max-width: 720px\) \{\s*\.summary-grid \{ gap: 12px; \}\s*\.summary-card \{ min-height: 0; padding: 16px 18px; \}/);
  });
});
