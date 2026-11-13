import { BillFormError } from './billForm';
import { EntryFormError } from './entryForm';
import { SetupError } from './setup';
import { AuthInputError } from '../domain/auth/credentials';
import { BillError } from '../domain/bills/schedule';
import { TradeLinkError } from '../domain/invest/ledgerLink';
import { LedgerError } from '../domain/ledger/entry';
import { StorageError } from '../storage/repository';

const DEFAULT_MESSAGE = 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง';

/** ข้อความของ domain ที่ปนศัพท์โปรแกรม (Entry/Line/ผลต่างเป็นสตางค์) → ภาษาที่ผู้ใช้อ่านเข้าใจ (ไม่เปลี่ยนความหมาย) */
export function humanizeLedgerMessage(message: string): string {
  return message
    .replace(/: ผลต่าง -?\d+$/, ' (ยอดฝั่งเข้าและฝั่งออกไม่เท่ากัน)')
    .replace(/\(บัญชี [^)]*\)/g, '')
    .replace(/ห้ามมี Line ยอด 0/g, 'ห้ามมีบรรทัดที่ยอดเป็น 0')
    .replace(/Entry ต้องมีอย่างน้อย 2 Line/g, 'รายการต้องมีอย่างน้อย 2 บรรทัด')
    .replace(/Entry /g, 'รายการ')
    .replace(/Entry/g, 'รายการ')
    .replace(/Line/g, 'บรรทัด')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ข้อความผิดพลาดที่ผู้ใช้อ่านเข้าใจ (ที่เดียว ใช้ทุกหน้าจอ): ข้อผิดพลาดที่แอปเขียนข้อความไทยไว้เองแสดงตามนั้น
 * ข้อผิดพลาดของระบบ (เช่น TypeError: Failed to fetch, StorageError ที่ไม่ใช่ข้อความไทย) ไม่แสดงดิบ ใช้ข้อความสำรอง
 */
export function friendlyError(error: unknown, fallback: string = DEFAULT_MESSAGE): string {
  if (
    error instanceof BillFormError ||
    error instanceof StorageError ||
    error instanceof EntryFormError ||
    error instanceof SetupError ||
    error instanceof BillError ||
    error instanceof AuthInputError ||
    error instanceof TradeLinkError
  ) {
    return error.message;
  }
  if (error instanceof LedgerError) return humanizeLedgerMessage(error.message);
  if (error instanceof RangeError) return 'ตัวเลขใหญ่เกินไปหรือไม่ถูกต้อง ตรวจจำนวนเงินอีกครั้ง';
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) return 'เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง';
  return fallback;
}
