import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { nextFocusAfterDelete } from '../../src/app/tradeFocus';
import { GLOSSARY, glossaryText } from '../../src/domain/invest/glossary';
import type { TradeRecord } from '../../src/domain/invest/types';
import { formatBaht, satang } from '../../src/domain/money/satang';
import { TermHelp } from '../../src/ui/TermHelp';
import { KIND_LABEL, TradeItem, tradeButtonId } from '../../src/ui/TradeItem';

/** ประวัติรายการลงทุนเป็นรายการย่อยกดขยายได้ (13 พ.ย. 2569) · 14 พ.ย.: ปุ่ม disclosure แทน details ซ้อน, โฟกัสหลังลบ, คำอธิบายศัพท์ · ข้อมูลสมมติทั้งหมด */
const raws = import.meta.glob('/src/ui/*.{tsx,css}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const read = (name: string): string => Object.entries(raws).find(([k]) => k.endsWith('/' + name))?.[1] ?? '';
const css = read('styles.css');
const view = read('PortfolioView.tsx');
const baht = (n: number): string => formatBaht(satang(n));

const trade = (over: Partial<TradeRecord> = {}): TradeRecord => ({
  id: 't1', assetId: 'a1', kind: 'buy', date: '2026-11-05', createdAt: '2026-11-05T03:00:00.000Z',
  units: '500000000', priceMicro: 10_000_000, amount: 50_000, fee: 5, withholding: 0, memo: '', ...over,
});
const html = (tr: TradeRecord, confirmDelete = false, busy = false) =>
  renderToString(createElement(TradeItem, { tr, confirmDelete, busy, onDelete: () => undefined })).replace(/<!-- -->/g, '');

describe('TradeItem: ปุ่ม disclosure (ไม่ใช่ <details> ซ้อน)', () => {
  it('ปุ่ม aria-expanded=false + aria-controls ชี้ส่วนที่ซ่อน (hidden) · ไม่มี <details>/<summary> ในรายการ', () => {
    const h = html(trade());
    expect(h).not.toMatch(/<details|<summary/);
    expect(h).toMatch(/<button type="button" id="trade-btn-t1" class="trade-summary" aria-expanded="false" aria-controls="([^"]+)"/);
    const controls = /aria-controls="([^"]+)"/.exec(h)?.[1] ?? '';
    expect(h).toContain(`<div id="${controls}" hidden="">`);
  });
  it('ปุ่มมีวันที่ ชนิด ค่าหลัก คั่นด้วยช่องว่างจริง (โปรแกรมอ่านจอไม่อ่านติดกัน)', () => {
    const h = html(trade());
    expect(h).toMatch(/trade-when">[^<]+<\/span> <span class="trade-kind">ซื้อ<\/span> <span class="trade-main num">/);
    expect(h).toContain(`<span class="trade-main num">${baht(50_000)}</span>`);
  });
  it('รายละเอียดเป็นแถวป้าย/ค่าทีละบรรทัด (ไม่เป็นบรรทัดยาวคั่นด้วย ·)', () => {
    const h = html(trade({ fee: 5, withholding: 100, memo: 'บันทึกทดสอบ' }));
    for (const label of ['จำนวนหน่วย', 'ราคาต่อหน่วย', 'ยอดเงิน', 'ค่าธรรมเนียม', 'ภาษีหัก ณ ที่จ่าย', 'บันทึก']) expect(h, label).toContain(`<dt>${label}</dt>`);
    expect(h).toContain(`<dt>ค่าธรรมเนียม</dt><dd class="num">${baht(5)}</dd>`);
    expect(h).toContain('<dd>บันทึกทดสอบ</dd>');
    expect(h).not.toContain(' · ');
  });
  it('ไม่มีค่า = ไม่แสดงแถว · ขาย (ไม่มียอด) ใช้จำนวนหน่วยเป็นค่าหลัก · ยอด 0 ยังแสดง', () => {
    const h = html(trade({ kind: 'sell', amount: undefined, fee: 0, withholding: 0, memo: '' }));
    for (const label of ['ยอดเงิน', 'ค่าธรรมเนียม', 'ภาษีหัก ณ ที่จ่าย', 'บันทึก']) expect(h, label).not.toContain(`<dt>${label}</dt>`);
    expect(h).toMatch(/<span class="trade-main num">[^<]* หน่วย<\/span>/);
    expect(html(trade({ amount: 0 }))).toContain(`<span class="trade-main num">${baht(0)}</span>`);
  });
  it('รอยืนยันลบ = ขยายไว้ (aria-expanded=true ไม่มี hidden) และมีข้อความ "รอการยืนยันลบ" ให้โปรแกรมอ่านจอ', () => {
    const h = html(trade(), true);
    expect(h).toContain('aria-expanded="true"');
    expect(h).not.toContain('hidden=""');
    expect(h).toContain('รอการยืนยันลบ');
    expect(html(trade(), false)).not.toContain('รอการยืนยันลบ');
  });
  it('ปุ่มลบอยู่ในส่วนที่ขยาย นอกปุ่มสรุป (ไม่มีปุ่มซ้อนปุ่ม) · ชื่ออ่านด้วยวันที่ไทย · ยืนยัน/ปิดตามสถานะ', () => {
    const h = html(trade());
    const summary = h.slice(h.indexOf('<button'), h.indexOf('</button>'));
    expect(summary.match(/<button/g)?.length).toBe(1);
    expect(h).toContain('aria-label="ลบรายการ ซื้อ');
    expect(h).not.toMatch(/aria-label="[^"]*2026-11-05/);
    expect(html(trade(), true)).toContain('confirm-delete');
    expect(html(trade(), false, true)).toMatch(/<button[^>]*disabled/);
    expect(h.lastIndexOf('<button')).toBeGreaterThan(h.indexOf('</dl>'));
  });
  it('รหัสปุ่มสำหรับย้ายโฟกัส', () => {
    expect(tradeButtonId('abc')).toBe('trade-btn-abc');
  });
});

describe('คำอธิบายศัพท์ (แตะแล้วเห็น ไม่ใช่ hover อย่างเดียว)', () => {
  it('มีคำอธิบายภาษาคนของ ปันผลเป็นเงินสด / ปันผลลงทุนต่อ / ภาษีหัก ณ ที่จ่าย · คำที่ไม่รู้จักคืน null', () => {
    for (const term of ['ปันผลเป็นเงินสด', 'ปันผลลงทุนต่อ', 'ภาษีหัก ณ ที่จ่าย'] as const) {
      expect(glossaryText(term), term).toBe(GLOSSARY[term]);
      expect(GLOSSARY[term].length).toBeGreaterThan(30);
      expect(GLOSSARY[term].length).toBeLessThan(200); // สั้นพอบนมือถือ
    }
    expect(glossaryText('คำที่ไม่มี')).toBeNull();
  });
  it('TermHelp เป็นปุ่ม (ไม่ใช่ title/hover) aria-expanded=false ซ่อนข้อความไว้ก่อน · ปุ่มมีชื่อที่บอกคำที่อธิบาย', () => {
    const h = renderToString(createElement(TermHelp, { term: 'ภาษีหัก ณ ที่จ่าย' })).replace(/<!-- -->/g, '');
    expect(h).toMatch(/<button type="button" class="term-help-btn" aria-expanded="false" aria-controls="[^"]+" aria-label="ความหมายของคำว่า ภาษีหัก ณ ที่จ่าย">ความหมาย<\/button>/);
    expect(h).toContain('hidden=""');
    expect(h).toContain(GLOSSARY['ภาษีหัก ณ ที่จ่าย']);
    expect(h).not.toContain('title=');
  });
  it('ใช้ที่ฟอร์มบันทึกรายการ (ชนิดปันผล + ช่องภาษีหัก ณ ที่จ่าย) และในรายการที่ขยาย (ปันผล / มีภาษีหัก)', () => {
    expect(view).toContain('<TermHelp term={KIND_LABEL[k]} />');
    expect(view).toContain('help={<TermHelp term="ภาษีหัก ณ ที่จ่าย" />}');
    const dividend = html(trade({ kind: 'dividend', withholding: 100 }));
    expect(dividend).toContain('ความหมายของคำว่า ปันผลเป็นเงินสด');
    expect(dividend).toContain('ความหมายของคำว่า ภาษีหัก ณ ที่จ่าย');
    const buy = html(trade());
    expect(buy).not.toContain('ความหมายของคำว่า');
    expect(html(trade({ kind: 'reinvest', withholding: 0 }))).toContain('ความหมายของคำว่า ปันผลลงทุนต่อ');
  });
  it('Esc ปิดคำอธิบายโดยไม่ปิดฟอร์มทั้งใบ (stopPropagation) · CSS: ปุ่มสูง 44px และซ่อนด้วย [hidden]', () => {
    const src = (Object.entries(import.meta.glob('/src/ui/TermHelp.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0]?.[1]) ?? '';
    expect(src).toContain("e.key === 'Escape'");
    expect(src).toContain('e.stopPropagation()');
    expect(css).toMatch(/\.term-help-btn\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.term-help-text\[hidden\]\s*\{\s*display:\s*none/);
  });
});

describe('โฟกัสหลังลบรายการลงทุน', () => {
  it('nextFocusAfterDelete: ถัดไป → ก่อนหน้า → null (หัวประวัติรายการ)', () => {
    expect(nextFocusAfterDelete(['a', 'b', 'c'], 'b')).toBe('c');
    expect(nextFocusAfterDelete(['a', 'b', 'c'], 'c')).toBe('b');
    expect(nextFocusAfterDelete(['a'], 'a')).toBeNull();
    expect(nextFocusAfterDelete(['a', 'b'], 'zzz')).toBeNull();
  });
  it('AssetRow จดเป้าหมายตอน "ยืนยันลบ" แล้วย้ายโฟกัสเมื่อรายการหายจริง (ลบไม่สำเร็จ = ไม่ย้าย) · หัวประวัติมี id ให้โฟกัส', () => {
    expect(view).toContain('nextFocusAfterDelete(sorted.map((x) => x.id), tr.id)');
    expect(view).toContain('if (confirmDelete === tr.id)'); // จดเฉพาะครั้งที่ยืนยัน ไม่ใช่ครั้งแรกที่กด
    expect(view).toContain('if (trades.some((x) => x.id === pending.deletedId)) {'); // ยังอยู่ = ลบไม่สำเร็จ/ยังไม่เสร็จ
    expect(view).toContain('if (!busy && confirmDelete !== pending.deletedId) focusAfterDelete.current = null;'); // งานจบแล้วรายการยังอยู่ = ลบไม่สำเร็จ ล้างทิ้ง ไม่ดึงโฟกัสทีหลัง
    expect(view).toContain('document.getElementById(tradeButtonId(pending.nextId))');
    expect(view).toContain('<summary id={summaryId}>');
    expect(view).toContain('target?.focus()');
  });
});

describe('การต่อสาย + CSS', () => {
  it('หน้าพอร์ตใช้ TradeItem · ไม่มีข้อความต่อด้วย · ในประวัติ · <details> เหลือชั้นเดียว (ประวัติรายการ)', () => {
    expect(view).toContain('<TradeItem');
    expect(view).not.toContain('ค่าธรรมเนียม ${baht(tr.fee)}');
    expect((view.match(/<details/g) ?? []).length).toBe(1);
  });
  it('ปุ่มสรุป: สูง 44px โฟกัสเห็นชัด ค่าหลักชิดขวาไม่ตัดกลางตัวเลข ลูกศรบอกขยายได้ ปุ่มลบมือถือเต็มแถว 44px', () => {
    expect(css).toMatch(/\.trade-summary\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.trade-summary:focus-visible\s*\{[^}]*outline/);
    expect(css).toMatch(/\.trade-main\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.trade-summary::after\s*\{[^}]*content:\s*'▾'/);
    expect(css).toMatch(/\.trade-summary\[aria-expanded='true'\]::after\s*\{[^}]*content:\s*'▴'/);
    expect(css).toMatch(/\.trade-delete\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/@media \(max-width: 720px\)\s*\{\s*\.trade-delete\s*\{[^}]*width:\s*100%[^}]*min-height:\s*44px/);
  });
  it('KIND_LABEL ยังครบทุกชนิด', () => {
    expect(Object.keys(KIND_LABEL).sort()).toEqual(['buy', 'dividend', 'reinvest', 'sell']);
  });
});

describe('ผลตรวจ design-critic (14 พ.ย. 2569)', () => {
  it('รายการที่เคยรอยืนยันลบไม่พับกลับเมื่อหมดเวลา/ไปยืนยันรายการอื่น · ลูกศรมีข้อความทดแทนว่าง (ไม่ให้โปรแกรมอ่านจออ่านว่า "ลูกศรลง") · ปุ่ม help อยู่หลังข้อความผิดพลาด', () => {
    const item = (Object.entries(import.meta.glob('/src/ui/TradeItem.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0]?.[1]) ?? '';
    expect(item).toContain('if (wasConfirming.current && !confirmDelete) setOpenByUser(true);');
    expect(css).toContain("content: '▾' / '';");
    const iHelp = view.indexOf('      {help}');
    expect(iHelp).toBeGreaterThan(view.indexOf('id={`${id}-err`}'));
  });
  it('ไม่ซ้ำข้อความ: ปันผลลงทุนต่อใช้คำอธิบายจากปุ่ม "ความหมาย" ที่เดียว', () => {
    expect(view).not.toContain('ปันผลที่ได้เป็นหน่วยเพิ่ม ไม่ได้รับเป็นเงิน');
    expect(glossaryText('ปันผลลงทุนต่อ')).toContain('ผู้จ่ายปันผล');
  });
});
