/**
 * เครื่องคิดภาษีเงินได้บุคคลธรรมดา "เงินเดือนล้วน" (กฎ R19 · เฟส 1-2) ประมาณการเท่านั้น
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
  /** เฟส 2 (ไม่ระบุ = 0 / false) */
  spouseNoIncome?: boolean;
  /** บุตรชอบด้วยกฎหมายทั้งหมด (คน) */
  childrenCount?: number;
  /** ในนั้นคนที่ 2 เป็นต้นไปที่เกิดตั้งแต่ปี 2561 (ได้เพิ่มอีกคนละ 30,000) ต้อง ≤ childrenCount − 1 เพราะบุตรคนแรกเพิ่มไม่ได้ */
  extraChildrenCount?: number;
  /** บิดามารดา (รวมของคู่สมรส) 0-4 คน */
  parentsCount?: number;
  lifeInsurancePaid?: number;
  healthInsurancePaid?: number;
  parentsHealthPaid?: number;
  mortgageInterestPaid?: number;
  donationPaid?: number;
  /** ค่าฝากครรภ์และคลอดบุตร แยกรายครรภ์ (สตางค์ต่อครรภ์) สูงสุด 2 ครรภ์ · แต่ละครรภ์หักได้ไม่เกิน 60,000 */
  prenatalPaid?: number[];
  /** คนพิการ/ทุพพลภาพที่อุปการะ: ญาติตามรายการ (คน) */
  disabledRelativesCount?: number;
  /** คนพิการ/ทุพพลภาพที่เป็นบุคคลอื่น (0 หรือ 1 คน) */
  disabledOtherCount?: number;
  /** บุตรชอบด้วยกฎหมายที่ยังมีชีวิตทั้งหมด รวมคนที่ไม่เข้าเกณฑ์ลดหย่อน (ใช้นับเพดานบุตรบุญธรรม 3 คน) ไม่ระบุ = เท่ากับ childrenCount ต้อง ≥ childrenCount */
  livingChildrenCount?: number;
  /** บุตรบุญธรรม (คน) ไม่เกิน 3 */
  adoptedChildrenCount?: number;
  /** เบี้ยประกันชีวิตของคู่สมรสที่ไม่มีเงินได้ (ต้องติ๊ก spouseNoIncome) */
  spouseLifeInsurancePaid?: number;
}

export type DeductionKey =
  | 'personal'
  | 'spouse'
  | 'children'
  | 'adoptedChildren'
  | 'parents'
  | 'disabled'
  | 'prenatal'
  | 'socialSecurity'
  | 'lifeInsurance'
  | 'healthInsurance'
  | 'spouseLifeInsurance'
  | 'parentsHealth'
  | 'mortgageInterest'
  | 'rmf'
  | 'pensionInsurance'
  | 'thaiEsg'
  | 'donation';

/** ลำดับแสดงผลและลำดับหักเพดานกลุ่ม (คงที่ ตามกฎ R19: รายการที่อยู่ก่อนได้ก่อน) · บริจาคอยู่ท้ายเพราะฐานคือเงินได้หลังหักลดหย่อนอื่นทั้งหมด */
export const DEDUCTION_ORDER: readonly DeductionKey[] = [
  'personal',
  'spouse',
  'children',
  'adoptedChildren',
  'parents',
  'disabled',
  'prenatal',
  'socialSecurity',
  'lifeInsurance',
  'healthInsurance',
  'spouseLifeInsurance',
  'parentsHealth',
  'mortgageInterest',
  'rmf',
  'pensionInsurance',
  'thaiEsg',
  'donation',
];

/** รายการที่แอปใส่ให้จากจำนวนที่ระบุ (ไม่ใช่จำนวนเงินที่ผู้ใช้กรอก) */
export const AUTO_DEDUCTION_KEYS: readonly DeductionKey[] = ['personal', 'spouse', 'children', 'adoptedChildren', 'parents', 'disabled'];

export interface DeductionLine {
  key: DeductionKey;
  /** ที่ผู้ใช้ขอ (รายการอัตโนมัติ = จำนวนที่แอปคำนวณจากที่ระบุ) */
  requested: number;
  /** ที่ใช้ได้จริงหลังเพดาน */
  allowed: number;
  /** ขอเกินเพดานจนถูกลด ("ขอ X ใช้ได้ Y") */
  clamped: boolean;
  /** "สิทธิที่ยังใช้ได้" เพิ่มได้อีกเท่าไรภายใต้เพดาน (null = ไม่มีเพดานให้เพิ่ม เช่น รายการอัตโนมัติ) */
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

const MONEY_LABEL = {
  annualSalary: 'เงินได้ทั้งปี',
  withheldTax: 'ภาษีที่ถูกหักแล้ว',
  socialSecurityPaid: 'เงินสมทบประกันสังคม',
  rmfPaid: 'เงินซื้อ RMF',
  pensionInsurancePaid: 'เบี้ยประกันชีวิตแบบบำนาญ',
  thaiEsgPaid: 'เงินซื้อ Thai ESG',
  lifeInsurancePaid: 'เบี้ยประกันชีวิต',
  healthInsurancePaid: 'เบี้ยประกันสุขภาพ',
  parentsHealthPaid: 'เบี้ยประกันสุขภาพบิดามารดา',
  mortgageInterestPaid: 'ดอกเบี้ยบ้าน',
  donationPaid: 'เงินบริจาค',
  spouseLifeInsurancePaid: 'เบี้ยประกันชีวิตคู่สมรส',
} as const;
const REQUIRED_MONEY = ['annualSalary', 'withheldTax', 'socialSecurityPaid', 'rmfPaid', 'pensionInsurancePaid', 'thaiEsgPaid'] as const;
const OPTIONAL_MONEY = ['lifeInsurancePaid', 'healthInsurancePaid', 'parentsHealthPaid', 'mortgageInterestPaid', 'donationPaid', 'spouseLifeInsurancePaid'] as const;

function assertMoney(v: unknown, label: string): asserts v is number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw new RangeError(`${label}ต้องเป็นจำนวนสตางค์ที่เป็นจำนวนเต็ม`);
  if (Object.is(v, -0)) throw new RangeError(`${label}ต้องไม่เป็นค่าลบศูนย์`);
  if (v < 0) throw new RangeError(`${label}ต้องไม่ติดลบ`);
  if (v > MAX_TAX_INPUT_SATANG) throw new RangeError(`${label}ต้องไม่เกิน 100 ล้านบาท`);
}

function assertCount(v: unknown, label: string, max: number): asserts v is number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || Object.is(v, -0)) throw new RangeError(`${label}ต้องเป็นจำนวนเต็ม`);
  if (v < 0) throw new RangeError(`${label}ต้องไม่ติดลบ`);
  if (v > max) throw new RangeError(`${label}ต้องไม่เกิน ${max} คน`);
}

/** ข้อมูลเข้าไม่ถูกต้อง = RangeError ข้อความไทย (R19: ห้ามปัดหรือตัดค่าเงียบๆ) */
export function assertSalaryTaxInput(input: SalaryTaxInput, config: TaxYearConfig = TAX_CONFIG_2569): void {
  for (const key of REQUIRED_MONEY) assertMoney(input[key], MONEY_LABEL[key]);
  for (const key of OPTIONAL_MONEY) {
    if (input[key] !== undefined) assertMoney(input[key], MONEY_LABEL[key]);
  }
  if (input.spouseNoIncome !== undefined && typeof input.spouseNoIncome !== 'boolean') throw new RangeError('คู่สมรสไม่มีเงินได้ต้องเป็นจริงหรือเท็จ');
  const children = input.childrenCount ?? 0;
  const extra = input.extraChildrenCount ?? 0;
  assertCount(children, 'จำนวนบุตร', config.child.maxCount);
  assertCount(extra, 'จำนวนบุตรที่ได้ลดหย่อนเพิ่ม', config.child.maxCount);
  if (extra > Math.max(children - 1, 0)) throw new RangeError('จำนวนบุตรที่ได้ลดหย่อนเพิ่มต้องน้อยกว่าจำนวนบุตรทั้งหมดอย่างน้อย 1 คน (บุตรคนแรกไม่ได้ลดหย่อนเพิ่ม)');
  assertCount(input.parentsCount ?? 0, 'จำนวนบิดามารดา', config.parent.maxCount);
  if (input.livingChildrenCount !== undefined) {
    assertCount(input.livingChildrenCount, 'จำนวนบุตรที่มีชีวิตทั้งหมด', config.child.maxCount);
    if (input.livingChildrenCount < children) throw new RangeError('จำนวนบุตรที่มีชีวิตทั้งหมดต้องไม่น้อยกว่าจำนวนบุตรที่ลดหย่อน');
  }
  assertCount(input.disabledRelativesCount ?? 0, 'จำนวนคนพิการ/ทุพพลภาพที่เป็นญาติ', config.disability.maxRelatives);
  assertCount(input.disabledOtherCount ?? 0, 'จำนวนคนพิการ/ทุพพลภาพที่เป็นบุคคลอื่น', config.disability.maxOthers);
  assertCount(input.adoptedChildrenCount ?? 0, 'จำนวนบุตรบุญธรรม', config.adoptedChild.maxTotalChildren);
  if (input.prenatalPaid !== undefined) {
    if (!Array.isArray(input.prenatalPaid)) throw new RangeError('ค่าฝากครรภ์และคลอดบุตรต้องระบุเป็นรายการรายครรภ์');
    if (input.prenatalPaid.length > config.prenatal.maxPregnancies) throw new RangeError(`ค่าฝากครรภ์และคลอดบุตรรองรับไม่เกิน ${config.prenatal.maxPregnancies} ครรภ์ต่อปี`);
    input.prenatalPaid.forEach((v, i) => assertMoney(v, `ค่าฝากครรภ์และคลอดบุตรครรภ์ที่ ${i + 1}`));
  }
  if ((input.spouseLifeInsurancePaid ?? 0) > 0 && input.spouseNoIncome !== true) {
    throw new RangeError('เบี้ยประกันชีวิตคู่สมรสใช้ลดหย่อนได้เมื่อคู่สมรสไม่มีเงินได้ ติ๊ก "คู่สมรสไม่มีเงินได้" ก่อน');
  }
}

const minBig = (a: bigint, b: bigint): bigint => (a < b ? a : b);
const maxBig = (a: bigint, b: bigint): bigint => (a > b ? a : b);
const percentOf = (amount: bigint, rateBps: number): bigint => roundHalfUpBig(amount * BigInt(rateBps), BPS);

/** เพดานรายตัว = min(ร้อยละของเงินได้ (ปัดครึ่งขึ้น), เพดานเงินบาทถ้ามี) */
function itemCap(income: bigint, rateBps: number, capSatang: number | null): bigint {
  const byRate = percentOf(income, rateBps);
  return capSatang === null ? byRate : minBig(byRate, BigInt(capSatang));
}

export function computeSalaryTax(input: SalaryTaxInput, config: TaxYearConfig = TAX_CONFIG_2569): SalaryTaxResult {
  assertSalaryTaxInput(input, config);
  const income = BigInt(input.annualSalary);
  const paid = (v: number | undefined): bigint => BigInt(v ?? 0);

  // ค่าใช้จ่ายเหมา 50% ไม่เกิน 100,000 บาท (เงินได้ประเภท 1 รวมครั้งเดียว)
  const expenseByRate = percentOf(income, config.employmentExpense.rateBps);
  const expense = config.employmentExpense.capSatang === null ? expenseByRate : minBig(expenseByRate, BigInt(config.employmentExpense.capSatang));

  // รายการที่แอปใส่ให้จากจำนวนที่ระบุ
  const personal = BigInt(config.personalAllowance.satang);
  const spouse = input.spouseNoIncome === true ? BigInt(config.spouse.satang) : 0n;
  const children = BigInt(input.childrenCount ?? 0) * BigInt(config.child.baseSatang) + BigInt(input.extraChildrenCount ?? 0) * BigInt(config.child.extraSatang);
  const parents = BigInt(input.parentsCount ?? 0) * BigInt(config.parent.perSatang);
  const disabledCount = BigInt((input.disabledRelativesCount ?? 0) + (input.disabledOtherCount ?? 0));
  const disabled = disabledCount * BigInt(config.disability.perSatang);

  // บุตรบุญธรรม: รวมกับบุตรชอบด้วยกฎหมายไม่เกิน 3 คน (ครบ 3 คนแล้วหักไม่ได้) บุตรชอบด้วยกฎหมายมาก่อนตามเอกสาร
  const adoptedRequestedCount = BigInt(input.adoptedChildrenCount ?? 0);
  // เอกสาร ภ.ง.ด.94 หัวข้อ 3: นับเฉพาะบุตรที่มีชีวิตอยู่ รวมทั้งบุตรที่ไม่อยู่ในเกณฑ์ได้รับการหักลดหย่อนด้วย
  const livingLegit = BigInt(Math.max(input.livingChildrenCount ?? 0, input.childrenCount ?? 0));
  const adoptedRoom = maxBig(BigInt(config.adoptedChild.maxTotalChildren) - livingLegit, 0n);
  const adoptedAllowedCount = minBig(adoptedRequestedCount, adoptedRoom);
  const adopted = adoptedAllowedCount * BigInt(config.adoptedChild.perSatang);

  // ค่าฝากครรภ์และคลอดบุตร: เพดานแยกต่อครรภ์ (ไม่เอายอดเกินของครรภ์หนึ่งไปชดเชยอีกครรภ์)
  const pregnancyCap = BigInt(config.prenatal.capPerPregnancySatang);
  const prenatalList = (input.prenatalPaid ?? []).map((v) => BigInt(v));
  const prenatalRequested = prenatalList.reduce((sum, v) => sum + v, 0n);
  const prenatal = prenatalList.reduce((sum, v) => sum + minBig(v, pregnancyCap), 0n);

  // เพดานรายตัวก่อน แล้วเพดานกลุ่มตามลำดับคงที่ (R19)
  const ssCap = BigInt(config.socialSecurity.capSatang);
  const ss = minBig(paid(input.socialSecurityPaid), ssCap);

  const lhGroup = BigInt(config.lifeHealthGroup.capSatang);
  const lifeCap = BigInt(config.lifeInsurance.capSatang);
  const healthCap = BigInt(config.healthInsurance.capSatang);
  const life = minBig(minBig(paid(input.lifeInsurancePaid), lifeCap), lhGroup);
  const health = minBig(minBig(paid(input.healthInsurancePaid), healthCap), lhGroup - life);
  const lhLeft = lhGroup - life - health;

  const parentsHealthCap = BigInt(config.parentsHealth.capSatang);
  const parentsHealth = minBig(paid(input.parentsHealthPaid), parentsHealthCap);
  const mortgageCap = BigInt(config.mortgageInterest.capSatang);
  const mortgage = minBig(paid(input.mortgageInterestPaid), mortgageCap);
  const spouseLifeCap = BigInt(config.spouseLifeInsurance.capSatang);
  const spouseLife = minBig(paid(input.spouseLifeInsurancePaid), spouseLifeCap);

  // ทุน/เกษียณ: กลุ่มเกษียณ (RMF ก่อน ประกันบำนาญตามลำดับคงที่) · Thai ESG นอกกลุ่ม
  const groupCap = BigInt(config.retirementGroup.capSatang);
  const rmfCap = itemCap(income, config.rmf.rateBps, config.rmf.capSatang);
  const pensionCap = itemCap(income, config.pensionInsurance.rateBps, config.pensionInsurance.capSatang);
  const esgCap = itemCap(income, config.thaiEsg.rateBps, config.thaiEsg.capSatang);
  const rmf = minBig(minBig(paid(input.rmfPaid), rmfCap), groupCap);
  const pension = minBig(minBig(paid(input.pensionInsurancePaid), pensionCap), groupCap - rmf);
  const esg = minBig(paid(input.thaiEsgPaid), esgCap);
  const groupLeft = groupCap - rmf - pension;

  // บริจาค: เพดานร้อยละของ "เงินได้หลังหักค่าใช้จ่ายและค่าลดหย่อนอื่นทั้งหมด" (ไม่รวมบริจาค) ฐานติดลบ = 0
  const beforeDonation = personal + spouse + children + adopted + parents + disabled + prenatal + ss + life + health + spouseLife + parentsHealth + mortgage + rmf + pension + esg;
  const donationBase = maxBig(income - expense - beforeDonation, 0n);
  const donationCap = percentOf(donationBase, config.donation.rateBps);
  const donation = minBig(paid(input.donationPaid), donationCap);

  const room = (cap: bigint, used: bigint, groupRoom?: bigint): bigint => {
    const r = maxBig(cap - used, 0n);
    return groupRoom === undefined ? r : minBig(r, groupRoom);
  };
  const auto = (key: DeductionKey, amount: bigint, confidence: Confidence): DeductionLine => ({ key, requested: Number(amount), allowed: Number(amount), clamped: false, remaining: null, confidence });
  const capped = (key: DeductionKey, requested: bigint, allowed: bigint, remaining: bigint, confidence: Confidence): DeductionLine => ({
    key,
    requested: Number(requested),
    allowed: Number(allowed),
    clamped: requested > allowed,
    remaining: Number(remaining),
    confidence,
  });

  const byKey: Record<DeductionKey, DeductionLine> = {
    personal: auto('personal', personal, config.personalAllowance.confidence),
    spouse: auto('spouse', spouse, config.spouse.confidence),
    children: auto('children', children, config.child.confidence),
    adoptedChildren: { key: 'adoptedChildren', requested: Number(adoptedRequestedCount * BigInt(config.adoptedChild.perSatang)), allowed: Number(adopted), clamped: adoptedAllowedCount < adoptedRequestedCount, remaining: null, confidence: config.adoptedChild.confidence },
    parents: auto('parents', parents, config.parent.confidence),
    disabled: auto('disabled', disabled, config.disability.confidence),
    prenatal: { key: 'prenatal', requested: Number(prenatalRequested), allowed: Number(prenatal), clamped: prenatalRequested > prenatal, remaining: null, confidence: config.prenatal.confidence },
    socialSecurity: capped('socialSecurity', paid(input.socialSecurityPaid), ss, room(ssCap, ss), config.socialSecurity.confidence),
    lifeInsurance: capped('lifeInsurance', paid(input.lifeInsurancePaid), life, room(lifeCap, life, lhLeft), config.lifeInsurance.confidence),
    spouseLifeInsurance: capped('spouseLifeInsurance', paid(input.spouseLifeInsurancePaid), spouseLife, room(spouseLifeCap, spouseLife), config.spouseLifeInsurance.confidence),
    healthInsurance: capped('healthInsurance', paid(input.healthInsurancePaid), health, room(healthCap, health, lhLeft), config.healthInsurance.confidence),
    parentsHealth: capped('parentsHealth', paid(input.parentsHealthPaid), parentsHealth, room(parentsHealthCap, parentsHealth), config.parentsHealth.confidence),
    mortgageInterest: capped('mortgageInterest', paid(input.mortgageInterestPaid), mortgage, room(mortgageCap, mortgage), config.mortgageInterest.confidence),
    rmf: capped('rmf', paid(input.rmfPaid), rmf, room(rmfCap, rmf, groupLeft), config.rmf.confidence),
    pensionInsurance: capped('pensionInsurance', paid(input.pensionInsurancePaid), pension, room(pensionCap, pension, groupLeft), config.pensionInsurance.confidence),
    thaiEsg: capped('thaiEsg', paid(input.thaiEsgPaid), esg, room(esgCap, esg), config.thaiEsg.confidence),
    donation: capped('donation', paid(input.donationPaid), donation, room(donationCap, donation), config.donation.confidence),
  };
  const lines = DEDUCTION_ORDER.map((k) => byKey[k]);

  const totalAllowances = beforeDonation + donation;
  const net = maxBig(income - expense - totalAllowances, 0n);

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
