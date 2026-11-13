import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Header } from '../../src/ui/Header';

/** Header บนมือถือ (design-critic ตัดสิน 13 พ.ย. 2569): ซ่อน "+ เพิ่มรายการ" (ซ้ำกับเมนู pop up) ให้สแกนสลิปเต็มแถว · จอใหญ่ยังมีครบ */
const css = Object.values(import.meta.glob('/src/ui/styles.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';

describe('Header', () => {
  const html = renderToString(
    createElement(Header, { ledger: { accounts: [], entries: [] }, onAdd: () => undefined, onQuickSaved: () => undefined, onScan: () => undefined, scanning: false }),
  );
  it('ยัง render ปุ่ม "เพิ่มรายการ" และ "สแกนสลิป" ทั้งคู่ (จอใหญ่ใช้ได้) ปุ่มเพิ่มมี class ให้ซ่อนบนมือถือ', () => {
    expect(html).toContain('btn btn-primary btn-add btn-add-header');
    expect(html).toContain('เพิ่มรายการ');
    expect(html).toContain('btn btn-add btn-scan');
    expect(html).toContain('สแกนสลิป');
  });
  it('มือถือ ≤720px: ซ่อนด้วย display: none (ออกจากลำดับ Tab) ไม่ใช้ hidden/JS · สแกนสลิปเต็มแถว', () => {
    const block = /@media \(max-width: 720px\) \{\s*\.btn-add-header \{ display: none; \}[\s\S]*?\n\}/.exec(css)?.[0] ?? '';
    expect(block).toContain('.btn-scan { flex: 1 1 100%; justify-content: center; }');
    expect(html).not.toMatch(/btn-add-header[^>]*hidden/);
  });
});
