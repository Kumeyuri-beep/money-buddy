/**
 * ผูกรายการหุ้นสหรัฐ (USD) และการแลกเงินกับสมุดบัญชีคู่ (A3-2 · กฎ R20.5, R16, R17) · ฟังก์ชันล้วน ไม่แตะ DOM/เครือข่าย
 *
 * Entry ของรายการ USD เป็นสกุล USD ล้วน (หน่วยเซนต์ · เดบิตบวก เครดิตลบ · ผลรวม 0) ไม่มีบรรทัดบาท:
 *   ซื้อ     บัญชีหุ้น +(A+F)                            เงินสด USD −(A+F)
 *   ขาย      เงินสด USD +net · บัญชีหุ้น −costOutUsd      กำไร (inv-gain-usd) −gain หรือ ขาดทุน (inv-loss-usd) +(−gain)
 *   ปันผล    เงินสด USD +(D−W) · ภาษีหัก (inv-wht-usd) +W    ปันผล (inv-dividend-usd) −D
 * ส่วนบาท (ต้นทุนบาท กำไรจากค่าเงิน) เป็นค่าแสดงผลที่เล่นซ้ำจากรายการ ไม่อยู่ในสมุด
 *
 * การแลกเงิน = Entry 4 บรรทัด ตรงกับที่ record_fx_exchange บังคับและ exchangeEntryProblem ตรวจ:
 *   บาท→USD  กระเป๋าบาท −thb · พักบาท +thb · เงินสด USD +usd · พัก USD −usd   |   USD→บาท เครื่องหมายตรงข้ามทั้งหมด
 */

import type { Entry, Line } from '../ledger/types';
import type { SellFxResult } from './costBasisFx';
import { coded, type InvestCode } from './errorCodes';
import type { FxExchangeRecord, TradeRecord } from './types';

export const USD_RESULT_ACCOUNT_IDS = {
  gain: 'inv-gain-usd',
  loss: 'inv-loss-usd',
  dividend: 'inv-dividend-usd',
  withholding: 'inv-wht-usd',
} as const;

export const FX_SUSPENSE_ACCOUNT_IDS = { thb: 'fx-suspense-thb', usd: 'fx-suspense-usd' } as const;

export class UsdLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsdLinkError';
  }
}

export interface UsdTradeEntryInput {
  trade: TradeRecord;
  assetName: string;
  /** บัญชีต้นทุนของหุ้น (บัญชีลงทุนสกุล USD ที่ผูกกับสินทรัพย์) */
  assetAccountId: string;
  /** เงินสด USD ที่ใช้จ่าย/รับเงิน */
  cashAccountId: string;
  entryId: string;
  /** ผลการขายจากการเล่นซ้ำ 2 ถัง (เฉพาะรายการขาย) */
  sell?: SellFxResult;
}

export interface UsdTradeEntryResult {
  entry: Entry;
  /** บัญชีผลลงทุนสกุล USD ที่ Entry นี้ใช้ (ให้ฐานข้อมูลสร้างให้ถ้ายังไม่มี) */
  resultAccountIds: string[];
}

const codedLink = (code: InvestCode) => coded((m) => new UsdLinkError(m), code);

const KIND_LABEL: Partial<Record<TradeRecord['kind'], string>> = { buy: 'ซื้อ', sell: 'ขาย', dividend: 'ปันผล' };

function tradeMemo(trade: TradeRecord, assetName: string): string {
  const head = `${KIND_LABEL[trade.kind] ?? trade.kind} ${assetName}`;
  const extra = trade.memo.trim();
  return extra === '' ? head : `${head} · ${extra}`;
}

export function buildUsdTradeEntry(input: UsdTradeEntryInput): UsdTradeEntryResult {
  const { trade, assetAccountId, cashAccountId, entryId, sell } = input;
  if (cashAccountId === '') throw codedLink('link.pickUsdCash');
  const lines: Line[] = [];
  const used: string[] = [];
  const add = (accountId: string, amount: number): void => {
    if (amount !== 0) lines.push({ accountId, amount });
  };

  if (trade.kind === 'buy') {
    const cost = (trade.amount ?? 0) + trade.fee;
    add(assetAccountId, cost);
    add(cashAccountId, -cost);
  } else if (trade.kind === 'dividend') {
    const amount = trade.amount ?? 0;
    add(cashAccountId, amount - trade.withholding);
    add(USD_RESULT_ACCOUNT_IDS.withholding, trade.withholding);
    add(USD_RESULT_ACCOUNT_IDS.dividend, -amount);
    used.push(USD_RESULT_ACCOUNT_IDS.dividend);
    if (trade.withholding > 0) used.push(USD_RESULT_ACCOUNT_IDS.withholding);
  } else if (trade.kind === 'sell') {
    if (sell === undefined) throw codedLink('link.noSellResult');
    add(cashAccountId, sell.netUsd);
    add(assetAccountId, -sell.costOutUsd);
    if (sell.priceGainUsd > 0) {
      add(USD_RESULT_ACCOUNT_IDS.gain, -sell.priceGainUsd);
      used.push(USD_RESULT_ACCOUNT_IDS.gain);
    } else if (sell.priceGainUsd < 0) {
      add(USD_RESULT_ACCOUNT_IDS.loss, -sell.priceGainUsd);
      used.push(USD_RESULT_ACCOUNT_IDS.loss);
    }
  } else {
    throw codedLink('link.usdNoReinvest');
  }

  if (lines.length < 2) throw codedLink('link.noChange');
  return {
    entry: { id: entryId, date: trade.date, memo: tradeMemo(trade, input.assetName), source: 'manual', createdAt: trade.createdAt, lines },
    resultAccountIds: used,
  };
}

export interface FxExchangeEntryInput {
  exchange: FxExchangeRecord;
  /** กระเป๋าเงินสดบาท */
  walletId: string;
  /** เงินสด USD */
  cashAccountId: string;
  entryId: string;
}

export interface FxExchangeEntryResult {
  entry: Entry;
  /** บัญชีพักบาท/พัก USD ที่ให้ฐานข้อมูลสร้างให้ถ้ายังไม่มี */
  suspenseAccountIds: string[];
}

export function buildFxExchangeEntry(input: FxExchangeEntryInput): FxExchangeEntryResult {
  const { exchange: x, walletId, cashAccountId, entryId } = input;
  if (walletId === '') throw codedLink('link.pickThbWallet');
  if (cashAccountId === '') throw codedLink('link.pickUsdCashShort');
  const sign = x.direction === 'thb_to_usd' ? 1 : -1;
  const lines: Line[] = [
    { accountId: walletId, amount: -sign * x.thbSatang },
    { accountId: FX_SUSPENSE_ACCOUNT_IDS.thb, amount: sign * x.thbSatang },
    { accountId: cashAccountId, amount: sign * x.usdCents },
    { accountId: FX_SUSPENSE_ACCOUNT_IDS.usd, amount: -sign * x.usdCents },
  ];
  const head = x.direction === 'thb_to_usd' ? 'แลกเงิน บาท → USD' : 'แลกเงิน USD → บาท';
  const extra = x.memo.trim();
  return {
    entry: { id: entryId, date: x.date, memo: extra === '' ? head : `${head} · ${extra}`, source: 'manual', createdAt: x.createdAt, lines },
    suspenseAccountIds: [FX_SUSPENSE_ACCOUNT_IDS.thb, FX_SUSPENSE_ACCOUNT_IDS.usd],
  };
}
