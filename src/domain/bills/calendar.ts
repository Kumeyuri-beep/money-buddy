/**
 * ปฏิทินสำหรับบิลประจำและวันเงินเดือน (ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล)
 * - รอบเดือนเขียนเป็น "YYYY-MM" วันที่เขียนเป็น "YYYY-MM-DD" (ปี ค.ศ. 1000-9999)
 * - วันที่ 29-31 ในเดือนที่สั้นกว่าถูกบีบเป็นวันสุดท้ายของเดือนนั้น
 * - คำนวณด้วยจำนวนเต็มล้วน ไม่ใช้ Date ท้องถิ่น (กันเขตเวลาทำให้วันเพี้ยน)
 */

import { isValidIsoDate } from '../ledger/entry';

const CYCLE_MONTH = /^([1-9]\d{3})-(0[1-9]|1[0-2])$/;
const MS_PER_DAY = 86_400_000;
const MIN_YEAR = 1000;
const MAX_YEAR = 9999;

const pad2 = (n: number) => String(n).padStart(2, '0');

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** จำนวนวันของเดือน (month = 1-12) */
export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`ปีหรือเดือนไม่ถูกต้อง: ${String(year)}-${String(month)}`);
  }
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** รอบเดือนรูปแบบ YYYY-MM ที่ถูกต้อง (ปี 1000-9999 เดือน 01-12) */
export function isCycleMonth(value: unknown): value is string {
  return typeof value === 'string' && CYCLE_MONTH.test(value);
}

function parseCycleMonth(cycleMonth: string): { year: number; month: number } {
  const m = CYCLE_MONTH.exec(cycleMonth);
  if (!m) throw new RangeError(`รอบเดือนต้องเป็น YYYY-MM (ปี ${MIN_YEAR}-${MAX_YEAR}): "${cycleMonth}"`);
  return { year: Number(m[1]), month: Number(m[2]) };
}

/** วันครบกำหนดในรอบเดือน day = 1-31 (เกินจำนวนวันของเดือนจะบีบเป็นวันสุดท้ายของเดือน) */
export function dueDateIn(cycleMonth: string, day: number): string {
  const { year, month } = parseCycleMonth(cycleMonth);
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new RangeError(`วันที่ในเดือนต้องเป็นจำนวนเต็ม 1-31: ${String(day)}`);
  }
  return `${year}-${pad2(month)}-${pad2(Math.min(day, daysInMonth(year, month)))}`;
}

/** เลื่อนรอบเดือนไปข้างหน้า (บวก) หรือย้อนหลัง (ลบ) ผลต้องอยู่ในปี 1000-9999 */
export function addMonths(cycleMonth: string, months: number): string {
  const { year, month } = parseCycleMonth(cycleMonth);
  if (!Number.isSafeInteger(months)) throw new RangeError(`จำนวนเดือนต้องเป็นจำนวนเต็ม: ${String(months)}`);
  const index = year * 12 + (month - 1) + months;
  const newYear = Math.floor(index / 12);
  if (!Number.isSafeInteger(index) || newYear < MIN_YEAR || newYear > MAX_YEAR) {
    throw new RangeError(`รอบเดือนที่ได้อยู่นอกช่วงปี ${MIN_YEAR}-${MAX_YEAR}`);
  }
  return `${newYear}-${pad2((((index % 12) + 12) % 12) + 1)}`;
}

/** รอบเดือน (YYYY-MM) ของวันที่ ปฏิเสธวันที่ที่ไม่มีจริง เช่น 2026-02-30 */
export function monthOf(isoDate: string): string {
  if (!isValidIsoDate(isoDate)) throw new RangeError(`วันที่ไม่ถูกต้อง: "${isoDate}"`);
  return isoDate.slice(0, 7);
}

function utcDay(isoDate: string): number {
  if (!isValidIsoDate(isoDate)) throw new RangeError(`วันที่ไม่ถูกต้อง: "${isoDate}"`);
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

/** จำนวนวันจาก from ไป to (to ช้ากว่า = บวก) ผลต่างของ UTC เป็นพหุคูณของวันพอดี จึงไม่ต้องปัดเศษ */
export function daysBetween(from: string, to: string): number {
  return (utcDay(to) - utcDay(from)) / MS_PER_DAY;
}

/** เลื่อนวันที่ไปข้างหน้า (บวก) หรือย้อนหลัง (ลบ) หน่วยเป็นวัน ด้วยเวลา UTC */
export function addDays(isoDate: string, days: number): string {
  if (!Number.isSafeInteger(days)) throw new RangeError(`จำนวนวันต้องเป็นจำนวนเต็ม: ${String(days)}`);
  const date = new Date(utcDay(isoDate) + days * MS_PER_DAY);
  const year = date.getUTCFullYear();
  if (!(year >= MIN_YEAR && year <= MAX_YEAR)) throw new RangeError(`วันที่ที่ได้อยู่นอกช่วงปี ${MIN_YEAR}-${MAX_YEAR}`);
  return `${year}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/**
 * วันเงินเดือนแรกที่ "หลัง" วันนี้ (ถ้าวันนี้คือวันเงินเดือน ถือว่าเงินเข้ากระเป๋าแล้ว ถัดไปคือเดือนหน้า)
 * payDay = 1-31 (เกินจำนวนวันของเดือนจะบีบเป็นวันสุดท้ายของเดือน)
 */
export function nextPayday(payDay: number, today: string): string {
  const month = monthOf(today);
  const thisMonth = dueDateIn(month, payDay);
  return thisMonth > today ? thisMonth : dueDateIn(addMonths(month, 1), payDay);
}

/**
 * วันเงินเดือนถัดไปที่ใช้คำนวณจริง: ถ้าผู้ใช้กำหนดวัน (override) และเป็นวัน "หลัง" วันนี้ ใช้วันนั้น
 * ไม่งั้น (ไม่ตั้ง / ผ่านไปแล้ว = หมดอายุ / ไกลเกิน 62 วัน = ถือว่าพิมพ์ผิด) คำนวณจากวันเงินเดือนประจำเดือนตามปกติ
 */
/** override ที่ไกลเกินนี้ (วัน) ถูกมองว่าพิมพ์ผิดและไม่ใช้ กันบิลล้นหลายรอบ */
const MAX_OVERRIDE_DAYS = 62;

export function effectiveNextPayday(payDay: number, today: string, override?: string): string {
  if (override !== undefined && override > today && daysBetween(today, override) <= MAX_OVERRIDE_DAYS) {
    return override;
  }
  return nextPayday(payDay, today);
}
