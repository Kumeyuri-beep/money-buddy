/**
 * ตรวจหมวดของผู้ใช้ (Categories R2 · docs/proposals/R2-categories.md) · ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล
 * กฎเดียวกับฐานข้อมูล (migration 20261121000100): ชื่อ 1-60 ตัวอักษรไม่มีช่องว่างหน้าหลัง/อักขระควบคุม/ศูนย์ความกว้าง/ตัวกลับทิศ ·
 * ไม่ซ้ำ (ไม่สนตัวพิมพ์) · ไม่เกิน 50 หมวด · เป้า bps จำนวนเต็ม 0-10,000 หรือไม่ตั้ง · ถ้าหมวดใดตั้งเป้า ทุกหมวดต้องตั้งและรวม 10,000 พอดี
 * ฝั่งเว็บตรวจก่อนส่ง (ข้อความชัด) ฐานข้อมูลตรวจซ้ำเสมอ (ไม่เชื่อเบราว์เซอร์)
 */

import { CATEGORY_NAME_MAX, CATEGORY_TARGET_TOTAL_BPS, MAX_CATEGORIES, type AssetCategory } from './types';

export type CategoryProblem = 'count' | 'id' | 'name' | 'sort' | 'target' | 'duplicateId' | 'duplicateName' | 'targetTotal';

/** อักขระควบคุม (รวม DEL และ C1) ศูนย์ความกว้าง ตัวกลับทิศ BOM · ตรงกับ check ของฐานข้อมูล */
export const CATEGORY_TEXT_UNSAFE = /[\p{Cc}\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/u;

const charLength = (s: string): number => [...s].length;

/** ชื่อหมวด/sector ที่ใช้ได้: ข้อความยาว 1..max ไม่มีช่องว่างหน้าหลัง ไม่มีอักขระต้องห้าม */
export function validLabel(v: unknown, max: number): v is string {
  return typeof v === 'string' && charLength(v) >= 1 && charLength(v) <= max && v === v.trim() && !CATEGORY_TEXT_UNSAFE.test(v);
}

export const validSector = (v: unknown): v is string => validLabel(v, CATEGORY_NAME_MAX);

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;

/** คืนปัญหาแรกที่พบ (null = ใช้ได้) */
export function categoriesProblem(cats: readonly AssetCategory[]): CategoryProblem | null {
  if (cats.length > MAX_CATEGORIES) return 'count';
  const ids = new Set<string>();
  const names = new Set<string>();
  let withTarget = 0;
  let total = 0;
  for (const c of cats) {
    if (typeof c.id !== 'string' || charLength(c.id) < 1 || charLength(c.id) > 100 || CATEGORY_TEXT_UNSAFE.test(c.id)) return 'id';
    if (!validLabel(c.name, CATEGORY_NAME_MAX)) return 'name';
    if (!isInt(c.sortOrder, 0, 1000)) return 'sort';
    if (c.targetBps !== null && !isInt(c.targetBps, 0, CATEGORY_TARGET_TOTAL_BPS)) return 'target';
    if (ids.has(c.id)) return 'duplicateId';
    ids.add(c.id);
    const key = c.name.toLowerCase();
    if (names.has(key)) return 'duplicateName';
    names.add(key);
    if (c.targetBps !== null) {
      withTarget += 1;
      total += c.targetBps;
    }
  }
  if (withTarget > 0 && (withTarget !== cats.length || total !== CATEGORY_TARGET_TOTAL_BPS)) return 'targetTotal';
  return null;
}

export const CATEGORY_PROBLEM_TEXT: Record<CategoryProblem, { th: string; en: string }> = {
  count: { th: `มีหมวดมากเกินไป (ไม่เกิน ${MAX_CATEGORIES} หมวด)`, en: `Too many categories (up to ${MAX_CATEGORIES}).` },
  id: { th: 'รหัสหมวดไม่ถูกต้อง', en: 'A category id is not valid.' },
  name: { th: `ชื่อหมวดต้องยาว 1-${CATEGORY_NAME_MAX} ตัวอักษร ไม่มีช่องว่างหน้าหลังหรืออักขระควบคุม`, en: `Category names must be 1-${CATEGORY_NAME_MAX} characters, without leading or trailing spaces or control characters.` },
  sort: { th: 'ลำดับหมวดต้องเป็นจำนวนเต็ม 0-1,000', en: 'The category order must be a whole number from 0 to 1,000.' },
  target: { th: 'เป้าของหมวดต้องเป็นจำนวนเต็ม bps 0-10,000', en: 'A category target must be a whole number of basis points from 0 to 10,000.' },
  duplicateId: { th: 'รหัสหมวดซ้ำ', en: 'Two categories share the same id.' },
  duplicateName: { th: 'ชื่อหมวดซ้ำ (ไม่สนตัวพิมพ์ใหญ่เล็ก)', en: 'Two categories share the same name (ignoring case).' },
  targetTotal: { th: 'เป้ารวมของทุกหมวดต้องเท่ากับ 100% (ตั้งเป้าให้ครบทุกหมวด)', en: 'The targets of all categories must add up to 100% (set a target for every category).' },
};
