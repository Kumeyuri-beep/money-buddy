import type { Account, Currency, Entry, NewEntry } from './types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

/** ตรวจว่าเป็นวันที่ YYYY-MM-DD ที่มีอยู่จริง (รวมวันสิ้นเดือน/ปีอธิกสุรทิน) */
export function isValidIsoDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function indexAccounts(accounts: readonly Account[]): Map<string, Account> {
  const map = new Map<string, Account>();
  for (const account of accounts) {
    if (map.has(account.id)) throw new LedgerError(`บัญชีซ้ำ: ${account.id}`);
    map.set(account.id, account);
  }
  return map;
}

/** ผลรวม Line แยกตามสกุลเงิน (ใช้ทั้งตอนสร้างและตอนตรวจ) */
export function sumByCurrency(
  entry: Pick<Entry, 'lines'>,
  accountsById: ReadonlyMap<string, Account>,
): Map<Currency, number> {
  const totals = new Map<Currency, number>();
  for (const line of entry.lines) {
    const account = accountsById.get(line.accountId);
    if (!account) continue;
    totals.set(account.currency, (totals.get(account.currency) ?? 0) + line.amount);
  }
  return totals;
}

/**
 * สร้าง Entry ที่ผ่านการตรวจแล้วเท่านั้น รายการที่ไม่สมดุลสร้างไม่ได้ตั้งแต่ต้น
 * การโอนข้ามสกุลเงินให้ใส่บัญชีพักอัตราแลกเปลี่ยน (equity) ฝั่งละสกุลเงินให้ครบ
 */
export function createEntry(accounts: readonly Account[], input: NewEntry): Entry {
  const byId = indexAccounts(accounts);

  if (!input.id) throw new LedgerError('Entry ต้องมี id');
  if (!isValidIsoDate(input.date)) throw new LedgerError(`วันที่ไม่ถูกต้อง: "${input.date}"`);
  if (input.lines.length < 2) throw new LedgerError('Entry ต้องมีอย่างน้อย 2 Line');

  for (const line of input.lines) {
    if (!byId.has(line.accountId)) throw new LedgerError(`ไม่พบบัญชี: ${line.accountId}`);
    if (!Number.isSafeInteger(line.amount)) {
      throw new LedgerError(`ยอดต้องเป็นจำนวนเต็มในช่วงปลอดภัย (บัญชี ${line.accountId})`);
    }
    if (line.amount === 0) throw new LedgerError(`ห้ามมี Line ยอด 0 (บัญชี ${line.accountId})`);
  }

  for (const [currency, total] of sumByCurrency(input, byId)) {
    if (total !== 0) {
      throw new LedgerError(`Entry ไม่สมดุลในสกุลเงิน ${currency}: ผลต่าง ${total}`);
    }
  }

  const entry: Entry = {
    id: input.id,
    date: input.date,
    memo: input.memo,
    source: input.source ?? 'manual',
    lines: input.lines.map((l) => ({ accountId: l.accountId, amount: l.amount })),
  };
  if (input.groupId !== undefined) entry.groupId = input.groupId;
  return entry;
}
