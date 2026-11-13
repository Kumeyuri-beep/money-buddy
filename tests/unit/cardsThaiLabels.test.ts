import { describe, expect, it } from 'vitest';

/** การ์ดสรุปภาพรวมสำหรับผู้ใช้ทั่วไป: ชื่อไทยเสมอ, ป้ายอังกฤษซ่อนบนมือถือและไม่อ่านออกเสียง, ผู้ใช้ใหม่ได้ลิงก์ให้เริ่ม (ผลสำรวจ 13 พ.ย. 2569) */
const ui = import.meta.glob('/src/ui/**/*.{tsx,css}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const get = (p: string): string => ui[`/src/ui/${p}`] ?? '';
const cards = get('overview/SummaryCards.tsx');
const sankey = get('overview/CashFlowSankey.tsx');
const css = get('styles.css');

describe('การ์ดสรุป', () => {
  it('ป้ายอังกฤษอยู่ใน span aria-hidden ที่ซ่อนบนมือถือ', () => {
    expect(cards).toMatch(/<span className="summary-label-en" aria-hidden="true">/);
    expect(css).toMatch(/@media \(max-width: 720px\) \{\s*\.summary-label-en \{ display: none; \}/);
  });
  it('หัวข้อ Cash Flow เป็นไทย "เงินเข้า-ออกเดือนนี้" (ไม่ใช่ข้อความอังกฤษล้วน) และคำอธิบายแผนภาพสำหรับโปรแกรมอ่านจอเป็นไทย', () => {
    expect(sankey).not.toMatch(/<h2 id="sankey-title">Cash Flow<\/h2>/);
    expect(sankey).toContain('เงินเข้า-ออกเดือนนี้');
    expect(sankey).toContain('`เงินเข้า-ออก ${thaiMonthKeyLabel(month)}');
  });
  it('การ์ดแรกตอนยังไม่มีรายการมีลิงก์ "บันทึกรายการแรก" ต่อกับปุ่มเพิ่มรายการ', () => {
    expect(cards).toContain('บันทึกรายการแรก →');
    expect(cards).toContain('onAdd={onAdd}');
    expect(get('Today.tsx')).toContain('onAdd={onAdd} />');
  });
  it('การ์ดอัตราการออมที่ยังไม่มีรายรับ บอกเหตุตรงๆ ไม่ใช่ "รอข้อมูลเดือนหน้า"', () => {
    expect(cards).toContain('headline="ยังไม่มีรายรับเดือนนี้"');
  });
});
