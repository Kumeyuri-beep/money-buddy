/**
 * สกุลที่แสดงผลใน /invest (กฎ R26) · ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล · BigInt ตลอดขั้นคูณ · ห้าม float
 *   - เป็นเรื่องของหน้าจอเท่านั้น: ไม่เปลี่ยนข้อมูลที่บันทึก ไม่ลงสมุด
 *   - มุมมอง USD ใช้เซนต์ต้นทางตรงๆ · มุมมอง THB แปลงจากต้นทางครั้งเดียวต่อค่า ด้วยเรตที่ผู้เรียกเลือกตามชนิดตัวเลข (R26 ตารางเรต)
 *   - ไม่มีเรต = ไม่คำนวณ (null → หน้าจอแสดง "Needs rate") ห้ามใช้ 1 หรือเรตอื่นแทนเงียบๆ (R20.7)
 */

import { roundHalfUpBig } from '../money/round';
import { assertFxRateMicro, FX_SCALE } from './fx';
import { toSafeSatang } from './units';

export type DisplayCurrency = 'THB' | 'USD';

/** ค่าเริ่มต้นเมื่อผู้ใช้ยังไม่เคยตั้ง = USD (R26.1) · ค่าที่ตั้งไว้แล้ว (THB/USD) คงเดิม */
export const DEFAULT_DISPLAY_CURRENCY: DisplayCurrency = 'USD';
export const resolveDisplayCurrency = (stored: unknown): DisplayCurrency => (stored === 'THB' || stored === 'USD' ? stored : DEFAULT_DISPLAY_CURRENCY);

function assertSafeInt(v: number): void {
  if (!Number.isSafeInteger(v)) throw new RangeError(`จำนวนเงินต้องเป็นจำนวนเต็มปลอดภัย (ได้รับ ${String(v)})`);
}

/** เซนต์ → สตางค์ (มีเครื่องหมายได้ · กำไรติดลบ) ปัดครึ่งออกจากศูนย์ครั้งเดียว: roundHalfUp(cents × rateMicro / 10^6) */
export function centsToSatangSigned(cents: number, rateMicro: number): number {
  assertSafeInt(cents);
  assertFxRateMicro(rateMicro);
  return toSafeSatang(roundHalfUpBig(BigInt(cents) * BigInt(rateMicro), FX_SCALE));
}

/** สตางค์ → เซนต์ (มีเครื่องหมายได้) ปัดครึ่งออกจากศูนย์ครั้งเดียว: roundHalfUp(satang × 10^6 / rateMicro) */
export function satangToCentsSigned(satang: number, rateMicro: number): number {
  assertSafeInt(satang);
  assertFxRateMicro(rateMicro);
  return toSafeSatang(roundHalfUpBig(BigInt(satang) * FX_SCALE, BigInt(rateMicro)));
}

/**
 * แปลงค่าเงินหน่วยย่อยหนึ่งค่าไปสกุลที่แสดง
 * - สกุลเดียวกัน = คืนค่าเดิม (ไม่ต้องใช้เรต)
 * - ต่างสกุลต้องมีเรต: rateMicro เป็น null/undefined = null (ไม่คำนวณ)
 */
export function toDisplayMinor(from: DisplayCurrency, minor: number, to: DisplayCurrency, rateMicro: number | null | undefined): number | null {
  assertSafeInt(minor);
  if (from === to) return minor;
  if (rateMicro === null || rateMicro === undefined) return null;
  return from === 'USD' ? centsToSatangSigned(minor, rateMicro) : satangToCentsSigned(minor, rateMicro);
}

/**
 * ผลรวมของตารางในมุมมองที่แปลงแล้ว (R26: ผลบวกของค่าที่แปลงแล้วของแต่ละแถว ไม่ใช่แปลงยอดรวมก้อนเดียว)
 * มีค่า null แม้แต่แถวเดียว = null (ไม่นับแถวนั้นเป็น 0)
 */
export function sumDisplayed(rows: readonly (number | null)[]): number | null {
  let sum = 0n;
  for (const r of rows) {
    if (r === null) return null;
    assertSafeInt(r);
    sum += BigInt(r);
  }
  return toSafeSatang(sum);
}
