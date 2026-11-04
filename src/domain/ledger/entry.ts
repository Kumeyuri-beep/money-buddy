import { safeAdd } from '../money/safe';
import type { Account, BillLink, Currency, Entry, NewEntry } from './types';

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

/**
 * ผลรวม Line แยกตามสกุลเงิน (ใช้ทั้งตอนสร้างและตอนตรวจ)
 * โยน RangeError ถ้ายอดสะสม (รวมค่าระหว่างทาง) เกินช่วงปลอดภัย (R1) เพราะ number จะเพี้ยนเงียบๆ
 */
export function sumByCurrency(
  entry: Pick<Entry, 'lines'>,
  accountsById: ReadonlyMap<string, Account>,
): Map<Currency, number> {
  const totals = new Map<Currency, number>();
  for (const line of entry.lines) {
    const account = accountsById.get(line.accountId);
    if (!account) continue;
    totals.set(account.currency, safeAdd(totals.get(account.currency) ?? 0, line.amount));
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

  let totals: Map<Currency, number>;
  try {
    totals = sumByCurrency(input, byId);
  } catch (e) {
    if (e instanceof RangeError) throw new LedgerError('ยอดรวมของ Entry ใหญ่เกินช่วงที่คำนวณได้อย่างปลอดภัย');
    throw e;
  }
  for (const [currency, total] of totals) {
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
  if (input.createdAt !== undefined) entry.createdAt = input.createdAt;
  if (input.bill !== undefined) {
    if (entry.source !== 'recurring') throw new LedgerError('ลิงก์บิลใช้ได้เฉพาะรายการจ่ายบิล (source recurring)');
    entry.bill = checkBillLink(input.bill);
  }
  return entry;
}


const CYCLE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** ตรวจลิงก์บิล-รอบ และคัดลอกเฉพาะฟิลด์ที่รู้จัก (before ไม่มี = ไม่มีคีย์) */
function checkBillLink(link: unknown): BillLink {
  const l = (typeof link === 'object' && link !== null ? link : {}) as Record<string, unknown>;
  if (typeof l.id !== 'string' || l.id.trim() === '') throw new LedgerError('ลิงก์บิลต้องมีรหัสบิล');
  if (typeof l.cycle !== 'string' || !CYCLE.test(l.cycle)) throw new LedgerError(`รอบของบิลไม่ถูกต้อง: "${String(l.cycle)}"`);
  const out: BillLink = { id: l.id, cycle: l.cycle };
  if (l.before !== undefined) {
    if (typeof l.before !== 'string' || !CYCLE.test(l.before)) {
      throw new LedgerError(`รอบก่อนหน้าของบิลไม่ถูกต้อง: "${String(l.before)}"`);
    }
    if (l.before >= l.cycle) throw new LedgerError('รอบก่อนหน้าของบิลต้องมาก่อนรอบที่จ่าย');
    out.before = l.before;
  }
  return out;
}
