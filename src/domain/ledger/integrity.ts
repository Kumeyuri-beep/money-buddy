import { isValidIsoDate, sumByCurrency } from './entry';
import type { Account, Entry } from './types';

export type IntegrityIssueCode =
  | 'duplicate-account'
  | 'duplicate-entry'
  | 'bad-date'
  | 'too-few-lines'
  | 'unknown-account'
  | 'non-integer'
  | 'zero-line'
  | 'unbalanced'
  | 'amount-overflow';

export interface IntegrityIssue {
  code: IntegrityIssueCode;
  entryId?: string;
  accountId?: string;
  message: string;
}

export interface IntegrityReport {
  ok: boolean;
  checkedEntries: number;
  issues: IntegrityIssue[];
}

/**
 * ตรวจสุขภาพข้อมูลทั้งสมุดบัญชี (กฎ R14) ใช้เป็นปุ่ม "ตรวจความถูกต้อง" ปุ่มเดียว
 * ไม่แก้ข้อมูลเอง แค่รายงานทุกปัญหาที่เจอ
 */
export function runIntegrityCheck(
  accounts: readonly Account[],
  entries: readonly Entry[],
): IntegrityReport {
  const issues: IntegrityIssue[] = [];

  const seenAccounts = new Set<string>();
  for (const account of accounts) {
    if (seenAccounts.has(account.id)) {
      issues.push({
        code: 'duplicate-account',
        accountId: account.id,
        message: `บัญชีซ้ำ: ${account.id}`,
      });
    }
    seenAccounts.add(account.id);
  }

  // บัญชีซ้ำรายงานไปแล้วข้างบน ที่นี่ใช้ตัวหลังสุดเพื่อตรวจ Entry ต่อได้
  const byId = new Map(accounts.map((a) => [a.id, a] as const));

  const seenEntries = new Set<string>();
  for (const entry of entries) {
    if (seenEntries.has(entry.id)) {
      issues.push({ code: 'duplicate-entry', entryId: entry.id, message: `Entry ซ้ำ: ${entry.id}` });
    }
    seenEntries.add(entry.id);

    if (!isValidIsoDate(entry.date)) {
      issues.push({
        code: 'bad-date',
        entryId: entry.id,
        message: `วันที่ไม่ถูกต้อง: "${entry.date}"`,
      });
    }
    if (entry.lines.length < 2) {
      issues.push({ code: 'too-few-lines', entryId: entry.id, message: 'มี Line น้อยกว่า 2' });
    }
    for (const line of entry.lines) {
      if (!byId.has(line.accountId)) {
        issues.push({
          code: 'unknown-account',
          entryId: entry.id,
          accountId: line.accountId,
          message: `ไม่พบบัญชี ${line.accountId}`,
        });
      }
      if (!Number.isSafeInteger(line.amount)) {
        issues.push({
          code: 'non-integer',
          entryId: entry.id,
          accountId: line.accountId,
          message: `ยอดไม่ใช่จำนวนเต็ม (${String(line.amount)})`,
        });
      } else if (line.amount === 0) {
        issues.push({
          code: 'zero-line',
          entryId: entry.id,
          accountId: line.accountId,
          message: 'Line ยอด 0',
        });
      }
    }
    // ตรวจความสมดุลเฉพาะ Entry ที่ยอดเป็นจำนวนเต็มทั้งหมด เพื่อไม่ให้ซ้ำซ้อนกับ non-integer
    if (entry.lines.every((l) => Number.isSafeInteger(l.amount))) {
      try {
        for (const [currency, total] of sumByCurrency(entry, byId)) {
          if (total !== 0) {
            issues.push({
              code: 'unbalanced',
              entryId: entry.id,
              message: `ไม่สมดุลในสกุลเงิน ${currency}: ผลต่าง ${total}`,
            });
          }
        }
      } catch (e) {
        if (!(e instanceof RangeError)) throw e;
        issues.push({
          code: 'amount-overflow',
          entryId: entry.id,
          message: 'ยอดรวมของรายการใหญ่เกินช่วงที่คำนวณได้อย่างปลอดภัย',
        });
      }
    }
  }

  return { ok: issues.length === 0, checkedEntries: entries.length, issues };
}
