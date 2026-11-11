/**
 * เครื่องคิดเลขถัวเฉลี่ยต้นทุน (พอร์ตลงทุน P1) · ไม่บันทึกอะไร ไม่แตะฐานข้อมูล ไม่ดึงราคาจากเว็บ (ผู้ใช้กรอกเอง)
 * ใช้ฟังก์ชันของ domain/invest เท่านั้น (R9, R11, R17): ต้นทุนใหม่ = ต้นทุนเดิม + เงินซื้อ + ค่าธรรมเนียม
 * ราคาเฉลี่ยเป็นค่าแสดงผลเท่านั้น ไม่นำกลับไปคำนวณ
 */

import { applyBuy, averageCostMicro, type Position } from '../domain/invest/costBasis';
import { dcaUnits } from '../domain/invest/dca';
import { formatUnits, parsePriceMicro, parseUnits } from '../domain/invest/units';
import { formatMicro } from '../domain/money/micro';
import { safeAdd } from '../domain/money/safe';
import { parseBahtToSatang } from '../domain/money/satang';

export interface AveragingForm {
  /** จำนวนหน่วยที่ถืออยู่ (ว่าง = ยังไม่มี) */
  holdUnits: string;
  /** ต้นทุนรวมที่จ่ายมาแล้ว (บาท ว่าง = ยังไม่มี) */
  holdCost: string;
  /** เงินที่จะซื้อเพิ่ม (บาท ไม่รวมค่าธรรมเนียม) */
  buyAmount: string;
  /** ราคาต่อหน่วยที่จะซื้อ (บาท) */
  price: string;
  /** ค่าธรรมเนียม (บาท ว่าง = 0) */
  fee: string;
}

export type AveragingResult =
  | {
      ok: true;
      boughtUnits: string;
      newUnits: string;
      /** ต้นทุนรวมใหม่ (สตางค์) */
      newCost: number;
      /** เงินที่ต้องจ่ายครั้งนี้ (สตางค์) = เงินซื้อ + ค่าธรรมเนียม */
      totalPaid: number;
      /** ราคาเฉลี่ยต่อหน่วยใหม่/เดิม (บาท) ค่าแสดงผล */
      newAvgPrice: string;
      oldAvgPrice: string | null;
    }
  | { ok: false; errors: AveragingError[] };

export interface AveragingError {
  field: keyof AveragingForm;
  message: string;
  /** true = แค่ยังไม่กรอก (หน้าจอแสดงหลังผู้ใช้แตะช่องนั้นแล้วเท่านั้น) */
  missing: boolean;
}

const blank = (s: string): boolean => s.trim() === '';

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'ข้อมูลไม่ถูกต้อง';
}

function nonNegativeBaht(
  text: string,
  field: keyof AveragingForm,
  label: string,
  errors: AveragingError[],
  required: boolean,
  min: number,
): number | null {
  if (blank(text)) {
    if (required) errors.push({ field, message: `กรอก${label}`, missing: true });
    return required ? null : 0;
  }
  try {
    const v = parseBahtToSatang(text);
    if (v < min) {
      errors.push({ field, message: `${label}ต้อง${min >= 1 ? 'มากกว่า 0' : 'ไม่ติดลบ'}`, missing: false });
      return null;
    }
    return v;
  } catch {
    errors.push({ field, message: `${label}ไม่ถูกต้อง`, missing: false });
    return null;
  }
}

export function computeAveraging(form: AveragingForm): AveragingResult {
  const errors: AveragingError[] = [];

  const amount = nonNegativeBaht(form.buyAmount, 'buyAmount', 'เงินที่จะซื้อ', errors, true, 1);
  const fee = nonNegativeBaht(form.fee, 'fee', 'ค่าธรรมเนียม', errors, false, 0);
  const holdCost = nonNegativeBaht(form.holdCost, 'holdCost', 'ต้นทุนรวมที่ถืออยู่', errors, false, 0);

  let priceMicro: number | null = null;
  if (blank(form.price)) errors.push({ field: 'price', message: 'กรอกราคาต่อหน่วย', missing: true });
  else {
    try {
      priceMicro = parsePriceMicro(form.price);
    } catch (e) {
      errors.push({ field: 'price', message: messageOf(e), missing: false });
    }
  }

  let holdUnits = 0n;
  if (!blank(form.holdUnits)) {
    try {
      holdUnits = parseUnits(form.holdUnits);
    } catch (e) {
      errors.push({ field: 'holdUnits', message: messageOf(e), missing: false });
    }
  }
  const hasUnits = !blank(form.holdUnits);
  const hasCost = !blank(form.holdCost) && holdCost !== null && holdCost > 0;
  if (hasUnits && !hasCost && errors.length === 0) errors.push({ field: 'holdCost', message: 'ถือหน่วยอยู่ ต้องกรอกต้นทุนรวมที่ถืออยู่ด้วย', missing: false });
  if (!hasUnits && !blank(form.holdCost)) errors.push({ field: 'holdUnits', message: 'กรอกต้นทุนรวมแล้ว ต้องกรอกจำนวนหน่วยที่ถืออยู่ด้วย', missing: false });

  if (errors.length > 0 || amount === null || fee === null || holdCost === null || priceMicro === null) {
    return { ok: false, errors };
  }

  try {
    const start: Position = { units: holdUnits, cost: holdCost };
    const bought = dcaUnits(amount, priceMicro);
    const next = applyBuy(start, { units: bought, amount, fee });
    const oldAvg = averageCostMicro(start);
    const newAvg = averageCostMicro(next);
    return {
      ok: true,
      boughtUnits: formatUnits(bought),
      newUnits: formatUnits(next.units),
      newCost: next.cost,
      totalPaid: safeAdd(amount, fee),
      newAvgPrice: newAvg === null ? '—' : formatMicro(newAvg),
      oldAvgPrice: oldAvg === null ? null : formatMicro(oldAvg),
    };
  } catch (e) {
    return { ok: false, errors: [{ field: 'buyAmount', message: messageOf(e), missing: false }] };
  }
}
