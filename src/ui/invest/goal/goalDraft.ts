/**
 * แปลงข้อความในฟอร์ม My goal เป็นค่าเป้าหมาย (ขอบ UI · R2: แปลงข้อความเป็นหน่วยย่อยที่นี่เท่านั้น) · ข้อความ error เป็นภาษาอังกฤษ
 * ไม่มีสูตรเงิน: จำนวนเงินใช้ parseBahtToSatang (ทศนิยม 2 ตำแหน่งเหมือนกันทั้งบาท/ดอลลาร์) · เปอร์เซ็นต์ใช้ parseRateToBps · ตรวจช่วงด้วย investGoalProblem
 */
import {
  GOAL_INFLATION_MAX_BPS,
  GOAL_RETURN_MAX_BPS,
  GOAL_RETURN_MIN_BPS,
  GOAL_YEAR_MAX,
  GOAL_YEAR_MIN,
  investGoalProblem,
  monthsUntil,
  type GoalCurrency,
  type GoalKind,
  type InvestGoal,
} from '../../../domain/invest/goalProjection';
import { parseRateToBps } from '../../../domain/money/rate';
import { parseBahtToSatang, toBahtString, satang } from '../../../domain/money/satang';

export interface GoalDraft {
  kind: GoalKind;
  /** สกุลของจำนวนในฟอร์ม (สกุลที่เก็บจริง · ไม่ใช่สกุลของปุ่ม ฿/USD · R26) */
  currency: GoalCurrency;
  target: string;
  /** 1-12 */
  month: string;
  year: string;
  contribution: string;
  returnPct: string;
  inflationPct: string;
}

export type GoalFormResult = { ok: true; goal: InvestGoal } | { ok: false; errors: Partial<Record<keyof GoalDraft, string>> };

/** หน่วยย่อย → ข้อความในช่อง ("1234.50" · ไม่มีสัญลักษณ์สกุลและไม่มีจุลภาค) */
export const minorToInput = (minor: number): string => toBahtString(satang(minor)).replace(/,/g, '');

/** bps → ข้อความ % ในช่อง ("7" / "7.5" / "-2.25") ด้วยจำนวนเต็มล้วน */
export function bpsToInput(bps: number): string {
  if (bps === 0) return '0'; // กัน "-0"
  const abs = Math.abs(bps);
  const whole = (abs - (abs % 100)) / 100;
  const frac = abs % 100;
  const fracText = frac === 0 ? '' : `.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
  return `${bps < 0 ? '-' : ''}${whole}${fracText}`;
}

/** ตัวเลขไม่เกิน 2 ทศนิยม (ไม่ปัดเศษที่ผู้ใช้พิมพ์เกินให้เงียบๆ · R2) */
const MONEY_TEXT = /^[\d,]*\.?\d{0,2}$/;

function amount(text: string): number | null {
  const t = text.trim();
  if (!MONEY_TEXT.test(t) || t === '' || t === '.') return null;
  try {
    const v = parseBahtToSatang(t);
    return v >= 0 ? v : null;
  } catch {
    return null;
  }
}

export function parseGoalDraft(d: GoalDraft, today: string): GoalFormResult {
  const currency = d.currency;
  const errors: Partial<Record<keyof GoalDraft, string>> = {};

  const targetMinor = amount(d.target);
  if (targetMinor === null) errors.target = 'Enter an amount, for example 50.00';
  else if (targetMinor === 0) errors.target = 'The target must be greater than 0';

  const contributionText = d.contribution.trim();
  const contributionMinor = contributionText === '' ? 0 : amount(contributionText);
  if (contributionMinor === null) errors.contribution = 'Enter an amount, for example 200.00 (leave empty for none)';

  const yearText = d.year.trim();
  const year = /^\d{4}$/.test(yearText) ? Number(yearText) : null;
  const month = /^(?:[1-9]|1[0-2])$/.test(d.month) ? Number(d.month) : null;
  let achieveBy = '';
  if (year === null || month === null || year < GOAL_YEAR_MIN || year > GOAL_YEAR_MAX) errors.year = `Enter a year between ${GOAL_YEAR_MIN} and ${GOAL_YEAR_MAX}`;
  else {
    achieveBy = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    if (monthsUntil(today, achieveBy) < 0) errors.year = 'Choose this month or a later one';
  }

  const returnBps = parseRateToBps(d.returnPct);
  if (returnBps === null) errors.returnPct = 'Enter a yearly return as a percentage, for example 7 or 7.5';
  else if (returnBps < GOAL_RETURN_MIN_BPS || returnBps > GOAL_RETURN_MAX_BPS) errors.returnPct = `Enter a yearly return from ${GOAL_RETURN_MIN_BPS / 100}% to ${GOAL_RETURN_MAX_BPS / 100}%`;

  const inflationText = d.inflationPct.trim();
  const inflationBps = inflationText === '' ? 0 : parseRateToBps(inflationText);
  if (inflationBps === null) errors.inflationPct = 'Enter inflation as a percentage, for example 2.5 (leave empty for none)';
  else if (inflationBps < 0 || inflationBps > GOAL_INFLATION_MAX_BPS) errors.inflationPct = `Enter inflation from 0% to ${GOAL_INFLATION_MAX_BPS / 100}%`;

  if (Object.keys(errors).length > 0 || targetMinor === null || contributionMinor === null || returnBps === null || inflationBps === null) return { ok: false, errors };
  const goal: InvestGoal = { kind: d.kind, targetMinor, contributionMinor, achieveBy, returnBps, inflationBps, currency };
  const problem = investGoalProblem(goal);
  return problem === null ? { ok: true, goal } : { ok: false, errors: { target: 'These values are out of range' } };
}

/** วันที่เริ่มต้นของ "Achieve by" เมื่อยังไม่เคยตั้ง = ธันวาคมของ 10 ปีข้างหน้า */
export function defaultAchieve(today: string): { month: string; year: string } {
  return { month: '12', year: String(Number(today.slice(0, 4)) + 10) };
}

/** เป้าที่บันทึกไว้ → ค่าในฟอร์ม: แสดงจำนวนและสกุลที่เก็บจริง ไม่แปลงตามปุ่ม ฿/USD (R26 · กด Save โดยไม่แก้ต้องไม่เปลี่ยนค่าที่เก็บ) */
export function draftFromGoal(goal: InvestGoal): GoalDraft {
  return {
    kind: goal.kind,
    currency: goal.currency,
    target: minorToInput(goal.targetMinor),
    month: String(Number(goal.achieveBy.slice(5, 7))),
    year: goal.achieveBy.slice(0, 4),
    contribution: minorToInput(goal.contributionMinor),
    returnPct: bpsToInput(goal.returnBps),
    inflationPct: goal.inflationBps === 0 ? '' : bpsToInput(goal.inflationBps),
  };
}
