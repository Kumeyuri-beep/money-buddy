/**
 * ฟอร์มเครื่องคิดภาษีเงินเดือน (เฟส 1-2 · กฎ R19) → SalaryTaxInput · ฟังก์ชันล้วน ไม่แตะ React/ฐานข้อมูล/ledger
 * ข้อความจากผู้ใช้แปลงเป็นสตางค์ด้วยตัวแปลงกลาง `parseBahtToSatang` ที่ขอบ UI (R2) ข้อผิดพลาดคืนเป็นรายช่อง (ไม่โยน)
 */

import { parseBahtToSatang } from '../domain/money/satang';
import { formatAbsWholeBaht, wholeBaht } from '../domain/tax/display';
import { TAX_CONFIG_2569, type Confidence } from '../domain/tax/config';
import { computeSalaryTax, type BalanceKind, type DeductionKey, type SalaryTaxInput, type SalaryTaxResult } from '../domain/tax/salaryTax';

export interface TaxForm {
  /** ติ๊ก = มีเงินได้อื่นนอกจากเงินเดือน (ยังไม่รองรับ) */
  hasOtherIncome: boolean;
  /** ติ๊ก = คู่สมรสไม่มีเงินได้ */
  spouseNoIncome: boolean;
  annualSalary: string;
  withheldTax: string;
  socialSecurityPaid: string;
  rmfPaid: string;
  pensionInsurancePaid: string;
  thaiEsgPaid: string;
  /** จำนวนคน (ข้อความ จำนวนเต็ม) */
  childrenCount: string;
  extraChildrenCount: string;
  parentsCount: string;
  lifeInsurancePaid: string;
  healthInsurancePaid: string;
  parentsHealthPaid: string;
  mortgageInterestPaid: string;
  donationPaid: string;
  /** ว่าง = ใช้เท่ากับจำนวนบุตรที่ลดหย่อน */
  livingChildrenCount: string;
  adoptedChildrenCount: string;
  disabledRelativesCount: string;
  disabledOtherCount: string;
  /** ค่าฝากครรภ์และคลอดบุตร แยกรายครรภ์ (สูงสุด 2 ครรภ์) */
  prenatalPaid1: string;
  prenatalPaid2: string;
  spouseLifeInsurancePaid: string;
}

export type TaxFormTextField = Exclude<keyof TaxForm, 'hasOtherIncome' | 'spouseNoIncome'>;

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
export const TAX_LIMITATIONS =
  'รองรับเฉพาะเงินได้จากเงินเดือน (มาตรา 40(1)) ไม่รวมเงินได้อื่น · ไม่ตรวจเงื่อนไขของสิทธิ (เช่น การถือครอง RMF/Thai ESG อายุและรายได้ของบิดามารดา) ผู้ใช้ต้องเป็นผู้ตรวจเอง · ยังไม่รวมค่าลดหย่อนอื่น (กองทุนสำรองเลี้ยงชีพ บริจาคพรรคการเมือง วิสาหกิจเพื่อสังคม กอช.) · แอปไม่ตรวจว่าคนเดียวกันถูกนับซ้ำหรือไม่ (เช่น คู่สมรสที่พิการได้ทั้งลดหย่อนคู่สมรสและคนพิการ ซึ่งกฎหมายแยกเป็นคนละรายการ) · ไม่ตรวจเอกสารประกอบสิทธิ เช่น บัตรคนพิการ เอกสารจากแพทย์ ใบเสร็จฝากครรภ์ เอกสารแสดงการเป็นผู้อุปการะ · ไม่รวม SSF และการบริจาคแบบ e-Donation 2 เท่า';

export const TAX_UNSUPPORTED_NOTE = 'เครื่องคิดนี้ยังไม่รองรับกรณีที่มีเงินได้อื่นนอกจากเงินเดือน จึงไม่แสดงตัวเลข เพื่อไม่ให้ได้ตัวเลขที่คลาดเคลื่อน โปรดใช้ e-Filing ของกรมสรรพากรหรือปรึกษาผู้เชี่ยวชาญ';

export const TAX_DISPLAY_NOTE = 'ตัวเลขแสดงเป็นบาทเต็ม (ปัดครึ่งขึ้น) เป็นการประมาณ แต่ละค่าปัดแยกกัน ผลลบกันเองอาจต่างจากที่แสดง 1 บาท';

export const TAX_PARTIAL_BADGE = 'อ้างอิง ม.ค. 2568';
/** คำอธิบายป้ายสั้นด้านบน แสดงครั้งเดียวใต้ตาราง */
export const TAX_PARTIAL_NOTE = 'ป้าย "อ้างอิง ม.ค. 2568" = ตัวเลขจากเอกสารกรมสรรพากรฉบับ ม.ค. 2568 ซึ่งไม่ระบุปีภาษี ยังไม่พบประกาศแก้ไขสำหรับปี 2569 · ป้าย "ยังไม่ยืนยัน" = ยังไม่มีแหล่งทางการที่อ่านได้';
export const TAX_UNVERIFIED_BADGE = 'ยังไม่ยืนยัน';

export const DEDUCTION_LABELS: Record<DeductionKey, string> = {
  personal: 'ลดหย่อนส่วนตัว',
  spouse: 'คู่สมรสไม่มีเงินได้',
  children: 'บุตรชอบด้วยกฎหมาย',
  adoptedChildren: 'บุตรบุญธรรม',
  parents: 'บิดามารดา',
  disabled: 'คนพิการหรือทุพพลภาพที่เลี้ยงดู',
  prenatal: 'ค่าฝากครรภ์และคลอดบุตร',
  socialSecurity: 'เงินสมทบประกันสังคม',
  lifeInsurance: 'เบี้ยประกันชีวิต',
  healthInsurance: 'เบี้ยประกันสุขภาพ',
  spouseLifeInsurance: 'เบี้ยประกันชีวิตคู่สมรส (ไม่มีเงินได้)',
  parentsHealth: 'เบี้ยประกันสุขภาพบิดามารดา',
  mortgageInterest: 'ดอกเบี้ยเงินกู้ที่อยู่อาศัย',
  rmf: 'กองทุน RMF',
  pensionInsurance: 'เบี้ยประกันชีวิตแบบบำนาญ',
  thaiEsg: 'กองทุน Thai ESG (รวม Thai ESGX)',
  donation: 'เงินบริจาคทั่วไป',
};

export function confidenceBadge(level: Confidence): string | null {
  if (level === 'unverified') return TAX_UNVERIFIED_BADGE;
  if (level === 'partial') return TAX_PARTIAL_BADGE;
  return null;
}

export const emptyTaxForm = (): TaxForm => ({
  hasOtherIncome: false,
  spouseNoIncome: false,
  annualSalary: '',
  withheldTax: '',
  socialSecurityPaid: '',
  rmfPaid: '',
  pensionInsurancePaid: '',
  thaiEsgPaid: '',
  childrenCount: '',
  extraChildrenCount: '',
  parentsCount: '',
  lifeInsurancePaid: '',
  healthInsurancePaid: '',
  parentsHealthPaid: '',
  mortgageInterestPaid: '',
  donationPaid: '',
  livingChildrenCount: '',
  adoptedChildrenCount: '',
  disabledRelativesCount: '',
  disabledOtherCount: '',
  prenatalPaid1: '',
  prenatalPaid2: '',
  spouseLifeInsurancePaid: '',
});

const MONEY_LABEL = {
  annualSalary: 'เงินได้จากเงินเดือนทั้งปี',
  withheldTax: 'ภาษีที่ถูกหักไปแล้วทั้งปี',
  socialSecurityPaid: 'เงินสมทบประกันสังคมที่จ่ายทั้งปี',
  rmfPaid: 'เงินที่ซื้อ RMF ในปี',
  pensionInsurancePaid: 'เบี้ยประกันชีวิตแบบบำนาญที่จ่ายในปี',
  thaiEsgPaid: 'เงินที่ซื้อ Thai ESG/ThaiESGX ในปี',
  lifeInsurancePaid: 'เบี้ยประกันชีวิตที่จ่ายในปี',
  healthInsurancePaid: 'เบี้ยประกันสุขภาพที่จ่ายในปี',
  parentsHealthPaid: 'เบี้ยประกันสุขภาพบิดามารดาที่จ่ายในปี',
  mortgageInterestPaid: 'ดอกเบี้ยเงินกู้ที่อยู่อาศัยที่จ่ายในปี',
  donationPaid: 'เงินบริจาคที่จ่ายในปี',
  prenatalPaid1: 'ค่าฝากครรภ์และคลอดบุตร ครรภ์ที่ 1',
  prenatalPaid2: 'ค่าฝากครรภ์และคลอดบุตร ครรภ์ที่ 2',
  spouseLifeInsurancePaid: 'เบี้ยประกันชีวิตคู่สมรสที่จ่ายในปี',
} as const;
type MoneyField = keyof typeof MONEY_LABEL;
const MONEY_FIELDS = Object.keys(MONEY_LABEL) as MoneyField[];

const COUNT_LABEL = {
  childrenCount: 'จำนวนบุตร',
  extraChildrenCount: 'จำนวนบุตรที่ได้ลดหย่อนเพิ่ม',
  parentsCount: 'จำนวนบิดามารดา',
  livingChildrenCount: 'จำนวนบุตรที่มีชีวิตทั้งหมด',
  adoptedChildrenCount: 'จำนวนบุตรบุญธรรม',
  disabledRelativesCount: 'จำนวนคนพิการ/ทุพพลภาพที่เป็นญาติ',
  disabledOtherCount: 'จำนวนคนพิการ/ทุพพลภาพที่เป็นบุคคลอื่น',
} as const;
type CountField = keyof typeof COUNT_LABEL;
const COUNT_FIELDS = Object.keys(COUNT_LABEL) as CountField[];
const COUNT_PATTERN = /^\d{1,2}$/;

/** ลำดับช่องบนหน้าจอ (ใช้เรียงข้อผิดพลาดเพื่อโฟกัสช่องแรกที่เห็น) */
export const TAX_FIELD_SCREEN_ORDER: readonly TaxFormTextField[] = [
  'annualSalary',
  'withheldTax',
  'spouseLifeInsurancePaid',
  'childrenCount',
  'extraChildrenCount',
  'livingChildrenCount',
  'adoptedChildrenCount',
  'prenatalPaid1',
  'prenatalPaid2',
  'parentsCount',
  'parentsHealthPaid',
  'disabledRelativesCount',
  'disabledOtherCount',
  'socialSecurityPaid',
  'lifeInsurancePaid',
  'healthInsurancePaid',
  'mortgageInterestPaid',
  'donationPaid',
  'rmfPaid',
  'pensionInsurancePaid',
  'thaiEsgPaid',
];

function sortErrors(errors: TaxFormError[]): TaxFormError[] {
  const rank = (e: TaxFormError): number => (e.field === 'general' ? 999 : TAX_FIELD_SCREEN_ORDER.indexOf(e.field));
  return [...errors].sort((a, b) => rank(a) - rank(b));
}

export function buildTaxInput(form: TaxForm): TaxFormResult {
  if (form.hasOtherIncome) return { ok: false, unsupported: true };
  const cfg = TAX_CONFIG_2569;
  const errors: TaxFormError[] = [];
  const money = {} as Record<MoneyField, number>;
  const counts = {} as Record<CountField, number>;

  for (const field of MONEY_FIELDS) {
    const text = form[field];
    const label = MONEY_LABEL[field];
    if (text.trim() === '') {
      if (field === 'annualSalary') errors.push({ field, message: `กรอก${label}` });
      money[field] = 0;
      continue;
    }
    if (/^\s*[+-]/.test(text.replace(/฿/g, ''))) {
      errors.push({ field, message: `${label}ไม่ต้องใส่เครื่องหมาย + หรือ - (ต้องไม่ติดลบ)` });
      continue;
    }
    try {
      money[field] = parseBahtToSatang(text.replace(/฿/g, ''));
    } catch (e) {
      errors.push({ field, message: e instanceof RangeError ? `${label}ใหญ่เกินไป` : `${label}ไม่ถูกต้อง` });
    }
  }

  for (const field of COUNT_FIELDS) {
    const text = form[field].trim();
    const label = COUNT_LABEL[field];
    if (text === '') {
      counts[field] = 0;
      continue;
    }
    if (!COUNT_PATTERN.test(text)) {
      errors.push({ field, message: `${label}ต้องเป็นจำนวนเต็ม 0 ขึ้นไป (ไม่ต้องใส่จุดหรือเครื่องหมาย)` });
      continue;
    }
    counts[field] = Number(text);
  }
  // ตรวจความสัมพันธ์ของจำนวนที่นี่ (รายช่อง) ก่อนถึงโดเมน
  if (!errors.some((e) => e.field === 'childrenCount') && counts.childrenCount > cfg.child.maxCount) {
    errors.push({ field: 'childrenCount', message: `${COUNT_LABEL.childrenCount}ต้องไม่เกิน ${cfg.child.maxCount} คน` });
  }
  if (!errors.some((e) => e.field === 'parentsCount') && counts.parentsCount > cfg.parent.maxCount) {
    errors.push({ field: 'parentsCount', message: `${COUNT_LABEL.parentsCount}ต้องไม่เกิน ${cfg.parent.maxCount} คน (รวมของคู่สมรส)` });
  }
  const maxOf: Partial<Record<CountField, number>> = { livingChildrenCount: cfg.child.maxCount, adoptedChildrenCount: cfg.adoptedChild.maxTotalChildren, disabledRelativesCount: cfg.disability.maxRelatives, disabledOtherCount: cfg.disability.maxOthers };
  for (const field of Object.keys(maxOf) as CountField[]) {
    if (!errors.some((e) => e.field === field) && counts[field] > maxOf[field]!) {
      errors.push({ field, message: `${COUNT_LABEL[field]}ต้องไม่เกิน ${maxOf[field]} คน` });
    }
  }
  if (form.livingChildrenCount.trim() !== '' && !errors.some((e) => e.field === 'livingChildrenCount' || e.field === 'childrenCount') && counts.livingChildrenCount < counts.childrenCount) {
    errors.push({ field: 'livingChildrenCount', message: 'จำนวนบุตรที่มีชีวิตทั้งหมดต้องไม่น้อยกว่าจำนวนบุตรที่ลดหย่อน' });
  }
  if (!errors.some((e) => e.field === 'spouseLifeInsurancePaid') && money.spouseLifeInsurancePaid > 0 && !form.spouseNoIncome) {
    errors.push({ field: 'spouseLifeInsurancePaid', message: 'เบี้ยประกันชีวิตคู่สมรสใช้ได้เมื่อคู่สมรสไม่มีเงินได้ ติ๊ก "คู่สมรสไม่มีเงินได้" ก่อน' });
  }
  if (!errors.some((e) => e.field === 'extraChildrenCount' || e.field === 'childrenCount') && counts.extraChildrenCount > Math.max(counts.childrenCount - 1, 0)) {
    errors.push({ field: 'extraChildrenCount', message: `${COUNT_LABEL.extraChildrenCount}ต้องน้อยกว่าจำนวนบุตรทั้งหมดอย่างน้อย 1 คน (บุตรคนแรกไม่ได้ลดหย่อนเพิ่ม)` });
  }
  if (errors.length > 0) return { ok: false, errors: sortErrors(errors) };

  const input: SalaryTaxInput = {
    annualSalary: money.annualSalary,
    withheldTax: money.withheldTax,
    socialSecurityPaid: money.socialSecurityPaid,
    rmfPaid: money.rmfPaid,
    pensionInsurancePaid: money.pensionInsurancePaid,
    thaiEsgPaid: money.thaiEsgPaid,
    spouseNoIncome: form.spouseNoIncome,
    childrenCount: counts.childrenCount,
    extraChildrenCount: counts.extraChildrenCount,
    parentsCount: counts.parentsCount,
    lifeInsurancePaid: money.lifeInsurancePaid,
    healthInsurancePaid: money.healthInsurancePaid,
    parentsHealthPaid: money.parentsHealthPaid,
    mortgageInterestPaid: money.mortgageInterestPaid,
    donationPaid: money.donationPaid,
    ...(form.livingChildrenCount.trim() !== '' ? { livingChildrenCount: counts.livingChildrenCount } : {}),
    adoptedChildrenCount: counts.adoptedChildrenCount,
    disabledRelativesCount: counts.disabledRelativesCount,
    disabledOtherCount: counts.disabledOtherCount,
    prenatalPaid: [money.prenatalPaid1, money.prenatalPaid2],
    spouseLifeInsurancePaid: money.spouseLifeInsurancePaid,
  };
  try {
    return { ok: true, input, result: computeSalaryTax(input, cfg) };
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
