/**
 * ฟอร์มเครื่องคิดเลขเกษียณ → RetirementInput (เฟส 1) · ฟังก์ชันล้วน
 * ข้อความจากผู้ใช้แปลงเป็นจำนวนเต็มด้วยตัวแปลงจำนวนเต็มที่ขอบ UI (R2): เงิน = parseBahtToSatang, อัตรา = ข้อความ "3", "3.5", "3.55" → bps ไม่ใช้ parseFloat
 * ข้อผิดพลาดคืนเป็นรายช่อง (ไม่โยน) เพื่อให้หน้าจอชี้ช่องที่ผิดได้
 */

import { computeRetirement, retirementProblems, type ProblemField, type RetirementInput, type RetirementResult } from '../domain/retirement/projection';
import { parseRateToBps } from '../domain/money/rate';
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
  /** 'general' = ปัญหาที่ไม่ผูกกับช่องใดช่องหนึ่ง (เช่น ตัวเลขรวมใหญ่เกินกว่าจะคำนวณ) */
  field: RetirementFormField | 'general';
  message: string;
}

export type RetirementFormResult = { ok: true; input: RetirementInput; result: RetirementResult } | { ok: false; errors: RetirementFormError[] };

/** ข้อความเตือนบังคับ (กฎ R18 ข้อ 18.1) ต้องแสดงติดกับผลลัพธ์ทุกครั้ง */
export const RETIREMENT_DISCLAIMER =
  'ตัวเลขนี้เป็นประมาณการจากสมมติฐานที่คุณกรอก ไม่ใช่ยอดในบัญชีของคุณ ผลตอบแทน เงินเฟ้อ และอายุขัยจริงอาจต่างจากที่ตั้งไว้ ไม่ใช่คำแนะนำการลงทุนและไม่ใช่การรับประกันผลลัพธ์';

/** ข้อจำกัดที่ต้องบอกผู้ใช้ (R18 ข้อ 18.1) */
export const RETIREMENT_LIMITATIONS = 'การคำนวณนี้ไม่รวมภาษี ค่าธรรมเนียม บำนาญหรือประกันสังคม และความเสี่ยงที่จะอยู่ยืนกว่าที่ตั้งไว้';

/** คำเตือนการปัดแสดงผล (R18 · เจ้าของอนุมัติ 12 พ.ย. 2569) ต้องแสดงติดกับผลลัพธ์ทุกครั้ง */
export const RETIREMENT_ROUNDING_NOTE = 'ตัวเลขด้านล่างปัดเป็นหลักร้อยบาท เป็นการประมาณ (เงินที่ต้องเก็บต่อเดือนปัดขึ้นเพื่อไม่ให้เก็บขาด) จึงอาจต่างจากการคำนวณจริงเล็กน้อย';

export const RETIREMENT_REAL_RETURN_WARNING = 'ผลตอบแทนหลังเกษียณต่ำกว่าเงินเฟ้อ เงินจะหมดเร็วกว่าที่รู้สึก';
export const RETIREMENT_ON_TRACK_NOTE = 'เงินที่เก็บไว้แล้วถึงเป้าตามสมมติฐานแล้ว';

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

/**
 * savingsFromPortfolio (สตางค์): มูลค่าพอร์ตที่ผู้ใช้เลือกนับเป็นเงินเกษียณ (เฟส 2 · R18 ข้อ 18.8) ใช้แทนช่อง "เงินที่เก็บไว้แล้ว" ทั้งก้อน
 * (ไม่บวกซ้ำกับค่าที่กรอกเอง · ช่องกรอกเองถูกเมินเมื่อมีค่านี้)
 */
export function buildRetirementInput(form: RetirementForm, savingsFromPortfolio?: number): RetirementFormResult {
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
    const bps = parseRateToBps(text);
    if (bps === null) {
      err(field, `${label}ไม่ถูกต้อง (ใส่ตัวเลข % ทศนิยมไม่เกิน 2 ตำแหน่ง ไม่ต้องใส่เครื่องหมาย % เช่น 3 หรือ 4.5 · ผลตอบแทนใส่ค่าติดลบได้ เช่น -2)`);
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
        err(field, `${label}ไม่ต้องใส่เครื่องหมาย + หรือ - (ต้องไม่ติดลบ)`);
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
  const currentSavings = savingsFromPortfolio !== undefined ? savingsFromPortfolio : money('currentSavings', 'เงินออมปัจจุบัน', false);

  if (errors.length > 0) return { ok: false, errors };

  const input: RetirementInput = { currentAge, retireAge, lifeExpectancy, monthlyExpense, inflationBps, returnBeforeBps, returnAfterBps };
  if (currentSavings !== undefined) input.currentSavings = currentSavings;
  const problems = retirementProblems(input);
  if (problems.length > 0) return { ok: false, errors: problems.map((p) => ({ field: FIELD_OF[p.field], message: p.message })) };
  try {
    return { ok: true, input, result: computeRetirement(input) };
  } catch (e) {
    // ตัวเลขใหญ่เกินกว่าจะแสดงได้ (เช่นค่าใช้จ่ายสูงมาก × หลายสิบปี) ไม่ทำให้หน้าล้ม
    return { ok: false, errors: [{ field: 'general', message: e instanceof Error ? e.message : 'คำนวณไม่ได้' }] };
  }
}
