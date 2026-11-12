/**
 * ตัวปัดสำหรับ "แสดงผล" ภาษี (กฎ R19): หน้าจอแสดงเป็นบาทเต็ม (ปัดครึ่งขึ้นด้วยตัวปัดกลาง R8) เพราะเป็นประมาณการ ไม่ควรโชว์สตางค์
 * ใช้เฉพาะตอนแสดง ห้ามนำค่าที่ปัดแล้วไปคำนวณต่อ (ค่าจริงในผลลัพธ์ยังเป็นสตางค์เต็ม)
 */

import { roundHalfUpBig } from '../money/round';

const SATANG_PER_BAHT = 100n;

/** สตางค์ (ไม่ติดลบ) → บาทเต็มแบบ bigint · ค่าไม่ถูกต้อง = RangeError */
export function wholeBaht(satangValue: number): bigint {
  if (!Number.isSafeInteger(satangValue) || satangValue < 0 || Object.is(satangValue, -0)) throw new RangeError('ยอดที่จะแสดงต้องเป็นสตางค์จำนวนเต็มที่ไม่ติดลบ');
  return roundHalfUpBig(BigInt(satangValue), SATANG_PER_BAHT);
}

/** "฿12,300" (บาทเต็ม ไม่มีทศนิยม) */
export function formatWholeBaht(satangValue: number): string {
  return `฿${wholeBaht(satangValue).toLocaleString('en-US')}`;
}

/** ค่าที่มีเครื่องหมาย (ผลต่างกับภาษีที่ถูกหัก): คืนข้อความขนาดเงินสัมบูรณ์ ส่วนบวก/ลบ/เท่ากัน ให้หน้าจอใช้ balanceKind แสดงเป็นคำ ไม่ใช้เครื่องหมาย */
export function formatAbsWholeBaht(signedSatang: number): string {
  if (!Number.isSafeInteger(signedSatang)) throw new RangeError('ยอดที่จะแสดงต้องเป็นสตางค์จำนวนเต็ม');
  return formatWholeBaht(Math.abs(signedSatang));
}
