/**
 * ผูกรายการลงทุนกับสมุดบัญชีคู่ (พอร์ตลงทุน P4 · กฎ R4, R16, R17) · ฟังก์ชันล้วน ไม่แตะ DOM/เครือข่าย
 *
 * รูปแบบ Entry (เดบิตบวก เครดิตลบ · ผลรวม 0):
 *   ซื้อ            บัญชีลงทุน +(A+F)                       กระเป๋า −(A+F)
 *   ปันผลลงทุนต่อ    บัญชีลงทุน +A                           ปันผล (inv-dividend) −A         ไม่มีเงินสด
 *   ปันผลเงินสด      กระเป๋า +(D−W) · ภาษี (inv-wht) +W      ปันผล (inv-dividend) −D
 *   ขาย             กระเป๋า +net · บัญชีลงทุน −costOut      กำไร (inv-gain) −gain หรือ ขาดทุน (inv-loss) +(−gain)
 * ต้นทุนที่ตัดออก (costOut) และกำไรมาจากการเล่นซ้ำรายการด้วยต้นทุนเฉลี่ย (R17) ไม่คำนวณซ้ำที่นี่
 * บรรทัดที่ยอด 0 ถูกข้าม (ฐานข้อมูลห้ามบรรทัดยอด 0)
 */

import { isInvestResultAccount } from '../ledger/accountKind';
import type { Entry, Line } from '../ledger/types';
import type { SellResult } from './costBasis';
import type { TradeKind, TradeRecord } from './types';

export const INVEST_ACCOUNT_IDS = {
  gain: 'inv-gain',
  loss: 'inv-loss',
  dividend: 'inv-dividend',
  withholding: 'inv-wht',
} as const;

/** บัญชีผลการลงทุนที่ระบบสร้างให้เอง (ตรงกับ public.record_trade) */
export const INVEST_RESULT_ACCOUNTS: readonly { id: string; type: 'income' | 'expense'; name: string }[] = [
  { id: INVEST_ACCOUNT_IDS.gain, type: 'income', name: 'กำไรจากการลงทุน' },
  { id: INVEST_ACCOUNT_IDS.loss, type: 'expense', name: 'ขาดทุนจากการลงทุน' },
  { id: INVEST_ACCOUNT_IDS.dividend, type: 'income', name: 'ปันผล' },
  { id: INVEST_ACCOUNT_IDS.withholding, type: 'expense', name: 'ภาษีหัก ณ ที่จ่าย' },
];

export const TRADE_KIND_LABEL: Record<TradeKind, string> = {
  buy: 'ซื้อ',
  sell: 'ขาย',
  dividend: 'ปันผลเป็นเงินสด',
  reinvest: 'ปันผลลงทุนต่อ',
};

export interface TradeEntryInput {
  trade: TradeRecord;
  assetName: string;
  /** บัญชีลงทุนของสินทรัพย์ */
  assetAccountId: string;
  /** กระเป๋าเงินสด (ซื้อ ขาย ปันผลเงินสดต้องมี · ปันผลลงทุนต่อไม่ใช้) */
  walletId?: string;
  entryId: string;
  /** ผลการขายจากการเล่นซ้ำ (เฉพาะรายการขาย) */
  sell?: SellResult;
}

export interface TradeEntryResult {
  entry: Entry;
  /** บัญชีผลลงทุนที่ Entry นี้ใช้ (ให้ฐานข้อมูลสร้างให้ถ้ายังไม่มี) */
  resultAccountIds: string[];
}

export class TradeLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TradeLinkError';
  }
}

function memoOf(trade: TradeRecord, assetName: string): string {
  const head = `${TRADE_KIND_LABEL[trade.kind]} ${assetName}`;
  const extra = trade.memo.trim();
  return extra === '' ? head : `${head} · ${extra}`;
}

export function buildTradeEntry(input: TradeEntryInput): TradeEntryResult {
  const { trade, assetAccountId, walletId, entryId, sell } = input;
  const lines: Line[] = [];
  const used: string[] = [];
  const add = (accountId: string, amount: number): void => {
    if (amount !== 0) lines.push({ accountId, amount });
  };
  const needWallet = (): string => {
    if (walletId === undefined || walletId === '') throw new TradeLinkError('เลือกกระเป๋าเงินที่ใช้จ่ายหรือรับเงิน');
    return walletId;
  };

  if (trade.kind === 'buy') {
    const wallet = needWallet();
    const cost = (trade.amount ?? 0) + trade.fee;
    add(assetAccountId, cost);
    add(wallet, -cost);
  } else if (trade.kind === 'reinvest') {
    const amount = trade.amount ?? 0;
    add(assetAccountId, amount);
    add(INVEST_ACCOUNT_IDS.dividend, -amount);
    used.push(INVEST_ACCOUNT_IDS.dividend);
  } else if (trade.kind === 'dividend') {
    const wallet = needWallet();
    const amount = trade.amount ?? 0;
    add(wallet, amount - trade.withholding);
    add(INVEST_ACCOUNT_IDS.withholding, trade.withholding);
    add(INVEST_ACCOUNT_IDS.dividend, -amount);
    used.push(INVEST_ACCOUNT_IDS.dividend);
    if (trade.withholding > 0) used.push(INVEST_ACCOUNT_IDS.withholding);
  } else {
    const wallet = needWallet();
    if (sell === undefined) throw new TradeLinkError('ไม่มีผลคำนวณต้นทุนของรายการขาย');
    add(wallet, sell.net);
    add(assetAccountId, -sell.costOut);
    if (sell.gain > 0) {
      add(INVEST_ACCOUNT_IDS.gain, -sell.gain);
      used.push(INVEST_ACCOUNT_IDS.gain);
    } else if (sell.gain < 0) {
      add(INVEST_ACCOUNT_IDS.loss, -sell.gain);
      used.push(INVEST_ACCOUNT_IDS.loss);
    }
  }

  if (lines.length < 2) throw new TradeLinkError('รายการนี้ไม่เปลี่ยนยอดเงินใดเลย บันทึกไม่ได้');
  return {
    entry: { id: entryId, date: trade.date, memo: memoOf(trade, input.assetName), source: 'manual', createdAt: trade.createdAt, lines },
    resultAccountIds: used,
  };
}

/** กระเป๋าที่ต้องเลือกสำหรับรายการชนิดนี้หรือไม่ (ปันผลลงทุนต่อไม่ใช้เงินสด) */
export const tradeNeedsWallet = (kind: TradeKind): boolean => kind !== 'reinvest';

export { isInvestResultAccount };
