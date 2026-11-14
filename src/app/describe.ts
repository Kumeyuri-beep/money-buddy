import { classifyEntry } from '../domain/ledger/balance';
import type { Account, Entry, EntryKind } from '../domain/ledger/types';
import { safeAdd } from '../domain/money/safe';
import { formatBaht, satang } from '../domain/money/satang';

export interface EntryDescription {
  kind: EntryKind;
  /** "−฿65.00" รายจ่าย, "+฿17,000.00" รายรับ, "฿2,500.00" ย้ายเงิน */
  amountText: string;
}

/** ข้อความแทนยอดเมื่อยอดรวมของรายการใหญ่เกินช่วงปลอดภัย (ข้อมูลผิดปกติ) */
export const OVERFLOW_AMOUNT_TEXT = '⚠ ยอดผิดปกติ';

/** class ของช่องยอดในรายการ: ยอดปกติใช้สีตามประเภท ยอดผิดปกติใช้สไตล์เตือน (ไม่ให้ดูเหมือนยอดจริง) */
export function amountClass(kind: EntryKind, amountText: string): string {
  return amountText === OVERFLOW_AMOUNT_TEXT ? 'tx-warn' : `num tx-${kind}`;
}

/**
 * สรุปรายการหนึ่งรายการสำหรับแสดงในหน้าจอ (ไม่มีสูตรเงินในคอมโพเนนต์)
 * ไม่โยน error ตอน render: ยอดรวมเกินช่วงปลอดภัยแสดงเป็นข้อความเตือนแทน
 */
export function describeEntry(accounts: readonly Account[], entry: Entry): EntryDescription {
  const kind = classifyEntry(accounts, entry);
  const types = new Map(accounts.map((a) => [a.id, a.type] as const));
  const sumOf = (type: Account['type']) =>
    entry.lines.filter((l) => types.get(l.accountId) === type).reduce((s, l) => safeAdd(s, l.amount), 0);

  try {
    if (kind === 'expense') return { kind, amountText: formatBaht(satang(-sumOf('expense'))) };
    if (kind === 'income') return { kind, amountText: `+${formatBaht(satang(-sumOf('income')))}` };
    const moved = entry.lines.filter((l) => l.amount > 0).reduce((s, l) => safeAdd(s, l.amount), 0);
    return { kind, amountText: formatBaht(satang(moved)) };
  } catch (e) {
    if (e instanceof RangeError) return { kind, amountText: OVERFLOW_AMOUNT_TEXT };
    throw e;
  }
}
