import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { checkCategoryRename, isCategory } from '../../src/domain/ledger/accountName';
import type { Account } from '../../src/domain/ledger/types';
import { CategoryNames } from '../../src/ui/CategoryNames';

/** เปลี่ยนชื่อหมวดรายรับ/รายจ่าย (เจ้าของสั่ง 13 พ.ย. 2569): เปลี่ยนแค่ชื่อที่แสดง ห้ามว่าง/ซ้ำ ห้ามแตะรหัส ยอด รายการ */
const accounts: Account[] = [
  { id: 'w1', type: 'asset', name: 'เงินสด', currency: 'THB' },
  { id: 'inv', type: 'asset', name: 'พอร์ต A', currency: 'THB', kind: 'investment' },
  { id: 'food', type: 'expense', name: 'อาหาร', currency: 'THB' },
  { id: 'travel', type: 'expense', name: 'เดินทาง', currency: 'THB' },
  { id: 'other-e', type: 'expense', name: 'อื่นๆ', currency: 'THB' },
  { id: 'salary', type: 'income', name: 'เงินเดือน', currency: 'THB' },
  { id: 'other-i', type: 'income', name: 'อื่นๆ', currency: 'THB' },
  { id: 'inv-gain', type: 'income', name: 'กำไรจากการลงทุน', currency: 'THB' },
  { id: 'opening', type: 'equity', name: 'ยอดยกมา', currency: 'THB' },
];

describe('checkCategoryRename', () => {
  it('ผ่าน: ตัดช่องว่างหัวท้าย/ยุบช่องว่างซ้อน · ชื่อเดิมของตัวเองผ่าน', () => {
    expect(checkCategoryRename(accounts, 'food', '  ข้าว   และ  ขนม ')).toEqual({ ok: true, name: 'ข้าว และ ขนม' });
    expect(checkCategoryRename(accounts, 'food', 'อาหาร').ok).toBe(true);
  });
  it('ชื่อว่าง/ช่องว่างล้วน = ไม่ผ่านพร้อมข้อความไทย', () => {
    expect(checkCategoryRename(accounts, 'food', '')).toMatchObject({ ok: false, message: 'ใส่ชื่อหมวดก่อน' });
    expect(checkCategoryRename(accounts, 'food', '   ')).toMatchObject({ ok: false, message: 'ใส่ชื่อหมวดก่อน' });
  });
  it('ชื่อซ้ำกับหมวดอื่น "ประเภทเดียวกัน" ไม่ผ่าน (ไม่สนตัวพิมพ์/ช่องว่าง) · ต่างประเภทใช้ชื่อเดียวกันได้', () => {
    expect(checkCategoryRename(accounts, 'food', ' เดินทาง ')).toMatchObject({ ok: false, message: 'มีหมวดชื่อนี้อยู่แล้ว ใช้ชื่ออื่น' });
    expect(checkCategoryRename([...accounts, { id: 'x', type: 'expense', name: 'Snacks', currency: 'THB' }], 'food', 'SNACKS').ok).toBe(false);
    expect(checkCategoryRename(accounts, 'salary', 'อาหาร').ok).toBe(true);
    expect(checkCategoryRename(accounts, 'food', 'เงินเดือน').ok).toBe(true);
  });
  it('ชื่อที่ยาวเกิน 200 และอักขระควบคุม/มองไม่เห็นไม่ผ่าน', () => {
    expect(checkCategoryRename(accounts, 'food', 'ก'.repeat(201)).ok).toBe(false);
    for (const bad of ['อา​หาร', 'a‮b', '﻿อาหาร', 'อา\nหาร', 'อา\u0000หาร']) {
      expect(checkCategoryRename(accounts, 'food', bad), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
  });
  it('ไม่ใช่หมวด (กระเป๋า บัญชีลงทุน ยอดยกมา บัญชีผลการลงทุน) หรือไม่มีอยู่ = ไม่ผ่าน', () => {
    for (const id of ['w1', 'inv', 'opening', 'inv-gain']) {
      expect(checkCategoryRename(accounts, id, 'ชื่อใหม่'), id).toMatchObject({ ok: false, message: 'เปลี่ยนชื่อได้เฉพาะหมวดรายรับและรายจ่าย' });
    }
    expect(checkCategoryRename(accounts, 'nope', 'x')).toMatchObject({ ok: false, message: 'ไม่พบหมวดนี้' });
  });
  it('หมวดที่เก็บถาวรเปลี่ยนชื่อไม่ได้', () => {
    expect(checkCategoryRename([...accounts, { id: 'old', type: 'expense', name: 'เก่า', currency: 'THB', archived: true }], 'old', 'ใหม่').ok).toBe(false);
  });
  it('isCategory: รายรับ/รายจ่ายทั่วไปเท่านั้น', () => {
    expect(accounts.filter(isCategory).map((a) => a.id)).toEqual(['food', 'travel', 'other-e', 'salary', 'other-i']);
  });
  it('ไม่แก้ข้อมูลเข้า (ไม่แตะรหัสบัญชี)', () => {
    const copy = JSON.stringify(accounts);
    checkCategoryRename(accounts, 'food', 'ชื่อใหม่');
    expect(JSON.stringify(accounts)).toBe(copy);
  });
});

describe('CategoryNames (หน้าจอ)', () => {
  const ui = import.meta.glob('/src/ui/{AccountView,CategoryNames}.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  it('อยู่ในหน้าโปรไฟล์ และบอกชัดว่าเปลี่ยนได้เฉพาะชื่อ ยอด/รายการไม่เปลี่ยน', () => {
    expect(ui['/src/ui/AccountView.tsx']).toContain('<CategoryNames onChanged={onWalletsChanged} />');
    const html = renderToString(createElement(CategoryNames, { onChanged: () => undefined }));
    expect(html).toContain('ชื่อหมวดรายรับ-รายจ่าย');
    expect(html).toContain('เปลี่ยนได้เฉพาะชื่อที่แสดง ยอดเงินและรายการเดิมไม่เปลี่ยน');
  });
  it('พับรายการไว้ใน details (หน้าโปรไฟล์ไม่ยาวเกิน) · label ซ่อนมีชื่อหมวด · ปุ่มมี aria-label · ข้อความผลไม่พึ่งสีอย่างเดียว · คืนโฟกัสให้ช่องกรอก', () => {
    const src = ui['/src/ui/CategoryNames.tsx'] ?? '';
    expect(src).toContain('<details className="archived-details">');
    expect(src).toContain('className="sr-only"');
    expect(src).toContain('aria-label={`บันทึกชื่อ${title} ${c.name}`}');
    expect(src).toContain('✓ เปลี่ยนชื่อแล้ว');
    expect(src).toContain('ไม่สำเร็จ:');
    expect(src).toContain('?.focus()');
  });
  it('เรียกเฉพาะ repo.renameCategory (ไม่แตะบัญชี/รายการอย่างอื่น) กดบันทึกได้เมื่อผู้ใช้แก้เอง และไม่เปลี่ยนชื่อให้เอง', () => {
    const src = ui['/src/ui/CategoryNames.tsx'] ?? '';
    expect(src).toContain('repo.renameCategory(');
    expect(src).not.toMatch(/repo\.(saveInitialLedger|appendEntry|updateEntry|deleteEntry|resetAll|importBackup|addWallet|renameWallet)/);
    expect(src).toContain('disabled={!changed || busyId !== null}');
  });
});
