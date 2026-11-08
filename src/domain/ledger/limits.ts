import type { Account } from './types';

/**
 * ข้อจำกัดข้อมูลที่ฐานข้อมูล (supabase/migrations/20261108000000_m2a_schema.sql) บังคับ
 * ฝั่งเว็บต้องปฏิเสธก่อนเสมอ เพื่อไม่ให้ข้อมูลที่เว็บสร้างได้ถูกฐานข้อมูลปฏิเสธทีหลัง (decisions 2026-11-08-m2-a ข้อ B1-B3)
 * ไม่แตะ DOM หรือฐานข้อมูล
 */

export const MAX_ID_LENGTH = 100;
export const MAX_NAME_LENGTH = 200;
export const MAX_MEMO_LENGTH = 2000;
/** lines.idx เป็น smallint ในฐานข้อมูล */
export const MAX_LINES_PER_ENTRY = 32767;
export const MIN_ENTRY_YEAR = 1900;
export const MAX_ENTRY_YEAR = 2999;
/** สกุลเงินตัวพิมพ์ใหญ่/ตัวเลข 2-10 ตัว */
export const CURRENCY_PATTERN = /^[A-Z0-9]{2,10}$/;
/** ช่วงของ integer ใน Postgres (ใช้กับ sortOrder) */
const INT32_MIN = -(2 ** 31);
const INT32_MAX = 2 ** 31 - 1;

const ACCOUNT_TYPES: ReadonlySet<string> = new Set(['asset', 'liability', 'income', 'expense', 'equity']);

/** ความยาวเป็นจำนวนจุดรหัส (เหมือน char_length ของ Postgres) อีโมจิคู่ surrogate นับเป็น 1 */
export function textLength(value: string): number {
  return Array.from(value).length;
}

/** อักขระที่ Postgres เก็บไม่ได้: NUL (\u0000) และ surrogate เดี่ยว (UTF-16 ที่ไม่เป็นคู่) */
const DB_INVALID_CHARS = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export function hasDbInvalidChars(value: string): boolean {
  return DB_INVALID_CHARS.test(value);
}

/** ข้อความที่ยาว min-max ตัวอักษร และเก็บในฐานข้อมูลได้ (ใช้กับ id, ชื่อ, หมายเหตุ) */
export function lengthWithin(value: unknown, min: number, max: number): boolean {
  if (typeof value !== 'string' || hasDbInvalidChars(value)) return false;
  const n = textLength(value);
  return n >= min && n <= max;
}

/** วันที่ YYYY-MM-DD ที่มีอยู่จริงและอยู่ในช่วงปี 1900-2999 */
export function isSupportedEntryDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number];
  if (y < MIN_ENTRY_YEAR || y > MAX_ENTRY_YEAR) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** เหตุผลที่บัญชีนี้ฐานข้อมูลจะปฏิเสธ (null = ใช้ได้) */
export function accountProblem(account: Account): string | null {
  if (!lengthWithin(account.id, 1, MAX_ID_LENGTH)) return `รหัสบัญชีต้องยาว 1-${MAX_ID_LENGTH} ตัวอักษร`;
  if (!lengthWithin(account.name, 1, MAX_NAME_LENGTH)) return `ชื่อบัญชีต้องยาว 1-${MAX_NAME_LENGTH} ตัวอักษร`;
  if (!ACCOUNT_TYPES.has(account.type)) return `ชนิดบัญชีไม่ถูกต้อง: "${String(account.type)}"`;
  if (typeof account.currency !== 'string' || !CURRENCY_PATTERN.test(account.currency)) {
    return `สกุลเงินต้องเป็นตัวพิมพ์ใหญ่/ตัวเลข 2-10 ตัว: "${String(account.currency)}"`;
  }
  const order = account.sortOrder;
  if (order !== undefined && (!Number.isInteger(order) || order < INT32_MIN || order > INT32_MAX)) {
    return `ลำดับแสดงผลต้องเป็นจำนวนเต็ม: ${String(order)}`;
  }
  return null;
}
