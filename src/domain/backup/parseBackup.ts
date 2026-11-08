import { billProblem } from '../bills/schedule';
import { settingsProblem, type FinanceSettings } from '../bills/settings';
import type { Bill } from '../bills/types';
import { createEntry, LedgerError } from '../ledger/entry';
import { accountProblem, lengthWithin, MAX_ID_LENGTH } from '../ledger/limits';
import { safeAdd } from '../money/safe';
import type { Account, Entry, EntrySource, NewEntry } from '../ledger/types';

/**
 * ตรวจไฟล์สำรอง JSON ก่อนนำเข้า (M2-D) · ไม่เชื่อข้อมูลในไฟล์: คัดลอกเฉพาะฟิลด์ที่รู้จัก, ตรวจทุกกฎเดียวกับตอนบันทึกปกติ
 * (R1 ช่วงปลอดภัย, R15 lastPaidMonth ไม่เกินเดือนปัจจุบัน, R16 สมดุลต่อสกุลเงิน) ผิดข้อใดข้อหนึ่ง = ปฏิเสธทั้งไฟล์ ไม่นำเข้าบางส่วน
 * ไม่แตะ DOM, ฐานข้อมูล หรือเครือข่าย
 */

/** เวอร์ชันโครงสร้างไฟล์สำรองสูงสุดที่แอปนี้เข้าใจ (ต้องเท่ากับ SCHEMA_VERSION ใน storage/db.ts มีเทสต์ตรวจ) */
export const MAX_SUPPORTED_SCHEMA = 2;
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
export const MAX_IMPORT_ACCOUNTS = 2000;
/** วัดจริง 2,000 รายการ = 5.2 วินาที เพดานเวลาของ Supabase ~8 วินาที จึงตั้ง 1,500 (ไฟล์ใหญ่กว่านี้ต้องนำเข้าแบบแบ่งชุด: backlog) ต้องตรงกับ import_ledger ในฐานข้อมูล */
export const MAX_IMPORT_ENTRIES = 1500;
export const MAX_LINES_PER_IMPORTED_ENTRY = 200;
export const MAX_IMPORT_LINES = 20_000;
export const MAX_IMPORT_BILLS = 2000;
const MAX_PROBLEMS = 30;

const SOURCES: ReadonlySet<string> = new Set<EntrySource>(['manual', 'ocr', 'quick', 'recurring', 'debt', 'import', 'system']);

export interface BackupData {
  accounts: Account[];
  entries: Entry[];
  bills: Bill[];
  settings: FinanceSettings;
}

export interface BackupSummary {
  schemaVersion: number;
  accounts: number;
  entries: number;
  bills: number;
}

export type ParseResult =
  | { ok: true; data: BackupData; summary: BackupSummary; warnings: string[] }
  | { ok: false; problems: string[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** ตัวอักษรควบคุมและตัวกลับทิศ (U+202A-202E, U+2066-2069) ที่ทำให้หน้าจอรกหรือแสดงผลหลอก */
const UNSAFE_TEXT = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u;
const hasUnsafeText = (s: string, allowLineBreaks = false): boolean =>
  UNSAFE_TEXT.test(allowLineBreaks ? s.replace(/[\n\r\t]/g, '') : s);

/** ตัดรหัสจากไฟล์ที่จะแสดงในข้อความผิดพลาด ไม่ให้ยาวหรือมีอักขระควบคุม */
const short = (s: string): string => {
  const clean = s.replace(/[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu, '?');
  return Array.from(clean).length > 40 ? Array.from(clean).slice(0, 40).join('') + '…' : clean;
};

class Problems {
  readonly list: string[] = [];
  private extra = 0;
  add(message: string): void {
    if (this.list.length < MAX_PROBLEMS) this.list.push(message);
    else this.extra += 1;
  }
  get any(): boolean {
    return this.list.length > 0;
  }
  result(): string[] {
    return this.extra > 0 ? [...this.list, `และอีก ${this.extra} ข้อ`] : this.list;
  }
}

const optionalString = (r: Record<string, unknown>, key: string): string | undefined | null => {
  const v = r[key];
  if (v === undefined) return undefined;
  return typeof v === 'string' ? v : null; // null = ชนิดผิด
};

function parseAccounts(raw: unknown[], p: Problems): Account[] {
  const out: Account[] = [];
  const seen = new Set<string>();
  raw.forEach((item, i) => {
    const label = `บัญชีที่ ${i + 1}`;
    if (!isObject(item)) return p.add(`${label}: ไม่ใช่วัตถุ`);
    const { id, type, name, currency, archived, sortOrder } = item;
    if (typeof id !== 'string' || typeof type !== 'string' || typeof name !== 'string' || typeof currency !== 'string') {
      return p.add(`${label}: ต้องมี id, type, name, currency เป็นข้อความ`);
    }
    if (hasUnsafeText(id) || hasUnsafeText(name)) return p.add(`${label} (${short(id)}): รหัส/ชื่อมีอักขระควบคุม`);
    if (archived !== undefined && typeof archived !== 'boolean') return p.add(`${label} (${short(id)}): archived ต้องเป็นจริง/เท็จ`);
    if (sortOrder !== undefined && typeof sortOrder !== 'number') return p.add(`${label} (${short(id)}): sortOrder ต้องเป็นตัวเลข`);
    const account = { id, type, name, currency } as Account;
    if (archived !== undefined) account.archived = archived;
    if (sortOrder !== undefined) account.sortOrder = sortOrder;
    const problem = accountProblem(account);
    if (problem) return p.add(`${label} (${short(id)}): ${problem}`);
    if (seen.has(id)) return p.add(`บัญชีซ้ำ: ${short(id)}`);
    seen.add(id);
    out.push(account);
  });
  return out;
}

function parseEntries(raw: unknown[], accounts: Account[], accountsOk: boolean, p: Problems): Entry[] {
  const out: Entry[] = [];
  const seen = new Set<string>();
  raw.forEach((item, i) => {
    const label = `รายการที่ ${i + 1}`;
    if (!isObject(item)) return p.add(`${label}: ไม่ใช่วัตถุ`);
    const id = item.id;
    if (typeof id !== 'string') return p.add(`${label}: ต้องมี id เป็นข้อความ`);
    const tag = `รายการ ${short(id)}`;
    if (hasUnsafeText(id)) return p.add(`${tag}: รหัสมีอักขระควบคุม`);
    if (seen.has(id)) return p.add(`รายการซ้ำ: ${short(id)}`);
    seen.add(id);
    if (typeof item.date !== 'string') return p.add(`${tag}: วันที่ต้องเป็นข้อความ YYYY-MM-DD`);
    const memo = item.memo === undefined ? '' : item.memo;
    if (typeof memo !== 'string') return p.add(`${tag}: หมายเหตุต้องเป็นข้อความ`);
    if (hasUnsafeText(memo, true)) return p.add(`${tag}: หมายเหตุมีอักขระควบคุม`);
    const source = item.source === undefined ? 'manual' : item.source;
    if (typeof source !== 'string' || !SOURCES.has(source)) return p.add(`${tag}: ชนิดรายการไม่รู้จัก`);
    const groupId = optionalString(item, 'groupId');
    if (groupId === null || (groupId !== undefined && hasUnsafeText(groupId))) return p.add(`${tag}: groupId ต้องเป็นข้อความที่ไม่มีอักขระควบคุม`);
    const createdAt = optionalString(item, 'createdAt');
    if (createdAt === null || (createdAt !== undefined && (!/^\d{4}-\d{2}-\d{2}T/.test(createdAt) || Number.isNaN(Date.parse(createdAt))))) {
      return p.add(`${tag}: เวลาที่บันทึกไม่ถูกต้อง`);
    }
    if (!Array.isArray(item.lines)) return p.add(`${tag}: lines ต้องเป็นอาร์เรย์`);
    if (item.lines.length > MAX_LINES_PER_IMPORTED_ENTRY) {
      return p.add(`${tag}: มีบรรทัดมากเกินไป (${item.lines.length} เกิน ${MAX_LINES_PER_IMPORTED_ENTRY})`);
    }
    const lines: { accountId: string; amount: number }[] = [];
    for (const line of item.lines as unknown[]) {
      if (!isObject(line) || typeof line.accountId !== 'string' || typeof line.amount !== 'number') {
        return p.add(`${tag}: บรรทัดต้องมี accountId เป็นข้อความและ amount เป็นตัวเลข (ไม่ใช่ข้อความ/ว่าง)`);
      }
      lines.push({ accountId: line.accountId, amount: line.amount });
    }
    if (!accountsOk) return; // บัญชีเสียอยู่แล้ว ไม่ตรวจรายการซ้ำซ้อน
    const input: NewEntry = { id, date: item.date, memo, source: source as EntrySource, lines };
    if (groupId !== undefined) input.groupId = groupId;
    if (createdAt !== undefined) input.createdAt = createdAt;
    if (item.bill !== undefined) input.bill = item.bill as NewEntry['bill'];
    try {
      const entry = createEntry(accounts, input);
      if (entry.bill !== undefined && !lengthWithin(entry.bill.id, 1, MAX_ID_LENGTH)) {
        return p.add(`${tag}: รหัสบิลในลิงก์ต้องยาว 1-${MAX_ID_LENGTH} ตัวอักษรและไม่มีอักขระต้องห้าม`);
      }
      out.push(entry);
    } catch (e) {
      p.add(`${tag}: ${e instanceof LedgerError ? short(e.message) : 'ข้อมูลไม่ถูกต้อง'}`);
    }
  });
  return out;
}

function parseBills(raw: unknown[], accounts: Account[], today: string, p: Problems): Bill[] {
  const out: Bill[] = [];
  const seen = new Set<string>();
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const month = today.slice(0, 7);
  raw.forEach((item, i) => {
    const label = `บิลที่ ${i + 1}`;
    if (!isObject(item)) return p.add(`${label}: ไม่ใช่วัตถุ`);
    const { id, name, amount, dueDay, archived } = item;
    if (typeof id !== 'string' || typeof name !== 'string') return p.add(`${label}: ต้องมี id และ name เป็นข้อความ`);
    const tag = `บิล ${short(id)}`;
    if (hasUnsafeText(id) || hasUnsafeText(name)) return p.add(`${tag}: รหัส/ชื่อมีอักขระควบคุม`);
    if (typeof amount !== 'number' || typeof dueDay !== 'number') return p.add(`${tag}: ยอดและวันครบกำหนดต้องเป็นตัวเลข`);
    if (archived !== undefined && typeof archived !== 'boolean') return p.add(`${tag}: archived ต้องเป็นจริง/เท็จ`);
    const bill: Bill = { id, name, amount, dueDay };
    for (const key of ['walletId', 'categoryId', 'lastPaidMonth', 'startMonth'] as const) {
      const v = optionalString(item, key);
      if (v === null) return p.add(`${tag}: ${key} ต้องเป็นข้อความ`);
      if (v !== undefined) bill[key] = v;
    }
    if (archived !== undefined) bill.archived = archived;
    const problem = billProblem(bill) ?? (bill.name.trim() === '' ? 'ชื่อบิลต้องไม่ว่าง' : null);
    if (problem) return p.add(`${tag}: ${problem}`);
    if (seen.has(id)) return p.add(`บิลซ้ำ: ${short(id)}`);
    seen.add(id);
    if (bill.lastPaidMonth !== undefined && bill.lastPaidMonth > month) {
      return p.add(`${tag}: lastPaidMonth (${bill.lastPaidMonth}) เป็นเดือนในอนาคต`);
    }
    if (bill.walletId !== undefined && byId.get(bill.walletId)?.type !== 'asset') {
      return p.add(`${tag}: กระเป๋าที่จ่ายต้องเป็นกระเป๋าที่มีอยู่จริง`);
    }
    if (bill.categoryId !== undefined && byId.get(bill.categoryId)?.type !== 'expense') {
      return p.add(`${tag}: หมวดต้องเป็นหมวดรายจ่ายที่มีอยู่จริง`);
    }
    out.push(bill);
  });
  return out;
}

/** R1: ยอดสะสมต่อบัญชี (ฝั่งเดบิต/เครดิตแยกกัน) ต้องอยู่ในช่วงปลอดภัย ไม่งั้นการแสดงยอดบัญชีจะโยน RangeError ไม่ว่าเรียงลำดับอย่างไร */
function checkAccountTotals(accounts: Account[], entries: Entry[], p: Problems): void {
  const pos = new Map<string, number>();
  const neg = new Map<string, number>();
  const bad = new Set<string>();
  for (const entry of entries) {
    for (const line of entry.lines) {
      const side = line.amount > 0 ? pos : neg;
      try {
        side.set(line.accountId, safeAdd(side.get(line.accountId) ?? 0, Math.abs(line.amount)));
      } catch {
        bad.add(line.accountId);
      }
    }
  }
  const names = new Map(accounts.map((a) => [a.id, a.name] as const));
  for (const id of bad) p.add(`บัญชี ${names.get(id) ?? id}: ยอดสะสมของรายการทั้งหมดเกินช่วงที่คำนวณได้อย่างปลอดภัย (R1)`);
}

/**
 * R15: เทียบรายการจ่ายบิลกับบิล · ปฏิเสธเมื่อขัดกันชัด (รอบอนาคต, (บิล,รอบ) ซ้ำ, lastPaidMonth เก่ากว่ารอบที่ผูก)
 * เตือนเมื่อพบได้ในข้อมูลจริง: รายการผูกบิลที่ถูกลบไปแล้ว, lastPaidMonth ที่ไม่มีรายการจ่ายรองรับ (ไฟล์ก่อนมีการผูกบิล), รายการ recurring ไม่ผูกบิล
 */
function checkBillLinks(entries: Entry[], bills: Bill[], today: string, p: Problems): string[] {
  const warnings: string[] = [];
  const month = today.slice(0, 7);
  const billById = new Map(bills.map((b) => [b.id, b] as const));
  const seenPairs = new Set<string>();
  const maxCycle = new Map<string, string>();
  const cycles = new Map<string, Set<string>>();
  const dangling = new Set<string>();
  let unlinked = 0;
  for (const e of entries) {
    if (e.source === 'recurring' && e.bill === undefined) unlinked += 1;
    if (e.bill === undefined) continue;
    const { id, cycle } = e.bill;
    if (cycle > month) p.add(`รายการ ${short(e.id)}: รอบบิล ${cycle} เป็นเดือนในอนาคต`);
    const pair = id + String.fromCharCode(0) + cycle;
    if (seenPairs.has(pair)) p.add(`รายการ ${short(e.id)}: บิล ${short(id)} รอบ ${cycle} มีรายการจ่ายซ้ำ (จ่ายได้ครั้งเดียวต่อรอบ)`);
    seenPairs.add(pair);
    if ((maxCycle.get(id) ?? "") < cycle) maxCycle.set(id, cycle);
    (cycles.get(id) ?? cycles.set(id, new Set()).get(id)!).add(cycle);
    if (!billById.has(id)) dangling.add(id);
  }
  for (const bill of bills) {
    const max = maxCycle.get(bill.id);
    if (bill.lastPaidMonth !== undefined && max !== undefined && bill.lastPaidMonth < max) {
      p.add(`บิล ${short(bill.id)}: lastPaidMonth (${bill.lastPaidMonth}) เก่ากว่ารอบที่จ่ายแล้วในรายการ (${max}) อาจทำให้จ่ายซ้ำรอบเดิม`);
    }
    if (bill.lastPaidMonth !== undefined && !(cycles.get(bill.id)?.has(bill.lastPaidMonth) ?? false)) {
      warnings.push(`บิล ${short(bill.name)}: ระบุว่าจ่ายแล้วถึงรอบ ${bill.lastPaidMonth} แต่ไม่มีรายการจ่ายที่ผูกกับรอบนั้นในไฟล์ (ยกเลิกการจ่ายจากแอปไม่ได้ ถ้าจ่ายไปก่อนมีการผูกบิลเป็นเรื่องปกติ)`);
    }
  }
  if (dangling.size > 0) {
    warnings.push(`มีรายการจ่ายผูกกับบิลที่ไม่อยู่ในไฟล์ ${dangling.size} บิล (บิลถูกลบไปแล้ว) ยังลบรายการเหล่านั้นได้จากสมุดบัญชี`);
  }
  if (unlinked > 0) warnings.push(`มีรายการจ่ายบิลที่ไม่ผูกกับบิล ${unlinked} รายการ (แก้หรือลบไม่ได้จากสมุดบัญชี)`);
  return warnings;
}

/** today = วันนี้เวลาไทย YYYY-MM-DD (ใช้ตรวจ lastPaidMonth ไม่เกินเดือนปัจจุบัน R15) */
export function parseBackup(text: string, today: string): ParseResult {
  if (typeof text !== 'string' || text.length > MAX_IMPORT_BYTES) {
    return { ok: false, problems: [`ไฟล์ใหญ่เกินไป (ไม่เกิน ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} MB)`] };
  }
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return { ok: false, problems: ['ไฟล์ไม่ใช่ JSON ที่ถูกต้อง'] };
  }
  if (!isObject(root)) return { ok: false, problems: ['ไฟล์สำรองต้องเป็นวัตถุ JSON'] };

  const p = new Problems();
  const schemaVersion = root.schemaVersion;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    p.add('ไม่พบเวอร์ชันของไฟล์สำรอง (schemaVersion)');
  } else if (schemaVersion > MAX_SUPPORTED_SCHEMA) {
    p.add(`ไฟล์สำรองเป็นเวอร์ชัน ${schemaVersion} ใหม่กว่าที่แอปนี้เข้าใจ (สูงสุด ${MAX_SUPPORTED_SCHEMA}) โปรดอัปเดตแอปก่อน`);
  }
  if (!Array.isArray(root.accounts)) p.add('accounts ต้องเป็นอาร์เรย์');
  if (!Array.isArray(root.entries)) p.add('entries ต้องเป็นอาร์เรย์');
  if (root.bills !== undefined && !Array.isArray(root.bills)) p.add('bills ต้องเป็นอาร์เรย์');
  if (root.settings !== undefined && !isObject(root.settings)) p.add('settings ต้องเป็นวัตถุ');
  if (p.any) return { ok: false, problems: p.result() };

  const rawAccounts = root.accounts as unknown[];
  const rawEntries = root.entries as unknown[];
  const rawBills = (root.bills ?? []) as unknown[];
  if (rawAccounts.length > MAX_IMPORT_ACCOUNTS) p.add(`มีบัญชีมากเกินไป (${rawAccounts.length} เกิน ${MAX_IMPORT_ACCOUNTS})`);
  if (rawEntries.length > MAX_IMPORT_ENTRIES) p.add(`มีรายการมากเกินไป (${rawEntries.length} เกิน ${MAX_IMPORT_ENTRIES}) ติดต่อผู้ดูแลเพื่อนำเข้าแบบแบ่งส่วน`);
  if (rawBills.length > MAX_IMPORT_BILLS) p.add(`มีบิลมากเกินไป (${rawBills.length} เกิน ${MAX_IMPORT_BILLS})`);
  const totalLines = rawEntries.reduce<number>((n, e) => n + (isObject(e) && Array.isArray(e.lines) ? e.lines.length : 0), 0);
  if (totalLines > MAX_IMPORT_LINES) p.add(`มีบรรทัดรวมมากเกินไป (${totalLines} เกิน ${MAX_IMPORT_LINES})`);
  if (p.any) return { ok: false, problems: p.result() };

  const accounts = parseAccounts(rawAccounts, p);
  const accountsOk = accounts.length === rawAccounts.length;
  const entries = parseEntries(rawEntries, accounts, accountsOk, p);
  const bills = accountsOk ? parseBills(rawBills, accounts, today, p) : [];

  const rawSettings = isObject(root.settings) ? root.settings : {};
  const settings: FinanceSettings = {};
  for (const key of ['payDay', 'monthlySavingsGoal', 'monthlyBudget', 'nextPaydayOverride'] as const) {
    if (rawSettings[key] !== undefined) (settings as Record<string, unknown>)[key] = rawSettings[key];
  }
  const settingsIssue = settingsProblem(settings);
  if (settingsIssue) p.add(`ค่าตั้งค่า: ${settingsIssue}`);

  let warnings: string[] = [];
  if (accountsOk) {
    checkAccountTotals(accounts, entries, p);
    warnings = checkBillLinks(entries, bills, today, p);
  }

  if (p.any) return { ok: false, problems: p.result() };
  return {
    ok: true,
    data: { accounts, entries, bills, settings },
    summary: { schemaVersion: schemaVersion as number, accounts: accounts.length, entries: entries.length, bills: bills.length },
    warnings,
  };
}
