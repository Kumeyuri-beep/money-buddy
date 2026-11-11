/**
 * ฟอร์มเครื่องคิดเลขเกษียณ → RetirementInput (เฟส 1) · ฟังก์ชันล้วน
 * ข้อความจากผู้ใช้แปลงเป็นจำนวนเต็มด้วยตัวแปลงจำนวนเต็มที่ขอบ UI (R2): เงิน = parseBahtToSatang, อัตรา = ข้อความ "3", "3.5", "3.55" → bps ไม่ใช้ parseFloat
 * ข้อผิดพลาดคืนเป็นรายช่อง (ไม่โยน) เพื่อให้หน้าจอชี้ช่องที่ผิดได้
 */

import { computeRetirement, retirementProblems, type ProblemField, type RetirementInput, type RetirementResult } from '../domain/retirement/projection';
import { parseBahtToSatang } from '../domain/money/satang';

export interface RetirementForm {
  currentAge: string;
  retireAge: string;
  lifeExpectancy: string;
  /** บาท/เดือน (มูลค่าวันนี้) */
  monthlyExpense: string;
  /** % ต่อปี */
  inflation: string;
  returnBefore: string;
  returnAfter: string;
  /** บาท (ไม่บังคับ) */
  currentSavings: string;
}

export type RetirementFormField = keyof RetirementForm;

export interface RetirementFormError {
  field: RetirementFormField;
  message: string;
}

export type RetirementFormResult = { ok: true; input: RetirementInput; result: RetirementResult } | { ok: false; errors: RetirementFormError[] };

export const DEFAULT_RETIRE_AGE = '60';
export const DEFAULT_INFLATION = '3';

export const emptyRetirementForm = (): RetirementForm => ({
  currentAge: '',
  retireAge: DEFAULT_RETIRE_AGE,
  lifeExpectancy: '',
  monthlyExpense: '',
  inflation: DEFAULT_INFLATION,
  returnBefore: '',
  returnAfter: '',
  currentSavings: '',
});

const FIELD_OF: Record<ProblemField, RetirementFormField> = {
  currentAge: 'currentAge',
  retireAge: 'retireAge',
  lifeExpectancy: 'lifeExpectancy',
  monthlyExpense: 'monthlyExpense',
  inflationBps: 'inflation',
  returnBeforeBps: 'returnBefore',
  returnAfterBps: 'returnAfter',
  currentSavings: 'currentSavings',
};

const INT = /^\d{1,3}$/;
const PERCENT = /^(\d{1,3})(?:\.(\d{1,2}))?$/;

/** "3" → 300, "3.5" → 350, "3.55" → 355 · ไม่รับติดลบ/เครื่องหมาย %/มากกว่า 2 ตำแหน่ง */
export function parsePercentToBps(text: string): number | null {
  const m = PERCENT.exec(text.trim().replace(/\s*%$/, ''));
  if (!m) return null;
  const frac = (m[2] ?? '').padEnd(2, '0');
  return Number(m[1]) * 100 + Number(frac);
}

export function buildRetirementInput(form: RetirementForm): RetirementFormResult {
  const errors: RetirementFormError[] = [];
  const err = (field: RetirementFormField, message: string): void => void errors.push({ field, message });
  const blank = (s: string): boolean => s.trim() === '';

  const age = (field: RetirementFormField, label: string): number => {
    const text = form[field].trim();
    if (blank(text)) {
      err(field, `กรอก${label}`);
      return Number.NaN;
    }
    if (!INT.test(text)) {
      err(field, `${label}ต้องเป็นจำนวนเต็ม (ปี)`);
      return Number.NaN;
    }
    return Number(text);
  };
  const rate = (field: RetirementFormField, label: string): number => {
    const text = form[field];
    if (blank(text)) {
      err(field, `กรอก${label} (% ต่อปี)`);
      return Number.NaN;
    }
    const bps = parsePercentToBps(text);
    if (bps === null) {
      err(field, `${label}ไม่ถูกต้อง (ตัวเลข % ทศนิยมไม่เกิน 2 ตำแหน่ง เช่น 3 หรือ 4.5)`);
      return Number.NaN;
    }
    return bps;
  };
  const money = (field: RetirementFormField, label: string, required: boolean): number | undefined => {
    const text = form[field];
    if (blank(text)) {
      if (required) err(field, `กรอก${label}`);
      return required ? Number.NaN : undefined;
    }
    try {
      const v = parseBahtToSatang(text.replace(/฿/g, ''));
      if (/^\s*[+-]/.test(text)) {
        err(field, `${label}ต้องไม่ติดลบ`);
        return Number.NaN;
      }
      return v;
    } catch {
      err(field, `${label}ไม่ถูกต้อง`);
      return Number.NaN;
    }
  };

  const currentAge = age('currentAge', 'อายุตอนนี้');
  const retireAge = age('retireAge', 'อายุเกษียณ');
  const lifeExpectancy = age('lifeExpectancy', 'อายุคาดการณ์');
  const monthlyExpense = money('monthlyExpense', 'ค่าใช้จ่ายต่อเดือน', true) as number;
  const inflationBps = rate('inflation', 'เงินเฟ้อ');
  const returnBeforeBps = rate('returnBefore', 'ผลตอบแทนก่อนเกษียณ');
  const returnAfterBps = rate('returnAfter', 'ผลตอบแทนหลังเกษียณ');
  const currentSavings = money('currentSavings', 'เงินออมปัจจุบัน', false);

  if (errors.length > 0) return { ok: false, errors };

  const input: RetirementInput = { currentAge, retireAge, lifeExpectancy, monthlyExpense, inflationBps, returnBeforeBps, returnAfterBps };
  if (currentSavings !== undefined) input.currentSavings = currentSavings;
  const problems = retirementProblems(input);
  if (problems.length > 0) return { ok: false, errors: problems.map((p) => ({ field: FIELD_OF[p.field], message: p.message })) };
  try {
    return { ok: true, input, result: computeRetirement(input) };
  } catch (e) {
    // ตัวเลขใหญ่เกินกว่าจะแสดงได้ (เช่นค่าใช้จ่ายสูงมาก × หลายสิบปี) ไม่ทำให้หน้าล้ม
    return { ok: false, errors: [{ field: 'monthlyExpense', message: e instanceof Error ? e.message : 'คำนวณไม่ได้' }] };
  }
}
