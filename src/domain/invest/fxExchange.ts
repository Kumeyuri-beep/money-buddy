/**
 * ตรวจว่า Entry ในสมุดตรงกับรายการแลกเงิน (R20.2 · ตรงกับที่ record_fx_exchange บังคับในฐานข้อมูล) · ฟังก์ชันล้วน
 *   Entry 4 บรรทัดพอดี: ฝั่งบาท 2 บรรทัด (กระเป๋าเงินสด + บัญชีพักบาท) · ฝั่ง USD 2 บรรทัด (บัญชีเงินสด USD + บัญชีพัก USD)
 *   thb_to_usd: กระเป๋าบาท −thb · พักบาท +thb · เงินสด USD +usd · พัก USD −usd   |   usd_to_thb: เครื่องหมายตรงข้ามทั้งหมด
 */

import type { Account, Entry } from '../ledger/types';
import { fxRateFromExchange } from './fx';
import type { FxExchangeRecord } from './types';

export function exchangeEntryProblem(x: FxExchangeRecord, entry: Entry, accountById: ReadonlyMap<string, Account>): string | null {
  if (entry.date !== x.date) return 'วันที่ของการแลกเงินไม่ตรงกับรายการในสมุด';
  if (entry.lines.length !== 4) return 'รายการในสมุดของการแลกเงินต้องมี 4 บรรทัดพอดี';
  const thbAsset: number[] = [];
  const thbEquity: number[] = [];
  const usdAsset: number[] = [];
  const usdEquity: number[] = [];
  for (const line of entry.lines) {
    const account = accountById.get(line.accountId);
    if (!account) return 'รายการในสมุดของการแลกเงินอ้างบัญชีที่ไม่มี';
    // กระเป๋าบาทรับได้ทั้งป้าย normal และ investment: R23 ให้เปลี่ยนป้ายได้แม้มีรายการ (แสดงผลล้วน ไม่แตะสมุด) จึงห้ามให้ป้ายมีผลต่อความถูกต้องของรายการแลกเงินที่บันทึกไปแล้ว
    if (account.currency === 'THB' && account.type === 'asset') thbAsset.push(line.amount);
    else if (account.currency === 'THB' && account.type === 'equity') thbEquity.push(line.amount);
    else if (account.currency === 'USD' && account.type === 'asset' && account.kind === 'investment') usdAsset.push(line.amount);
    else if (account.currency === 'USD' && account.type === 'equity') usdEquity.push(line.amount);
    else return 'รายการในสมุดของการแลกเงินใช้บัญชีผิดชนิด (ต้องเป็นกระเป๋าบาท บัญชีพักบาท เงินสด USD และบัญชีพัก USD อย่างละ 1)';
  }
  if (thbAsset.length !== 1 || thbEquity.length !== 1 || usdAsset.length !== 1 || usdEquity.length !== 1) {
    return 'รายการในสมุดของการแลกเงินต้องมีกระเป๋าบาท บัญชีพักบาท เงินสด USD และบัญชีพัก USD อย่างละ 1 บรรทัด';
  }
  const sign = x.direction === 'thb_to_usd' ? 1 : -1;
  if (thbAsset[0] !== -sign * x.thbSatang || thbEquity[0] !== sign * x.thbSatang) return 'จำนวนบาทในสมุดไม่ตรงกับรายการแลกเงิน';
  if (usdAsset[0] !== sign * x.usdCents || usdEquity[0] !== -sign * x.usdCents) return 'จำนวน USD ในสมุดไม่ตรงกับรายการแลกเงิน';
  return null;
}

/** อัตราของรายการแลกเงินต้องเท่ากับที่คำนวณจากสองจำนวน (R20.2) · ไม่ผ่าน = ข้อความปัญหา */
export function exchangeRateProblem(x: Pick<FxExchangeRecord, 'thbSatang' | 'usdCents' | 'rateMicro'>): string | null {
  let expected: number;
  try {
    expected = fxRateFromExchange(x.thbSatang, x.usdCents);
  } catch (e) {
    return e instanceof Error ? e.message : 'คำนวณอัตราไม่ได้';
  }
  return expected === x.rateMicro ? null : `อัตราแลกเปลี่ยนไม่ตรงกับจำนวนสองฝั่ง (ควรเป็น ${expected} micro)`;
}
