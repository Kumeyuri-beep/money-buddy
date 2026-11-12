/**
 * ความคืบหน้าสู่เป้าเกษียณ และการเทียบแผน DCA (เฟส 2 · กฎ R18 ข้อ 18.8) · ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล/ledger
 * **แสดงผลอย่างเดียว ห้ามป้อนกลับเข้าสูตรเงินที่ต้องมี/เงินเก็บต่อเดือน และห้ามบันทึกเป็นยอด (R16)**
 */

import { roundHalfUpBig } from '../money/round';
import { safeSub } from '../money/safe';

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

const assertSatang = (v: number, what: string): void => {
  if (!Number.isSafeInteger(v) || v < 0 || Object.is(v, -0)) throw new RangeError(`${what}ต้องเป็นสตางค์จำนวนเต็มที่ไม่ติดลบ`);
};

/**
 * ความคืบหน้าเป็น bps = roundHalfUp(มูลค่า x 10000 / เป้า) · เป้า = 0 → null (ไม่หารศูนย์)
 * ยังน้อยกว่าเป้าแต่ปัดแล้วได้ 10000 → คืน 9999 (ห้ามแสดง 100% ถ้ายังไม่ถึง) · เกินเป้าคืนเกิน 10000 ได้
 */
export function progressBps(valueSatang: number, requiredSatang: number): number | null {
  assertSatang(valueSatang, 'มูลค่าพอร์ต');
  assertSatang(requiredSatang, 'เงินที่ต้องมี');
  if (requiredSatang === 0) return null;
  let bps = roundHalfUpBig(BigInt(valueSatang) * 10_000n, BigInt(requiredSatang));
  if (valueSatang < requiredSatang && bps >= 10_000n) bps = 9_999n;
  if (bps > MAX_SAFE) throw new RangeError('ความคืบหน้าใหญ่เกินกว่าจะแสดงได้');
  return Number(bps);
}

/** ความกว้างแถบความคืบหน้าเป็น % จำนวนเต็ม 0-100 (แสดงผลอย่างเดียว · เกินเป้าแสดงเต็ม 100) */
export function progressBarPercent(bps: number): number {
  if (!Number.isSafeInteger(bps) || bps < 0 || Object.is(bps, -0)) throw new RangeError('ความคืบหน้าต้องเป็น bps จำนวนเต็มที่ไม่ติดลบ');
  return bps >= 10_000 ? 100 : (bps - (bps % 100)) / 100;
}

export interface DcaVersusSaving {
  /** รวมแผน DCA ต่อเดือนของสินทรัพย์ที่เลือก (สตางค์ · แผนที่ตั้งไว้ ไม่ใช่เงินออมจริง) */
  dcaMonthly: number;
  /** เงินที่ต้องเก็บต่อเดือนตามประมาณการ (สตางค์) */
  savingNeeded: number;
  /** ส่วนที่แผนยังไม่ถึง (สตางค์ ≥ 0) */
  shortBy: number;
  covered: boolean;
}

/** เทียบแผน DCA ต่อเดือนกับเงินที่ต้องเก็บ · ไม่นับ DCA เป็นเงินออม ไม่ป้อนกลับสูตร */
export function dcaVersusSaving(dcaMonthly: number, savingNeeded: number): DcaVersusSaving {
  assertSatang(dcaMonthly, 'แผน DCA ต่อเดือน');
  assertSatang(savingNeeded, 'เงินที่ต้องเก็บ');
  const shortBy = savingNeeded > dcaMonthly ? safeSub(savingNeeded, dcaMonthly) : 0;
  return { dcaMonthly, savingNeeded, shortBy, covered: shortBy === 0 };
}
