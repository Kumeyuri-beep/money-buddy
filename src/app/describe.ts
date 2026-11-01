import { classifyEntry } from '../domain/ledger/balance';
import type { Account, Entry, EntryKind } from '../domain/ledger/types';
import { formatBaht, satang } from '../domain/money/satang';

export interface EntryDescription {
  kind: EntryKind;
  /** "−฿65.00" รายจ่าย, "+฿17,000.00" รายรับ, "฿2,500.00" โอน */
  amountText: string;
}

/** สรุปรายการหนึ่งรายการสำหรับแสดงในหน้าจอ (ไม่มีสูตรเงินในคอมโพเนนต์) */
export function describeEntry(accounts: readonly Account[], entry: Entry): EntryDescription {
  const kind = classifyEntry(accounts, entry);
  const types = new Map(accounts.map((a) => [a.id, a.type] as const));
  const sumOf = (type: Account['type']) =>
    entry.lines.filter((l) => types.get(l.accountId) === type).reduce((s, l) => s + l.amount, 0);

  if (kind === 'expense') return { kind, amountText: formatBaht(satang(-sumOf('expense'))) };
  if (kind === 'income') return { kind, amountText: `+${formatBaht(satang(-sumOf('income')))}` };
  const moved = entry.lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0);
  return { kind, amountText: formatBaht(satang(moved)) };
}
