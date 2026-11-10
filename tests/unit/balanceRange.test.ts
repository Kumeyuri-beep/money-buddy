import rawCss from '../../src/ui/styles.css?raw';
import { describe, expect, it } from 'vitest';
import { balanceOf, naturalBalance } from '../../src/domain/ledger/balance';
import type { Account, Entry } from '../../src/domain/ledger/types';

/** สร้าง Entry ตรงๆ (ข้าม createEntry) เพื่อทดสอบยอดใหญ่ผิดปกติ */
function raw(id: string, lines: [string, number][]): Entry {
  return {
    id,
    date: '2026-11-01',
    memo: '',
    source: 'manual',
    createdAt: 0,
    lines: lines.map(([accountId, amount]) => ({ accountId, amount })),
  } as unknown as Entry;
}
const MAX = Number.MAX_SAFE_INTEGER;

describe('balanceOf: ช่วงปลอดภัย', () => {
  it('ไม่มีรายการ = 0', () => {
    expect(balanceOf('w', [])).toBe(0);
  });
  it('ยอดเท่าขอบ MAX_SAFE_INTEGER ยังคืนค่าได้', () => {
    expect(balanceOf('w', [raw('a', [['w', MAX]])])).toBe(MAX);
    expect(balanceOf('w', [raw('a', [['w', -MAX]])])).toBe(-MAX);
  });
  it('ยอดสะสมเกิน MAX_SAFE_INTEGER = RangeError (บวก)', () => {
    expect(() => balanceOf('w', [raw('a', [['w', MAX]]), raw('b', [['w', 1]])])).toThrow(RangeError);
  });
  it('ยอดสะสมต่ำกว่า -MAX_SAFE_INTEGER = RangeError (ลบ)', () => {
    expect(() => balanceOf('w', [raw('a', [['w', -MAX]]), raw('b', [['w', -1]])])).toThrow(RangeError);
  });
  it('ค่ากลางทางเกินช่วงปลอดภัย = RangeError แม้ผลสุดท้ายจะกลับมาอยู่ในช่วง (เลี่ยงความเพี้ยน)', () => {
    const list = [raw('a', [['w', MAX]]), raw('b', [['w', MAX]]), raw('c', [['w', -MAX]])];
    expect(() => balanceOf('w', list)).toThrow(RangeError);
  });
  it('ไม่นับบัญชีอื่น: ยอดบัญชีอื่นที่ใหญ่ไม่ทำให้ throw', () => {
    expect(balanceOf('w', [raw('a', [['x', MAX]]), raw('b', [['x', MAX]]), raw('c', [['w', 5]])])).toBe(5);
  });
  it('จำนวนเงินไม่ใช่จำนวนเต็มปลอดภัย (NaN/ทศนิยม/Infinity) = RangeError', () => {
    for (const bad of [Number.NaN, 1.5, Infinity]) {
      expect(() => balanceOf('w', [raw('a', [['w', bad]])])).toThrow(RangeError);
    }
  });
  it('-0 และยอดหักล้างกันพอดี = 0 (ไม่ใช่ -0)', () => {
    expect(Object.is(balanceOf('w', [raw('a', [['w', -0]])]), 0)).toBe(true);
    expect(balanceOf('w', [raw('a', [['w', 500]]), raw('b', [['w', -500]])])).toBe(0);
    const liab: Account = { id: 'w', type: 'liability', name: 'w', currency: 'THB' };
    expect(Object.is(naturalBalance(liab, []), 0)).toBe(true);
  });
  it('naturalBalance ฝั่ง liability/income ที่ -MAX = +MAX', () => {
    const liab: Account = { id: 'w', type: 'liability', name: 'w', currency: 'THB' };
    expect(naturalBalance(liab, [raw('a', [['w', -MAX]])])).toBe(MAX);
  });
  it('naturalBalance ส่งต่อ RangeError', () => {
    const acc: Account = { id: 'w', type: 'asset', name: 'w', currency: 'THB' };
    expect(() => naturalBalance(acc, [raw('a', [['w', MAX]]), raw('b', [['w', 1]])])).toThrow(RangeError);
  });
});

describe('prefers-reduced-transparency ครอบคลุมพื้นผิวทั้งสามแบบ', () => {
  // ไฟล์บน Windows อาจเป็น CRLF: ทำให้ขึ้นบรรทัดแบบเดียวกันก่อนหาท้ายบล็อกด้วย "\n}\n"
  const css = rawCss.replace(/\r\n/g, '\n');
  const start = css.indexOf('@media (prefers-reduced-transparency: reduce)');
  const block = css.slice(start, css.indexOf('\n}\n', start));

  it('มีบล็อก reduced-transparency', () => {
    expect(start).toBeGreaterThan(-1);
  });
  it('กระจกแท้ (.glass) และ glass-lite เป็นพื้นทึบและปิด backdrop-filter', () => {
    expect(block).toMatch(/\.glass,\s*\.glass-lite\s*\{[^}]*background:\s*var\(--surface-fallback\)/);
    expect(block).toMatch(/\.glass,\s*\.glass-lite\s*\{[^}]*backdrop-filter:\s*none/);
  });
  it('พื้นทึบ (.solid) ที่ปกติโปร่ง 10% กลายเป็นสีทึบเต็ม', () => {
    expect(block).toMatch(/\.solid\s*\{[^}]*background:\s*#[0-9a-f]{6}\b/i);
  });
  it('backdrop-filter blur มีเฉพาะ .glass กับฉากหลังกล่องเพิ่มรายการ (glass-lite/solid ไม่มี)', () => {
    const outside = css.replace(block, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...outside.matchAll(/([^{}]+)\{[^}]*backdrop-filter:\s*blur/g)].map((m) => (m[1] ?? '').trim());
    expect(selectors.sort()).toEqual(['.entry-dialog::backdrop', '.glass']);
  });
});
