/**
 * ฟอร์มเครื่องคิดภาษีเงินเดือน (เฟส 1 · กฎ R19) → SalaryTaxInput · ฟังก์ชันล้วน ไม่แตะ React/ฐานข้อมูล/ledger
 * ข้อความจากผู้ใช้แปลงเป็นสตางค์ด้วยตัวแปลงกลาง `parseBahtToSatang` ที่ขอบ UI (R2) ข้อผิดพลาดคืนเป็นรายช่อง (ไม่โยน)
 */

import { parseBahtToSatang } from '../domain/money/satang';
import { formatAbsWholeBaht, wholeBaht } from '../domain/tax/display';
import { TAX_CONFIG_2569, type Confidence } from '../domain/tax/config';
import { computeSalaryTax, type BalanceKind, type DeductionKey, type SalaryTaxInput, type SalaryTaxResult } from '../domain/tax/salaryTax';

export interface TaxForm {
  /** ติ๊ก = มีเงินได้อื่นนอกจากเงินเดือน (เฟสแรกยังไม่รองรับ) */
  hasOtherIncome: boolean;
  annualSalary: string;
  withheldTax: string;
  socialSecurityPaid: string;
  rmfPaid: string;
  pensionInsurancePaid: string;
  thaiEsgPaid: string;
}

export type TaxFormTextField = Exclude<keyof TaxForm, 'hasOtherIncome'>;

export interface TaxFormError {
  field: TaxFormTextField | 'general';
  message: string;
}

export type TaxFormResult =
  | { ok: true; input: SalaryTaxInput; result: SalaryTaxResult }
  | { ok: false; unsupported: true }
  | { ok: false; unsupported?: false; errors: TaxFormError[] };

/** ข้อความเตือนบังคับ (กฎ R19) ต้องแสดงติดผลลัพธ์ทุกจุด */
export const TAX_DISCLAIMER = 'ตัวเลขนี้เป็นการประมาณการเท่านั้น ไม่ใช่คำแนะนำทางภาษี ไม่ใช่การรับประกันผล และอาจต่างจากที่กรมสรรพากรคำนวณ โปรดตรวจกับ e-Filing หรือกรมสรรพากรก่อนยื่นแบบ';

/** ข้อจำกัดที่ต้องบอกผู้ใช้ (R19) */
export const TAX_LIMITATIONS = 'รองรับเฉพาะเงินได้จากเงินเดือน (มาตรา 40(1)) ไม่รวมเงินได้อื่น ไม่ตรวจเงื่อนไขการถือครอง RMF/Thai ESG ไม่รวมค่าลดหย่อนอื่น (เช่น บุตร คู่สมรส บิดามารดา ประกันชีวิต/สุขภาพ ดอกเบี้ยบ้าน บริจาค กองทุนสำรองเลี้ยงชีพ) ไม่รวม SSF';

export const TAX_UNSUPPORTED_NOTE = 'เครื่องคิดนี้ยังไม่รองรับกรณีที่มีเงินได้อื่นนอกจากเงินเดือน จึงไม่แสดงตัวเลข เพื่อไม่ให้ได้ตัวเลขที่คลาดเคลื่อน โปรดใช้ e-Filing ของกรมสรรพากรหรือปรึกษาผู้เชี่ยวชาญ';

export const TAX_DISPLAY_NOTE = 'ตัวเลขแสดงเป็นบาทเต็ม (ปัดครึ่งขึ้น) เป็นการประมาณ แต่ละค่าปัดแยกกัน ผลลบกันเองอาจต่างจากที่แสดง 1 บาท';

export const TAX_PARTIAL_BADGE = 'ตามเอกสารกรมสรรพากร ม.ค. 2568 ไม่ระบุปีภาษี';
export const TAX_UNVERIFIED_BADGE = 'ยังไม่ยืนยัน';

export const DEDUCTION_LABELS: Record<DeductionKey, string> = {
  personal: 'ลดหย่อนส่วนตัว',
  socialSecurity: 'เงินสมทบประกันสังคม',
  rmf: 'กองทุน RMF',
  pensionInsurance: 'เบี้ยประกันชีวิตแบบบำนาญ',
  thaiEsg: 'กองทุน Thai ESG (รวม Thai ESGX)',
};

export function confidenceBadge(level: Confidence): string | null {
  if (level === 'unverified') return TAX_UNVERIFIED_BADGE;
  if (level === 'partial') return TAX_PARTIAL_BADGE;
  return null;
}

export const emptyTaxForm = (): TaxForm => ({
  hasOtherIncome: false,
  annualSalary: '',
  withheldTax: '',
  socialSecurityPaid: '',
  rmfPaid: '',
  pensionInsurancePaid: '',
  thaiEsgPaid: '',
});

const LABEL: Record<TaxFormTextField, string> = {
  annualSalary: 'เงินได้จากเงินเดือนทั้งปี',
  withheldTax: 'ภาษีที่ถูกหักไปแล้วทั้งปี',
  socialSecurityPaid: 'เงินสมทบประกันสังคมที่จ่ายทั้งปี',
  rmfPaid: 'เงินที่ซื้อ RMF ในปี',
  pensionInsurancePaid: 'เบี้ยประกันชีวิตแบบบำนาญที่จ่ายในปี',
  thaiEsgPaid: 'เงินที่ซื้อ Thai ESG/ThaiESGX ในปี',
};
const REQUIRED: Record<TaxFormTextField, boolean> = {
  annualSalary: true,
  withheldTax: false,
  socialSecurityPaid: false,
  rmfPaid: false,
  pensionInsurancePaid: false,
  thaiEsgPaid: false,
};

export function buildTaxInput(form: TaxForm): TaxFormResult {
  if (form.hasOtherIncome) return { ok: false, unsupported: true };
  const errors: TaxFormError[] = [];
  const values = {} as Record<TaxFormTextField, number>;

  for (const field of Object.keys(LABEL) as TaxFormTextField[]) {
    const text = form[field];
    const label = LABEL[field];
    if (text.trim() === '') {
      if (REQUIRED[field]) errors.push({ field, message: `กรอก${label}` });
      values[field] = 0;
      continue;
    }
    if (/^\s*[+-]/.test(text.replace(/฿/g, ''))) {
      errors.push({ field, message: `${label}ไม่ต้องใส่เครื่องหมาย + หรือ - (ต้องไม่ติดลบ)` });
      continue;
    }
    try {
      values[field] = parseBahtToSatang(text.replace(/฿/g, ''));
    } catch (e) {
      errors.push({ field, message: e instanceof RangeError ? `${label}ใหญ่เกินไป` : `${label}ไม่ถูกต้อง` });
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const input: SalaryTaxInput = { ...values };
  try {
    return { ok: true, input, result: computeSalaryTax(input, TAX_CONFIG_2569) };
  } catch (e) {
    // RangeError ภาษาไทยจากโดเมน (เกิน 100 ล้านบาท ฯลฯ) แสดงตามที่โดเมนบอก
    return { ok: false, errors: [{ field: 'general', message: e instanceof Error ? e.message : 'คำนวณไม่ได้' }] };
  }
}

/**
 * ข้อความผลต่างกับภาษีที่ถูกหัก (ไม่ใช้เครื่องหมายบวก/ลบ ตามกฎ R19)
 * ถ้าผลต่างจริงไม่เป็นศูนย์แต่ปัดเป็นบาทเต็มแล้วเป็น 0 บอกว่า "ต่างกันไม่ถึง ฿1" แทนการขึ้น "ชำระเพิ่ม ฿0"
 */
export function balanceSummary(kind: BalanceKind, balanceSatang: number): string {
  if (kind === 'even') return 'ภาษีที่ถูกหักไปแล้วเท่ากับภาษีที่ประมาณได้';
  const abs = formatAbsWholeBaht(balanceSatang);
  if (wholeBaht(Math.abs(balanceSatang)) === 0n) return 'ภาษีที่ถูกหักไปแล้วใกล้เคียงกับภาษีที่ประมาณได้ (ต่างกันไม่ถึง ฿1)';
  return kind === 'payMore' ? `ประมาณว่าต้องชำระเพิ่ม ${abs} (ประมาณการ)` : `ประมาณว่าอาจขอคืนได้ ${abs} (ประมาณการ)`;
}
