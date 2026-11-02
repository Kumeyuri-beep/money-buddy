import { roundHalfUp } from '../money/round';
import { indexAccounts } from './entry';
import { naturalBalance, periodTotals } from './balance';
import type { Account, Entry } from './types';

/**
 * ฟังก์ชันสรุปภาพรวมสำหรับการ์ดหน้าแรก (ดีไซน์ A)
 * - ยอดเงินเป็นสตางค์จำนวนเต็มเสมอ, ร้อยละเป็น basis points จำนวนเต็ม (1% = 100) ไม่ใช้ float (R1)
 * - เฉพาะสกุลเงิน THB ไม่บวกต่างสกุลเงิน (R3/R10)
 * - รายรับ/รายจ่ายมาจาก periodTotals เท่านั้น จึงไม่นับ Transfer/เงินต้นหนี้/ยอดยกมา (R4)
 * - ไม่แตะ DOM หรือฐานข้อมูล
 */

const CURRENCY = 'THB';
const BPS = 10000;
const MAX_CASH_HISTORY_MONTHS = 3;
const MAX_SERIES_POINTS = 12;

/** ตัวตั้ง ÷ ตัวหาร เป็น basis points ปัดครึ่งออกจากศูนย์ (R8) ตัวหาร 0 หรือยอดใหญ่เกินช่วงปลอดภัยจะ throw RangeError */
export function ratioBps(numerator: number, denominator: number): number {
  return roundHalfUp(numerator * BPS, denominator);
}

/** 'YYYY-MM' ของ 'YYYY-MM-DD' */
function monthOf(date: string): string {
  return date.slice(0, 7);
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + delta;
  const year = Math.floor(index / 12);
  const mm = String((index % 12) + 1).padStart(2, '0');
  return `${year}-${mm}`;
}

/** วันสุดท้ายที่เป็นไปได้ของเดือน (เปรียบเทียบเป็นข้อความ ใช้ 31 ได้เพราะไม่มีวันที่เกิน) */
function monthEnd(month: string): string {
  return `${month}-31`;
}

function monthRange(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: monthEnd(month) };
}

function entriesUpTo(entries: readonly Entry[], date: string): Entry[] {
  return entries.filter((entry) => entry.date <= date);
}

function earliestDate(entries: readonly Entry[]): string | null {
  let first: string | null = null;
  for (const entry of entries) {
    if (first === null || entry.date < first) first = entry.date;
  }
  return first;
}

function sumNatural(accountList: readonly Account[], entries: readonly Entry[]): number {
  let total = 0;
  for (const account of accountList) total += naturalBalance(account, entries);
  return total;
}

/** มูลค่าสุทธิ ณ สิ้นวัน = Σ asset − Σ liability (THB, รวมกระเป๋าที่เก็บถาวรที่ยังมีเงิน) */
export function netWorthAt(accounts: readonly Account[], entries: readonly Entry[], date: string): number {
  const upTo = entriesUpTo(entries, date);
  const thb = accounts.filter((a) => a.currency === CURRENCY);
  const assets = sumNatural(
    thb.filter((a) => a.type === 'asset'),
    upTo,
  );
  const liabilities = sumNatural(
    thb.filter((a) => a.type === 'liability'),
    upTo,
  );
  return assets - liabilities;
}

/** เงินสด = Σ ยอดบัญชี asset THB ที่ไม่ถูกเก็บถาวร ณ สิ้นวัน */
export function cashBalance(accounts: readonly Account[], entries: readonly Entry[], date: string): number {
  const upTo = entriesUpTo(entries, date);
  return sumNatural(
    accounts.filter((a) => a.type === 'asset' && a.currency === CURRENCY && !a.archived),
    upTo,
  );
}

export interface NetWorthPoint {
  month: string;
  value: number;
}

/**
 * มูลค่าสุทธิสิ้นเดือน เริ่มที่เดือนของรายการแรก ถึงเดือนของ asOf (จุดสุดท้ายนับถึง asOf ไม่ใช่สิ้นเดือน)
 * ได้ไม่เกิน 12 จุดล่าสุด
 */
export function netWorthMonthlySeries(
  accounts: readonly Account[],
  entries: readonly Entry[],
  asOf: string,
): NetWorthPoint[] {
  const first = earliestDate(entries);
  if (first === null || first > asOf) return [];
  const lastMonth = monthOf(asOf);
  const months: string[] = [];
  for (let m = monthOf(first); m <= lastMonth; m = shiftMonth(m, 1)) months.push(m);
  return months.slice(-MAX_SERIES_POINTS).map((month) => ({
    month,
    value: netWorthAt(accounts, entries, month === lastMonth ? asOf : monthEnd(month)),
  }));
}

function monthExpense(accounts: readonly Account[], entries: readonly Entry[], month: string): number {
  return periodTotals(accounts, entries, monthRange(month), CURRENCY).expense;
}

/** จำนวนวันของเดือน 'YYYY-MM' (รวมปีอธิกสุรทิน) */
function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * รายจ่ายตั้งแต่วันที่ 1 ถึงวันที่ asOf ของเดือนนี้ เทียบ "ช่วงเดียวกัน" ของเดือนก่อน เป็น bps (ลดลง = ติดลบ)
 * เดือนก่อนสั้นกว่าให้ตัดที่วันสุดท้ายของเดือนนั้น (เช่น 31 มี.ค. เทียบ 1-28 ก.พ.)
 * ช่วงเดียวกันของเดือนก่อนไม่มีรายจ่ายสุทธิ (0 หรือติดลบ) = null
 */
export function monthOverMonth(
  accounts: readonly Account[],
  entries: readonly Entry[],
  asOf: string,
): number | null {
  const month = monthOf(asOf);
  const prevMonth = shiftMonth(month, -1);
  const day = Number(asOf.slice(8, 10));
  const prevDay = String(Math.min(day, daysInMonth(prevMonth))).padStart(2, '0');
  const previous = periodTotals(accounts, entries, { from: `${prevMonth}-01`, to: `${prevMonth}-${prevDay}` }, CURRENCY).expense;
  if (previous <= 0) return null; // 0 หรือติดลบ (เครดิตคืนเกินรายจ่าย) เทียบเป็นร้อยละไม่มีความหมาย
  const current = periodTotals(accounts, entries, { from: `${month}-01`, to: asOf }, CURRENCY).expense;
  return ratioBps(current - previous, previous);
}

/** อัตราออม = เหลือสุทธิ ÷ รายรับ เป็น bps ติดลบได้ รายรับ 0 = null */
export function savingsRate(income: number, net: number): number | null {
  if (income <= 0) return null;
  return ratioBps(net, income);
}

/** ส่วนต่างมูลค่าสุทธิจุดสุดท้ายเทียบจุดก่อนหน้า (สตางค์) ไม่มีจุดก่อนหน้า = null */
export function netWorthDelta(series: readonly NetWorthPoint[]): number | null {
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last === undefined || prev === undefined) return null;
  return last.value - prev.value;
}

/**
 * รายจ่ายของเดือนที่ "ครบสมบูรณ์" ล่าสุดไม่เกิน 3 เดือนที่มีรายจ่าย เรียงเก่า→ใหม่
 * - ไม่นับเดือนของ asOf (ยังไม่จบ)
 * - เดือนของรายการแรกถือว่าครบก็ต่อเมื่อรายการแรกอยู่วันที่ 1 (ไม่งั้นเริ่มใช้กลางเดือน ข้อมูลไม่ครบ)
 * - เดือนที่ไม่มีรายจ่ายถูกข้าม เพื่อไม่ดึงค่าเฉลี่ยให้ต่ำเกินจริง
 */
export function completedMonthExpenses(
  accounts: readonly Account[],
  entries: readonly Entry[],
  asOf: string,
): number[] {
  const first = earliestDate(entries);
  if (first === null) return [];
  const firstMonth = monthOf(first);
  const startMonth = first.endsWith('-01') ? firstMonth : shiftMonth(firstMonth, 1);
  const result: number[] = [];
  for (let m = shiftMonth(monthOf(asOf), -1); m >= startMonth; m = shiftMonth(m, -1)) {
    const expense = monthExpense(accounts, entries, m);
    if (expense > 0) result.unshift(expense);
    if (result.length === MAX_CASH_HISTORY_MONTHS) break;
  }
  return result;
}

/**
 * runway เป็น "เดือน ×10" จำนวนเต็ม = เงินสด ÷ ค่าใช้จ่ายเฉลี่ยต่อเดือน
 * ไม่มีประวัติ/รายจ่ายรวม 0 = null · เงินสดติดลบแสดง 0 (ไม่แสดงเดือนติดลบ)
 */
export function runwayTenths(cash: number, monthlyExpenses: readonly number[]): number | null {
  const count = monthlyExpenses.length;
  const total = monthlyExpenses.reduce((sum, v) => sum + v, 0);
  if (count === 0 || total === 0) return null;
  if (cash <= 0) return 0;
  return roundHalfUp(cash * 10 * count, total);
}

export interface IncomeChannels {
  /** จำนวนบัญชีรายรับที่มียอดสุทธิ > 0 ในเดือน */
  count: number;
  topWalletId: string | null;
  topWalletAmount: number;
}

/** ช่องทางรายรับของเดือน และกระเป๋าที่รับเงินจากรายรับมากสุด (เท่ากันเลือกตามลำดับบัญชี) */
export function incomeChannels(
  accounts: readonly Account[],
  entries: readonly Entry[],
  month: string,
): IncomeChannels {
  const byId = indexAccounts(accounts);
  const { from, to } = monthRange(month);
  const incomeNet = new Map<string, number>();
  const walletIn = new Map<string, number>();

  for (const entry of entries) {
    if (entry.date < from || entry.date > to) continue;
    let touchesIncome = false;
    for (const line of entry.lines) {
      const account = byId.get(line.accountId);
      if (account?.type === 'income' && account.currency === CURRENCY) {
        touchesIncome = true;
        incomeNet.set(account.id, (incomeNet.get(account.id) ?? 0) - line.amount);
      }
    }
    if (!touchesIncome) continue;
    for (const line of entry.lines) {
      const account = byId.get(line.accountId);
      if (account?.type === 'asset' && account.currency === CURRENCY) {
        walletIn.set(account.id, (walletIn.get(account.id) ?? 0) + line.amount);
      }
    }
  }

  let count = 0;
  for (const net of incomeNet.values()) if (net > 0) count += 1;

  const order = (id: string) => byId.get(id)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
  let topWalletId: string | null = null;
  let topWalletAmount = 0;
  for (const [id, amount] of walletIn) {
    if (amount <= 0) continue; // ยอดสุทธิจากรายรับต้องเป็นบวก (กลับรายการแล้วไม่นับ)
    if (amount > topWalletAmount || (amount === topWalletAmount && topWalletId !== null && order(id) < order(topWalletId))) {
      topWalletId = id;
      topWalletAmount = amount;
    }
  }
  return { count, topWalletId, topWalletAmount };
}
