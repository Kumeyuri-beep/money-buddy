/**
 * เครื่องคิดภาษีเงินได้บุคคลธรรมดา "เงินเดือนล้วน" (กฎ R19 · เฟส 1) ประมาณการเท่านั้น
 * ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล/ledger · ไม่สร้าง Entry · ไม่เก็บผล
 * เงินเป็นสตางค์ (จำนวนเต็ม) อัตราเป็น bps คำนวณด้วย bigint ปัดครึ่งขึ้นด้วยตัวปัดกลาง (R8) · ตัวเลขกฎหมายมาจาก config เท่านั้น (R13)
 */

import { roundHalfUpBig } from '../money/round';
import { MAX_TAX_INPUT_SATANG, TAX_CONFIG_2569, type Confidence, type TaxYearConfig } from './config';

const BPS = 10_000n;

export interface SalaryTaxInput {
  /** เงินเดือน/โบนัส รวมทั้งปี (เงินได้พึงประเมินมาตรา 40(1)) สตางค์ */
  annualSalary: number;
  /** ภาษีที่ถูกหัก ณ ที่จ่ายแล้วทั้งปี สตางค์ */
  withheldTax: number;
  socialSecurityPaid: number;
  rmfPaid: number;
  pensionInsurancePaid: number;
  thaiEsgPaid: number;
}

export type DeductionKey = 'personal' | 'socialSecurity' | 'rmf' | 'pensionInsurance' | 'thaiEsg';

/** ลำดับแสดงผลและลำดับหักเพดานกลุ่ม (คงที่ ตามกฎ R19) */
export const DEDUCTION_ORDER: readonly DeductionKey[] = ['personal', 'socialSecurity', 'rmf', 'pensionInsurance', 'thaiEsg'];

export interface DeductionLine {
  key: DeductionKey;
  /** ที่ผู้ใช้ขอ (ลดหย่อนส่วนตัว = ค่าคงที่) */
  requested: number;
  /** ที่ใช้ได้จริงหลังเพดาน */
  allowed: number;
  /** ขอเกินเพดานจนถูกลด ("ขอ X ใช้ได้ Y") */
  clamped: boolean;
  /** "สิทธิที่ยังใช้ได้" เพิ่มได้อีกเท่าไรภายใต้เพดาน (null = ไม่มีเพดานให้เพิ่ม เช่น ลดหย่อนส่วนตัว) */
  remaining: number | null;
  confidence: Confidence;
}

export interface BracketRow {
  fromSatang: number;
  upToSatang: number | null;
  rateBps: number;
  /** ส่วนของเงินได้สุทธิที่ตกอยู่ในขั้นนี้ */
  amountInBracket: number;
}

export type BalanceKind = 'payMore' | 'refund' | 'even';

export interface SalaryTaxResult {
  year: number;
  income: number;
  expense: number;
  deductions: DeductionLine[];
  totalAllowances: number;
  /** เงินได้สุทธิ (ไม่ติดลบ) */
  netIncome: number;
  brackets: BracketRow[];
  /** ภาษีที่คำนวณได้ (ประมาณการ) */
  tax: number;
  withheld: number;
  /** tax − withheld: บวก = ชำระเพิ่ม · ลบ = ขอคืน · 0 = เท่ากัน */
  balance: number;
  balanceKind: BalanceKind;
}

const FIELD_LABEL: Record<keyof SalaryTaxInput, string> = {
  annualSalary: 'เงินได้ทั้งปี',
  withheldTax: 'ภาษีที่ถูกหักแล้ว',
  socialSecurityPaid: 'เงินสมทบประกันสังคม',
  rmfPaid: 'เงินซื้อ RMF',
  pensionInsurancePaid: 'เบี้ยประกันชีวิตแบบบำนาญ',
  thaiEsgPaid: 'เงินซื้อ Thai ESG',
};

/** ข้อมูลเข้าไม่ถูกต้อง = RangeError ข้อความไทย (R19: ห้ามปัดหรือตัดค่าเงียบๆ) */
export function assertSalaryTaxInput(input: SalaryTaxInput): void {
  for (const key of Object.keys(FIELD_LABEL) as (keyof SalaryTaxInput)[]) {
    const v = input[key];
    const label = FIELD_LABEL[key];
    if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw new RangeError(`${label}ต้องเป็นจำนวนสตางค์ที่เป็นจำนวนเต็ม`);
    if (Object.is(v, -0)) throw new RangeError(`${label}ต้องไม่เป็นค่าลบศูนย์`);
    if (v < 0) throw new RangeError(`${label}ต้องไม่ติดลบ`);
    if (v > MAX_TAX_INPUT_SATANG) throw new RangeError(`${label}ต้องไม่เกิน 100 ล้านบาท`);
  }
}

const minBig = (a: bigint, b: bigint): bigint => (a < b ? a : b);
const maxBig = (a: bigint, b: bigint): bigint => (a > b ? a : b);
const percentOf = (income: bigint, rateBps: number): bigint => roundHalfUpBig(income * BigInt(rateBps), BPS);

/** เพดานรายตัว = min(ร้อยละของเงินได้ (ปัดครึ่งขึ้น), เพดานเงินบาทถ้ามี) */
function itemCap(income: bigint, rateBps: number, capSatang: number | null): bigint {
  const byRate = percentOf(income, rateBps);
  return capSatang === null ? byRate : minBig(byRate, BigInt(capSatang));
}

export function computeSalaryTax(input: SalaryTaxInput, config: TaxYearConfig = TAX_CONFIG_2569): SalaryTaxResult {
  assertSalaryTaxInput(input);
  const income = BigInt(input.annualSalary);

  // ค่าใช้จ่ายเหมา 50% ไม่เกิน 100,000 บาท (เงินได้ประเภท 1 รวมครั้งเดียว)
  const expenseByRate = percentOf(income, config.employmentExpense.rateBps);
  const expense = config.employmentExpense.capSatang === null ? expenseByRate : minBig(expenseByRate, BigInt(config.employmentExpense.capSatang));

  // ค่าลดหย่อน: เพดานรายตัวก่อน แล้วเพดานกลุ่มเกษียณ (RMF ก่อน ประกันบำนาญตามลำดับคงที่) · ThaiESG อยู่นอกกลุ่ม
  const groupCap = BigInt(config.retirementGroup.capSatang);
  const ssCap = BigInt(config.socialSecurity.capSatang);
  const rmfCap = itemCap(income, config.rmf.rateBps, config.rmf.capSatang);
  const pensionCap = itemCap(income, config.pensionInsurance.rateBps, config.pensionInsurance.capSatang);
  const esgCap = itemCap(income, config.thaiEsg.rateBps, config.thaiEsg.capSatang);

  const personal = BigInt(config.personalAllowance.satang);
  const ss = minBig(BigInt(input.socialSecurityPaid), ssCap);
  const rmf = minBig(minBig(BigInt(input.rmfPaid), rmfCap), groupCap);
  const pension = minBig(minBig(BigInt(input.pensionInsurancePaid), pensionCap), groupCap - rmf);
  const esg = minBig(BigInt(input.thaiEsgPaid), esgCap);

  const groupLeft = groupCap - rmf - pension;
  const remainingOf = (cap: bigint, used: bigint, inGroup: boolean): bigint => {
    const room = maxBig(cap - used, 0n);
    return inGroup ? minBig(room, groupLeft) : room;
  };

  const lines: DeductionLine[] = [
    { key: 'personal', requested: Number(personal), allowed: Number(personal), clamped: false, remaining: null, confidence: config.personalAllowance.confidence },
    {
      key: 'socialSecurity',
      requested: input.socialSecurityPaid,
      allowed: Number(ss),
      clamped: BigInt(input.socialSecurityPaid) > ss,
      remaining: Number(remainingOf(ssCap, ss, false)),
      confidence: config.socialSecurity.confidence,
    },
    {
      key: 'rmf',
      requested: input.rmfPaid,
      allowed: Number(rmf),
      clamped: BigInt(input.rmfPaid) > rmf,
      remaining: Number(remainingOf(rmfCap, rmf, true)),
      confidence: config.rmf.confidence,
    },
    {
      key: 'pensionInsurance',
      requested: input.pensionInsurancePaid,
      allowed: Number(pension),
      clamped: BigInt(input.pensionInsurancePaid) > pension,
      remaining: Number(remainingOf(pensionCap, pension, true)),
      confidence: config.pensionInsurance.confidence,
    },
    {
      key: 'thaiEsg',
      requested: input.thaiEsgPaid,
      allowed: Number(esg),
      clamped: BigInt(input.thaiEsgPaid) > esg,
      remaining: Number(remainingOf(esgCap, esg, false)),
      confidence: config.thaiEsg.confidence,
    },
  ];

  const totalAllowances = personal + ss + rmf + pension + esg;
  const afterExpense = income - expense;
  const net = maxBig(afterExpense - totalAllowances, 0n);

  // ขั้นบันได: รวมตัวเศษ (ส่วนของเงิน × bps) ทุกขั้นก่อน แล้วปัดครั้งเดียว (R19)
  let numerator = 0n;
  let lower = 0n;
  const rows: BracketRow[] = [];
  for (const b of config.brackets) {
    const upper = b.upToSatang === null ? null : BigInt(b.upToSatang);
    const top = upper === null ? net : minBig(net, upper);
    const slice = maxBig(top - lower, 0n);
    numerator += slice * BigInt(b.rateBps);
    rows.push({ fromSatang: Number(lower), upToSatang: b.upToSatang, rateBps: b.rateBps, amountInBracket: Number(slice) });
    if (upper !== null) lower = upper;
  }
  const tax = roundHalfUpBig(numerator, BPS);
  const withheld = BigInt(input.withheldTax);
  const balance = tax - withheld;

  const result: SalaryTaxResult = {
    year: config.year,
    income: Number(income),
    expense: Number(expense),
    deductions: lines,
    totalAllowances: Number(totalAllowances),
    netIncome: Number(net),
    brackets: rows,
    tax: Number(tax),
    withheld: Number(withheld),
    balance: Number(balance),
    balanceKind: balance > 0n ? 'payMore' : balance < 0n ? 'refund' : 'even',
  };
  for (const n of [result.tax, result.balance, result.netIncome, result.totalAllowances]) {
    if (!Number.isSafeInteger(n)) throw new RangeError('ผลลัพธ์ใหญ่เกินกว่าจะคำนวณได้');
  }
  return result;
}
