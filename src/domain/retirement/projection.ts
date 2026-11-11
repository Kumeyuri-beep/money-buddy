/**
 * เครื่องคิดเลขเป้าเกษียณ (เฟส 1) · ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล/เครือข่าย
 *
 * **ตัวเลขทั้งหมดเป็นประมาณการ ไม่ใช่ยอดในสมุดบัญชี** ห้ามลงสมุด ห้ามปนกับ SAFE-TO-SPEND / cashBalance / รายรับรายจ่าย
 * (ร่างกฎ R18 รออนุมัติเจ้าของ: docs/money-rules-R18-proposal.md · โค้ดนี้ทำตามร่างและจะปรับตามที่เจ้าของอนุมัติ)
 *
 * วิธีคิด (จำนวนเต็ม BigInt fixed-point สเกล 10^18 ไม่ใช้ float):
 *   1) ค่าใช้จ่ายต่อเดือน ณ วันเกษียณ = ค่าใช้จ่ายวันนี้ x (1 + เงินเฟ้อ)^จำนวนปีถึงเกษียณ (ทบรายปี)
 *   2) เงินที่ต้องมีตอนเกษียณ = ผลรวมมูลค่า ณ วันเกษียณของเงินถอนทุกต้นเดือนจนถึงอายุคาดการณ์
 *      เงินถอนปรับตามเงินเฟ้อปีละครั้ง · ลดค่าด้วยอัตราหลังเกษียณต่อเดือน = อัตราต่อปี / 12
 *   3) เงินออมปัจจุบันโตด้วยอัตราก่อนเกษียณต่อเดือน (อัตราต่อปี / 12) ส่วนที่ยังขาด = เงินที่ต้องมี - มูลค่าอนาคตของเงินออม
 *      เงินที่ต้องเก็บต่อเดือน (ออมสิ้นเดือน) = ส่วนที่ขาด / ตัวคูณ annuity
 *   4) ปัดเศษ: ระหว่างทางปัดครึ่งขึ้นที่สเกล 10^18 · ผลลัพธ์ที่เป็น "เงินที่ต้องมี/ต้องเก็บ" ปัดขึ้น (ceiling) เป็นสตางค์ ไม่ประเมินต่ำ
 *      ค่าอธิบาย (ค่าใช้จ่าย ณ วันเกษียณ) ปัดครึ่งขึ้น
 */

import { roundHalfUpBig } from '../money/round';

const SCALE = 10n ** 18n;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export const MAX_AGE = 120;
export const MAX_RATE_BPS = 3000; // 30%/ปี
export const MAX_INFLATION_BPS = 2000; // 20%/ปี
export const MAX_MONTHLY_EXPENSE = 100_000_000_000; // สตางค์ (1,000 ล้านบาท/เดือน)
export const MAX_SAVINGS = 10_000_000_000_000; // สตางค์

export interface RetirementInput {
  currentAge: number;
  retireAge: number;
  /** อายุคาดการณ์ที่จะอยู่ถึง */
  lifeExpectancy: number;
  /** ค่าใช้จ่ายต่อเดือนที่ต้องการ (สตางค์ มูลค่าวันนี้) */
  monthlyExpense: number;
  /** อัตราต่อปี หน่วย basis points (1% = 100) */
  inflationBps: number;
  returnBeforeBps: number;
  returnAfterBps: number;
  /** เงินออมปัจจุบันที่ใช้เป็นทุนเกษียณ (สตางค์ ไม่บังคับ) */
  currentSavings?: number;
}

export interface RetirementResult {
  yearsToRetire: number;
  retirementYears: number;
  /** ค่าใช้จ่ายต่อเดือน ณ วันเกษียณ (สตางค์ ราคาตอนนั้น) */
  monthlyExpenseAtRetirement: number;
  /** เงินที่ต้องมี ณ วันเกษียณ (สตางค์ ปัดขึ้น) */
  requiredAtRetirement: number;
  /** เงินที่ต้องมีเทียบเป็นมูลค่าวันนี้ (สตางค์ ปัดขึ้น ค่าอธิบาย) */
  requiredInTodayMoney: number;
  /** มูลค่าอนาคตของเงินออมปัจจุบัน ณ วันเกษียณ (สตางค์ ปัดลง) */
  currentSavingsAtRetirement: number;
  /** ส่วนที่ยังขาด (สตางค์ ≥ 0) */
  shortfall: number;
  /** ต้องเก็บต่อเดือน (สตางค์ ปัดขึ้น · 0 = เงินออมปัจจุบันพอแล้วตามสมมติฐาน) */
  monthlySaving: number;
}

export type ProblemField = 'currentAge' | 'retireAge' | 'lifeExpectancy' | 'monthlyExpense' | 'inflationBps' | 'returnBeforeBps' | 'returnAfterBps' | 'currentSavings';

export interface RetirementProblem {
  field: ProblemField;
  message: string;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

/** ตรวจข้อมูลเข้า (ช่วงค่าที่รับได้) · คืนรายการปัญหา ว่าง = ใช้ได้ */
export function retirementProblems(i: RetirementInput): RetirementProblem[] {
  const out: RetirementProblem[] = [];
  const add = (field: ProblemField, message: string): void => void out.push({ field, message });
  if (!isInt(i.currentAge) || i.currentAge < 0 || i.currentAge > MAX_AGE) add('currentAge', `อายุตอนนี้ต้องเป็นจำนวนเต็ม 0-${MAX_AGE}`);
  if (!isInt(i.retireAge) || i.retireAge > MAX_AGE) add('retireAge', `อายุเกษียณต้องเป็นจำนวนเต็มไม่เกิน ${MAX_AGE}`);
  else if (isInt(i.currentAge) && i.retireAge <= i.currentAge) add('retireAge', 'อายุเกษียณต้องมากกว่าอายุตอนนี้');
  if (!isInt(i.lifeExpectancy) || i.lifeExpectancy > MAX_AGE) add('lifeExpectancy', `อายุคาดการณ์ต้องเป็นจำนวนเต็มไม่เกิน ${MAX_AGE}`);
  else if (isInt(i.retireAge) && i.lifeExpectancy <= i.retireAge) add('lifeExpectancy', 'อายุคาดการณ์ต้องมากกว่าอายุเกษียณ');
  if (!isInt(i.monthlyExpense) || i.monthlyExpense < 1 || i.monthlyExpense > MAX_MONTHLY_EXPENSE) add('monthlyExpense', 'ค่าใช้จ่ายต่อเดือนต้องมากกว่า 0 และไม่เกินช่วงที่คำนวณได้');
  if (!isInt(i.inflationBps) || i.inflationBps < 0 || i.inflationBps > MAX_INFLATION_BPS) add('inflationBps', `เงินเฟ้อต้องอยู่ระหว่าง 0-${MAX_INFLATION_BPS / 100}% ต่อปี`);
  if (!isInt(i.returnBeforeBps) || i.returnBeforeBps < 0 || i.returnBeforeBps > MAX_RATE_BPS) add('returnBeforeBps', `ผลตอบแทนก่อนเกษียณต้องอยู่ระหว่าง 0-${MAX_RATE_BPS / 100}% ต่อปี`);
  if (!isInt(i.returnAfterBps) || i.returnAfterBps < 0 || i.returnAfterBps > MAX_RATE_BPS) add('returnAfterBps', `ผลตอบแทนหลังเกษียณต้องอยู่ระหว่าง 0-${MAX_RATE_BPS / 100}% ต่อปี`);
  if (i.currentSavings !== undefined && (!isInt(i.currentSavings) || i.currentSavings < 0 || i.currentSavings > MAX_SAVINGS)) {
    add('currentSavings', 'เงินออมปัจจุบันต้องไม่ติดลบและไม่เกินช่วงที่คำนวณได้');
  }
  return out;
}

const mulFp = (a: bigint, b: bigint): bigint => roundHalfUpBig(a * b, SCALE);
const divFp = (a: bigint, b: bigint): bigint => roundHalfUpBig(a * SCALE, b);
const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

function powFp(base: bigint, exp: number): bigint {
  let result = SCALE;
  let b = base;
  let e = exp;
  while (e > 0) {
    if (e % 2 === 1) result = mulFp(result, b);
    b = mulFp(b, b);
    e = (e - (e % 2)) / 2;
  }
  return result;
}

function toSafe(n: bigint, what: string): number {
  if (n < 0n || n > MAX_SAFE) throw new RangeError(`${what}ใหญ่เกินกว่าจะแสดงได้ ลองลดค่าใช้จ่าย/จำนวนปี/ผลตอบแทน`);
  return Number(n);
}

/** คำนวณเป้าเกษียณ · ข้อมูลเข้าผิดช่วง = RangeError (ตรวจด้วย retirementProblems ก่อนเรียกที่ขอบ UI) */
export function computeRetirement(input: RetirementInput): RetirementResult {
  const problems = retirementProblems(input);
  if (problems.length > 0) throw new RangeError(problems[0]!.message);

  const years = input.retireAge - input.currentAge;
  const retYears = input.lifeExpectancy - input.retireAge;
  const accMonths = years * 12;
  const retMonths = retYears * 12;

  const inflAnnual = SCALE + roundHalfUpBig(SCALE * BigInt(input.inflationBps), 10_000n);
  const rmBefore = roundHalfUpBig(SCALE * BigInt(input.returnBeforeBps), 120_000n); // อัตราต่อเดือน (สเกล)
  const rmAfter = roundHalfUpBig(SCALE * BigInt(input.returnAfterBps), 120_000n);

  // ค่าใช้จ่ายต่อเดือน ณ วันเกษียณ (สเกล 10^18 ของสตางค์)
  const inflToRetire = powFp(inflAnnual, years);
  const w0 = BigInt(input.monthlyExpense) * inflToRetire;

  // เงินที่ต้องมี ณ วันเกษียณ: ผลรวมของเงินถอนต้นเดือน k = 0..M-1 ลดค่าด้วย (1+rm)^k
  const growAfter = SCALE + rmAfter;
  let w = w0;
  let discount = SCALE; // (1+rm)^-k
  let pv = 0n;
  for (let k = 0; k < retMonths; k++) {
    if (k > 0 && k % 12 === 0) w = mulFp(w, inflAnnual);
    pv += mulFp(w, discount);
    discount = divFp(discount, growAfter);
  }
  const requiredAtRetirement = ceilDiv(pv, SCALE);
  const requiredInToday = ceilDiv(pv, inflToRetire);

  // ช่วงสะสม
  const growBefore = SCALE + rmBefore;
  const savings = BigInt(input.currentSavings ?? 0);
  const growthFactor = powFp(growBefore, accMonths);
  const savingsFv = (savings * growthFactor) / SCALE; // ปัดลง (ไม่ประเมินเงินออมสูงเกิน)
  const shortfall = requiredAtRetirement > savingsFv ? requiredAtRetirement - savingsFv : 0n;

  let monthly = 0n;
  if (shortfall > 0n) {
    // ตัวคูณ annuity (ออมสิ้นเดือน): Σ_{j=0}^{N-1} (1+rm)^j
    let a = 0n;
    let p = SCALE;
    for (let j = 0; j < accMonths; j++) {
      a += p;
      p = mulFp(p, growBefore);
    }
    monthly = ceilDiv(shortfall * SCALE, a);
  }

  return {
    yearsToRetire: years,
    retirementYears: retYears,
    monthlyExpenseAtRetirement: toSafe(roundHalfUpBig(w0, SCALE), 'ค่าใช้จ่ายต่อเดือน ณ วันเกษียณ'),
    requiredAtRetirement: toSafe(requiredAtRetirement, 'เงินที่ต้องมี'),
    requiredInTodayMoney: toSafe(requiredInToday, 'เงินที่ต้องมี (มูลค่าวันนี้)'),
    currentSavingsAtRetirement: toSafe(savingsFv, 'มูลค่าอนาคตของเงินออม'),
    shortfall: toSafe(shortfall, 'ส่วนที่ยังขาด'),
    monthlySaving: toSafe(monthly, 'เงินที่ต้องเก็บต่อเดือน'),
  };
}
