/** บัญชีลงทุน (kind = investment) ต้องไม่นับเป็นเงินสดตั้งแต่วันแรก (R17) · ใช้เป็นตัวกรอง "กระเป๋าเงินสด" ที่เดียว */
import type { Account } from './types';

export function isInvestmentAccount(a: Account): boolean {
  return a.kind === 'investment';
}

/**
 * บัญชีผลการลงทุนที่ระบบสร้างให้ (กำไร inv-gain · ขาดทุน inv-loss · ปันผล inv-dividend · ภาษีหัก ณ ที่จ่าย inv-wht)
 * ต้องไม่ปนกับรายรับรายจ่ายปกติ เช่น เงินเดือน (R17: กำไร/ปันผลแสดงแยกที่หน้าพอร์ต) · รหัสตรงกับ public.record_trade
 */
const INVEST_RESULT_IDS: ReadonlySet<string> = new Set(['inv-gain', 'inv-loss', 'inv-dividend', 'inv-wht']);
export const isInvestResultAccount = (a: Pick<Account, 'id'>): boolean => INVEST_RESULT_IDS.has(a.id);

/** กระเป๋าเงินสด: บัญชี asset สกุลบาทที่ใช้งานอยู่และไม่ใช่บัญชีลงทุน */
export function isCashWallet(a: Account): boolean {
  return a.type === 'asset' && a.currency === 'THB' && !a.archived && !isInvestmentAccount(a);
}
