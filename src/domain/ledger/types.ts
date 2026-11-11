/**
 * สมุดบัญชีคู่ (ข้อเสนอกฎ R16)
 *   - ทุกเหตุการณ์ทางเงินเป็น Entry หนึ่งรายการ ที่มี Line ตั้งแต่ 2 บรรทัดขึ้นไป
 *   - amount ของ Line เป็นจำนวนเต็มมีเครื่องหมาย: บวก = เดบิต, ลบ = เครดิต
 *   - ผลรวมของทุก Line ใน Entry ต้องเป็น 0 แยกตามสกุลเงิน
 *   - ยอดบัญชีไม่เก็บค่าไว้ แต่คำนวณจากผลรวม Line เสมอ
 *   - บาทเก็บเป็นสตางค์ ส่วนสกุลอื่นเก็บเป็น micro-units (ดู money/micro.ts)
 */

export type AccountType = 'asset' | 'liability' | 'income' | 'expense' | 'equity';

export type Currency = string; // 'THB', 'USD', ...

export type EntrySource = 'manual' | 'ocr' | 'quick' | 'recurring' | 'debt' | 'import' | 'system';

/** normal = บัญชีทั่วไป (ค่าตั้งต้น) · investment = บัญชีเก็บต้นทุนสินทรัพย์ลงทุน ไม่นับเป็นเงินสด/SAFE-TO-SPEND (R17) */
export type AccountKind = 'normal' | 'investment';

export interface Account {
  id: string;
  type: AccountType;
  name: string;
  currency: Currency;
  archived?: boolean;
  /** ไม่มี = normal (ข้อมูลเดิมทุกบัญชี) */
  kind?: AccountKind;
  /** ลำดับแสดงผล (น้อยมาก่อน) ไม่มีค่า = ไว้ท้ายสุด */
  sortOrder?: number;
}

export interface Line {
  accountId: string;
  /** เดบิตเป็นบวก เครดิตเป็นลบ เป็นจำนวนเต็มเสมอ ห้ามเป็น 0 */
  amount: number;
}

export interface BillLink {
  id: string;
  /** รอบที่จ่าย YYYY-MM */
  cycle: string;
  before?: string;
}

export interface Entry {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  memo: string;
  source: EntrySource;
  /** เชื่อมหลาย Entry ที่เกิดจากการกระทำเดียว เช่น จ่ายงวดหนี้ */
  groupId?: string;
  /** เวลาที่บันทึก (ISO) ใช้เรียงรายการวันเดียวกัน รายการเก่าที่ไม่มีค่านี้ถือว่าเก่าสุด */
  createdAt?: string;
  /** รายการจ่ายบิลประจำ: ผูกกับบิลและรอบ (R15) before = lastPaidMonth ก่อนจ่าย ใช้คืนค่าเมื่อยกเลิก */
  bill?: BillLink;
  lines: Line[];
}

export type NewEntry = Omit<Entry, 'source'> & { source?: EntrySource };

export type EntryKind = 'income' | 'expense' | 'transfer';
