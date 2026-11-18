/**
 * ปรับยอดเงินสดของพอร์ต (หน้า Cash · R16/R20/R23) · ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล
 * Entry 2 บรรทัดสกุลเดียวกัน: เงินสดของพอร์ต ± จำนวน และบัญชีพักการปรับยอด (equity) ฝั่งตรงข้ามเท่ากัน · ไม่ใช่รายรับ/รายจ่าย
 * ฐานข้อมูลตรวจซ้ำ (RPC record_cash_adjustment): ชนิดบัญชี สกุลตรงกัน ผลรวม 0 ถอนเกินยอดไม่ได้
 */

import { isValidIsoDate } from '../ledger/entry';
import type { Entry, Line } from '../ledger/types';
import { coded, type InvestCode } from './errorCodes';
import type { InstrumentCurrency } from './types';

export const CASH_ADJUST_ACCOUNT_IDS = { THB: 'inv-cash-adjust-thb', USD: 'inv-cash-adjust-usd' } as const satisfies Record<InstrumentCurrency, string>;

export interface CashAdjustmentInput {
  /** รหัสรายการในสมุด (ผู้เรียกสร้าง) */
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** เวลาบันทึก (ISO) */
  createdAt: string;
  /** บัญชีเงินสดของพอร์ต (บัญชีลงทุนไม่ผูกสินทรัพย์) */
  cashAccountId: string;
  currency: InstrumentCurrency;
  /** deposit = เงินเข้าพอร์ต · withdraw = เงินออกจากพอร์ต */
  direction: 'deposit' | 'withdraw';
  /** สตางค์/เซนต์ จำนวนเต็มบวกตั้งแต่ 1 */
  amountMinor: number;
  memo: string;
}

export class CashAdjustmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CashAdjustmentError';
  }
}
const codedCash = (code: InvestCode) => coded((m) => new CashAdjustmentError(m), code);

export interface CashAdjustmentResult {
  entry: Entry;
  /** บัญชีพักที่ให้ฐานข้อมูลสร้างให้ถ้ายังไม่มี */
  adjustAccountIds: string[];
}

export function buildCashAdjustmentEntry(input: CashAdjustmentInput): CashAdjustmentResult {
  if (input.cashAccountId === '') throw codedCash('link.pickCashAccount');
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 1) throw codedCash('link.cashAmountInvalid');
  if (!isValidIsoDate(input.date)) throw codedCash('link.cashDateInvalid');
  const adjust = CASH_ADJUST_ACCOUNT_IDS[input.currency];
  const sign = input.direction === 'deposit' ? 1 : -1;
  const lines: Line[] = [
    { accountId: input.cashAccountId, amount: sign * input.amountMinor },
    { accountId: adjust, amount: -sign * input.amountMinor },
  ];
  const head = input.direction === 'deposit' ? 'เงินเข้าพอร์ต (ปรับยอดเงินสด)' : 'เงินออกจากพอร์ต (ปรับยอดเงินสด)';
  const extra = input.memo.trim();
  return {
    entry: { id: input.id, date: input.date, memo: extra === '' ? head : `${head} · ${extra}`, source: 'manual', createdAt: input.createdAt, lines },
    adjustAccountIds: [adjust],
  };
}
