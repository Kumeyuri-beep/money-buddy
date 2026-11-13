import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { TradeRecord } from '../../src/domain/invest/types';
import { formatBaht, satang } from '../../src/domain/money/satang';
import { KIND_LABEL, TradeItem } from '../../src/ui/TradeItem';

/** ประวัติรายการลงทุนเป็นรายการย่อยกดขยายได้ (เจ้าของสั่ง 13 พ.ย. 2569) · ข้อมูลสมมติทั้งหมด */
const css = Object.values(import.meta.glob('/src/ui/styles.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
const view = Object.values(import.meta.glob('/src/ui/PortfolioView.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
const baht = (n: number): string => formatBaht(satang(n));

const trade = (over: Partial<TradeRecord> = {}): TradeRecord => ({
  id: 't1', assetId: 'a1', kind: 'buy', date: '2026-11-05', createdAt: '2026-11-05T03:00:00.000Z',
  units: '500000000', priceMicro: 10_000_000, amount: 50_000, fee: 5, withholding: 0, memo: '', ...over,
});
const html = (tr: TradeRecord, confirmDelete = false, busy = false) =>
  renderToString(createElement(TradeItem, { tr, confirmDelete, busy, onDelete: () => undefined })).replace(/<!-- -->/g, '');

describe('TradeItem', () => {
  it('เป็น <details>: พับอยู่ตอนแรก (ไม่มี open) · summary มีวันที่ ชนิด ค่าหลัก', () => {
    const h = html(trade());
    expect(h).toContain('<details>');
    expect(h).not.toContain('<details open');
    expect(h).toMatch(/<summary>.*trade-when.*trade-kind.*trade-main.*<\/summary>/s);
    expect(h).toContain(`>${KIND_LABEL.buy}<`);
    expect(h).toContain(`<span class="trade-main num">${baht(50_000)}</span>`);
  });
  it('รายละเอียดเป็นแถวป้าย/ค่าทีละบรรทัด (ไม่เป็นบรรทัดยาวคั่นด้วย ·)', () => {
    const h = html(trade({ fee: 5, withholding: 100, memo: 'บันทึกทดสอบ' }));
    for (const label of ['จำนวนหน่วย', 'ราคาต่อหน่วย', 'ยอดเงิน', 'ค่าธรรมเนียม', 'ภาษีหัก ณ ที่จ่าย', 'บันทึก']) expect(h, label).toContain(`<dt>${label}</dt>`);
    expect(h).toContain(`<dt>ค่าธรรมเนียม</dt><dd class="num">${baht(5)}</dd>`);
    expect(h).toContain(`<dt>ภาษีหัก ณ ที่จ่าย</dt><dd class="num">${baht(100)}</dd>`);
    expect(h).toContain('<dd>บันทึกทดสอบ</dd>');
    expect(h).not.toContain(' · ');
  });
  it('ไม่มีค่า = ไม่แสดงแถว · ขาย (ไม่มียอด) ใช้จำนวนหน่วยเป็นค่าหลัก', () => {
    const h = html(trade({ kind: 'sell', amount: undefined, fee: 0, withholding: 0, memo: '' }));
    for (const label of ['ยอดเงิน', 'ค่าธรรมเนียม', 'ภาษีหัก ณ ที่จ่าย', 'บันทึก']) expect(h, label).not.toContain(`<dt>${label}</dt>`);
    expect(h).toMatch(/<span class="trade-main num">[^<]* หน่วย<\/span>/);
    expect(h).toContain(`>${KIND_LABEL.sell}<`);
  });
  it('ปุ่มลบ: อยู่ในส่วนที่ขยาย · ชื่ออ่านด้วยวันที่ไทย · ยืนยันลบ/ปิดปุ่มตามสถานะ', () => {
    expect(html(trade())).toContain('aria-label="ลบรายการ ซื้อ');
    expect(html(trade())).not.toMatch(/aria-label="[^"]*2026-11-05/);
    const confirm = html(trade(), true);
    expect(confirm).toContain('confirm-delete');
    expect(confirm).toContain('ยืนยันลบ');
    expect(html(trade(), false, true)).toMatch(/<button[^>]*disabled/);
    const h = html(trade());
    expect(h.indexOf('<button')).toBeGreaterThan(h.indexOf('</dl>'));
  });
  it('รอยืนยันลบ = เปิดส่วนที่ขยายไว้ให้เห็นปุ่ม · ยอด 0 บาทยังแสดง (ไม่ถูกซ่อน)', () => {
    expect(html(trade(), true)).toContain('<details open="">');
    expect(html(trade(), false)).not.toContain('open');
    expect(html(trade(), true)).toContain('รอการยืนยันลบ');
    expect(html(trade(), false)).not.toContain('รอการยืนยันลบ');
    const zero = html(trade({ amount: 0 }));
    expect(zero).toContain(`<span class="trade-main num">${baht(0)}</span>`);
    expect(zero).toContain(`<dt>ยอดเงิน</dt><dd class="num">${baht(0)}</dd>`);
  });
  it('ไม่ใช่ปุ่มซ้อนใน summary (ปุ่มลบอยู่นอก summary)', () => {
    const h = html(trade());
    const summary = h.slice(h.indexOf('<summary>'), h.indexOf('</summary>'));
    expect(summary).not.toContain('<button');
  });
});

describe('การต่อสาย + CSS', () => {
  it('หน้าพอร์ตใช้ TradeItem แทนบรรทัดยาว · ไม่มีข้อความต่อด้วย · เหลือในประวัติ', () => {
    expect(view).toContain('<TradeItem');
    expect(view).not.toContain('ค่าธรรมเนียม ${baht(tr.fee)}');
    expect(view).not.toContain('ภาษีหัก ${baht(tr.withholding)}');
  });
  it('summary สูงอย่างน้อย 44px โฟกัสเห็นชัด · ค่าหลักชิดขวาไม่ตัดกลางตัวเลข · ปุ่มลบมือถือเต็มแถว 44px', () => {
    expect(css).toMatch(/\.trade-item summary\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.trade-item summary:focus-visible\s*\{[^}]*outline/);
    expect(css).toMatch(/\.trade-main\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.trade-item summary::after\s*\{[^}]*content:\s*'▾'/); // ลูกศรบอกว่าขยายได้
    expect(css).toMatch(/\.trade-delete\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/@media \(max-width: 720px\)\s*\{\s*\.trade-delete\s*\{[^}]*width:\s*100%[^}]*min-height:\s*44px/);
  });
});
