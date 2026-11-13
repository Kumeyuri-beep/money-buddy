import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { SummaryCards } from '../../src/ui/overview/SummaryCards';

/** เจ้าของตัดสิน 13 พ.ย. 2569: มือถือโชว์การ์ดสรุป 3 ใบ + "ดูทั้งหมด" · จอใหญ่ครบ 8 ใบ (กระจกแท้ไม่เกินโควตา) */
const ui = import.meta.glob('/src/ui/styles.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const css = ui['/src/ui/styles.css'] ?? '';
const html = renderToString(createElement(SummaryCards, { accounts: [], entries: [], today: '2026-11-13', finance: { bills: [], settings: {} }, onOpenLedger: () => undefined, onOpenBills: () => undefined }));

describe('การ์ดสรุป (มือถือ 3 ใบ)', () => {
  it('ใน DOM ยังมีการ์ดครบ 8 ใบเสมอ (จอใหญ่เห็นครบ) และเป็นกระจกแท้ 8 ใบ', () => {
    expect((html.match(/<article/g) ?? []).length).toBe(8);
    expect((html.match(/class="glass card summary-card"/g) ?? []).length).toBe(8);
  });
  it('การ์ดที่ซ่อนบนมือถือมี 5 ใบ (รายรับ รายจ่าย อัตราออม เทียบเดือนก่อน เงินสดใช้ได้อีก) ส่วน 3 ใบสำคัญไม่ถูกห่อ', () => {
    expect((html.match(/class="summary-secondary"/g) ?? []).length).toBe(5);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('ดูทั้งหมด (อีก 5 ใบ)');
  });
  it('CSS: ตัวห่อเป็น display: contents บนจอใหญ่ ซ่อนบนมือถือจนกว่าจะกดดูทั้งหมด · ปุ่มแสดงเฉพาะมือถือและสูง 44px', () => {
    expect(css).toContain('.summary-secondary { display: contents; }');
    expect(css).toContain('.summary-toggle { display: none; }');
    expect(css).toContain('.summary-grid:not(.summary-expanded) .summary-secondary { display: none; }');
    expect(css).toMatch(/\.summary-toggle \{ display: inline-flex; justify-content: center; width: 100%; min-height: 44px; \}/);
  });
});
