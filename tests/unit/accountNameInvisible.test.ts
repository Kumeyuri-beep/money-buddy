import { describe, expect, it } from 'vitest';
import { buildInitialLedger } from '../../src/app/setup';
import { checkCategoryAdd, checkCategoryRename, checkWalletRename } from '../../src/domain/ledger/accountName';
import { accountProblem, hasInvisibleChars } from '../../src/domain/ledger/limits';

/** ชื่อบัญชีห้ามอักขระควบคุม/มองไม่เห็น: เว็บกันทุกทางก่อนถึง constraint accounts_name_no_invisible ในฐานข้อมูล (migration 20261114000200) */
const BAD = ['\u0001', '\u0007', '\t', '\n', '\u007F', '\u0085', '​', '‌', '‍', '‎', '‏', '‪', '‮', '⁠', '⁣', '⁩', '﻿'];
const GOOD = ['อาหาร', 'ค่า กาแฟ (ร้านหน้า) #1', 'Cafe-Latte_2', 'เงินเดือน 50% / โบนัส', 'หมวด 😀', 'กั่'];

describe('hasInvisibleChars', () => {
  it('จับตัวควบคุม/ศูนย์ความกว้าง/ตัวกำกับทิศ/BOM ทุกตัวในชุด และไม่จับชื่อปกติ (ไทยมีสระ/วรรณยุกต์ อังกฤษ สัญลักษณ์ อีโมจิ)', () => {
    for (const c of BAD) expect(hasInvisibleChars(`ชื่อ${c}หมวด`), JSON.stringify(c)).toBe(true);
    for (const g of GOOD) expect(hasInvisibleChars(g), g).toBe(false);
  });
  it('ตรงกับด่านตรวจชื่อเดิมของหมวด/กระเป๋า (ไม่ผ่านทั้งสองทาง)', () => {
    const accounts = [{ id: 'w1', type: 'asset' as const, name: 'เงินสด', currency: 'THB' }, { id: 'food', type: 'expense' as const, name: 'อาหาร', currency: 'THB' }];
    for (const c of BAD) {
      const name = `ชื่อ${c}ใหม่`;
      expect(checkCategoryAdd(accounts, 'expense', name).ok, JSON.stringify(c)).toBe(false);
      expect(checkCategoryRename(accounts, 'food', name).ok).toBe(false);
      expect(checkWalletRename(accounts, 'w1', name).ok).toBe(false);
    }
  });
});

describe('accountProblem / ตั้งต้น', () => {
  it('ชื่อบัญชีที่มีอักขระมองไม่เห็นถูกปฏิเสธด้วยข้อความไทย · ชื่อปกติผ่าน', () => {
    expect(accountProblem({ id: 'a', type: 'asset', name: 'เงิน​สด', currency: 'THB' })).toBe('ชื่อมีอักขระที่มองไม่เห็น ลบออกแล้วลองใหม่');
    expect(accountProblem({ id: 'a', type: 'asset', name: 'เงินสด', currency: 'THB' })).toBeNull();
  });
  it('หน้าตั้งต้น: ชื่อกระเป๋าที่มีอักขระมองไม่เห็นสร้างไม่ได้ (ไม่ปล่อยให้ฐานข้อมูลปฏิเสธตอนบันทึก)', () => {
    expect(() => buildInitialLedger([{ name: 'เงิน‮สด', opening: '100' }], '2026-11-01')).toThrow();
  });
});
