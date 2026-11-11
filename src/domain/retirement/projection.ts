/**
 * เครื่องคิดเลขเป้าเกษียณ (เฟส 1) · ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล/เครือข่าย · ไม่ import ledger
 *
 * **ตัวเลขทั้งหมดเป็นประมาณการ ไม่ใช่ยอดในสมุดบัญชี** ห้ามลงสมุด ห้ามปนกับ SAFE-TO-SPEND / cashBalance / รายรับรายจ่าย
 * ทำตามร่างกฎ R18 (docs/money-rules-R18-proposal.md · รออนุมัติเจ้าของ) · ลำดับการปัดเศษตายตัว เปลี่ยนต้องเทียบ golden:
 *   1) E_ret = roundHalfUp(E0 x (10000+i)^Y / 10000^Y)            ค่าใช้จ่ายต่อเดือน ณ วันเกษียณ (เศษส่วนตรงตัว ปัดครั้งเดียว)
 *   2) W_k   = roundHalfUp(E_ret x (10000+i)^k / 10000^k)         เงินถอนรายเดือนของปีเกษียณที่ k (เท่ากันทั้ง 12 เดือน)
 *   3) G(b)  = roundHalfUp(S x (120000+b) / 120000)                ตัวคูณโตรายเดือน (S = 10^18)
 *      D_0 = S, D_(m+1) = roundHalfUp(D_m x S / G(b2)) · PV = Σ W_floor(m/12) x D_m · N = ceil(PV / S)        เงินที่ต้องมี
 *   4) P_0 = S, P_(t+1) = roundHalfUp(P_t x G(b1) / S) · A = Σ_(t<n) P_t · FVsav = roundHalfUp(Sav x P_n / S)    ช่วงสะสม (ฝากปลายเดือน)
 *   5) PMT = gap <= 0 ? 0 : ceil(gap x S / A)                                                              เก็บต่อเดือน
 *   6) N_today = roundHalfUp(N x 10000^Y / (10000+i)^Y)                                                    (แสดงผลอย่างเดียว)
 * ปัดครึ่งขึ้นระหว่างทาง · ปัดขึ้นเฉพาะ N กับ PMT (ตัวเลขวางแผน ไม่ประเมินต่ำ) · N ที่ปัดขึ้นแล้วเป็นตัวตั้งของขั้น 4-5 (ไม่ปัดซ้อน)
 * วนลูปรายเดือน ไม่ใช้สูตรปิด: ตัวหารมีแค่ G(b) >= S > 0 จึงไม่มีทางหารด้วยศูนย์ (อัตรา 0% ได้จำนวนเต็มตรงๆ)
 */

import { ceilDivBig, roundHalfUpBig } from '../money/round';

const SCALE = 10n ** 18n;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export const MIN_CURRENT_AGE = 18;
export const MAX_AGE = 100;
export const MIN_RETIRE_AGE = 30;
export const MAX_LIFE_EXPECTANCY = 120;
export const MAX_INFLATION_BPS = 1500;
export const MAX_RETURN_BEFORE_BPS = 2000;
export const MAX_RETURN_AFTER_BPS = 1500;
export const MAX_MONTHLY_EXPENSE = 100_000_000; // สตางค์ (1 ล้านบาท/เดือน)
export const MAX_SAVINGS = 100_000_000_000; // สตางค์ (1,000 ล้านบาท)

export interface RetirementInput {
  /** อายุเป็นปีเต็ม */
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
  /** เงินที่ต้องมีเทียบเป็นมูลค่าวันนี้ (สตางค์ ค่าอธิบาย) */
  requiredInTodayMoney: number;
  /** มูลค่าอนาคตของเงินออมปัจจุบัน ณ วันเกษียณ (สตางค์) */
  currentSavingsAtRetirement: number;
  /** ส่วนที่ยังขาด (สตางค์ ≥ 0) */
  shortfall: number;
  /** ต้องเก็บต่อเดือน (สตางค์ ปัดขึ้น · 0 = เงินออมปัจจุบันถึงเป้าตามสมมติฐานแล้ว) */
  monthlySaving: number;
  /** ผลตอบแทนหลังเกษียณต่ำกว่าเงินเฟ้อ: เงินจะหมดเร็วกว่าที่รู้สึก (ต้องเตือนผู้ใช้) */
  realReturnNegativeAfter: boolean;
}

export type ProblemField = 'currentAge' | 'retireAge' | 'lifeExpectancy' | 'monthlyExpense' | 'inflationBps' | 'returnBeforeBps' | 'returnAfterBps' | 'currentSavings';

export interface RetirementProblem {
  field: ProblemField;
  message: string;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && !Object.is(v, -0);

/** ตรวจข้อมูลเข้า (ช่วงค่าที่รับได้ ตาม R18 ข้อ 18.2) · คืนรายการปัญหา ว่าง = ใช้ได้ */
export function retirementProblems(i: RetirementInput): RetirementProblem[] {
  const out: RetirementProblem[] = [];
  const add = (field: ProblemField, message: string): void => void out.push({ field, message });
  if (!isInt(i.currentAge) || i.currentAge < MIN_CURRENT_AGE || i.currentAge > MAX_AGE) add('currentAge', `อายุตอนนี้ต้องเป็นจำนวนเต็ม ${MIN_CURRENT_AGE}-${MAX_AGE} ปี`);
  if (!isInt(i.retireAge) || i.retireAge < MIN_RETIRE_AGE || i.retireAge > MAX_AGE) add('retireAge', `อายุเกษียณต้องเป็นจำนวนเต็ม ${MIN_RETIRE_AGE}-${MAX_AGE} ปี`);
  else if (isInt(i.currentAge) && i.retireAge <= i.currentAge) add('retireAge', 'อายุเกษียณต้องมากกว่าอายุตอนนี้');
  if (!isInt(i.lifeExpectancy) || i.lifeExpectancy > MAX_LIFE_EXPECTANCY) add('lifeExpectancy', `อายุคาดการณ์ต้องเป็นจำนวนเต็มไม่เกิน ${MAX_LIFE_EXPECTANCY} ปี`);
  else if (isInt(i.retireAge) && i.lifeExpectancy <= i.retireAge) add('lifeExpectancy', 'อายุคาดการณ์ต้องมากกว่าอายุเกษียณ');
  if (!isInt(i.monthlyExpense) || i.monthlyExpense < 1 || i.monthlyExpense > MAX_MONTHLY_EXPENSE) add('monthlyExpense', 'ค่าใช้จ่ายต่อเดือนต้องมากกว่า 0 และไม่เกิน 1,000,000 บาท');
  if (!isInt(i.inflationBps) || i.inflationBps < 0 || i.inflationBps > MAX_INFLATION_BPS) add('inflationBps', `เงินเฟ้อต้องอยู่ระหว่าง 0-${MAX_INFLATION_BPS / 100}% ต่อปี`);
  if (!isInt(i.returnBeforeBps) || i.returnBeforeBps < 0 || i.returnBeforeBps > MAX_RETURN_BEFORE_BPS) add('returnBeforeBps', `ผลตอบแทนก่อนเกษียณต้องอยู่ระหว่าง 0-${MAX_RETURN_BEFORE_BPS / 100}% ต่อปี`);
  if (!isInt(i.returnAfterBps) || i.returnAfterBps < 0 || i.returnAfterBps > MAX_RETURN_AFTER_BPS) add('returnAfterBps', `ผลตอบแทนหลังเกษียณต้องอยู่ระหว่าง 0-${MAX_RETURN_AFTER_BPS / 100}% ต่อปี`);
  if (i.currentSavings !== undefined && (!isInt(i.currentSavings) || i.currentSavings < 0 || i.currentSavings > MAX_SAVINGS)) {
    add('currentSavings', 'เงินออมปัจจุบันต้องไม่ติดลบและไม่เกิน 1,000 ล้านบาท');
  }
  return out;
}

function toSafe(n: bigint, what: string): number {
  if (n < 0n || n > MAX_SAFE) throw new RangeError(`ค่าสมมติฐานทำให้${what}ใหญ่เกินกว่าจะคำนวณได้`);
  return Number(n);
}

/** คำนวณเป้าเกษียณ · ข้อมูลเข้าผิดช่วง = RangeError (ตรวจด้วย retirementProblems ก่อนเรียกที่ขอบ UI) */
export function computeRetirement(input: RetirementInput): RetirementResult {
  const problems = retirementProblems(input);
  if (problems.length > 0) throw new RangeError(problems[0]!.message);

  const years = input.retireAge - input.currentAge;
  const retYears = input.lifeExpectancy - input.retireAge;
  const n = years * 12;
  const M = retYears * 12;

  const base = 10_000n;
  const up = BigInt(10_000 + input.inflationBps);
  const G = (bps: number): bigint => roundHalfUpBig(SCALE * BigInt(120_000 + bps), 120_000n);
  const g1 = G(input.returnBeforeBps);
  const g2 = G(input.returnAfterBps);

  // 1) ค่าใช้จ่ายต่อเดือน ณ วันเกษียณ
  const eRet = roundHalfUpBig(BigInt(input.monthlyExpense) * up ** BigInt(years), base ** BigInt(years));

  // 2) เงินถอนรายเดือนของแต่ละปีเกษียณ
  const w: bigint[] = [];
  for (let k = 0; k < retYears; k++) w.push(roundHalfUpBig(eRet * up ** BigInt(k), base ** BigInt(k)));

  // 3) เงินที่ต้องมี ณ วันเกษียณ
  let d = SCALE;
  let pv = 0n;
  for (let m = 0; m < M; m++) {
    pv += w[(m - (m % 12)) / 12]! * d;
    d = roundHalfUpBig(d * SCALE, g2);
  }
  const required = ceilDivBig(pv, SCALE);

  // 4) ช่วงสะสม
  let p = SCALE;
  let a = 0n;
  for (let t = 0; t < n; t++) {
    a += p;
    p = roundHalfUpBig(p * g1, SCALE);
  }
  const savingsFv = roundHalfUpBig(BigInt(input.currentSavings ?? 0) * p, SCALE);
  const gap = required - savingsFv;

  // 5) เก็บต่อเดือน
  const pmt = gap > 0n ? ceilDivBig(gap * SCALE, a) : 0n;

  // 6) ค่าเสริม
  const requiredToday = roundHalfUpBig(required * base ** BigInt(years), up ** BigInt(years));

  return {
    yearsToRetire: years,
    retirementYears: retYears,
    monthlyExpenseAtRetirement: toSafe(eRet, 'ค่าใช้จ่ายต่อเดือน ณ วันเกษียณ'),
    requiredAtRetirement: toSafe(required, 'เงินที่ต้องมี'),
    requiredInTodayMoney: toSafe(requiredToday, 'เงินที่ต้องมี (มูลค่าวันนี้)'),
    currentSavingsAtRetirement: toSafe(savingsFv, 'มูลค่าอนาคตของเงินออม'),
    shortfall: toSafe(gap > 0n ? gap : 0n, 'ส่วนที่ยังขาด'),
    monthlySaving: toSafe(pmt, 'เงินที่ต้องเก็บต่อเดือน'),
    realReturnNegativeAfter: input.returnAfterBps < input.inflationBps,
  };
}
