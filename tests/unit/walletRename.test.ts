import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { buildInitialLedger, DEFAULT_WALLETS } from '../../src/app/setup';
import { checkWalletRename, isWallet } from '../../src/domain/ledger/accountName';
import type { Account } from '../../src/domain/ledger/types';
import { WalletNames } from '../../src/ui/WalletNames';

/** เปลี่ยนชื่อกระเป๋า + ชื่อเริ่มต้นเป็นไทย (เจ้าของตัดสิน 13 พ.ย. 2569) */
const accounts: Account[] = [
  { id: 'w1', type: 'asset', name: 'เงินสด', currency: 'THB' },
  { id: 'w2', type: 'asset', name: 'บัญชีธนาคาร', currency: 'THB' },
  { id: 'inv', type: 'asset', name: 'พอร์ต A', currency: 'THB', kind: 'investment' },
  { id: 'food', type: 'expense', name: 'อาหาร', currency: 'THB' },
  { id: 'opening', type: 'equity', name: 'ยอดยกมา', currency: 'THB' },
];

describe('checkWalletRename', () => {
  it('ผ่าน: ตัดช่องว่างหัวท้ายและยุบช่องว่างซ้อน · ชื่อเดิมของตัวเองผ่าน', () => {
    expect(checkWalletRename(accounts, 'w1', '  เงินสด   หลัก  ')).toEqual({ ok: true, name: 'เงินสด หลัก' });
    expect(checkWalletRename(accounts, 'w1', 'เงินสด').ok).toBe(true);
  });
  it('ไม่ผ่านพร้อมข้อความไทย: ว่าง · ยาวเกิน 200 · ซ้ำ (ไม่สนตัวพิมพ์/ช่องว่าง) · ไม่ใช่กระเป๋า · ไม่มีอยู่', () => {
    expect(checkWalletRename(accounts, 'w1', '   ')).toMatchObject({ ok: false, message: 'ใส่ชื่อกระเป๋าก่อน' });
    expect(checkWalletRename(accounts, 'w1', 'ก'.repeat(201)).ok).toBe(false);
    expect(checkWalletRename(accounts, 'w1', ' บัญชีธนาคาร ')).toMatchObject({ ok: false, message: 'มีกระเป๋าชื่อนี้อยู่แล้ว ใช้ชื่ออื่น' });
    expect(checkWalletRename([...accounts, { id: 'w3', type: 'asset', name: 'Cash', currency: 'THB' }], 'w1', 'CASH').ok).toBe(false);
    for (const id of ['inv', 'food', 'opening']) expect(checkWalletRename(accounts, id, 'ชื่อใหม่'), id).toMatchObject({ ok: false, message: 'เปลี่ยนชื่อได้เฉพาะกระเป๋าเงิน' });
    expect(checkWalletRename(accounts, 'nope', 'x')).toMatchObject({ ok: false, message: 'ไม่พบกระเป๋านี้' });
  });
  it('ปฏิเสธอักขระควบคุม/มองไม่เห็น (zero-width, ตัวกลับทิศ, BOM, newline) กันชื่อที่ดูซ้ำกันหรือแสดงสลับทิศ', () => {
    for (const bad of ['เงิน\u200Bสด', 'a\u202Eb', '\uFEFFเงิน', 'เงิน\nสด', 'เงิน\u0000สด', 'เงิน\u2060สด']) {
      expect(checkWalletRename(accounts, 'w1', bad), JSON.stringify(bad)).toMatchObject({ ok: false, message: 'ชื่อมีอักขระควบคุมหรืออักขระที่มองไม่เห็น ลบออกแล้วลองใหม่' });
    }
    expect(checkWalletRename(accounts, 'w1', 'เงินสด 🐷').ok).toBe(true); // อีโมจิปกติผ่าน
  });
  it('กระเป๋าที่เก็บถาวรเปลี่ยนชื่อไม่ได้', () => {
    expect(checkWalletRename([...accounts, { id: 'old', type: 'asset', name: 'เก่า', currency: 'THB', archived: true }], 'old', 'ใหม่')).toMatchObject({ ok: false });
  });
  it('isWallet: บัญชีสินทรัพย์ทั่วไปเท่านั้น ไม่รวมบัญชีลงทุน/หมวด/ยอดยกมา', () => {
    expect(accounts.filter(isWallet).map((a) => a.id)).toEqual(['w1', 'w2']);
  });
  it('ชื่อใหม่ไม่กระทบรหัสบัญชีที่คำนวณไว้ (ฟังก์ชันตรวจไม่แก้ข้อมูลเข้า)', () => {
    const copy = JSON.stringify(accounts);
    checkWalletRename(accounts, 'w1', 'ชื่อใหม่');
    expect(JSON.stringify(accounts)).toBe(copy);
  });
});

describe('ชื่อกระเป๋าเริ่มต้น', () => {
  it('เป็นภาษาไทย 3 ใบ ไม่ซ้ำกัน และตั้งต้นได้ (ผู้ใช้เดิมที่ใช้ชื่ออังกฤษไม่ถูกเปลี่ยนให้เอง: ค่าเริ่มต้นใช้เฉพาะตอนตั้งต้นใหม่)', () => {
    expect(DEFAULT_WALLETS.map((w) => w.name)).toEqual(['เงินสด', 'บัญชีธนาคาร', 'เงินออม']);
    const ledger = buildInitialLedger(DEFAULT_WALLETS.map((w) => ({ ...w, opening: '100' })), '2026-11-13');
    expect(ledger.accounts.filter((a) => a.type === 'asset').map((a) => a.name)).toEqual(['เงินสด', 'บัญชีธนาคาร', 'เงินออม']);
  });
});

describe('WalletNames (หน้าจอ)', () => {
  const ui = import.meta.glob('/src/ui/{AccountView,WalletNames}.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  it('อยู่ในหน้าโปรไฟล์ และบอกชัดว่าเปลี่ยนได้เฉพาะชื่อ ยอด/รายการไม่เปลี่ยน', () => {
    expect(ui['/src/ui/AccountView.tsx']).toContain('<WalletNames onChanged={onWalletsChanged} />');
    const html = renderToString(createElement(WalletNames, { onChanged: () => undefined }));
    expect(html).toContain('ชื่อกระเป๋าเงิน');
    expect(html).toContain('เปลี่ยนได้เฉพาะชื่อที่แสดง ยอดเงินและรายการเดิมไม่เปลี่ยน');
  });
  it('เรียกเฉพาะ repo.renameWallet (ไม่แตะบัญชี/รายการอย่างอื่น) และไม่เปลี่ยนชื่อให้เอง', () => {
    const src = ui['/src/ui/WalletNames.tsx'] ?? '';
    expect(src).toContain('repo.renameWallet(');
    expect(src).not.toMatch(/repo\.(saveInitialLedger|appendEntry|updateEntry|deleteEntry|resetAll|importBackup|addWallet)/);
    expect(src).toContain('disabled={!changed || busyId !== null}'); // กดบันทึกได้เมื่อผู้ใช้แก้เองเท่านั้น
  });
});
