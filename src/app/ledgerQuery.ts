import type { Account, Entry, EntryKind } from '../domain/ledger/types';
import { describeEntry } from './describe';
import { entryToForm } from './entryForm';

export interface LedgerFilter {
  /** 'YYYY-MM' หรือ 'all' */
  month: string;
  kind: 'all' | EntryKind;
  /** รหัสกระเป๋าหรือหมวด หรือ 'all' */
  accountId: string;
  /** คำค้นในบันทึกช่วยจำและชื่อบัญชี */
  text: string;
}

export interface LedgerRow {
  entry: Entry;
  kind: EntryKind;
  amountText: string;
  /** บรรทัดรองใต้ชื่อรายการ เช่น "อาหาร, จาก CashFlow" */
  detail: string;
  /** แก้ไขและลบได้ (ยอดยกมาของระบบทำไม่ได้) */
  editable: boolean;
  /** รายการจ่ายบิลที่ผูกกับบิลแล้ว: ยกเลิกการจ่ายได้ (คืนสถานะบิลพร้อมกัน) แก้ไขไม่ได้ */
  cancelable: boolean;
}

export const ALL_FILTER: LedgerFilter = { month: 'all', kind: 'all', accountId: 'all', text: '' };

function names(accounts: readonly Account[]): Map<string, string> {
  return new Map(accounts.map((a) => [a.id, a.name] as const));
}

/** คำอธิบายรองของรายการจากบัญชีที่เกี่ยวข้อง */
export function entryDetail(accounts: readonly Account[], entry: Entry): string {
  const nameOf = names(accounts);
  if (entry.source === 'system') return 'ยอดยกมา';
  const form = entryToForm(accounts, entry);
  if (!form) {
    return entry.lines.map((l) => nameOf.get(l.accountId) ?? l.accountId).join(', ');
  }
  const wallet = nameOf.get(form.walletId) ?? '';
  const counter = nameOf.get(form.counterId) ?? '';
  if (form.kind === 'expense') return `${counter}, จาก ${wallet}`;
  if (form.kind === 'income') return `${counter}, เข้า ${wallet}`;
  return `${wallet} ไป ${counter}`;
}

/**
 * กรองและเรียงรายการสำหรับหน้า "รายการ" (ใหม่สุดก่อน วันเดียวกันรายการที่เพิ่มทีหลังอยู่บน)
 * ไม่คำนวณเงินเอง ใช้ describeEntry และ entryToForm
 */
export function queryLedger(
  accounts: readonly Account[],
  entries: readonly Entry[],
  filter: LedgerFilter,
): LedgerRow[] {
  const nameOf = names(accounts);
  const text = filter.text.trim().toLowerCase();

  const rows: LedgerRow[] = [];
  entries.forEach((entry) => {
    if (filter.month !== 'all' && !entry.date.startsWith(`${filter.month}-`)) return;
    if (filter.accountId !== 'all' && !entry.lines.some((l) => l.accountId === filter.accountId)) return;
    const { kind, amountText } = describeEntry(accounts, entry);
    // ยอดยกมาไม่ใช่รายรับ รายจ่าย หรือการโอน จึงแสดงเฉพาะเมื่อไม่ได้กรองประเภท
    if (filter.kind !== 'all' && (kind !== filter.kind || entry.source === 'system')) return;
    const detail = entryDetail(accounts, entry);
    if (text) {
      const haystack = [entry.memo, detail, ...entry.lines.map((l) => nameOf.get(l.accountId) ?? '')]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(text)) return;
    }
    rows.push({ entry, kind, amountText, detail, editable: entry.source !== 'system' && entry.source !== 'recurring',
      cancelable: entry.source === 'recurring' && entry.bill !== undefined,
    });
  });

  // entries เรียงตามวันที่จากเก่าไปใหม่อยู่แล้ว กลับด้านแบบคงลำดับเดิมภายในวันเดียวกัน
  return rows.reverse().sort((a, b) => (a.entry.date < b.entry.date ? 1 : a.entry.date > b.entry.date ? -1 : 0));
}

/** เดือนที่มีรายการ ใหม่สุดก่อน รูปแบบ 'YYYY-MM' */
export function monthsWithEntries(entries: readonly Entry[]): string[] {
  return [...new Set(entries.map((e) => e.date.slice(0, 7)))].sort().reverse();
}

/** จัดกลุ่มแถวตามวันที่ (คงลำดับ) สำหรับหัวข้อวัน */
export function groupByDate(rows: readonly LedgerRow[]): { date: string; rows: LedgerRow[] }[] {
  const groups: { date: string; rows: LedgerRow[] }[] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (last && last.date === row.entry.date) last.rows.push(row);
    else groups.push({ date: row.entry.date, rows: [row] });
  }
  return groups;
}
