/**
 * ยอดที่จ่ายจริงของบิล (R15 · เจ้าของตัดสินใจ 9 พ.ย. 2569)
 * จ่ายต่างจากยอดบิลได้ (ค่าไฟ/ค่าน้ำไม่เท่ากันทุกเดือน) แต่ต่างเกิน 20% ต้องถามยืนยันก่อนบันทึก
 * คำนวณด้วยจำนวนเต็ม (BigInt) ทั้งหมด ไม่ใช้ทศนิยมลอยตัว (R1) · ไม่แตะ DOM หรือฐานข้อมูล
 */

export const PAY_CONFIRM_PERCENT = 20;

/** เหตุผลที่ยอดจ่ายใช้ไม่ได้ (null = ใช้ได้): ต้องเป็นจำนวนเต็มสตางค์บวกที่อยู่ในช่วงปลอดภัย */
export function payAmountProblem(amount: unknown): string | null {
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
    return 'ยอดที่จ่ายต้องมากกว่า 0 และเป็นจำนวนเงินที่ถูกต้อง';
  }
  return null;
}

export interface PayDeviation {
  /** ยอดจ่าย - ยอดบิล (สตางค์) */
  diff: number;
  direction: 'same' | 'higher' | 'lower';
  /** ส่วนต่างเป็นเปอร์เซ็นต์ของยอดบิล หน่วยหนึ่งส่วนสิบ (เช่น 200 = 20.0%) ปัดครึ่งขึ้น */
  percentTenths: number;
  /** ต่างเกิน PAY_CONFIRM_PERCENT ของยอดบิล (20% พอดีไม่ต้องยืนยัน) */
  needsConfirm: boolean;
}

export function payDeviation(billAmount: number, paidAmount: number): PayDeviation {
  const billProblem = payAmountProblem(billAmount);
  if (billProblem) throw new RangeError(`ยอดบิลไม่ถูกต้อง: ${String(billAmount)}`);
  const paidProblem = payAmountProblem(paidAmount);
  if (paidProblem) throw new RangeError(`ยอดจ่ายไม่ถูกต้อง: ${String(paidAmount)}`);
  const bill = BigInt(billAmount);
  const diff = BigInt(paidAmount) - bill;
  const abs = diff < 0n ? -diff : diff;
  let tenths = Number((abs * 1000n * 2n + bill) / (bill * 2n)); // ปัดครึ่งขึ้น
  const needsConfirm = abs * 100n > bill * BigInt(PAY_CONFIRM_PERCENT);
  // ข้อความที่แสดงต้องไม่ขัดกับเกณฑ์: ต้องยืนยัน (เกิน 20% จริง) แต่ปัดแล้วได้ 20.0% -> แสดง 20.1% (ปัดขึ้น)
  if (needsConfirm && tenths <= PAY_CONFIRM_PERCENT * 10) tenths = PAY_CONFIRM_PERCENT * 10 + 1;
  return {
    diff: Number(diff),
    direction: diff === 0n ? 'same' : diff > 0n ? 'higher' : 'lower',
    percentTenths: tenths,
    needsConfirm,
  };
}
