/**
 * ประมาณการเป้าหมายในหน้า My goal (กฎ R28) · ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล · BigInt ตลอดขั้นคูณ · ห้าม float
 *   - เป็นประมาณการ ไม่ใช่คำสัญญา · ไม่ลงสมุด ไม่ใช่ข้อมูลเงินจริง (R16)
 *   - สูตรรายเดือน: V(k+1) = roundHalfUp(V(k) x (120,000 + r) / 120,000) + C · รายได้ปันผลต่อเดือน = roundHalfUp(V(k) x y / 120,000)
 *   - ปัดครึ่งออกจากศูนย์ด้วย roundHalfUpBig ตัวกลางเท่านั้น (R8)
 *   - ไม่มีข้อมูล = ไม่คำนวณ พร้อมเหตุผล (ห้ามเดา) · หน่วยเงินคือหน่วยย่อยของสกุลที่ผู้เรียกส่งมา (เซนต์/สตางค์)
 */

import { roundHalfUpBig } from '../money/round';
import { addMonthsClamped } from './metrics';
import { assetCurrency, type InvestmentData } from './types';

/** ประมาณการไกลสุดกี่เดือน (100 ปี) · ไม่ถึงภายในนี้ = null */
export const GOAL_MAX_MONTHS = 1_200;
export const GOAL_RETURN_MIN_BPS = -5_000;
export const GOAL_RETURN_MAX_BPS = 30_000;
export const GOAL_INFLATION_MAX_BPS = 10_000;
export const GOAL_YIELD_MAX_BPS = 10_000;
export const GOAL_YEAR_MIN = 2_000;
export const GOAL_YEAR_MAX = 2_200;

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const isMinor = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isBpsIn = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;

export type GoalKind = 'value' | 'income';
export type GoalCurrency = 'THB' | 'USD';

/** ค่าที่ผู้ใช้ตั้ง (เก็บใน settings.investGoal) · จำนวนเงินเป็นหน่วยย่อยของ currency ที่ผู้ใช้กรอก (สตางค์/เซนต์) */
export interface InvestGoal {
  kind: GoalKind;
  /** เป้า: มูลค่าพอร์ต หรือรายได้ปันผลต่อเดือน */
  targetMinor: number;
  /** เงินเพิ่มต่อเดือน */
  contributionMinor: number;
  /** เดือนที่ต้องการถึงเป้า YYYY-MM */
  achieveBy: string;
  /** ผลตอบแทนคาดหวังต่อปี (bps) */
  returnBps: number;
  /** เงินเฟ้อต่อปี (bps) · 0 = ไม่คิด */
  inflationBps: number;
  currency: GoalCurrency;
}

const ACHIEVE_BY = /^(\d{4})-(0[1-9]|1[0-2])$/;
const isAchieveBy = (v: unknown): v is string => {
  if (typeof v !== 'string') return false;
  const m = ACHIEVE_BY.exec(v);
  return m !== null && Number(m[1]) >= GOAL_YEAR_MIN && Number(m[1]) <= GOAL_YEAR_MAX;
};

/** เหตุผลที่ค่าเป้าหมายผิดรูป (null = ใช้ได้) */
export function investGoalProblem(g: InvestGoal): string | null {
  if (g === null || typeof g !== 'object' || Array.isArray(g)) return 'เป้าหมายลงทุนต้องเป็นออบเจ็กต์';
  if (g.kind !== 'value' && g.kind !== 'income') return `ชนิดเป้าหมายต้องเป็น value หรือ income (ได้รับ ${String(g.kind)})`;
  if (!isMinor(g.targetMinor)) return `เป้าต้องเป็นจำนวนเต็มหน่วยย่อยที่ไม่ติดลบ (ได้รับ ${String(g.targetMinor)})`;
  if (!isMinor(g.contributionMinor)) return `เงินเพิ่มต่อเดือนต้องเป็นจำนวนเต็มหน่วยย่อยที่ไม่ติดลบ (ได้รับ ${String(g.contributionMinor)})`;
  if (!isAchieveBy(g.achieveBy)) return `เดือนที่ต้องการถึงเป้าต้องเป็น YYYY-MM ปี ${GOAL_YEAR_MIN}-${GOAL_YEAR_MAX} (ได้รับ ${String(g.achieveBy)})`;
  if (!isBpsIn(g.returnBps, GOAL_RETURN_MIN_BPS, GOAL_RETURN_MAX_BPS)) return `ผลตอบแทนคาดหวังต้องเป็น bps จำนวนเต็ม ${GOAL_RETURN_MIN_BPS} ถึง ${GOAL_RETURN_MAX_BPS} (ได้รับ ${String(g.returnBps)})`;
  if (!isBpsIn(g.inflationBps, 0, GOAL_INFLATION_MAX_BPS)) return `เงินเฟ้อต้องเป็น bps จำนวนเต็ม 0 ถึง ${GOAL_INFLATION_MAX_BPS} (ได้รับ ${String(g.inflationBps)})`;
  if (g.currency !== 'THB' && g.currency !== 'USD') return `สกุลของเป้าหมายต้องเป็น THB หรือ USD (ได้รับ ${String(g.currency)})`;
  return null;
}

/** อ่านค่าจากภายนอก (ฐานข้อมูล/ไฟล์) แบบไม่เชื่อ: เก็บเฉพาะฟิลด์ที่รู้จัก · ผิดรูป = undefined (ทิ้งทั้งก้อน) */
export function sanitizeInvestGoal(raw: unknown): InvestGoal | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const g = { kind: r.kind, targetMinor: r.targetMinor, contributionMinor: r.contributionMinor, achieveBy: r.achieveBy, returnBps: r.returnBps, inflationBps: r.inflationBps, currency: r.currency } as InvestGoal;
  return investGoalProblem(g) === null ? g : undefined;
}

/** ผลตอบแทนจริงต่อปี (bps) หลังหักเงินเฟ้อ: roundHalfUp((10,000 + r) x 10,000 / (10,000 + i)) − 10,000 */
export function realReturnBps(returnBps: number, inflationBps: number): number {
  return Number(roundHalfUpBig(BigInt(10_000 + returnBps) * 10_000n, BigInt(10_000 + inflationBps))) - 10_000;
}

export interface GoalInput {
  /** มูลค่าตลาดปัจจุบันของพอร์ต (หน่วยย่อย) · null = ไม่ทราบ (ไม่มีราคา/เรต) */
  startMinor: number | null;
  contributionMinor: number;
  returnBps: number;
  inflationBps: number;
  /** yield ปันผลต่อปี (bps) จาก R25.2 · null = ไม่มีข้อมูล */
  yieldBps: number | null;
  kind: GoalKind;
  targetMinor: number;
}

export type GoalNa = 'no-value' | 'no-yield' | 'invalid' | 'too-large';

export interface GoalPoint {
  month: number;
  /** เป้ามูลค่า = มูลค่าพอร์ต · เป้ารายได้ = รายได้ปันผลต่อเดือน */
  valueMinor: number;
}

export type GoalResult =
  | {
      kind: 'ok';
      /** เดือนที่ k น้อยสุดที่ถึงเป้า (0 = ถึงแล้ว) · null = ไม่ถึงภายใน 1,200 เดือน */
      months: number | null;
      realReturnBps: number;
      /** รายได้ปันผลต่อเดือนวันนี้ · null = ไม่มี yield */
      incomeNowMinor: number | null;
      /** พอร์ตที่ต้องมี: เป้ามูลค่า = เป้า · เป้ารายได้ = ปัด(T x 120,000 / y) · null = คำนวณไม่ได้ (y = 0) */
      neededMinor: number | null;
      /** จุดสำหรับกราฟ: ทุก 12 เดือน + เดือนที่ถึงเป้า */
      path: GoalPoint[];
    }
  | { kind: 'na'; reason: GoalNa };

export interface GoalOptions {
  /** ให้เส้นกราฟยาวอย่างน้อยกี่เดือน (เช่น ถึงเดือนเป้าที่ผู้ใช้ตั้ง) · ไม่เกิน 1,200 */
  horizonMonths?: number;
}

function inputsValid(i: GoalInput): boolean {
  return (
    (i.startMinor === null || isMinor(i.startMinor)) &&
    isMinor(i.contributionMinor) &&
    isMinor(i.targetMinor) &&
    isBpsIn(i.returnBps, GOAL_RETURN_MIN_BPS, GOAL_RETURN_MAX_BPS) &&
    isBpsIn(i.inflationBps, 0, GOAL_INFLATION_MAX_BPS) &&
    (i.yieldBps === null || isBpsIn(i.yieldBps, 0, GOAL_YIELD_MAX_BPS)) &&
    (i.kind === 'value' || i.kind === 'income')
  );
}

/** ประมาณการทีละเดือนจนถึงเป้า (R28) · ไม่มีข้อมูล/ค่าผิดช่วง = na พร้อมเหตุผล */
export function projectGoal(input: GoalInput, options: GoalOptions = {}): GoalResult {
  if (!inputsValid(input)) return { kind: 'na', reason: 'invalid' };
  if (input.startMinor === null) return { kind: 'na', reason: 'no-value' };
  if (input.kind === 'income' && input.yieldBps === null) return { kind: 'na', reason: 'no-yield' };
  const horizon = options.horizonMonths;
  if (horizon !== undefined && (!Number.isSafeInteger(horizon) || horizon < 0)) return { kind: 'na', reason: 'invalid' };

  const real = realReturnBps(input.returnBps, input.inflationBps);
  const growth = BigInt(120_000 + real);
  const contribution = BigInt(input.contributionMinor);
  const target = BigInt(input.targetMinor);
  const y = input.yieldBps === null ? null : BigInt(input.yieldBps);
  const incomeOf = (v: bigint): bigint | null => (y === null ? null : roundHalfUpBig(v * y, 120_000n));
  const metricOf = (v: bigint): bigint => (input.kind === 'value' ? v : (incomeOf(v) as bigint));

  // จำลอง 0..1,200 เดือน: ก่อนถึงเป้า ค่าเกินช่วงปลอดภัย = too-large · หลังถึงเป้า ตัดเส้นที่ตรงนั้น
  const values: bigint[] = [];
  let v = BigInt(input.startMinor);
  let months: number | null = null;
  let overflowAt: number | null = null;
  for (let k = 0; k <= GOAL_MAX_MONTHS; k++) {
    if (v > MAX_SAFE || metricOf(v) > MAX_SAFE) {
      overflowAt = k;
      break;
    }
    values.push(v);
    if (months === null && metricOf(v) >= target) months = k;
    if (k < GOAL_MAX_MONTHS) v = roundHalfUpBig(v * growth, 120_000n) + contribution;
  }
  if (months === null && overflowAt !== null) return { kind: 'na', reason: 'too-large' };

  const wanted = Math.min(GOAL_MAX_MONTHS, Math.max(months ?? 0, horizon ?? 0, 12));
  const last = Math.min(wanted, values.length - 1);
  const path: GoalPoint[] = [];
  for (let k = 0; k <= last; k++) {
    if (k % 12 === 0 || k === months || k === last) path.push({ month: k, valueMinor: Number(metricOf(values[k] as bigint)) });
  }

  const needed = input.kind === 'value' ? target : y === null || y === 0n ? null : roundHalfUpBig(target * 120_000n, y);
  return {
    kind: 'ok',
    months,
    realReturnBps: real,
    incomeNowMinor: y === null ? null : Number(incomeOf(BigInt(input.startMinor))),
    neededMinor: needed !== null && needed <= MAX_SAFE ? Number(needed) : null,
    path,
  };
}

/** ปีปฏิทินที่ถึงเป้า = ปีของวันนี้ + k เดือน (R28) */
export function reachYear(today: string, months: number): number {
  const y = Number(today.slice(0, 4));
  const m0 = Number(today.slice(5, 7)) - 1;
  return y + (((m0 + months) - ((m0 + months) % 12)) / 12);
}

/** จำนวนเดือนจากเดือนของวันนี้ถึงเดือนเป้า (YYYY-MM) · ย้อนหลัง = ติดลบ */
export function monthsUntil(today: string, achieveBy: string): number {
  return (Number(achieveBy.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + (Number(achieveBy.slice(5, 7)) - Number(today.slice(5, 7)));
}

/** On track = ถึงเป้าภายในเดือนที่กำหนด · ไม่ถึง/ช้ากว่า = Behind */
export function goalStatus(months: number | null, deadlineMonths: number): 'on-track' | 'behind' {
  return months !== null && months <= deadlineMonths ? 'on-track' : 'behind';
}

/**
 * ค่าเสนอเริ่มต้นของ "เงินเพิ่มต่อเดือน" (USD เซนต์) = ยอดซื้อหุ้น USD จริง 12 เดือนล่าสุด (วันที่ในช่วง (asOf − 12 เดือน, asOf]) ÷ 12 ปัดครึ่งออกจากศูนย์
 * ไม่รวมค่าธรรมเนียม ขาย ปันผล และสินทรัพย์บาท · ไม่มีรายการซื้อ = null (ผู้ใช้กรอกเอง)
 */
export function averageMonthlyBuysUsd(data: InvestmentData, asOf: string): number | null {
  const from = addMonthsClamped(asOf, -12);
  const usdIds = new Set(data.assets.filter((a) => assetCurrency(a) === 'USD').map((a) => a.id));
  let sum = 0n;
  let any = false;
  for (const t of data.trades) {
    if (t.kind !== 'buy' || !usdIds.has(t.assetId) || t.date <= from || t.date > asOf) continue;
    sum += BigInt(t.amount ?? 0);
    any = true;
  }
  if (!any) return null;
  const avg = roundHalfUpBig(sum, 12n);
  return avg <= MAX_SAFE ? Number(avg) : null;
}

/** ความคืบหน้าสู่เป้า (bps) = roundHalfUp(ปัจจุบัน x 10,000 / เป้า) · เป้า 0 = null · ไม่จำกัดที่ 100% (เกินเป้าได้) */
export function progressBps(currentMinor: number, targetMinor: number): number | null {
  if (!isMinor(currentMinor) || !isMinor(targetMinor) || targetMinor === 0) return null;
  const p = roundHalfUpBig(BigInt(currentMinor) * 10_000n, BigInt(targetMinor));
  return p <= MAX_SAFE ? Number(p) : null;
}
