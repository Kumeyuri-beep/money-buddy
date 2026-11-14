import { describe, expect, it } from 'vitest';
import { checkCategoryAdd, checkCategoryHide, hiddenCategories, visibleCategories } from '../../src/domain/ledger/accountName';
import type { Account } from '../../src/domain/ledger/types';

/** เพิ่ม/ซ่อนหมวดรายรับ-รายจ่าย (ฟีดแบ็กใช้งานจริง 14 พ.ย. 2569): ห้ามลบจริง · ซ่อนแล้วรายการเก่ายังอ้างถึง · ห้ามชื่อว่าง/ซ้ำ · หมวดผลการลงทุนห้ามแตะ */
const accounts: Account[] = [
  { id: 'w1', type: 'asset', name: 'เงินสด', currency: 'THB' },
  { id: 'inv', type: 'asset', name: 'พอร์ต A', currency: 'THB', kind: 'investment' },
  { id: 'food', type: 'expense', name: 'อาหาร', currency: 'THB' },
  { id: 'travel', type: 'expense', name: 'เดินทาง', currency: 'THB' },
  { id: 'old', type: 'expense', name: 'ของเก่า', currency: 'THB', archived: true },
  { id: 'salary', type: 'income', name: 'เงินเดือน', currency: 'THB' },
  { id: 'inv-gain', type: 'income', name: 'กำไรจากการลงทุน', currency: 'THB' },
  { id: 'opening', type: 'equity', name: 'ยอดยกมา', currency: 'THB' },
];

describe('checkCategoryAdd', () => {
  it('ชื่อใหม่ผ่าน: ตัดช่องว่างหัวท้ายและรวมช่องว่างซ้อน', () => {
    expect(checkCategoryAdd(accounts, 'expense', '  ค่า   กาแฟ ')).toEqual({ ok: true, name: 'ค่า กาแฟ' });
  });
  it('ชื่อว่าง/มีแต่ช่องว่าง/ยาวเกิน/มีอักขระมองไม่เห็น = ไม่ผ่านพร้อมข้อความไทย', () => {
    expect(checkCategoryAdd(accounts, 'expense', '')).toMatchObject({ ok: false, message: 'ใส่ชื่อหมวดก่อน' });
    expect(checkCategoryAdd(accounts, 'expense', '   ')).toMatchObject({ ok: false, message: 'ใส่ชื่อหมวดก่อน' });
    expect(checkCategoryAdd(accounts, 'expense', 'ก'.repeat(201)).ok).toBe(false);
    expect(checkCategoryAdd(accounts, 'expense', 'ชื่อ​หมวด').ok).toBe(false);
    expect(checkCategoryAdd(accounts, 'expense', 'ชื่อ\u0007').ok).toBe(false);
  });
  it('ชื่อซ้ำกับหมวดประเภทเดียวกัน (ไม่สนช่องว่างซ้อน/ตัวพิมพ์) = ไม่ผ่าน · รายรับกับรายจ่ายใช้ชื่อเดียวกันได้', () => {
    expect(checkCategoryAdd(accounts, 'expense', ' อาหาร ')).toMatchObject({ ok: false, message: 'มีหมวดชื่อนี้อยู่แล้ว ใช้ชื่ออื่น' });
    expect(checkCategoryAdd(accounts, 'income', 'อาหาร').ok).toBe(true);
  });
  it('ชื่อซ้ำกับหมวดที่ซ่อนอยู่ = ไม่ผ่านและบอกให้เปิดกลับ (ไม่สร้างซ้ำซ้อน)', () => {
    expect(checkCategoryAdd(accounts, 'expense', 'ของเก่า')).toMatchObject({ ok: false, message: 'มีหมวดชื่อนี้อยู่แล้วแต่ซ่อนอยู่ เปิดกลับแทนการสร้างใหม่' });
  });
  it('ประเภทที่ไม่ใช่รายรับ/รายจ่าย = ไม่ผ่าน', () => {
    expect(checkCategoryAdd(accounts, 'asset' as never, 'กระเป๋าใหม่').ok).toBe(false);
  });
  it('ชื่อเดียวกับหมวดผลการลงทุนของระบบ (กำไรจากการลงทุน) ใช้ไม่ได้ในประเภทรายรับ (กันสับสนกับหมวดระบบ)', () => {
    expect(checkCategoryAdd(accounts, 'income', 'กำไรจากการลงทุน')).toMatchObject({ ok: false });
  });
});

describe('checkCategoryHide', () => {
  it('ซ่อนหมวดที่ใช้งานอยู่ได้เมื่อยังเหลือหมวดประเภทเดียวกันอย่างน้อย 1 หมวด', () => {
    expect(checkCategoryHide(accounts, 'food', true)).toEqual({ ok: true });
  });
  it('ซ่อนหมวดสุดท้ายของประเภทไม่ได้ (ฟอร์มบันทึกรายการจะไม่มีหมวดให้เลือก) · หมวดผลการลงทุนไม่นับว่าเป็นหมวดที่เหลือ', () => {
    expect(checkCategoryHide(accounts, 'salary', true)).toMatchObject({ ok: false, message: 'ต้องเหลือหมวดที่ใช้งานอย่างน้อย 1 หมวด' });
    const oneLeft = accounts.filter((a) => a.id !== 'travel');
    expect(checkCategoryHide(oneLeft, 'food', true).ok).toBe(false);
  });
  it('เปิดกลับหมวดที่ซ่อนอยู่ได้เสมอ · ซ่อน/เปิดซ้ำสถานะเดิม = ไม่ผ่าน (ไม่ทำอะไรเงียบๆ)', () => {
    expect(checkCategoryHide(accounts, 'old', false)).toEqual({ ok: true });
    expect(checkCategoryHide(accounts, 'old', true)).toMatchObject({ ok: false, message: 'หมวดนี้ซ่อนอยู่แล้ว' });
    expect(checkCategoryHide(accounts, 'food', false)).toMatchObject({ ok: false, message: 'หมวดนี้เปิดใช้งานอยู่แล้ว' });
  });
  it('ไม่ใช่หมวด (กระเป๋า บัญชีลงทุน ยอดยกมา) = ไม่ผ่าน · หมวดผลการลงทุนที่ระบบสร้างซ่อน/เปิดไม่ได้ · ไม่มีอยู่ = ไม่พบ', () => {
    for (const id of ['w1', 'inv', 'opening']) expect(checkCategoryHide(accounts, id, true), id).toMatchObject({ ok: false, message: 'ซ่อนได้เฉพาะหมวดรายรับและรายจ่าย' });
    expect(checkCategoryHide(accounts, 'inv-gain', true)).toMatchObject({ ok: false, message: 'ซ่อนได้เฉพาะหมวดรายรับและรายจ่าย' });
    expect(checkCategoryHide(accounts, 'inv-gain', false).ok).toBe(false);
    expect(checkCategoryHide(accounts, 'nope', true)).toMatchObject({ ok: false, message: 'ไม่พบหมวดนี้' });
  });
});

describe('visibleCategories / hiddenCategories', () => {
  it('แยกหมวดที่ใช้งาน/ซ่อน (ไม่รวมกระเป๋า ยอดยกมา หมวดผลการลงทุน) ตามประเภท', () => {
    expect(visibleCategories(accounts, 'expense').map((a) => a.id)).toEqual(['food', 'travel']);
    expect(hiddenCategories(accounts).map((a) => a.id)).toEqual(['old']);
    expect(visibleCategories(accounts, 'income').map((a) => a.id)).toEqual(['salary']);
  });
  it('ไม่แก้ข้อมูลเข้า', () => {
    const copy = JSON.stringify(accounts);
    visibleCategories(accounts, 'expense');
    checkCategoryHide(accounts, 'food', true);
    checkCategoryAdd(accounts, 'expense', 'x');
    expect(JSON.stringify(accounts)).toBe(copy);
  });
});

describe('รายการเก่าในหมวดที่ซ่อน (แก้ไข/แสดงชื่อ)', async () => {
  const { counterOptions, buildEntry } = await import('../../src/app/entryForm');
  const { describeEntry } = await import('../../src/app/describe');
  const { entryDetail } = await import('../../src/app/ledgerQuery');
  const base: Account[] = [
    { id: 'w1', type: 'asset', name: 'เงินสด', currency: 'THB' },
    { id: 'food', type: 'expense', name: 'อาหาร', currency: 'THB', archived: true },
    { id: 'travel', type: 'expense', name: 'เดินทาง', currency: 'THB' },
  ];
  const old = { id: 'e1', date: '2026-11-02', memo: 'ข้าว', source: 'manual' as const, lines: [{ accountId: 'food', amount: 6500 }, { accountId: 'w1', amount: -6500 }] };

  it('ฟอร์มปกติไม่เห็นหมวดที่ซ่อน · ฟอร์มแก้รายการเก่าเห็นเฉพาะหมวดเดิมของรายการนั้น', () => {
    expect(counterOptions(base, 'expense', 'w1').map((a) => a.id)).toEqual(['travel']);
    expect(counterOptions(base, 'expense', 'w1', 'food').map((a) => a.id)).toEqual(['food', 'travel']);
    expect(counterOptions(base, 'expense', 'w1', 'nope').map((a) => a.id)).toEqual(['travel']);
  });
  it('บันทึกรายการใหม่เข้าหมวดที่ซ่อนไม่ได้ · แก้รายการเก่าคงหมวดเดิมที่ซ่อนไว้ได้ (แก้ยอดได้ หมวดไม่เปลี่ยน)', () => {
    const form = { kind: 'expense' as const, date: '2026-11-03', amount: '70', walletId: 'w1', counterId: 'food', memo: '' };
    expect(() => buildEntry(base, form, 'n1')).toThrow(/เลือกหมวดรายจ่าย/);
    const kept = buildEntry(base, form, 'n1', { keepCounterId: 'food' });
    expect(kept.lines[0]).toEqual({ accountId: 'food', amount: 7000 });
    // keepCounterId ปลดล็อกเฉพาะหมวดนั้น: หมวดซ่อนอื่นยังเลือกไม่ได้
    const other: Account[] = [...base, { id: 'gone', type: 'expense', name: 'เลิกใช้', currency: 'THB', archived: true }];
    expect(() => buildEntry(other, { ...form, counterId: 'gone' }, 'n2', { keepCounterId: 'food' })).toThrow(/เลือกหมวดรายจ่าย/);
  });
  it('รายการเก่ายังแสดงชื่อหมวดเดิมและยอดเดิม แม้หมวดถูกซ่อน', () => {
    expect(entryDetail(base, old)).toContain('อาหาร');
    expect(describeEntry(base, old)).toMatchObject({ kind: 'expense', amountText: expect.stringContaining('65.00') });
  });
});
