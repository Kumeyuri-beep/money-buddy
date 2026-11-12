/**
 * ตัวปัดสำหรับ "แสดงผล" ของเครื่องคิดเลขเกษียณ (กฎ R18 · เจ้าของอนุมัติ 12 พ.ย. 2569): หน้าจอแสดงเป็นหลักร้อยบาท
 * ใช้เฉพาะตอนแสดง ห้ามนำค่าที่ปัดแล้วไปคำนวณต่อ (ค่าจริงในผลลัพธ์ยังเป็นสตางค์เต็ม)
 *   'nearest' = ปัดครึ่งขึ้น (R8 ตัวปัดกลาง) · ใช้กับทุกค่ายกเว้นเงินเก็บต่อเดือน
 *   'up'      = ปัดขึ้น (ceilDivBig) · ใช้กับ "เงินเก็บต่อเดือน" เท่านั้น เพื่อไม่ให้เก็บขาด
 */

import { ceilDivBig, roundHalfUpBig } from '../money/round';
import { satang, toBahtString } from '../money/satang';

const HUNDRED_BAHT_SATANG = 10_000n;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export type DisplayRounding = 'nearest' | 'up';

/** สตางค์ → สตางค์ที่เป็นพหุคูณของ 100 บาท · ค่าไม่ถูกต้อง/ผลเกินช่วงปลอดภัย = RangeError */
export function roundToHundredBaht(value: number, mode: DisplayRounding): number {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) throw new RangeError('ยอดที่จะแสดงต้องเป็นสตางค์จำนวนเต็มที่ไม่ติดลบ');
  const v = BigInt(value);
  const units = mode === 'up' ? ceilDivBig(v, HUNDRED_BAHT_SATANG) : roundHalfUpBig(v, HUNDRED_BAHT_SATANG);
  const rounded = units * HUNDRED_BAHT_SATANG;
  if (rounded > MAX_SAFE) throw new RangeError('ยอดใหญ่เกินกว่าจะแสดงได้');
  return Number(rounded);
}

/** ข้อความ "฿12,300" (หลักร้อยบาท ไม่มีทศนิยม) */
export function formatHundredBaht(value: number, mode: DisplayRounding): string {
  const text = toBahtString(satang(roundToHundredBaht(value, mode)));
  return `฿${text.slice(0, -3)}`; // ตัด ".00" (พหุคูณของ 100 บาทไม่มีสตางค์)
}

/** เหมือน formatHundredBaht แบบใกล้สุด แต่ค่าบวกที่ปัดแล้วเป็น 0 แสดง "น้อยกว่า ฿100" (ไม่ให้เห็น ฿0 ทั้งที่ยังขาดอยู่) */
export function formatHundredBahtNonZero(value: number): string {
  return value > 0 && roundToHundredBaht(value, 'nearest') === 0 ? 'น้อยกว่า ฿100' : formatHundredBaht(value, 'nearest');
}
