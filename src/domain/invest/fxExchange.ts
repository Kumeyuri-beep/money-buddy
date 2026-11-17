/**
 * ตรวจว่า Entry ในสมุดตรงกับรายการแลกเงิน (R20.2 · ตรงกับที่ record_fx_exchange บังคับในฐานข้อมูล) · ฟังก์ชันล้วน
 *   Entry 4 บรรทัดพอดี: ฝั่งบาท 2 บรรทัด (กระเป๋าเงินสด + บัญชีพักบาท) · ฝั่ง USD 2 บรรทัด (บัญชีเงินสด USD + บัญชีพัก USD)
 *   thb_to_usd: กระเป๋าบาท −thb · พักบาท +thb · เงินสด USD +usd · พัก USD −usd   |   usd_to_thb: เครื่องหมายตรงข้ามทั้งหมด
 */

import type { Account, Entry } from '../ledger/types';
import type { CodedProblem } from '../errors/problem';
import { problemOfError } from '../errors/problem';
import { problem } from './errorCodes';
import { fxRateFromExchange } from './fx';
import type { FxExchangeRecord } from './types';

export function exchangeEntryProblemCoded(x: FxExchangeRecord, entry: Entry, accountById: ReadonlyMap<string, Account>): CodedProblem | null {
  if (entry.date !== x.date) return problem('fxx.dateMismatch');
  if (entry.lines.length !== 4) return problem('fxx.lines4');
  const thbAsset: number[] = [];
  const thbEquity: number[] = [];
  const usdAsset: number[] = [];
  const usdEquity: number[] = [];
  for (const line of entry.lines) {
    const account = accountById.get(line.accountId);
    if (!account) return problem('fxx.accountMissing');
    // กระเป๋าบาทรับได้ทั้งป้าย normal และ investment: R23 ให้เปลี่ยนป้ายได้แม้มีรายการ (แสดงผลล้วน ไม่แตะสมุด) จึงห้ามให้ป้ายมีผลต่อความถูกต้องของรายการแลกเงินที่บันทึกไปแล้ว
    if (account.currency === 'THB' && account.type === 'asset') thbAsset.push(line.amount);
    else if (account.currency === 'THB' && account.type === 'equity') thbEquity.push(line.amount);
    else if (account.currency === 'USD' && account.type === 'asset' && account.kind === 'investment') usdAsset.push(line.amount);
    else if (account.currency === 'USD' && account.type === 'equity') usdEquity.push(line.amount);
    else return problem('fxx.accountWrongType');
  }
  if (thbAsset.length !== 1 || thbEquity.length !== 1 || usdAsset.length !== 1 || usdEquity.length !== 1) {
    return problem('fxx.accountCount');
  }
  const sign = x.direction === 'thb_to_usd' ? 1 : -1;
  if (thbAsset[0] !== -sign * x.thbSatang || thbEquity[0] !== sign * x.thbSatang) return problem('fxx.thbMismatch');
  if (usdAsset[0] !== sign * x.usdCents || usdEquity[0] !== -sign * x.usdCents) return problem('fxx.usdMismatch');
  return null;
}

/** เหมือน exchangeEntryProblemCoded แต่คืนเฉพาะข้อความไทยเดิม (สัญญาเดิม) */
export function exchangeEntryProblem(x: FxExchangeRecord, entry: Entry, accountById: ReadonlyMap<string, Account>): string | null {
  return exchangeEntryProblemCoded(x, entry, accountById)?.message ?? null;
}

/** อัตราของรายการแลกเงินต้องเท่ากับที่คำนวณจากสองจำนวน (R20.2) · ไม่ผ่าน = ข้อความปัญหา */
export function exchangeRateProblemCoded(x: Pick<FxExchangeRecord, 'thbSatang' | 'usdCents' | 'rateMicro'>): CodedProblem | null {
  let expected: number;
  try {
    expected = fxRateFromExchange(x.thbSatang, x.usdCents);
  } catch (e) {
    return problemOfError(e, problem('fxx.rateUncomputable'));
  }
  return expected === x.rateMicro ? null : problem('fxx.rateMismatch', { expected });
}

/** เหมือน exchangeRateProblemCoded แต่คืนเฉพาะข้อความไทยเดิม (สัญญาเดิม) */
export function exchangeRateProblem(x: Pick<FxExchangeRecord, 'thbSatang' | 'usdCents' | 'rateMicro'>): string | null {
  return exchangeRateProblemCoded(x)?.message ?? null;
}
