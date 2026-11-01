import { isValidIsoDate } from '../domain/ledger/entry';
import type { Account, NewEntry } from '../domain/ledger/types';
import { parseBahtToSatang } from '../domain/money/satang';

export class EntryFormError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntryFormError';
  }
}

export type FormKind = 'expense' | 'income' | 'transfer';

export interface EntryForm {
  kind: FormKind;
  /** YYYY-MM-DD */
  date: string;
  /** ข้อความหน่วยบาทตามที่ผู้ใช้พิมพ์ เช่น "65" หรือ "1,234.50" */
  amount: string;
  /** กระเป๋าที่เงินออก (รายจ่าย/โอน) หรือเงินเข้า (รายรับ) */
  walletId: string;
  /** หมวดรายจ่าย หมวดรายรับ หรือกระเป๋าปลายทางของการโอน */
  counterId: string;
  memo: string;
}

/** กระเป๋าเงินบาทที่ใช้งานอยู่ */
export function walletOptions(accounts: readonly Account[]): Account[] {
  return accounts.filter((a) => a.type === 'asset' && a.currency === 'THB' && !a.archived);
}

/** ตัวเลือกช่องที่สอง (หมวดหรือกระเป๋าปลายทาง) ตามประเภทรายการ */
export function counterOptions(accounts: readonly Account[], kind: FormKind, walletId: string): Account[] {
  if (kind === 'transfer') return walletOptions(accounts).filter((a) => a.id !== walletId);
  return accounts.filter((a) => a.type === kind && a.currency === 'THB' && !a.archived);
}

/**
 * แปลงฟอร์มเป็นรายการสมุดบัญชี พร้อมข้อความแจ้งข้อผิดพลาดภาษาไทยที่เข้าใจง่าย
 *   รายจ่าย: เดบิตหมวดรายจ่าย  เครดิตกระเป๋า
 *   รายรับ:  เดบิตกระเป๋า       เครดิตหมวดรายรับ
 *   โอน:     เดบิตกระเป๋าปลายทาง เครดิตกระเป๋าต้นทาง (ไม่นับเป็นรายรับรายจ่าย ตามกฎ R4)
 * ผลลัพธ์ยังต้องผ่าน createEntry ตอนบันทึกอีกชั้นหนึ่ง
 */
export function buildEntry(accounts: readonly Account[], form: EntryForm, id: string): NewEntry {
  let amount: number;
  try {
    amount = parseBahtToSatang(form.amount);
  } catch (error) {
    if (error instanceof RangeError) throw new EntryFormError('จำนวนเงินใหญ่เกินไป');
    throw new EntryFormError('อ่านจำนวนเงินไม่ได้ ใส่เป็นตัวเลข เช่น 65 หรือ 65.50');
  }
  if (amount <= 0) throw new EntryFormError('จำนวนเงินต้องมากกว่า 0');
  if (!isValidIsoDate(form.date)) throw new EntryFormError('วันที่ไม่ถูกต้อง');

  const wallet = walletOptions(accounts).find((a) => a.id === form.walletId);
  if (!wallet) throw new EntryFormError('เลือกกระเป๋าเงิน');

  const counter = counterOptions(accounts, form.kind, form.walletId).find((a) => a.id === form.counterId);
  if (!counter) {
    if (form.kind === 'transfer') {
      throw new EntryFormError(
        form.counterId === form.walletId ? 'กระเป๋าต้นทางและปลายทางต้องต่างกัน' : 'เลือกกระเป๋าปลายทาง',
      );
    }
    throw new EntryFormError(form.kind === 'expense' ? 'เลือกหมวดรายจ่าย' : 'เลือกหมวดรายรับ');
  }

  const memo = form.memo.trim();
  const base = { id, date: form.date, source: 'manual' as const };

  switch (form.kind) {
    case 'expense':
      return {
        ...base,
        memo: memo || counter.name,
        lines: [
          { accountId: counter.id, amount },
          { accountId: wallet.id, amount: -amount },
        ],
      };
    case 'income':
      return {
        ...base,
        memo: memo || counter.name,
        lines: [
          { accountId: wallet.id, amount },
          { accountId: counter.id, amount: -amount },
        ],
      };
    case 'transfer':
      return {
        ...base,
        memo: memo || `โอน ${wallet.name} ไป ${counter.name}`,
        lines: [
          { accountId: counter.id, amount },
          { accountId: wallet.id, amount: -amount },
        ],
      };
  }
}
