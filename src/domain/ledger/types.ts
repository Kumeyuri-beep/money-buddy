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

export interface Account {
  id: string;
  type: AccountType;
  name: string;
  currency: Currency;
  archived?: boolean;
}

export interface Line {
  accountId: string;
  /** เดบิตเป็นบวก เครดิตเป็นลบ เป็นจำนวนเต็มเสมอ ห้ามเป็น 0 */
  amount: number;
}

export interface Entry {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  memo: string;
  source: EntrySource;
  /** เชื่อมหลาย Entry ที่เกิดจากการกระทำเดียว เช่น จ่ายงวดหนี้ */
  groupId?: string;
  lines: Line[];
}

export type NewEntry = Omit<Entry, 'source'> & { source?: EntrySource };

export type EntryKind = 'income' | 'expense' | 'transfer';
