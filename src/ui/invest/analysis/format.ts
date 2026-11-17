import { MONTHS_EN } from '../../../app/dateEn';

/**
 * ตัวจัดรูปแบบของแท็บ "วิเคราะห์" (ไม่มีสูตรเงิน): แปลง bps จำนวนเต็มเป็นข้อความเปอร์เซ็นต์ด้วยจำนวนเต็มล้วน (ไม่ใช้ทศนิยมลอยตัว)
 * 1 bps = 0.01% · ค่าจริงมาจากฟังก์ชันใน src/domain/invest เท่านั้น
 */

/** 1069 -> "10.69%" · -38 -> "-0.38%" (ไม่มีเครื่องหมายบวก) */
export function percentBps(bps: number): string {
  if (!Number.isSafeInteger(bps)) throw new RangeError(`Invalid bps: ${String(bps)}`);
  const abs = Math.abs(bps);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${bps < 0 ? '−' : ''}${whole.toLocaleString('en-US')}.${frac}%`;
}

/** เหมือน percentBps แต่ค่าบวกมี "+" (ศูนย์ไม่มีเครื่องหมาย) · ใช้ในตารางผลตอบแทนเพื่อไม่พึ่งสีอย่างเดียว */
export const signedPercentBps = (bps: number): string => (bps > 0 ? `+${percentBps(bps)}` : percentBps(bps));

/** ชื่อเดือนย่อ Jan-Dec (ดัชนี 0-11) */
export const MONTHS_SHORT = MONTHS_EN;

/** เหตุผลที่คำนวณผลตอบแทนเดือนไม่ได้ (จาก MonthReturn.na) */
export function naReasonText(na: 'missing' | 'zero-base' | undefined): string {
  return na === 'zero-base' ? 'Cannot calculate: no starting balance this month' : 'Missing price or exchange rate for this month';
}

export type Tone = 'pos' | 'neg' | 'zero';
export const toneOf = (n: number): Tone => (n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero');
