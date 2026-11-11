/** บัญชีลงทุน (kind = investment) ต้องไม่นับเป็นเงินสดตั้งแต่วันแรก (R17) · ใช้เป็นตัวกรอง "กระเป๋าเงินสด" ที่เดียว */
import type { Account } from './types';

export function isInvestmentAccount(a: Account): boolean {
  return a.kind === 'investment';
}

/** กระเป๋าเงินสด: บัญชี asset สกุลบาทที่ใช้งานอยู่และไม่ใช่บัญชีลงทุน */
export function isCashWallet(a: Account): boolean {
  return a.type === 'asset' && a.currency === 'THB' && !a.archived && !isInvestmentAccount(a);
}
