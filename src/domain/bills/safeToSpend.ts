/**
 * SAFE-TO-SPEND ตามกฎ R15
 *   (ยอดกระเป๋าที่ใช้จ่ายได้ − บิลและงวดหนี้ที่ยังไม่จ่ายก่อนวันรับเงินเดือนถัดไป − เงินสำรองที่ผู้ใช้ตั้ง) ÷ จำนวนวันที่เหลือ
 * ผลติดลบให้แสดงเป็น 0 พร้อมคำเตือน ห้ามแสดงตัวเลขติดลบเป็นเงินที่ใช้ได้
 *
 * ฟังก์ชันล้วน ยอดเป็นสตางค์จำนวนเต็ม (R1) ปัดเศษต่อวันด้วย roundHalfUp ตัวกลาง (R8)
 * ผลรวม perDay × daysLeft อาจเกินยอดที่ใช้ได้ไม่เกินครึ่งสตางค์ต่อวัน (ยอมรับตามกติกา R8)
 */

import { roundHalfUp } from '../money/round';
import { daysBetween, nextPayday } from './calendar';

export interface SafeToSpendInput {
  /** ยอดกระเป๋าที่ใช้จ่ายได้ (สตางค์) ติดลบได้ถ้าเบิกเกิน */
  spendable: number;
  /** บิลและงวดหนี้ที่ยังไม่จ่ายก่อนเงินเดือนถัดไป (สตางค์ ไม่ติดลบ) */
  outstanding: number;
  /** เงินสำรองที่ผู้ใช้ตั้ง เช่น เป้าออม (สตางค์ ไม่ติดลบ) */
  reserve: number;
  /** วันนี้ YYYY-MM-DD */
  today: string;
  /** วันเงินเดือนเข้าในเดือน 1-31 */
  payDay: number;
}

interface Common {
  /** ยอดที่ใช้ได้รวมหลังหักบิลและเงินสำรอง (ติดลบได้ในกรณีขาด) */
  available: number;
  /** จำนวนวันจากวันนี้ถึงวันก่อนเงินเดือนถัดไป นับรวมวันนี้ อย่างน้อย 1 */
  daysLeft: number;
  nextPayday: string;
}

export type SafeToSpendResult =
  | (Common & { kind: 'ok'; perDay: number })
  /** ยอดที่ใช้ได้ติดลบ: ใช้ได้ต่อวัน = 0 และบอกจำนวนที่ขาด (สตางค์ บวก) */
  | (Common & { kind: 'shortfall'; perDay: 0; shortfall: number });

function assertSatang(value: number, name: string, allowNegative: boolean): void {
  if (!Number.isSafeInteger(value) || (!allowNegative && value < 0)) {
    throw new RangeError(`${name} ต้องเป็นจำนวนเต็มสตางค์${allowNegative ? '' : 'ที่ไม่ติดลบ'} (ได้รับ ${String(value)})`);
  }
}

export function computeSafeToSpend(input: SafeToSpendInput): SafeToSpendResult {
  assertSatang(input.spendable, 'ยอดกระเป๋าที่ใช้จ่ายได้', true);
  assertSatang(input.outstanding, 'ยอดบิลค้างจ่าย', false);
  assertSatang(input.reserve, 'เงินสำรอง', false);

  const next = nextPayday(input.payDay, input.today); // ตรวจวันนี้และวันเงินเดือนด้วย
  const daysLeft = daysBetween(input.today, next); // วันนี้ถึงวันก่อนเงินเดือน นับรวมวันนี้ = ผลต่างพอดี (>= 1)
  const available = input.spendable - input.outstanding - input.reserve || 0; // `|| 0` กัน -0
  if (!Number.isSafeInteger(available)) throw new RangeError('ยอดที่ใช้ได้เกินช่วงที่คำนวณได้อย่างปลอดภัย');

  const common = { available, daysLeft, nextPayday: next };
  if (available < 0) return { ...common, kind: 'shortfall', perDay: 0, shortfall: -available };
  return { ...common, kind: 'ok', perDay: roundHalfUp(available, daysLeft) };
}
