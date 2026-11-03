import { balanceOf } from './balance';
import type { Account, Entry } from './types';

export interface WalletShare {
  id: string;
  name: string;
  /** ยอดคงเหลือเป็นสตางค์ (คำนวณจากบรรทัดในสมุดบัญชี R16) */
  balance: number;
  /** ร้อยละจำนวนเต็ม 0-100 ของยอดรวมกระเป๋าที่ไม่ติดลบ ผลรวมทุกกระเป๋า = 100 พอดี (หรือ 0 ทั้งหมดถ้าไม่มีเงิน) */
  percent: number;
  negative: boolean;
}

/**
 * สัดส่วนกระเป๋าเงิน (บาท ไม่ถูกเก็บถาวร) เรียงตามลำดับที่ส่งเข้ามา
 *   - ส่วนแบ่งคิดจากกระเป๋าที่ยอด > 0 เท่านั้น กระเป๋าติดลบ/ศูนย์ได้ 0% และไม่หารด้วยศูนย์
 *   - ปัดด้วยวิธีเศษมากสุด (largest remainder) ให้ร้อยละรวมเป็น 100 พอดี ใช้ BigInt จึงไม่ล้นแม้ยอดใหญ่
 *   - ร้อยละใช้แสดงผลเท่านั้น ไม่ใช้คำนวณยอดเงิน
 */
export function walletShares(accounts: readonly Account[], entries: readonly Entry[]): WalletShare[] {
  const wallets = accounts
    .filter((a) => a.type === 'asset' && a.currency === 'THB' && !a.archived)
    .map((a) => ({ id: a.id, name: a.name, balance: balanceOf(a.id, entries) }));

  const positiveTotal = wallets.reduce((s, w) => (w.balance > 0 ? s + BigInt(w.balance) : s), 0n);

  const parts = wallets.map((w, index) => {
    if (positiveTotal === 0n || w.balance <= 0) return { index, floor: 0, remainder: -1n };
    const scaled = BigInt(w.balance) * 100n;
    return { index, floor: Number(scaled / positiveTotal), remainder: scaled % positiveTotal };
  });

  let leftover = positiveTotal === 0n ? 0 : 100 - parts.reduce((s, p) => s + p.floor, 0);
  const percents = parts.map((p) => p.floor);
  const byRemainder = parts
    .filter((p) => p.remainder >= 0n)
    .sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  for (const p of byRemainder) {
    if (leftover <= 0) break;
    percents[p.index] = (percents[p.index] ?? 0) + 1;
    leftover -= 1;
  }

  return wallets.map((w, i) => ({ ...w, percent: percents[i] ?? 0, negative: w.balance < 0 }));
}
