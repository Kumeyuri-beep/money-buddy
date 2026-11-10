import { addDays, effectiveNextPayday } from '../domain/bills/calendar';
import { computeSafeToSpend } from '../domain/bills/safeToSpend';
import { outstandingTotal, splitValidBills, upcomingBills } from '../domain/bills/schedule';
import type { FinanceSettings } from '../domain/bills/settings';
import type { Bill, UpcomingBill } from '../domain/bills/types';
import { periodTotals } from '../domain/ledger/balance';
import { cashBalance } from '../domain/ledger/overview';
import type { Account, Entry } from '../domain/ledger/types';

/** ข้อมูลบิลและค่าตั้งค่าที่หน้าภาพรวมใช้ (ไม่มีสูตรเงินในที่นี้ เรียก domain เท่านั้น) */
export interface FinanceInput {
  bills: readonly Bill[];
  settings: FinanceSettings;
}

/** เตือนเมื่อเหลือน้อยกว่านี้ (วัน) ก่อนเงินเดือนถัดไป ตัวเลขต่อวันอาจไม่สมจริง */
export const LOW_DAYS_THRESHOLD = 3;
/** ไม่ตั้งวันเงินเดือน: แผงบิลมองล่วงหน้ากี่วัน */
const UPCOMING_LOOKAHEAD_DAYS = 30;
const UPCOMING_MAX_SHOWN = 5;

export type SafeToSpendState =
  | { kind: 'needs-setup' }
  | { kind: 'error'; message: string }
  | {
      kind: 'value';
      /** ใช้ได้ต่อวัน (สตางค์ ไม่ติดลบ) */
      perDay: number;
      daysLeft: number;
      nextPayday: string;
      /** ยอดที่ใช้ได้รวมหลังหักบิลและเงินสำรอง (ติดลบได้) */
      available: number;
      outstanding: number;
      reserve: number;
      /** ยอดที่ขาด (สตางค์ บวก) 0 = ไม่ขาด */
      shortfall: number;
      lowDays: boolean;
      /** จำนวนบิลข้อมูลผิดที่ถูกข้าม (ยอดอาจไม่ครบ) */
      invalidBills: number;
      /** ใช้วันเงินเดือนถัดไปที่ผู้ใช้กำหนดเอง */
      overridden: boolean;
    };

function errorMessage(e: unknown): string {
  return e instanceof RangeError ? e.message : 'คำนวณไม่สำเร็จ ตรวจข้อมูลบิลและค่าตั้งค่า';
}

/**
 * การ์ด SAFE-TO-SPEND (R15): (ยอดกระเป๋า − บิลค้างก่อนเงินเดือนถัดไป − เป้าออม) ÷ วันที่เหลือ
 * ยังไม่ตั้งวันเงินเดือน = needs-setup · ข้อมูลเสียจนคำนวณไม่ได้ = error (ไม่ throw ใส่หน้าจอ) · บิลผิดรูปถูกข้ามและนับไว้เตือน
 */
export function buildSafeToSpend(
  accounts: readonly Account[],
  entries: readonly Entry[],
  finance: FinanceInput,
  today: string,
): SafeToSpendState {
  const { settings } = finance;
  if (settings.payDay === undefined) return { kind: 'needs-setup' };
  try {
    const { valid, invalid } = splitValidBills(finance.bills);
    const next = effectiveNextPayday(settings.payDay, today, settings.nextPaydayOverride);
    const outstanding = outstandingTotal(upcomingBills(valid, today, next));
    const result = computeSafeToSpend({
      spendable: cashBalance(accounts, entries, today),
      outstanding,
      reserve: settings.monthlySavingsGoal ?? 0,
      today,
      payDay: settings.payDay,
      ...(settings.nextPaydayOverride !== undefined ? { nextPaydayOverride: settings.nextPaydayOverride } : {}),
    });
    return {
      kind: 'value',
      perDay: result.perDay,
      daysLeft: result.daysLeft,
      nextPayday: result.nextPayday,
      available: result.available,
      outstanding,
      reserve: settings.monthlySavingsGoal ?? 0,
      shortfall: result.kind === 'shortfall' ? result.shortfall : 0,
      lowDays: result.daysLeft < LOW_DAYS_THRESHOLD,
      invalidBills: invalid.length,
      overridden: settings.nextPaydayOverride !== undefined && settings.nextPaydayOverride === result.nextPayday,
    };
  } catch (e) {
    return { kind: 'error', message: errorMessage(e) };
  }
}

export interface OutgoingSplit {
  /** รายจ่ายเดือนนี้ทั้งหมด (สตางค์) */
  total: number;
  /** ส่วนที่เป็นการจ่ายบิลประจำ (รายการ source recurring) */
  bills: number;
  /** ส่วนที่เหลือ = total − bills */
  spend: number;
  /** null = ยังไม่ตั้งเป้างบ */
  budget: null | { limit: number; remaining: number; over: number };
}

/** รายจ่ายของเดือนนี้ (นับถึงวันนี้) แยกบิล/ใช้จ่าย และเทียบเป้างบ · รายจ่ายนับตาม R4 เหมือนการ์ดอื่น */
export function buildOutgoingSplit(
  accounts: readonly Account[],
  entries: readonly Entry[],
  settings: FinanceSettings,
  today: string,
): OutgoingSplit {
  const range = { from: `${today.slice(0, 7)}-01`, to: today };
  // รายจ่ายสุทธิ (หักรายการคืนเงิน) ติดลบ = แสดงเป็น 0 เหมือน Sankey ไม่แสดงรายจ่ายติดลบ
  const total = Math.max(0, periodTotals(accounts, entries, range, 'THB').expense);
  const recurring = entries.filter((e) => e.source === 'recurring');
  // รายจ่ายของรายการจ่ายบิล คิดด้วย periodTotals ชุดเดียวกัน บิล + ใช้จ่าย = รวมเสมอ (R4) ส่วนบิลไม่เกินรวมและไม่ติดลบ
  const bills = Math.min(total, Math.max(0, periodTotals(accounts, recurring, range, 'THB').expense));
  const limit = settings.monthlyBudget;
  return {
    total,
    bills,
    spend: total - bills,
    budget:
      limit === undefined ? null : { limit, remaining: Math.max(0, limit - total), over: Math.max(0, total - limit) },
  };
}

export type UpcomingPanel =
  | { kind: 'no-bills' }
  /** มีบิลแต่ไม่มีที่ต้องจ่ายในช่วงที่ดู */
  | { kind: 'clear'; invalidBills: number }
  | { kind: 'error'; message: string }
  | {
      kind: 'list';
      items: UpcomingBill[];
      /** บิลที่ไม่ได้แสดง (เกินจำนวนที่แสดงได้) */
      hidden: number;
      /** ยอดรวมทุกบิลในช่วง รวมที่ซ่อน (สตางค์) */
      total: number;
      /** วันสุดท้ายของช่วงที่ดู */
      until: string;
      invalidBills: number;
    };

/** แผง "บิลที่จะถึง": ถึงก่อนเงินเดือนถัดไป (ตั้งไว้) หรือ 30 วันข้างหน้า (ยังไม่ตั้ง) เรียงเลยกำหนดก่อน */
export function buildUpcomingPanel(finance: FinanceInput, today: string): UpcomingPanel {
  if (finance.bills.filter((b) => b.archived !== true).length === 0) return { kind: 'no-bills' };
  try {
    const { valid, invalid } = splitValidBills(finance.bills);
    const { payDay, nextPaydayOverride } = finance.settings;
    const until =
      payDay !== undefined
        ? effectiveNextPayday(payDay, today, nextPaydayOverride) /* รวมวันเงินเดือน (R15) */
        : addDays(today, UPCOMING_LOOKAHEAD_DAYS);
    const all = upcomingBills(valid, today, until);
    if (all.length === 0) return { kind: 'clear', invalidBills: invalid.length };
    return {
      kind: 'list',
      items: all.slice(0, UPCOMING_MAX_SHOWN),
      hidden: Math.max(0, all.length - UPCOMING_MAX_SHOWN),
      total: outstandingTotal(all),
      until,
      invalidBills: invalid.length,
    };
  } catch (e) {
    return { kind: 'error', message: errorMessage(e) };
  }
}
