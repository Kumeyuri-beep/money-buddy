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

/** รายการซื้อ/ขาย/ปันผลที่ไม่มี fxRateMicro (ไม่ถูกเล่นซ้ำ) · ข้อมูลสำหรับแสดง "Needs rate" ห้ามนับเป็น 0 หรือเดาเรต (R26, R20.7) */
export interface MissingRateTrade {
  id: string;
  assetId: string;
  kind: 'buy' | 'sell' | 'dividend';
  date: string;
}

/** แยกรายการเป็น "มีเรต" (ใช้เล่นซ้ำได้) กับ "ขาดเรต" · ไม่เปลี่ยนผลของ toTradesFx (ตัวบันทึกยังใช้ตัวเดิม) */
export function splitTradesByRate(records: readonly TradeRecord[]): { withRate: TradeRecord[]; missingRate: MissingRateTrade[] } {
  const withRate: TradeRecord[] = [];
  const missingRate: MissingRateTrade[] = [];
  for (const t of records) {
    if (t.fxRateMicro !== undefined) withRate.push(t);
    else if (t.kind === 'buy' || t.kind === 'sell' || t.kind === 'dividend') missingRate.push({ id: t.id, assetId: t.assetId, kind: t.kind, date: t.date });
  }
  return { withRate, missingRate };
}
