/**
 * ตรวจชื่อกระเป๋าเงินตอนเปลี่ยนชื่อ (เจ้าของตัดสิน 13 พ.ย. 2569: เปลี่ยนได้เฉพาะ "ชื่อที่แสดง" ห้ามแตะรหัสบัญชีหรือยอด)
 * ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล · ไม่เกี่ยวกับเงิน
 */
import { isInvestResultAccount } from './accountKind';
import { lengthWithin, MAX_NAME_LENGTH } from './limits';
import type { Account } from './types';

export interface RenameCheck {
  ok: boolean;
  /** ชื่อที่ตัดช่องว่างหัวท้ายแล้ว (ใช้บันทึกจริง) */
  name: string;
  /** ข้อความไทยบอกผู้ใช้เมื่อไม่ผ่าน */
  message?: string;
}

/** กระเป๋าเงิน = บัญชีสินทรัพย์ทั่วไป (ไม่ใช่บัญชีลงทุนที่ผูกกับสินทรัพย์) */
export const isWallet = (a: Account): boolean => a.type === 'asset' && a.kind !== 'investment';

/** หมวดรายรับ/รายจ่ายที่ผู้ใช้ตั้งชื่อเองได้ (เจ้าของสั่ง 13 พ.ย. 2569) · ไม่รวมบัญชีผลการลงทุนที่ระบบสร้าง (inv-gain ฯลฯ) และบัญชีลงทุน */
export const isCategory = (a: Account): boolean => (a.type === 'income' || a.type === 'expense') && a.kind !== 'investment' && !isInvestResultAccount(a);

/** อักขระควบคุม (C0/C1) ช่องว่างความกว้างศูนย์ ตัวกลับทิศข้อความ และ BOM: มองไม่เห็นหรือทำให้ชื่อดูซ้ำกัน/แสดงสลับทิศ (ผลตรวจ security-auditor) */
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/;

const norm = (s: string): string => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('th');

export function checkWalletRename(accounts: readonly Account[], id: string, rawName: string): RenameCheck {
  const name = String(rawName ?? '').trim().replace(/\s+/g, ' ');
  if (INVISIBLE.test(String(rawName ?? ''))) return { ok: false, name, message: 'ชื่อมีอักขระควบคุมหรืออักขระที่มองไม่เห็น ลบออกแล้วลองใหม่' };
  if (name === '') return { ok: false, name, message: 'ใส่ชื่อกระเป๋าก่อน' };
  if (!lengthWithin(name, 1, MAX_NAME_LENGTH)) return { ok: false, name, message: `ชื่อกระเป๋าต้องยาว 1-${MAX_NAME_LENGTH} ตัวอักษร` };
  const target = accounts.find((a) => a.id === id);
  if (!target) return { ok: false, name, message: 'ไม่พบกระเป๋านี้' };
  if (!isWallet(target)) return { ok: false, name, message: 'เปลี่ยนชื่อได้เฉพาะกระเป๋าเงิน' };
  if (target.archived) return { ok: false, name, message: 'กระเป๋านี้ถูกเก็บถาวร เปลี่ยนชื่อไม่ได้' };
  const clash = accounts.some((a) => a.id !== id && isWallet(a) && norm(a.name) === norm(name));
  if (clash) return { ok: false, name, message: 'มีกระเป๋าชื่อนี้อยู่แล้ว ใช้ชื่ออื่น' };
  return { ok: true, name };
}

/**
 * ตรวจชื่อหมวดตอนเปลี่ยนชื่อ (แบบเดียวกับกระเป๋า): เปลี่ยนเฉพาะ "ชื่อที่แสดง" ห้ามแตะรหัสบัญชี ยอด หรือรายการ
 * ชื่อต้องไม่ว่าง ไม่ยาวเกิน ไม่มีอักขระมองไม่เห็น และไม่ซ้ำกับหมวดอื่น "ประเภทเดียวกัน" (รายรับกับรายจ่ายใช้ชื่อเดียวกันได้ เช่น "อื่นๆ")
 */
export function checkCategoryRename(accounts: readonly Account[], id: string, rawName: string): RenameCheck {
  const name = String(rawName ?? '').trim().replace(/\s+/g, ' ');
  if (INVISIBLE.test(String(rawName ?? ''))) return { ok: false, name, message: 'ชื่อมีอักขระควบคุมหรืออักขระที่มองไม่เห็น ลบออกแล้วลองใหม่' };
  if (name === '') return { ok: false, name, message: 'ใส่ชื่อหมวดก่อน' };
  if (!lengthWithin(name, 1, MAX_NAME_LENGTH)) return { ok: false, name, message: `ชื่อหมวดต้องยาว 1-${MAX_NAME_LENGTH} ตัวอักษร` };
  const target = accounts.find((a) => a.id === id);
  if (!target) return { ok: false, name, message: 'ไม่พบหมวดนี้' };
  if (!isCategory(target)) return { ok: false, name, message: 'เปลี่ยนชื่อได้เฉพาะหมวดรายรับและรายจ่าย' };
  if (target.archived) return { ok: false, name, message: 'หมวดนี้ถูกซ่อนอยู่ เปิดกลับก่อนจึงเปลี่ยนชื่อได้' };
  const clash = accounts.some((a) => a.id !== id && a.type === target.type && isCategory(a) && norm(a.name) === norm(name));
  if (clash) return { ok: false, name, message: 'มีหมวดชื่อนี้อยู่แล้ว ใช้ชื่ออื่น' };
  return { ok: true, name };
}

/** หมวดที่ใช้งานอยู่ (ไม่ซ่อน) ของประเภทนั้น · ไม่รวมกระเป๋า ยอดยกมา และหมวดผลการลงทุนที่ระบบสร้าง */
export function visibleCategories(accounts: readonly Account[], type: 'income' | 'expense'): Account[] {
  return accounts.filter((a) => isCategory(a) && a.type === type && !a.archived);
}

/** หมวดที่ซ่อนอยู่ (รายการเก่ายังอ้างถึงและแสดงชื่อเดิม · เปิดกลับได้) */
export function hiddenCategories(accounts: readonly Account[]): Account[] {
  return accounts.filter((a) => isCategory(a) && a.archived === true);
}

/**
 * ตรวจชื่อหมวดใหม่ (ฟีดแบ็กใช้งานจริง 14 พ.ย. 2569): ห้ามว่าง/ยาวเกิน/มีอักขระมองไม่เห็น · ห้ามซ้ำกับหมวดประเภทเดียวกัน (รวมหมวดที่ซ่อนอยู่ ให้เปิดกลับแทน)
 * และห้ามซ้ำกับหมวดผลการลงทุนของระบบ (กันสับสนกับหมวดที่ระบบสร้าง)
 */
export function checkCategoryAdd(accounts: readonly Account[], type: 'income' | 'expense', rawName: string): RenameCheck {
  const name = String(rawName ?? '').trim().replace(/\s+/g, ' ');
  if (INVISIBLE.test(String(rawName ?? ''))) return { ok: false, name, message: 'ชื่อมีอักขระควบคุมหรืออักขระที่มองไม่เห็น ลบออกแล้วลองใหม่' };
  if (name === '') return { ok: false, name, message: 'ใส่ชื่อหมวดก่อน' };
  if (!lengthWithin(name, 1, MAX_NAME_LENGTH)) return { ok: false, name, message: `ชื่อหมวดต้องยาว 1-${MAX_NAME_LENGTH} ตัวอักษร` };
  if (type !== 'income' && type !== 'expense') return { ok: false, name, message: 'เพิ่มได้เฉพาะหมวดรายรับและรายจ่าย' };
  const same = accounts.filter((a) => a.type === type && norm(a.name) === norm(name));
  if (same.some((a) => isCategory(a) && a.archived === true)) return { ok: false, name, message: 'มีหมวดชื่อนี้อยู่แล้วแต่ซ่อนอยู่ เปิดกลับแทนการสร้างใหม่' };
  if (same.length > 0) return { ok: false, name, message: 'มีหมวดชื่อนี้อยู่แล้ว ใช้ชื่ออื่น' };
  return { ok: true, name };
}

export interface HideCheck {
  ok: boolean;
  message?: string;
}

/**
 * ตรวจการซ่อน/เปิดกลับหมวด: ห้ามลบจริง (รายการเก่ายังอ้างถึง) · เฉพาะหมวดรายรับ/รายจ่ายทั่วไป (หมวดผลการลงทุนที่ระบบสร้างห้ามแตะ)
 * ซ่อนแล้วต้องเหลือหมวดที่ใช้งานอย่างน้อย 1 หมวดต่อประเภท (ไม่งั้นฟอร์มบันทึกรายการไม่มีหมวดให้เลือก)
 */
export function checkCategoryHide(accounts: readonly Account[], id: string, hidden: boolean): HideCheck {
  const target = accounts.find((a) => a.id === id);
  if (!target) return { ok: false, message: 'ไม่พบหมวดนี้' };
  if (!isCategory(target)) return { ok: false, message: 'ซ่อนได้เฉพาะหมวดรายรับและรายจ่าย' };
  const isHidden = target.archived === true;
  if (hidden && isHidden) return { ok: false, message: 'หมวดนี้ซ่อนอยู่แล้ว' };
  if (!hidden && !isHidden) return { ok: false, message: 'หมวดนี้เปิดใช้งานอยู่แล้ว' };
  if (hidden) {
    // นับเฉพาะหมวดสกุลบาท (ตรงกับฟังก์ชัน set_category_archived ฝั่งฐานข้อมูล · ฟอร์มบันทึกรายการใช้เฉพาะหมวดบาท)
    const others = visibleCategories(accounts, target.type as 'income' | 'expense').filter((a) => a.id !== id && a.currency === 'THB');
    if (others.length === 0) return { ok: false, message: 'ต้องเหลือหมวดที่ใช้งานอย่างน้อย 1 หมวด' };
  }
  return { ok: true };
}
