/**
 * ตารางบิลประจำ: บิลไหนจ่ายแล้ว บิลไหนค้างจ่ายก่อนเงินเดือนถัดไป และการกันจ่ายซ้ำ (กฎ R15)
 * ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล ยอดเป็นสตางค์จำนวนเต็ม
 *
 * ขอบเขตของ "ค้างจ่าย": รอบของเดือนปัจจุบันเป็นต้นไป บวกรอบเดือนก่อนที่ยังไม่จ่าย "เมื่อบิลมี startMonth ครอบคลุม"
 * (ย้อนหลังได้ไม่เกิน 1 เดือน ไม่แต่งหนี้ที่ไม่มีหลักฐาน) ดู docs/decisions/2026-11-04-bills-safe-to-spend.md
 */

import { addDays, addMonths, dueDateIn, effectiveNextPayday, isCycleMonth, monthOf } from './calendar';
import { lengthWithin, MAX_ID_LENGTH, MAX_NAME_LENGTH } from '../ledger/limits';
import type { Bill, BillProblem, UpcomingBill } from './types';

export class BillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillError';
  }
}

/** เหตุผลที่บิลนี้ข้อมูลผิดรูป (null = ใช้ได้) ตรวจ ยอด วันครบกำหนด lastPaidMonth startMonth */
export function billProblem(bill: Bill): string | null {
  if (!lengthWithin(bill.id, 1, MAX_ID_LENGTH)) return `รหัสบิลต้องยาว 1-${MAX_ID_LENGTH} ตัวอักษร`;
  if (!lengthWithin(bill.name, 1, MAX_NAME_LENGTH)) return `ชื่อบิลต้องยาว 1-${MAX_NAME_LENGTH} ตัวอักษร`;
  if (!Number.isSafeInteger(bill.amount) || bill.amount <= 0) {
    return `ยอดต้องเป็นจำนวนเต็มสตางค์ที่มากกว่า 0 (ได้รับ ${String(bill.amount)})`;
  }
  try {
    dueDateIn('2000-01', bill.dueDay); // ตรวจ 1-31 ด้วยฟังก์ชันปฏิทินตัวเดียวกัน
  } catch {
    return `วันครบกำหนดต้องเป็นจำนวนเต็ม 1-31 (ได้รับ ${String(bill.dueDay)})`;
  }
  if (bill.lastPaidMonth !== undefined && !isCycleMonth(bill.lastPaidMonth)) {
    return `lastPaidMonth ผิดรูป ต้องเป็น YYYY-MM (ได้รับ "${String(bill.lastPaidMonth)}")`;
  }
  if (bill.startMonth !== undefined && !isCycleMonth(bill.startMonth)) {
    return `startMonth ผิดรูป ต้องเป็น YYYY-MM (ได้รับ "${String(bill.startMonth)}")`;
  }
  return null;
}

/**
 * แยกบิลที่ใช้ได้กับบิลที่ข้อมูลผิดรูป (รวมรหัสซ้ำ: ตัวที่สองเป็นต้นไปถือว่าเสีย กันนับยอดซ้ำ)
 * บิลที่เก็บถาวร (archived === true) ถูกข้ามและไม่อยู่ในผลทั้งสองฝั่ง
 * ผู้เรียกควรแจ้งผู้ใช้เมื่อมี invalid เพราะยอดค้างจ่ายอาจต่ำกว่าจริง
 */
export function splitValidBills(bills: readonly Bill[]): { valid: Bill[]; invalid: BillProblem[] } {
  const valid: Bill[] = [];
  const invalid: BillProblem[] = [];
  const seen = new Set<string>();
  for (const bill of bills) {
    if (bill.archived === true) continue;
    const reason = billProblem(bill) ?? (seen.has(bill.id) ? 'รหัสบิลซ้ำ (นับซ้ำไม่ได้)' : null);
    seen.add(bill.id);
    if (reason) invalid.push({ id: bill.id, name: bill.name, reason });
    else valid.push(bill);
  }
  return { valid, invalid };
}

/** รอบเดือนนี้จ่ายแล้วหรือยัง: lastPaidMonth ครอบคลุมรอบนั้น (เทียบเดือนแบบ >= เพราะ YYYY-MM เรียงตามตัวอักษรได้) */
export function isBillPaid(bill: Bill, cycleMonth: string): boolean {
  if (!isCycleMonth(cycleMonth)) throw new RangeError(`รอบเดือนต้องเป็น YYYY-MM: "${cycleMonth}"`);
  if (bill.lastPaidMonth === undefined) return false;
  if (!isCycleMonth(bill.lastPaidMonth)) {
    throw new RangeError(`บิล "${bill.name}" (${bill.id}) มี lastPaidMonth ผิดรูป: "${String(bill.lastPaidMonth)}"`);
  }
  return bill.lastPaidMonth >= cycleMonth;
}

/** รอบแรกที่นับ: ไม่มี startMonth = รอบปัจจุบัน · เริ่มในอนาคต = เดือนที่เริ่ม · อื่นๆ = startMonth แต่ย้อนไม่เกิน 1 เดือน */
function firstCycle(bill: Bill, currentMonth: string): string {
  const start = bill.startMonth;
  if (start === undefined) return currentMonth;
  if (start > currentMonth) return start;
  const floor = addMonths(currentMonth, -1);
  return start > floor ? start : floor;
}

/** รายการรอบเดือนจาก first ถึง last (รวมทั้งสอง) ว่างเมื่อ first อยู่หลัง last และไม่คำนวณเลยเดือนสุดท้าย */
function cyclesBetween(first: string, last: string): string[] {
  const cycles: string[] = [];
  if (first > last) return cycles;
  for (let cycle = first; ; cycle = addMonths(cycle, 1)) {
    cycles.push(cycle);
    if (cycle >= last) break;
  }
  return cycles;
}

/** รอบที่การจ่ายวันนี้จะชำระ: รอบที่ค้างเก่าที่สุดที่ยังไม่จ่าย (ไม่เกินเดือนนี้) คืน null ถ้าไม่มีรอบที่ต้องจ่าย */
export function payableCycle(bill: Bill, today: string): string | null {
  const current = monthOf(today);
  for (const cycle of cyclesBetween(firstCycle(bill, current), current)) {
    if (!isBillPaid(bill, cycle)) return cycle;
  }
  return null;
}

/**
 * ตั้ง lastPaidMonth หลังจ่าย ไม่แก้ของเดิม
 * ปฏิเสธรอบอนาคต (หลังเดือนของวันนี้) กัน lastPaidMonth ล้ำหน้าจนบล็อกการจ่ายจริงเมื่อนาฬิกาเครื่องเพี้ยน
 * ปฏิเสธรอบที่จ่ายไปแล้ว (กันจ่ายซ้ำตามกฎ R15)
 */
export function markBillPaid(bill: Bill, cycleMonth: string, today: string): Bill {
  dueDateIn(cycleMonth, 1); // ตรวจรูปแบบ YYYY-MM
  if (cycleMonth > monthOf(today)) {
    throw new BillError(`บิล "${bill.name}" จ่ายล่วงหน้ารอบอนาคต (${cycleMonth}) ไม่ได้`);
  }
  if (isBillPaid(bill, cycleMonth)) {
    throw new BillError(`บิล "${bill.name}" จ่ายรอบ ${cycleMonth} ไปแล้ว จ่ายซ้ำไม่ได้`);
  }
  return { ...bill, lastPaidMonth: cycleMonth };
}

/**
 * บิลที่ยังไม่จ่ายและครบกำหนดตั้งแต่รอบแรกที่นับถึง endDate (รวมวันนั้น) เรียงตามวันครบกำหนด ชื่อ รหัส
 * endDate ก่อนวันนี้ -> ว่าง · บิลที่เก็บถาวรถูกข้าม (และไม่ตรวจรูปแบบ)
 * ข้อมูลบิลผิดรูปหรือรหัสซ้ำโยน RangeError (ถ้าต้องการแสดงผลต่อทั้งที่มีบิลเสีย ให้ผ่าน splitValidBills ก่อน)
 */
export function upcomingBills(bills: readonly Bill[], today: string, endDate: string): UpcomingBill[] {
  const currentMonth = monthOf(today);
  const lastCycle = monthOf(endDate);
  if (endDate < today) return [];

  const found: UpcomingBill[] = [];
  const seen = new Set<string>();
  for (const bill of bills) {
    if (bill.archived === true) continue;
    const problem = billProblem(bill);
    if (problem) throw new RangeError(`บิล "${bill.name}" (${bill.id}): ${problem}`);
    if (seen.has(bill.id)) throw new RangeError(`รหัสบิลซ้ำ: ${bill.id}`);
    seen.add(bill.id);
    for (const cycle of cyclesBetween(firstCycle(bill, currentMonth), lastCycle)) {
      const dueDate = dueDateIn(cycle, bill.dueDay);
      if (dueDate > endDate || isBillPaid(bill, cycle)) continue;
      found.push({ bill, dueDate, cycleMonth: cycle, overdue: dueDate < today });
    }
  }
  return found.sort(
    (a, b) =>
      (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0) ||
      (a.bill.name < b.bill.name ? -1 : a.bill.name > b.bill.name ? 1 : 0) ||
      (a.bill.id < b.bill.id ? -1 : a.bill.id > b.bill.id ? 1 : 0),
  );
}

/** ยอดรวมบิลค้างจ่าย (สตางค์) เกินช่วงปลอดภัยโยน RangeError ไม่ปัดเงียบ */
export function outstandingTotal(upcoming: readonly UpcomingBill[]): number {
  let total = 0;
  for (const u of upcoming) {
    total += u.bill.amount;
    if (!Number.isSafeInteger(total)) throw new RangeError('ยอดรวมบิลใหญ่เกินช่วงที่คำนวณได้อย่างปลอดภัย');
  }
  return total;
}

/**
 * บิลค้างจ่ายก่อนเงินเดือนถัดไป ประกอบ nextPayday + upcomingBills ให้ช่วงตรงกับจำนวนวันของสูตร R15 เสมอ
 * ช่วงบิลคือ [วันนี้, วันเงินเดือนถัดไป] รวมวันเงินเดือน: บิลที่ครบกำหนดตรงวันเงินเดือนถัดไปถูกหักจากรอบปัจจุบัน (ทางปลอดภัย · เจ้าของตัดสิน 11 พ.ย. 2569)
 * ส่วนจำนวนวันหารยังนับ [วันนี้, วันเงินเดือนถัดไป) เท่าเดิม
 */
export function outstandingBeforePayday(
  bills: readonly Bill[],
  today: string,
  payDay: number,
  nextPaydayOverride?: string,
): { nextPayday: string; items: UpcomingBill[]; total: number } {
  const next = effectiveNextPayday(payDay, today, nextPaydayOverride);
  const items = upcomingBills(bills, today, next);
  return { nextPayday: next, items, total: outstandingTotal(items) };
}
