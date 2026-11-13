import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { startGuide } from '../../src/app/startGuide';
import { StartGuide } from '../../src/ui/overview/StartGuide';
import type { Entry } from '../../src/domain/ledger/types';
import type { Bill } from '../../src/domain/bills/types';

/** การ์ด "เริ่มต้น 3 ขั้น": ติ๊กเองจากข้อมูล หายเองเมื่อครบ (เจ้าของตัดสิน 13 พ.ย. 2569) */
const entry = (id: string, source: Entry['source']): Entry => ({ id, date: '2026-11-01', memo: '', source, lines: [] });
const bill = { id: 'b1', name: 'ค่าเน็ต', amount: 59900, dueDay: 5 } as Bill;

describe('startGuide', () => {
  it('ผู้ใช้ใหม่: ยอดยกมา (system) ไม่นับเป็นรายการแรก · ยังไม่ทำขั้นไหนเลย', () => {
    const g = startGuide([entry('o1', 'system')], { bills: [], settings: {} });
    expect(g.steps.map((s) => s.done)).toEqual([false, false, false]);
    expect(g.doneCount).toBe(0);
    expect(g.complete).toBe(false);
  });
  it('ติ๊กแต่ละขั้นจากข้อมูลจริง: รายการที่ไม่ใช่ system · มี payDay · มีบิลอย่างน้อย 1', () => {
    expect(startGuide([entry('e1', 'manual')], { bills: [], settings: {} }).steps[0]!.done).toBe(true);
    expect(startGuide([], { bills: [], settings: { payDay: 25 } }).steps[1]!.done).toBe(true);
    expect(startGuide([], { bills: [bill], settings: {} }).steps[2]!.done).toBe(true);
  });
  it('ครบ 3 ขั้น = complete (การ์ดซ่อนเอง) · ขาดขั้นเดียวยังแสดง', () => {
    const entries = [entry('e1', 'quick')];
    expect(startGuide(entries, { bills: [bill], settings: { payDay: 1 } }).complete).toBe(true);
    expect(startGuide(entries, { bills: [bill], settings: {} }).complete).toBe(false);
  });
});

describe('StartGuide (การ์ด)', () => {
  const props = { onAdd: () => undefined, onOpenBills: () => undefined };
  it('ยังไม่ครบ: แสดงหัวข้อ ความคืบหน้า ปุ่มเฉพาะขั้นที่ยังไม่ทำ และข้อความ (ทำแล้ว)/(ยังไม่ได้ทำ) สำหรับโปรแกรมอ่านจอ', () => {
    const html = renderToString(createElement(StartGuide, { entries: [entry('e1', 'manual')], finance: { bills: [], settings: {} }, ...props })).replace(/<!-- -->/g, '');
    expect(html).toContain('เริ่มต้น 3 ขั้น');
    expect(html).toContain('ทำแล้ว 1 จาก 3 ขั้น');
    expect(html).toContain('(ทำแล้ว)');
    expect(html).toContain('(ยังไม่ได้ทำ)');
    expect(html).toContain('ตั้งวันเงินเดือน');
    expect(html).not.toContain('>บันทึกรายการ<'); // ขั้นที่ทำแล้วไม่มีปุ่ม
  });
  it('ครบแล้ว: ไม่ render อะไรเลย', () => {
    const html = renderToString(createElement(StartGuide, { entries: [entry('e1', 'manual')], finance: { bills: [bill], settings: { payDay: 25 } }, ...props }));
    expect(html).toBe('');
  });
  it('เป็นพื้นทึบ (.solid) ไม่ใช่กระจกแท้ จึงไม่กินโควตาการ์ดกระจก 8 ใบ', () => {
    const html = renderToString(createElement(StartGuide, { entries: [], finance: { bills: [], settings: {} }, ...props }));
    expect(html).toContain('class="solid card start-guide"');
    expect(html).not.toMatch(/class="[^"]*\bglass\b[^"]*"/);
  });
});
