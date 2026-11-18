/**
 * มุมมองของหน้า My goal (R26, R28) · ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล
 * ไม่มีสูตรเงินใหม่: ประมาณการมาจาก src/domain/invest/goalProjection · แปลงสกุลมาจาก displayCurrency (R26) · ที่นี่มีแค่การประกอบอินพุต
 * และเรขาคณิตของกราฟ (ตำแหน่งพิกเซลและป้ายแกน ซึ่งเป็นการแสดงผล ไม่ใช่ยอดเงิน)
 * ข้อมูลไม่ครบ = สถานะ "needs" พร้อมเหตุผล (ห้ามเดา · ห้ามใช้ต้นทุนแทนมูลค่าตลาด)
 */
import { toDisplayMinor, type DisplayCurrency } from '../../../domain/invest/displayCurrency';
import {
  averageMonthlyBuysUsd,
  goalStatus,
  monthsUntil,
  progressBps,
  projectGoal,
  reachYear,
  type GoalNa,
  type GoalPoint,
  type InvestGoal,
} from '../../../domain/invest/goalProjection';
import type { InvestmentData } from '../../../domain/invest/types';
import { roundHalfUpBig } from '../../../domain/money/round';
import type { DashboardView } from '../dashboard/dashboardView';

export interface GoalContext {
  /** มูลค่าตลาดของที่ถือ ในสกุลที่แสดง · null = ไม่ครบ (ไม่มีราคา/เรต) */
  startMinor: number | null;
  /** yield ปันผลต่อปี (bps · R25.2) · null = ไม่มีข้อมูล */
  yieldBps: number | null;
  /** เรตล่าสุดที่กรอก (R26) · null = ไม่มี */
  rateMicro: number | null;
  /** ค่าเสนอเงินเพิ่มต่อเดือนจากรายการซื้อจริง ในสกุลที่แสดง · null = ไม่มี (หรือไม่มีเรต) */
  suggestedContributionMinor: number | null;
}

export function buildGoalContext(view: DashboardView, data: InvestmentData, today: string, currency: DisplayCurrency): GoalContext {
  const rateMicro = view.fxText?.rateMicro ?? null;
  const avgUsd = averageMonthlyBuysUsd(data, today);
  let suggested: number | null = null;
  try {
    suggested = avgUsd === null ? null : toDisplayMinor('USD', avgUsd, currency, rateMicro);
  } catch (e) {
    if (!(e instanceof RangeError)) throw e; // เกินช่วงปลอดภัย = ไม่เสนอค่า
  }
  return {
    startMinor: currency === 'THB' ? view.valueThb : view.valueUsd,
    yieldBps: view.dividend.yieldBps,
    rateMicro,
    suggestedContributionMinor: suggested,
  };
}

export type GoalAmounts = { kind: 'ok'; targetMinor: number; contributionMinor: number } | { kind: 'needs-rate' } | { kind: 'too-large' };

/**
 * จำนวนเงินที่ผู้ใช้ตั้งไว้ (สกุลที่กรอก) → สกุลที่แสดงตอนนี้ (R26 · ปัดครั้งเดียวต่อค่า)
 * ไม่มีเรต = needs-rate (Needs rate) · เกินช่วงปลอดภัยหลังแปลง = too-large (ไม่ปัดเงียบ ไม่ใช้เรตเก่า)
 */
export function goalAmountsForDisplay(goal: InvestGoal, currency: DisplayCurrency, rateMicro: number | null): GoalAmounts {
  try {
    const target = toDisplayMinor(goal.currency, goal.targetMinor, currency, rateMicro);
    const contribution = toDisplayMinor(goal.currency, goal.contributionMinor, currency, rateMicro);
    return target === null || contribution === null ? { kind: 'needs-rate' } : { kind: 'ok', targetMinor: target, contributionMinor: contribution };
  } catch (e) {
    if (e instanceof RangeError) return { kind: 'too-large' };
    throw e;
  }
}

export type GoalNeeds = 'rate' | 'value' | 'yield';

export type GoalOutcome =
  | { state: 'needs'; needs: GoalNeeds }
  | { state: 'invalid'; reason: Extract<GoalNa, 'invalid' | 'too-large'> }
  | {
      state: 'ok';
      status: 'on-track' | 'behind';
      /** เดือนที่ถึงเป้า (null = ไม่ถึงภายใน 100 ปี) */
      months: number | null;
      year: number | null;
      /** เดือนที่เหลือถึงวันที่ตั้งไว้ลบด้วยเดือนที่ถึงเป้า (บวก = ถึงก่อนกำหนด) */
      slackMonths: number | null;
      deadlineMonths: number;
      nowMinor: number;
      progressBps: number | null;
      neededMinor: number | null;
      targetMinor: number;
      path: GoalPoint[];
    };

/** ประมาณการจากเป้าที่บันทึกไว้ ในสกุลที่แสดงตอนนี้ */
export function runGoal(goal: InvestGoal, ctx: GoalContext, currency: DisplayCurrency, today: string): GoalOutcome {
  const amounts = goalAmountsForDisplay(goal, currency, ctx.rateMicro);
  if (amounts.kind === 'needs-rate') return { state: 'needs', needs: 'rate' };
  if (amounts.kind === 'too-large') return { state: 'invalid', reason: 'too-large' };
  const deadlineMonths = monthsUntil(today, goal.achieveBy);
  const horizon = Math.max(deadlineMonths, 12);
  const r = projectGoal(
    { startMinor: ctx.startMinor, contributionMinor: amounts.contributionMinor, returnBps: goal.returnBps, inflationBps: goal.inflationBps, yieldBps: ctx.yieldBps, kind: goal.kind, targetMinor: amounts.targetMinor },
    { horizonMonths: horizon },
  );
  if (r.kind === 'na') {
    if (r.reason === 'no-value') return { state: 'needs', needs: 'value' };
    if (r.reason === 'no-yield') return { state: 'needs', needs: 'yield' };
    return { state: 'invalid', reason: r.reason };
  }
  const now = goal.kind === 'value' ? (ctx.startMinor as number) : (r.incomeNowMinor as number);
  return {
    state: 'ok',
    status: goalStatus(r.months, deadlineMonths),
    months: r.months,
    year: r.months === null ? null : reachYear(today, r.months),
    slackMonths: r.months === null ? null : deadlineMonths - r.months,
    deadlineMonths,
    nowMinor: now,
    progressBps: progressBps(now, amounts.targetMinor),
    neededMinor: r.neededMinor,
    targetMinor: amounts.targetMinor,
    path: r.path,
  };
}

// ───────────────────────── กราฟ (การแสดงผล) ─────────────────────────

export const CHART = { width: 640, height: 300, left: 64, right: 16, top: 16, bottom: 32 } as const;

export interface ChartGeometry {
  /** จุดของเส้นคาดการณ์ (พิกเซล) */
  line: { x: number; y: number }[];
  /** รูปปิดใต้เส้นสำหรับระบายสี */
  area: string;
  targetY: number;
  /** จุดที่ถึงเป้า */
  reach: { x: number; y: number } | null;
  /** เส้นแนวตั้งของเดือนที่ตั้งไว้ (ถ้าอยู่ในช่วงกราฟ) */
  deadlineX: number | null;
  yTicks: { y: number; valueMinor: number }[];
  xTicks: { x: number; label: string }[];
}

/** ค่าแกน Y ตัดเป็นหน่วยเต็มของสกุล (ป้ายแกนเท่านั้น): ปัดครึ่งออกจากศูนย์ด้วยตัวปัดกลาง */
export const wholeUnits = (minor: number): string => roundHalfUpBig(BigInt(minor), 100n).toLocaleString('en-US');

export function chartGeometry(outcome: Extract<GoalOutcome, { state: 'ok' }>, today: string): ChartGeometry {
  const { width, height, left, right, top, bottom } = CHART;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const lastMonth = Math.max(outcome.path[outcome.path.length - 1]?.month ?? 12, 1);
  const maxValue = Math.max(outcome.targetMinor, ...outcome.path.map((p) => p.valueMinor), 1);
  const xOf = (month: number): number => left + (month / lastMonth) * innerW;
  const yOf = (value: number): number => top + innerH - (value / maxValue) * innerH;
  const line = outcome.path.map((p) => ({ x: xOf(p.month), y: yOf(p.valueMinor) }));
  const baseY = yOf(0);
  const first = line[0];
  const last = line[line.length - 1];
  const area = first && last ? `M${first.x},${baseY} ${line.map((p) => `L${p.x},${p.y}`).join(' ')} L${last.x},${baseY} Z` : '';
  const yTicks = [0, 1, 2, 3, 4].map((i) => {
    const valueMinor = Number(roundHalfUpBig(BigInt(maxValue) * BigInt(i), 4n));
    return { y: yOf(valueMinor), valueMinor };
  });
  // ป้ายปี: ทุกจุดของเส้น (ทุก 12 เดือน) แต่ไม่เกิน ~8 ป้ายเพื่อไม่ให้ทับกัน
  const yearPoints = outcome.path.filter((p) => p.month % 12 === 0);
  const stride = Math.max(1, Math.ceil(yearPoints.length / 8));
  const xTicks = yearPoints.filter((_, i) => i % stride === 0).map((p) => ({ x: xOf(p.month), label: String(reachYear(today, p.month)) }));
  const reachPoint = outcome.months === null ? null : outcome.path.find((p) => p.month === outcome.months);
  return {
    line,
    area,
    targetY: yOf(outcome.targetMinor),
    reach: reachPoint ? { x: xOf(reachPoint.month), y: yOf(reachPoint.valueMinor) } : null,
    deadlineX: outcome.deadlineMonths >= 0 && outcome.deadlineMonths <= lastMonth ? xOf(outcome.deadlineMonths) : null,
    yTicks,
    xTicks,
  };
}
