/**
 * DCA (ซื้อด้วยเงินคงที่) และสรุปมูลค่าตามราคาที่ผู้ใช้กรอก (กฎ R17) · ฟังก์ชันล้วน ไม่ดึงราคาจากเว็บ
 *   units = roundHalfUp(A x 10^12 / priceMicro) ปัดครั้งเดียว · ต้นทุนที่บันทึก = A + F ไม่คำนวณกลับจากหน่วย x ราคา
 * แผน DCA เป็นเพียงตัวเตือน ฟังก์ชันนี้ใช้คำนวณล่วงหน้า/เติมฟอร์ม ไม่สร้างรายการ
 */

import { roundHalfUpBig } from '../money/round';
import { safeAdd, safeSub } from '../money/safe';
import { rangeError } from './errorCodes';
import { applyBuy, type Position } from './costBasis';
import { assertPriceMicro, assertUnitsInRange, SATANG_DIVISOR, valueInSatang } from './units';

export function dcaUnits(amountSatang: number, priceMicro: number): bigint {
  if (!Number.isSafeInteger(amountSatang) || amountSatang <= 0) {
    throw rangeError('dca.amountInvalid', { got: String(amountSatang) });
  }
  assertPriceMicro(priceMicro);
  const units = roundHalfUpBig(BigInt(amountSatang) * SATANG_DIVISOR, BigInt(priceMicro));
  if (units <= 0n) throw rangeError('dca.unitsZero');
  assertUnitsInRange(units);
  return units;
}

export interface DcaPeriod {
  /** เงินที่ซื้อ (สตางค์ ไม่รวมค่าธรรมเนียม) */
  amount: number;
  fee: number;
  /** ราคาสมมติหรือราคาจริงของงวดนั้น */
  priceMicro: number;
}

export interface DcaProjection {
  position: Position;
  /** Σ เงินที่ออกจากกระเป๋า (A+F) */
  totalPaid: number;
  steps: { units: bigint; paid: number }[];
}

/**
 * จำลองซื้อ DCA หลายงวดต่อเนื่อง (ได้หน่วย/ต้นทุนรวม/เงินที่จ่ายต่องวด)
 *
 * [เก็บไว้ทั้งที่ยังไม่มีหน้าจอเรียก — ตัดสินเมื่อ 14 พ.ย. 2569 หลัง money-auditor ตรวจ]
 * เหตุผล: เตรียมไว้สำหรับ "ตัวคำนวณ DCA ล่วงหน้า" ตามแผน docs/plans/2026-11-11-invest-portfolio-dca.md (P1) หน้าถัวเฉลี่ยตอนนี้คำนวณงวดเดียวด้วย dcaUnits + applyBuy ตรรกะเดียวกับหนึ่งงวดของฟังก์ชันนี้
 * ไม่มีโค้ดอื่นจำลองหลายงวดซ้ำ (ค้นแล้วไม่พบ) · มีเทสต์ที่ tests/unit/investDca.test.ts · ถ้าเลิกแผนหน้าจำลองหลายงวดค่อยลบพร้อมเทสต์
 */
export function projectDca(start: Position, periods: readonly DcaPeriod[]): DcaProjection {
  let position = start;
  let totalPaid = 0;
  const steps: DcaProjection['steps'] = [];
  for (const p of periods) {
    const units = dcaUnits(p.amount, p.priceMicro);
    position = applyBuy(position, { units, amount: p.amount, fee: p.fee });
    const paid = safeAdd(p.amount, p.fee);
    totalPaid = safeAdd(totalPaid, paid);
    steps.push({ units, paid });
  }
  return { position, totalPaid, steps };
}

export interface MarketSummary {
  /** มูลค่าตามราคาที่กรอก (สตางค์) */
  value: number;
  cost: number;
  /** กำไร/ขาดทุนที่ยังไม่ขาย = มูลค่า − ต้นทุน (ค่าแสดงผล ไม่ลงสมุดบัญชี) */
  unrealized: number;
}

/** ยังไม่มีราคา = null ห้ามใช้ต้นทุนแทนเงียบๆ */
export function marketSummary(position: Position, priceMicro: number | null): MarketSummary | null {
  if (priceMicro === null) return null;
  const value = valueInSatang(position.units, priceMicro);
  return { value, cost: position.cost, unrealized: safeSub(value, position.cost) };
}
