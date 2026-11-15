/**
 * แปลงรายการลงทุนของสินทรัพย์ USD เป็นอินพุตเล่นซ้ำ 2 ถัง (R20.3-R20.4) · ฟังก์ชันล้วน
 * ใช้ร่วมกันระหว่างตัวบันทึก (repository) และหน้าจอ (มุมมองพอร์ต) เพื่อไม่ให้สูตรเดียวกันอยู่หลายที่
 * รายการที่ไม่มี fxRateMicro หรือเป็นปันผล (ไม่เปลี่ยนต้นทุน) ถูกข้าม
 */

import type { TradeFx } from './costBasisFx';
import type { TradeRecord } from './types';

export function toTradesFx(records: readonly TradeRecord[]): TradeFx[] {
  const out: TradeFx[] = [];
  for (const t of records) {
    if (t.fxRateMicro === undefined) continue;
    const base = { id: t.id, date: t.date, createdAt: t.createdAt, fxRateMicro: t.fxRateMicro };
    if (t.kind === 'buy') out.push({ kind: 'buy', ...base, units: BigInt(t.units ?? '0'), amount: t.amount ?? 0, fee: t.fee });
    else if (t.kind === 'sell') out.push({ kind: 'sell', ...base, units: BigInt(t.units ?? '0'), priceMicro: t.priceMicro ?? 0, fee: t.fee });
  }
  return out;
}
