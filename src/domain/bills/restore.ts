import type { Entry } from '../ledger/types';
import type { Bill } from './types';

/**
 * ลบบิลแล้ว "เลิกทำ" (เพิ่มบิลกลับพร้อมสถานะเดิม) ทำได้ไหม · ต้องตรงกับกติกา INSERT ของ private.bills_guard (M2-G)
 * กู้คืนได้ก็ต่อเมื่อ lastPaidMonth ของบิล = รอบล่าสุดของรายการจ่าย (recurring) ที่ผูกกับบิลนี้พอดี
 * (ไม่มีรายการเลย + ไม่มีสถานะจ่าย ก็ตรงกัน) · ไม่ตรง (เช่น จ่ายไว้ก่อนมีการผูกบิล) = กู้คืนไม่ได้ ควรเก็บถาวร (archive) แทนลบ
 * ไม่แตะ DOM หรือฐานข้อมูล
 */
export function canRestoreDeletedBill(bill: Bill, entries: readonly Entry[]): boolean {
  let latest: string | undefined;
  for (const entry of entries) {
    if (entry.source !== 'recurring' || entry.bill?.id !== bill.id) continue;
    if (latest === undefined || entry.bill.cycle > latest) latest = entry.bill.cycle;
  }
  return (bill.lastPaidMonth ?? null) === (latest ?? null);
}
