import { roundHalfUp } from '../money/round';
import { indexAccounts } from './entry';
import type { Account, Entry } from './types';

/**
 * ข้อมูล Cash Flow แบบ Sankey 3 คอลัมน์ (ดีไซน์ A, Ticket A4)
 *   แหล่งรายรับ -> งบรวม -> หมวดรายจ่าย + เหลือเก็บ
 *
 * - ทุกยอดเป็นสตางค์จำนวนเต็ม (R1) ร้อยละ (`shareBps`) ใช้แสดงผลเท่านั้น ไม่ใช้คำนวณยอด (R8)
 * - รายรับ = เครดิตบัญชี income, รายจ่าย = เดบิตบัญชี expense เฉพาะ THB จึงไม่นับ Transfer/เงินต้นหนี้/ยอดยกมา (R4)
 * - ผลรวมฝั่งซ้าย = ผลรวมฝั่งขวา = `total` พอดี การรวมหมวดเป็น "อื่นๆ" ใช้การบวกสตางค์ ไม่ปัดเศษ
 * - ไม่แตะ DOM หรือฐานข้อมูล
 */

const CURRENCY = 'THB';
/** หมวดที่น้อยกว่า 4% ของยอดรวมกระแสเงิน (1/25) รวมเป็น "อื่นๆ" */
const MERGE_BELOW_DENOMINATOR = 25n;
const MAX_NAMED_CATEGORIES = 5;
const OTHER_NAME = 'อื่นๆ';
const BPS = 10000;

export type FlowNodeKind = 'income' | 'shortfall' | 'expense' | 'other' | 'leftover';

export interface FlowNode {
  key: string;
  name: string;
  /** สตางค์ มากกว่า 0 เสมอ */
  amount: number;
  /** สัดส่วนของ `total` เป็น basis points ปัดด้วย roundHalfUp (ใช้แสดงผลเท่านั้น) */
  shareBps: number;
  kind: FlowNodeKind;
}

export interface CashFlow {
  month: string;
  hasData: boolean;
  /** รายรับรวมของเดือน (ไม่รวมส่วน "ใช้เงินเก็บ (เกินรายรับ)") */
  income: number;
  /** รายจ่ายรวมของเดือน */
  expense: number;
  /** ยอดรวมของกระแส = max(รายรับ, รายจ่าย) ใช้เป็นฐานของแท่งกลาง */
  total: number;
  /** คอลัมน์ซ้าย: แหล่งรายรับ (มาก -> น้อย) และ "ใช้เงินเก็บ (เกินรายรับ)" ถ้ารายจ่ายมากกว่ารายรับ */
  sources: FlowNode[];
  /** คอลัมน์ขวา: หมวดรายจ่าย (มาก -> น้อย) ตามด้วย "อื่นๆ" และ "เหลือเก็บ" */
  categories: FlowNode[];
  /** เหลือเก็บ = max(0, รายรับ − รายจ่าย) */
  leftover: number;
  /** ใช้เกินรายรับ = max(0, รายจ่าย − รายรับ) */
  shortfall: number;
}

function monthOf(date: string): string {
  return date.slice(0, 7);
}

function share(amount: number, total: number): number {
  return roundHalfUp(amount * BPS, total);
}

/** ช่วงวันที่ของเดือน ถ้ามี asOf ที่อยู่ในเดือนนั้นให้ตัดที่ asOf (ตามนิยาม "เดือนนี้นับถึงวันนี้") */
function rangeOf(month: string, asOf?: string): { from: string; to: string } {
  const end = `${month}-31`;
  return { from: `${month}-01`, to: asOf !== undefined && asOf < end ? asOf : end };
}

interface Totals {
  income: Map<string, number>;
  expense: Map<string, number>;
}

function sumByAccount(
  accounts: readonly Account[],
  entries: readonly Entry[],
  range: { from: string; to: string },
): Totals {
  const byId = indexAccounts(accounts);
  const income = new Map<string, number>();
  const expense = new Map<string, number>();
  for (const entry of entries) {
    if (entry.date < range.from || entry.date > range.to) continue;
    for (const line of entry.lines) {
      const account = byId.get(line.accountId);
      if (!account || account.currency !== CURRENCY) continue;
      if (account.type === 'income') income.set(account.id, (income.get(account.id) ?? 0) - line.amount);
      else if (account.type === 'expense') expense.set(account.id, (expense.get(account.id) ?? 0) + line.amount);
    }
  }
  return { income, expense };
}

interface Bucket {
  id: string;
  name: string;
  amount: number;
}

function byAmountDesc(a: Bucket, b: Bucket): number {
  return b.amount - a.amount || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : 1);
}

/**
 * แท่งของแต่ละบัญชีเรียงมาก -> น้อย (เท่ากันเรียงตามชื่อแล้ว id เพื่อให้ผลคงที่)
 * บัญชีที่ยอดสุทธิติดลบ (เช่น คืนเงินข้ามเดือน) ไม่วาดเป็นแท่งลบ แต่นำไปหักจากแท่งที่ใหญ่สุดก่อน
 * ผลรวมจึงเท่ากับยอดสุทธิของ periodTotals (กฎ R4) ยกเว้นกรณีสุทธิรวมติดลบทั้งหมดที่ปัดเป็น 0
 */
function netBuckets(byId: ReadonlyMap<string, Account>, sums: ReadonlyMap<string, number>): Bucket[] {
  let buckets: Bucket[] = [];
  let credit = 0;
  for (const [id, amount] of sums) {
    if (amount > 0) buckets.push({ id, name: byId.get(id)?.name ?? id, amount });
    else if (amount < 0) credit += -amount;
  }
  buckets.sort(byAmountDesc);
  if (credit > 0) {
    buckets = buckets
      .map((b) => {
        const take = Math.min(credit, b.amount);
        credit -= take;
        return { ...b, amount: b.amount - take };
      })
      .filter((b) => b.amount > 0)
      .sort(byAmountDesc);
  }
  return buckets;
}

const EMPTY = (month: string): CashFlow => ({
  month,
  hasData: false,
  income: 0,
  expense: 0,
  total: 0,
  sources: [],
  categories: [],
  leftover: 0,
  shortfall: 0,
});

/**
 * สร้างข้อมูล Sankey ของเดือน `month` ('YYYY-MM')
 * `asOf` (YYYY-MM-DD) ถ้าอยู่ในเดือนนี้จะนับถึงวันนั้น รายการลงวันล่วงหน้าไม่นับ
 */
export function buildCashFlow(
  accounts: readonly Account[],
  entries: readonly Entry[],
  month: string,
  asOf?: string,
): CashFlow {
  const byId = indexAccounts(accounts);
  const sums = sumByAccount(accounts, entries, rangeOf(month, asOf));
  const incomes = netBuckets(byId, sums.income);
  const expenses = netBuckets(byId, sums.expense);

  const income = incomes.reduce((s, b) => s + b.amount, 0);
  const expense = expenses.reduce((s, b) => s + b.amount, 0);
  if (income === 0 && expense === 0) return EMPTY(month);

  const total = Math.max(income, expense);
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(total * BPS)) {
    throw new RangeError('buildCashFlow: ยอดรวมใหญ่เกินช่วงปลอดภัย');
  }

  const sources: FlowNode[] = incomes.map((b) => ({
    key: `income:${b.id}`,
    name: b.name,
    amount: b.amount,
    shareBps: share(b.amount, total),
    kind: 'income',
  }));
  if (expense > income) {
    const gap = expense - income;
    sources.push({ key: 'shortfall', name: 'ใช้เงินเก็บ (เกินรายรับ)', amount: gap, shareBps: share(gap, total), kind: 'shortfall' });
  }

  // หมวดที่ต้องรวมเป็น "อื่นๆ": น้อยกว่า 4% ของ total, บัญชีที่ชื่อ "อื่นๆ", และหมวดที่เกินอันดับ 5
  const named: Bucket[] = [];
  let otherAmount = 0;
  let otherCount = 0;
  for (const b of expenses) {
    const belowThreshold = BigInt(b.amount) * MERGE_BELOW_DENOMINATOR < BigInt(total);
    if (belowThreshold || b.name === OTHER_NAME || named.length >= MAX_NAMED_CATEGORIES) {
      otherAmount += b.amount;
      otherCount += 1;
    } else {
      named.push(b);
    }
  }

  const categories: FlowNode[] = named.map((b) => ({
    key: `expense:${b.id}`,
    name: b.name,
    amount: b.amount,
    shareBps: share(b.amount, total),
    kind: 'expense',
  }));
  if (otherCount > 0) {
    categories.push({ key: 'other', name: OTHER_NAME, amount: otherAmount, shareBps: share(otherAmount, total), kind: 'other' });
  }
  if (income > expense) {
    const left = income - expense;
    categories.push({ key: 'leftover', name: 'เหลือเก็บ', amount: left, shareBps: share(left, total), kind: 'leftover' });
  }

  return {
    month,
    hasData: true,
    income,
    expense,
    total,
    sources,
    categories,
    leftover: Math.max(0, income - expense),
    shortfall: Math.max(0, expense - income),
  };
}

/** เดือน ('YYYY-MM') ที่มีรายรับหรือรายจ่ายสุทธิ THB มากกว่า 0 เรียงใหม่ -> เก่า (ตรงกับ hasData ของ buildCashFlow) */
export function cashFlowMonths(accounts: readonly Account[], entries: readonly Entry[]): string[] {
  const byId = indexAccounts(accounts);
  const candidates = new Set<string>();
  for (const entry of entries) {
    for (const line of entry.lines) {
      const account = byId.get(line.accountId);
      if (account && account.currency === CURRENCY && (account.type === 'income' || account.type === 'expense')) {
        candidates.add(monthOf(entry.date));
        break;
      }
    }
  }
  return [...candidates]
    .filter((m) => {
      const sums = sumByAccount(accounts, entries, rangeOf(m));
      return netBuckets(byId, sums.income).length > 0 || netBuckets(byId, sums.expense).length > 0;
    })
    .sort()
    .reverse();
}
