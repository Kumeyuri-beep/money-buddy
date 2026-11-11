/**
 * กติกาของรายการลงทุน (กฎ R11, R17) · ฟังก์ชันล้วน ใช้ทั้งฝั่งหน้าจอ repository และตัวตรวจไฟล์สำรอง
 *   - ตำแหน่ง (หน่วย, ต้นทุน) คำนวณจากการเล่นซ้ำรายการเสมอ: ซื้อ + ปันผลลงทุนต่อ เพิ่ม · ขาย ลด · ปันผลเงินสดไม่กระทบ
 *   - ต้นทุนเฉลี่ยขึ้นกับลำดับ จึง **ห้ามเพิ่ม/ลบรายการที่กระทบตำแหน่ง ณ หรือก่อนวันที่ของรายการขายล่าสุด** (ต้องลบรายการขายก่อน)
 *     เจ้าของรับรองกติกานี้ 11 พ.ย. 2569 (ข้อที่เลือกเอง ข้อ 4) · รายการขายลบได้เฉพาะรายการล่าสุด
 */

import { replayTrades, type ReplayResult, type Trade } from './costBasis';
import type { TradeRecord } from './types';
import { valueInSatang } from './units';

/** รายการที่กระทบจำนวนหน่วย/ต้นทุน (ปันผลเงินสดไม่กระทบ) */
const affectsPosition = (t: TradeRecord): boolean => t.kind !== 'dividend';

/** แปลงรายการในสมุดลงทุนเป็นรายการสำหรับเล่นซ้ำ (ปันผลลงทุนต่อ = ซื้อที่ไม่มีค่าธรรมเนียม · ปันผลเงินสดถูกข้าม) */
export function toReplayTrades(trades: readonly TradeRecord[]): Trade[] {
  const out: Trade[] = [];
  for (const t of trades) {
    if (t.kind === 'buy') {
      out.push({ kind: 'buy', id: t.id, date: t.date, createdAt: t.createdAt, units: BigInt(t.units as string), amount: t.amount as number, fee: t.fee });
    } else if (t.kind === 'reinvest') {
      out.push({ kind: 'buy', id: t.id, date: t.date, createdAt: t.createdAt, units: BigInt(t.units as string), amount: t.amount as number, fee: 0 });
    } else if (t.kind === 'sell') {
      out.push({ kind: 'sell', id: t.id, date: t.date, createdAt: t.createdAt, units: BigInt(t.units as string), priceMicro: t.priceMicro as number, fee: t.fee });
    }
  }
  return out;
}

export function replayRecords(trades: readonly TradeRecord[]): ReplayResult {
  return replayTrades(toReplayTrades(trades));
}

const cmpKey = (a: TradeRecord, b: TradeRecord): number =>
  (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
  (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function latestSell(trades: readonly TradeRecord[]): TradeRecord | undefined {
  return trades.filter((t) => t.kind === 'sell').sort(cmpKey).at(-1);
}

function replayProblem(trades: readonly TradeRecord[]): string | null {
  try {
    replayRecords(trades);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'รายการซื้อขายไม่สอดคล้อง';
  }
}

/** ตรวจก่อนเพิ่มรายการของสินทรัพย์เดียวกัน (existing = รายการเดิมของสินทรัพย์นั้น) · null = เพิ่มได้ */
export function checkTradeAdd(existing: readonly TradeRecord[], added: TradeRecord): string | null {
  if (existing.some((t) => t.id === added.id)) return 'รหัสรายการซ้ำ';
  if (added.kind === 'sell') {
    let gross: number;
    try {
      gross = valueInSatang(BigInt(added.units as string), added.priceMicro as number);
    } catch {
      return 'มูลค่าที่ขายเกินช่วงที่คำนวณได้';
    }
    if (gross === 0) return 'ขายแล้วได้เงิน 0 สตางค์ (หน่วยน้อยหรือราคาต่ำเกินไป) บันทึกไม่ได้';
    if (added.fee > gross) return 'ค่าธรรมเนียมขายเกินเงินที่ขายได้';
  }
  if (affectsPosition(added)) {
    const last = latestSell(existing);
    if (last && added.date <= last.date) {
      return `ต้องลงวันที่หลังรายการขายล่าสุด (${last.date}) เพราะต้นทุนเฉลี่ยขึ้นกับลำดับ ถ้าต้องการบันทึกย้อนหลัง ให้ลบรายการขายก่อน`;
    }
  }
  return replayProblem([...existing, added]);
}

/** ตรวจก่อนลบรายการ · null = ลบได้ */
export function checkTradeDelete(existing: readonly TradeRecord[], id: string): string | null {
  const target = existing.find((t) => t.id === id);
  if (!target) return 'ไม่พบรายการ';
  if (!affectsPosition(target)) return null; // ปันผลเงินสด
  const last = latestSell(existing);
  if (target.kind === 'sell') {
    if (last && last.id !== target.id) return 'ลบได้เฉพาะรายการขายล่าสุด (ลบจากล่าสุดย้อนกลับ)';
  } else if (last && target.date <= last.date) {
    return `ลบรายการที่ลงวันที่ ณ หรือก่อนรายการขายล่าสุด (${last.date}) ไม่ได้ ให้ลบรายการขายก่อน`;
  }
  return replayProblem(existing.filter((t) => t.id !== id));
}
