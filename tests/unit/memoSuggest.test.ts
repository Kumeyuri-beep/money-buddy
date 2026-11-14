import { describe, expect, it } from 'vitest';
import { MAX_HIDDEN_MEMOS, buildMemoIndex, hideMemo, loadHiddenMemos, memoKey, saveHiddenMemos, suggestMemos } from '../../src/app/memoSuggest';
import type { Account, Entry } from '../../src/domain/ledger/types';

/** บันทึกช่วยจำแบบเดาคำ (ฟีดแบ็กใช้งานจริง 14 พ.ย. 2569): ในเครื่องจากรายการที่โหลดแล้ว · ไม่เติมจำนวนเงิน */
const accounts: Account[] = [
  { id: 'w1', type: 'asset', name: 'เงินสด', currency: 'THB' },
  { id: 'w2', type: 'asset', name: 'ออมทรัพย์', currency: 'THB' },
  { id: 'food', type: 'expense', name: 'อาหาร', currency: 'THB' },
  { id: 'travel', type: 'expense', name: 'เดินทาง', currency: 'THB' },
  { id: 'salary', type: 'income', name: 'เงินเดือน', currency: 'THB' },
  { id: 'open', type: 'equity', name: 'ยอดยกมา', currency: 'THB' },
];
let n = 0;
const exp = (memo: string, date: string, cat = 'food', amount = 5000): Entry => ({ id: `e${++n}`, date, memo, source: 'manual', lines: [{ accountId: cat, amount }, { accountId: 'w1', amount: -amount }] });
const inc = (memo: string, date: string): Entry => ({ id: `e${++n}`, date, memo, source: 'manual', lines: [{ accountId: 'w1', amount: 100000 }, { accountId: 'salary', amount: -100000 }] });
const mv = (memo: string, date: string): Entry => ({ id: `e${++n}`, date, memo, source: 'manual', lines: [{ accountId: 'w2', amount: 1000 }, { accountId: 'w1', amount: -1000 }] });
const sys: Entry = { id: 'sys', date: '2026-11-01', memo: 'ยอดยกมา เงินสด', source: 'system', lines: [{ accountId: 'w1', amount: 100000 }, { accountId: 'open', amount: -100000 }] };

const entries: Entry[] = [
  sys,
  exp('กะเพราไก่', '2026-11-02'),
  exp('กะเพราไก่', '2026-11-04'),
  exp('กาแฟหน้าออฟฟิศ', '2026-11-03'),
  exp('กาแฟหน้าออฟฟิศ', '2026-11-05'),
  exp('กาแฟหน้าออฟฟิศ', '2026-11-06'),
  exp('ข้าวกะเพรา', '2026-11-07'),
  exp('กะทิสด', '2026-11-08', 'travel'),
  exp('ค่ากะปิ', '2026-11-09'),
  exp('', '2026-11-09'),
  inc('กะเพราขายออนไลน์', '2026-11-05'),
  mv('กะเพราย้ายเงิน', '2026-11-05'),
];
const index = buildMemoIndex(accounts, entries);
const none = new Set<string>();

describe('memoKey', () => {
  it('ตัดช่องว่างหัวท้าย รวมช่องว่างซ้อน ตัวพิมพ์เล็ก', () => {
    expect(memoKey('  Cafe   Latte ')).toBe('cafe latte');
    expect(memoKey('กาแฟ')).toBe('กาแฟ');
  });
});

describe('suggestMemos', () => {
  it('พิมพ์ 1 ตัวอักษร ("ก") ก็แสดง · เฉพาะประเภทที่เลือก (รายจ่าย ไม่เอารายรับ/ย้ายเงิน/ยอดยกมา)', () => {
    const r = suggestMemos(index.expense, 'ก', none).map((s) => s.text);
    expect(r.length).toBeGreaterThan(0);
    expect(r).not.toContain('กะเพราขายออนไลน์');
    expect(r).not.toContain('กะเพราย้ายเงิน');
    expect(r).not.toContain('ยอดยกมา เงินสด');
    expect(suggestMemos(index.income, 'ก', none).map((s) => s.text)).toEqual(['กะเพราขายออนไลน์']);
    expect(suggestMemos(index.transfer, 'ก', none).map((s) => s.text)).toEqual(['กะเพราย้ายเงิน']);
  });
  it('"กะ": ขึ้นต้นมาก่อน "มีคำนั้น" แล้วเรียงตามจำนวนครั้ง → ล่าสุด · ไม่เกิน 5', () => {
    const r = suggestMemos(index.expense, 'กะ', none).map((s) => s.text);
    // ขึ้นต้นด้วย "กะ": กะเพราไก่ (2 ครั้ง) → กะทิสด (1 ครั้ง) ; มี "กะ" กลางข้อความ: ค่ากะปิ (ล่าสุดกว่า) → ข้าวกะเพรา
    expect(r).toEqual(['กะเพราไก่', 'กะทิสด', 'ค่ากะปิ', 'ข้าวกะเพรา']);
    const many = Array.from({ length: 9 }, (_, i) => exp(`ซื้อของ${i}`, `2026-10-0${(i % 9) + 1}`));
    expect(suggestMemos(buildMemoIndex(accounts, many).expense, 'ซื้อ', none)).toHaveLength(5);
  });
  it('ไม่สนตัวพิมพ์ใหญ่เล็กและช่องว่างซ้อน · พิมพ์ครบตรงกันแล้วไม่แนะนำซ้ำ · ว่าง/ช่องว่างล้วน = ไม่แนะนำ', () => {
    const idx = buildMemoIndex(accounts, [exp('Cafe  Latte', '2026-11-02'), exp('cafe latte', '2026-11-03')]);
    const r = suggestMemos(idx.expense, 'CAFE', none);
    expect(r).toHaveLength(1);
    expect(r[0]!.text).toBe('cafe latte'); // รวมเป็นข้อความเดียว แสดงตามที่ใช้ล่าสุด
    expect(suggestMemos(idx.expense, 'cafe latte', none)).toEqual([]);
    expect(suggestMemos(idx.expense, '   ', none)).toEqual([]);
    expect(suggestMemos(idx.expense, '', none)).toEqual([]);
  });
  it('ที่ผู้ใช้ลบแล้ว (hidden) ไม่แสดง', () => {
    const hidden = new Set([memoKey('กะเพราไก่')]);
    expect(suggestMemos(index.expense, 'กะ', hidden).map((s) => s.text)).not.toContain('กะเพราไก่');
  });
  it('หมวดอัตโนมัติ: ใช้หมวดเดียวกันทุกครั้ง = ส่งหมวดมาให้ · เคยใช้หลายหมวด = ไม่ส่ง · ผลลัพธ์ไม่มีจำนวนเงิน', () => {
    const idx = buildMemoIndex(accounts, [exp('ค่าแท็กซี่', '2026-11-01', 'travel'), exp('ค่าแท็กซี่', '2026-11-02', 'travel'), exp('ของกิน', '2026-11-01', 'food'), exp('ของกิน', '2026-11-02', 'travel')]);
    const r = suggestMemos(idx.expense, 'ค', none)[0]!;
    expect(r.text).toBe('ค่าแท็กซี่');
    expect(r.counterId).toBe('travel');
    expect(suggestMemos(idx.expense, 'ของ', none)[0]!.counterId).toBeNull();
    for (const s of suggestMemos(index.expense, 'ก', none)) expect(Object.keys(s).sort()).toEqual(['counterId', 'key', 'text']);
  });
  it('ไม่แก้ข้อมูลเข้า', () => {
    const copy = JSON.stringify(entries);
    buildMemoIndex(accounts, entries);
    suggestMemos(index.expense, 'ก', none);
    expect(JSON.stringify(entries)).toBe(copy);
  });
});

describe('ที่เก็บข้อความที่ลบ (ในเครื่อง)', () => {
  const memoryStorage = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  it('บันทึก/อ่านกลับ แยกตามผู้ใช้ · ข้อมูลเสีย/ไม่ใช่อาร์เรย์ = ว่าง · ค่าที่ไม่ใช่ข้อความสั้นถูกทิ้ง', () => {
    const s = memoryStorage();
    saveHiddenMemos('somchai', new Set(['a', 'b']), s);
    expect([...loadHiddenMemos('somchai', s)].sort()).toEqual(['a', 'b']);
    expect(loadHiddenMemos('another', s).size).toBe(0);
    s.m.set('mb.hiddenMemos.bad', '{not json');
    expect(loadHiddenMemos('bad', s).size).toBe(0);
    s.m.set('mb.hiddenMemos.obj', '{"a":1}');
    expect(loadHiddenMemos('obj', s).size).toBe(0);
    s.m.set('mb.hiddenMemos.mixed', JSON.stringify(['ok', 5, null, 'x'.repeat(500)]));
    expect([...loadHiddenMemos('mixed', s)]).toEqual(['ok']);
  });
  it('hideMemo เพิ่มและจำกัดจำนวน (เก่าสุดหลุดก่อน) · เก็บไม่ได้ (โหมดส่วนตัว) ไม่ throw', () => {
    let set = new Set<string>();
    for (let i = 0; i < MAX_HIDDEN_MEMOS + 5; i++) set = hideMemo(set, `m${i}`);
    expect(set.size).toBe(MAX_HIDDEN_MEMOS);
    expect(set.has('m0')).toBe(false);
    expect(set.has(`m${MAX_HIDDEN_MEMOS + 4}`)).toBe(true);
    const broken = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('x');
      },
    };
    expect(() => saveHiddenMemos('u', set, broken)).not.toThrow();
    expect(loadHiddenMemos('u', broken).size).toBe(0);
  });
});
