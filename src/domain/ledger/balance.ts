import { indexAccounts } from './entry';
import type { Account, AccountType, Currency, Entry, EntryKind } from './types';

/** ผลรวมดิบของบัญชี: เดบิตเป็นบวก เครดิตเป็นลบ */
export function balanceOf(accountId: string, entries: readonly Entry[]): number {
  let total = 0;
  for (const entry of entries) {
    for (const line of entry.lines) {
      if (line.accountId === accountId) total += line.amount;
    }
  }
  return total;
}

const DEBIT_NORMAL: ReadonlySet<AccountType> = new Set(['asset', 'expense']);

/**
 * ยอดตามธรรมชาติของบัญชี (เป็นบวกเมื่อมีค่าตามปกติ)
 *   asset/expense = ผลรวมดิบ,  liability/income/equity = กลับเครื่องหมาย
 * เช่น ยอดหนี้บัตรเครดิต 3,200 บาท แสดงเป็น +3,200 ไม่ใช่ -3,200
 */
export function naturalBalance(account: Account, entries: readonly Entry[]): number {
  const raw = balanceOf(account.id, entries);
  return (DEBIT_NORMAL.has(account.type) ? raw : -raw) || 0;
}

export interface DateRange {
  /** รวมวันนี้ YYYY-MM-DD */
  from: string;
  /** รวมวันนี้ YYYY-MM-DD */
  to: string;
}

export interface PeriodTotals {
  currency: Currency;
  income: number;
  expense: number;
  /** income - expense */
  net: number;
}

/**
 * รายรับและรายจ่ายของช่วงเวลา (กฎ R4)
 *   รายรับ = เครดิตในบัญชีประเภท income,  รายจ่าย = เดบิตในบัญชีประเภท expense
 * การโอนระหว่างกระเป๋า, การจ่ายเงินต้นหนี้, การจ่ายบิลบัตรเครดิต, การให้ยืม/รับคืน
 * ไม่แตะบัญชี income/expense จึงไม่ถูกนับเอง (ดอกเบี้ยเป็นบัญชี expense จึงถูกนับ)
 */
export function periodTotals(
  accounts: readonly Account[],
  entries: readonly Entry[],
  range: DateRange,
  currency: Currency = 'THB',
): PeriodTotals {
  const byId = indexAccounts(accounts);
  let income = 0;
  let expense = 0;
  for (const entry of entries) {
    if (entry.date < range.from || entry.date > range.to) continue;
    for (const line of entry.lines) {
      const account = byId.get(line.accountId);
      if (!account || account.currency !== currency) continue;
      if (account.type === 'income') income -= line.amount;
      else if (account.type === 'expense') expense += line.amount;
    }
  }
  return { currency, income, expense, net: income - expense };
}

/** จัดประเภท Entry สำหรับแสดงในรายการ: มีบัญชีรายจ่าย = expense, มีบัญชีรายรับ = income, นอกนั้น = transfer */
export function classifyEntry(accounts: readonly Account[], entry: Entry): EntryKind {
  const byId = indexAccounts(accounts);
  let hasIncome = false;
  let hasExpense = false;
  for (const line of entry.lines) {
    const type = byId.get(line.accountId)?.type;
    if (type === 'expense') hasExpense = true;
    if (type === 'income') hasIncome = true;
  }
  if (hasExpense) return 'expense';
  if (hasIncome) return 'income';
  return 'transfer';
}
