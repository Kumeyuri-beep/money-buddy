/**
 * หารายการเดิมที่คล้ายสลิปที่กำลังบันทึก (ยอด + วันที่ + ผู้รับ) เพื่อเตือนว่าอาจสแกนซ้ำ
 * แค่เตือน ไม่บล็อก: จ่ายยอดเท่ากันให้ร้านเดิมสองครั้งในวันเดียวเกิดขึ้นได้จริง
 */

import type { Entry } from '../domain/ledger/types';
import { safeAdd } from '../domain/money/safe';
import { parseBahtToSatang } from '../domain/money/satang';

export interface DuplicateQuery {
  date: string;
  /** ข้อความบาทตามที่อยู่ในฟอร์ม */
  amount: string;
  /** ชื่อผู้รับจากสลิป ถ้าไม่มีจะเทียบแค่ยอดกับวันที่ */
  recipient?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** ยอดรวมฝั่งเดบิตของรายการ (สตางค์) โยน RangeError ถ้าเกินช่วงปลอดภัย */
function debitTotal(entry: Entry): number {
  return entry.lines.reduce((sum, l) => (l.amount > 0 ? safeAdd(sum, l.amount) : sum), 0);
}

/** ยอดเดบิตของรายการ หรือ null ถ้ายอดผิดปกติ (ข้ามรายการนั้น ไม่ให้ทั้งการเตือนล้ม) */
function debitTotalOrNull(entry: Entry): number | null {
  try {
    return debitTotal(entry);
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
}

export function findDuplicateEntry(entries: readonly Entry[], query: DuplicateQuery): Entry | undefined {
  if (!query.date) return undefined;
  let amount: number;
  try {
    amount = parseBahtToSatang(query.amount);
  } catch {
    return undefined; // ยอดยังกรอกไม่ครบหรืออ่านไม่ได้
  }
  if (amount <= 0) return undefined;

  const recipient = query.recipient ? norm(query.recipient) : '';
  return entries.find(
    (e) =>
      e.source !== 'system' &&
      e.date === query.date &&
      debitTotalOrNull(e) === amount &&
      (recipient === '' || norm(e.memo).includes(recipient)),
  );
}
