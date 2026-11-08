import type { SupabaseClient } from '@supabase/supabase-js';
import type { BackupData } from '../domain/backup/parseBackup';
import { payAmountProblem } from '../domain/bills/payAmount';
import { billProblem, markBillPaid, payableCycle } from '../domain/bills/schedule';
import { sanitizeSettings, settingsProblem, type FinanceSettings } from '../domain/bills/settings';
import type { Bill } from '../domain/bills/types';
import { createEntry } from '../domain/ledger/entry';
import { runIntegrityCheck } from '../domain/ledger/integrity';
import type { Account, AccountType, Entry, EntrySource, NewEntry } from '../domain/ledger/types';
import { SCHEMA_VERSION } from './db';
import type { LedgerRepository } from './ledgerRepository';
import {
  assertBillWritableWith,
  assertNotFuture,
  compareEntries,
  currentMonth,
  nextCreatedAt,
  pickBill,
  StorageError,
  type Ledger,
  type PayBillOptions,
  type PayBillResult,
  type Snapshot,
} from './repository';

/**
 * LedgerRepository บน Supabase (M2-C2) · ผ่านเทสต์สัญญาชุดเดียวกับ Dexie (tests/live/)
 * - ข้อมูลของแต่ละคนแยกด้วย RLS ที่ฐานข้อมูล (client ต้องล็อกอินด้วย anon key เท่านั้น ห้ามส่ง key ผู้ดูแลเข้ามา)
 * - ตรวจสูตรเงินที่ฝั่งเว็บด้วย createEntry เหมือน Dexie ทุกประการ · ฐานข้อมูลตรวจซ้ำ (สมดุล R16, ช่วงปลอดภัย R1, R15)
 * - ความเป็นอะตอมของการจ่าย/ยกเลิกบิลอยู่ที่ trigger ในฐานข้อมูล: จ่าย = เรียก create_entry ครั้งเดียว,
 *   ยกเลิก = ลบรายการครั้งเดียว (trigger คืน lastPaidMonth ในธุรกรรมเดียวกัน)
 */

const PAGE = 1000;

interface DbError {
  message?: string;
  code?: string;
}

const THAI = /[฀-๿]/;
/** รหัส error ที่ฟังก์ชัน/trigger ของเราตั้งใจ raise พร้อมข้อความไทย (ข้อความอื่นของ Postgres เองไม่ส่งต่อ เพราะอาจมีค่าที่ผู้ใช้กรอกปนอยู่) */
const OWN_CODES = new Set(['28000', '42501', '25006', '23514', '40001', '53400', '23503', '23505', 'P0002', '22007', '22023', '55000']);

/** แปลง error ของ PostgREST เป็น StorageError · ข้อความไทยที่ฐานข้อมูลตั้งใจส่งมาใช้ได้เลย ที่เหลือไม่โชว์รายละเอียดภายใน */
export function storageErrorFrom(error: DbError): StorageError {
  const message = String(error.message ?? '');
  if (THAI.test(message) && error.code !== undefined && OWN_CODES.has(error.code)) return new StorageError(message);
  if (/bill_cycle_once/i.test(message)) return new StorageError('รอบนี้จ่ายแล้ว (อาจจ่ายจากอีกหน้าต่างหนึ่งไปก่อนแล้ว) โหลดใหม่เพื่อดูสถานะล่าสุด');
  if (error.code === '23505' || /duplicate key/i.test(message)) return new StorageError('รหัสนี้มีอยู่แล้ว ไม่เขียนทับ');
  if (error.code === '23503') return new StorageError('ข้อมูลอ้างอิงไม่ถูกต้อง (บัญชีหรือบิลที่เกี่ยวข้องไม่มีอยู่)');
  if (error.code === '23514' || error.code === '22003' || error.code === '22023') {
    return new StorageError('ข้อมูลไม่ผ่านการตรวจของฐานข้อมูล');
  }
  if (/fetch|network|timeout/i.test(message)) return new StorageError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง');
  return new StorageError('บันทึกหรืออ่านข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง');
}

// ---------- แปลงแถวฐานข้อมูล <-> โดเมน (ฟังก์ชันล้วน ทดสอบได้โดยไม่ต้องมีฐานข้อมูล) ----------

export interface AccountRow {
  id: string;
  type: string;
  name: string;
  currency: string;
  archived: boolean;
  sort_order: number | null;
}

export interface EntryRow {
  id: string;
  date: string;
  memo: string;
  source: string;
  group_id: string | null;
  created_at: string;
  bill_id: string | null;
  bill_cycle: string | null;
  bill_before: string | null;
  lines?: { idx: number; account_id: string; amount: number | string }[] | null;
}

export interface BillRow {
  id: string;
  name: string;
  amount: number | string;
  due_day: number;
  wallet_id: string | null;
  category_id: string | null;
  last_paid_month: string | null;
  start_month: string | null;
  archived: boolean;
}

const ENTRY_COLUMNS = 'id,date,memo,source,group_id,created_at,bill_id,bill_cycle,bill_before,lines(idx,account_id,amount)';

function safeInt(value: unknown, what: string): number {
  const n = typeof value === 'string' ? (/^-?[0-9]{1,16}$/.test(value) ? Number(value) : Number.NaN) : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n)) throw new StorageError(`ข้อมูลจากเซิร์ฟเวอร์ไม่ถูกต้อง: ${what} ไม่ใช่จำนวนเต็มที่ปลอดภัย`);
  return n;
}

export function rowToAccount(row: AccountRow): Account {
  const account: Account = { id: row.id, type: row.type as AccountType, name: row.name, currency: row.currency };
  if (row.archived) account.archived = true;
  if (row.sort_order !== null && row.sort_order !== undefined) account.sortOrder = row.sort_order;
  return account;
}

export function accountToJson(a: Account): Record<string, unknown> {
  const out: Record<string, unknown> = { id: a.id, type: a.type, name: a.name, currency: a.currency };
  if (a.archived !== undefined) out.archived = a.archived;
  if (a.sortOrder !== undefined) out.sortOrder = a.sortOrder;
  return out;
}

export function rowToEntry(row: EntryRow): Entry {
  const lines = [...(row.lines ?? [])]
    .sort((a, b) => a.idx - b.idx)
    .map((l) => ({ accountId: l.account_id, amount: safeInt(l.amount, 'จำนวนเงิน') }));
  const entry: Entry = {
    id: row.id,
    date: row.date,
    memo: row.memo,
    source: row.source as EntrySource,
    createdAt: new Date(row.created_at).toISOString(),
    lines,
  };
  if (row.group_id !== null) entry.groupId = row.group_id;
  if (row.bill_id !== null && row.bill_cycle !== null) {
    entry.bill = row.bill_before !== null ? { id: row.bill_id, cycle: row.bill_cycle, before: row.bill_before } : { id: row.bill_id, cycle: row.bill_cycle };
  }
  return entry;
}

/** รูปแบบที่ RPC create_entry / update_entry / setup_ledger รับ */
export function entryToJson(e: Entry): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: e.id,
    date: e.date,
    memo: e.memo,
    source: e.source,
    lines: e.lines.map((l) => ({ accountId: l.accountId, amount: l.amount })),
  };
  if (e.groupId !== undefined) out.groupId = e.groupId;
  if (e.createdAt !== undefined) out.createdAt = e.createdAt;
  if (e.bill !== undefined) out.bill = e.bill.before !== undefined ? { id: e.bill.id, cycle: e.bill.cycle, before: e.bill.before } : { id: e.bill.id, cycle: e.bill.cycle };
  return out;
}

export function rowToBill(row: BillRow): Bill {
  const bill: Bill = { id: row.id, name: row.name, amount: safeInt(row.amount, 'ยอดบิล'), dueDay: row.due_day };
  if (row.wallet_id !== null) bill.walletId = row.wallet_id;
  if (row.category_id !== null) bill.categoryId = row.category_id;
  if (row.last_paid_month !== null) bill.lastPaidMonth = row.last_paid_month;
  if (row.start_month !== null) bill.startMonth = row.start_month;
  if (row.archived) bill.archived = true;
  return bill;
}

/** รูปแบบบิลที่ RPC import_ledger รับ (ส่งเฉพาะฟิลด์ที่มีค่า) */
export function billToJson(b: Bill): Record<string, unknown> {
  const out: Record<string, unknown> = { id: b.id, name: b.name, amount: b.amount, dueDay: b.dueDay };
  if (b.walletId !== undefined) out.walletId = b.walletId;
  if (b.categoryId !== undefined) out.categoryId = b.categoryId;
  if (b.lastPaidMonth !== undefined) out.lastPaidMonth = b.lastPaidMonth;
  if (b.startMonth !== undefined) out.startMonth = b.startMonth;
  if (b.archived !== undefined) out.archived = b.archived;
  return out;
}

/** ฟิลด์ที่ผู้ใช้แก้ได้ของบิล (ไม่รวม lastPaidMonth/startMonth: เปลี่ยนผ่านการจ่าย/ยกเลิกเท่านั้น R15) */
function billEditableColumns(b: Bill): Record<string, unknown> {
  return {
    name: b.name,
    amount: b.amount,
    due_day: b.dueDay,
    wallet_id: b.walletId ?? null,
    category_id: b.categoryId ?? null,
    archived: b.archived === true,
  };
}

const RECURRING_LOCKED = 'รายการนี้เกิดจากการจ่ายบิล แก้หรือลบจากสมุดบัญชีไม่ได้ (เลิกทำได้ทันทีหลังจ่ายจากปุ่ม "เลิกทำ")';

// ---------- repository ----------

export interface SupabaseRepositoryOptions {
  /**
   * ขอรหัสผ่านจากผู้ใช้ตอนล้างข้อมูลทั้งหมด (ฐานข้อมูลตรวจรหัสและจำกัดการลอง) · ไม่ให้ = ล้างไม่ได้
   * เหตุผล: session ที่ถูกขโมยต้องล้างสมุดทั้งเล่มไม่ได้โดยไม่รู้รหัสผ่าน (ผล security-auditor M2-C2)
   */
  getPasswordForReset?: () => Promise<string>;
}

export function createSupabaseRepository(client: SupabaseClient, userId: string, options: SupabaseRepositoryOptions = {}): LedgerRepository {
  if (typeof userId !== 'string' || userId === '') throw new StorageError('ต้องเข้าสู่ระบบก่อนใช้งานข้อมูล');

  const check = (error: DbError | null | undefined): void => {
    if (error) throw storageErrorFrom(error);
  };

  /**
   * อ่านทุกหน้า (PostgREST จำกัดแถวต่อคำขอ) แล้วตรวจให้ครบจริง:
   * ตัดแถวซ้ำด้วย id (ถ้ามีการเขียนแทรกระหว่างหน้า) และเทียบจำนวนแถวกับ count ของตาราง · ไม่ตรง = อ่านใหม่ (สูงสุด 3 รอบ)
   * ไม่ตรงทุกรอบ (เช่น เพดานแถวของเซิร์ฟเวอร์ต่ำกว่า PAGE) = ปฏิเสธ ไม่ปล่อยข้อมูลขาดเงียบๆ
   */
  async function fetchAll<T extends { id: string }>(
    table: string,
    build: (from: number, to: number) => PromiseLike<{ data: unknown; error: DbError | null }>,
  ): Promise<T[]> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const byId = new Map<string, T>();
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await build(from, from + PAGE - 1);
        check(error);
        const rows = (data ?? []) as T[];
        for (const row of rows) byId.set(row.id, row);
        if (rows.length < PAGE) break;
      }
      const { count, error } = await client.from(table).select('id', { count: 'exact', head: true });
      check(error);
      if (count === null || count === undefined || count === byId.size) return [...byId.values()];
    }
    throw new StorageError('ข้อมูลเปลี่ยนระหว่างอ่านหรืออ่านไม่ครบ ลองใหม่อีกครั้ง');
  }

  async function loadAccounts(): Promise<Account[]> {
    const rows = await fetchAll<AccountRow>('accounts', (from, to) => client.from('accounts').select('*').order('id').range(from, to));
    const accounts = rows.map(rowToAccount);
    const rank = (a: Account) => a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    accounts.sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name), 'th'));
    return accounts;
  }

  async function fetchEntry(id: string): Promise<Entry | null> {
    const { data, error } = await client.from('entries').select(ENTRY_COLUMNS).eq('id', id).order('idx', { referencedTable: 'lines' }).maybeSingle();
    check(error);
    return data ? rowToEntry(data as unknown as EntryRow) : null;
  }

  async function fetchBill(id: string): Promise<Bill | null> {
    const { data, error } = await client.from('bills').select('*').eq('id', id).maybeSingle();
    check(error);
    return data ? rowToBill(data as unknown as BillRow) : null;
  }

  const accountGetter = async () => {
    const accounts = await loadAccounts();
    return async (id: string) => accounts.find((a) => a.id === id);
  };

  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await client.rpc(name, args);
    check(error);
    return data;
  }

  async function deleteEntryRow(id: string): Promise<void> {
    const { error } = await client.from('entries').delete().eq('id', id);
    check(error);
  }

  async function loadBills(): Promise<Bill[]> {
    const rows = await fetchAll<BillRow>('bills', (from, to) => client.from('bills').select('*').order('id').range(from, to));
    return rows.map(rowToBill).sort((a, b) => String(a.name).localeCompare(String(b.name), 'th') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  async function loadLedger(): Promise<Ledger> {
    const [accounts, rows] = await Promise.all([
      loadAccounts(),
      fetchAll<EntryRow>('entries', (from, to) =>
        client.from('entries').select(ENTRY_COLUMNS).order('date').order('id').order('idx', { referencedTable: 'lines' }).range(from, to),
      ),
    ]);
    const entries = rows.map(rowToEntry);
    entries.sort(compareEntries);
    return { accounts, entries };
  }

  async function loadSettings(): Promise<FinanceSettings> {
    const { data, error } = await client.from('settings').select('value').maybeSingle();
    check(error);
    return sanitizeSettings((data as { value?: unknown } | null)?.value);
  }

  /** คืนบิลหลังยกเลิกการจ่าย (อ่านค่าจริงจากฐานข้อมูลหลัง trigger ทำงาน) */
  async function cancelPayment(entry: Entry): Promise<Bill | undefined> {
    const link = entry.bill;
    if (entry.source !== 'recurring' || !link) {
      throw new StorageError('ยกเลิกได้เฉพาะรายการจ่ายบิลที่ผูกกับบิล (รายการที่จ่ายก่อนอัปเดตยังยกเลิกจากหน้านี้ไม่ได้)');
    }
    const bill = await fetchBill(link.id);
    if (!bill) {
      await deleteEntryRow(entry.id);
      return undefined;
    }
    if (bill.lastPaidMonth !== link.cycle) {
      throw new StorageError(`ยกเลิกรอบ ${link.cycle} ไม่ได้ เพราะบิลนี้จ่ายรอบหลังจากนั้นแล้ว ให้ยกเลิกรอบล่าสุดก่อน`);
    }
    if (link.before !== undefined && link.before >= link.cycle) {
      throw new StorageError('ข้อมูลลิงก์การจ่ายบิลผิดปกติ (รอบก่อนหน้าต้องมาก่อนรอบที่จ่าย) ไม่ลบรายการ');
    }
    await deleteEntryRow(entry.id); // trigger คืน lastPaidMonth ในธุรกรรมเดียวกัน
    return (await fetchBill(link.id)) ?? undefined;
  }

  return {
    loadLedger,

    async isEmpty() {
      const { count, error } = await client.from('accounts').select('id', { count: 'exact', head: true });
      check(error);
      return (count ?? 0) === 0;
    },

    async saveInitialLedger(ledger) {
      const report = runIntegrityCheck(ledger.accounts, ledger.entries);
      if (!report.ok) throw new StorageError(`ข้อมูลตั้งต้นไม่ผ่านการตรวจ: ${report.issues[0]?.message ?? ''}`);
      await rpc('setup_ledger', { p_accounts: ledger.accounts.map(accountToJson), p_entries: ledger.entries.map(entryToJson) });
    },

    async appendEntry(input: NewEntry) {
      const accounts = await loadAccounts();
      const entry = createEntry(accounts, { ...input, createdAt: input.createdAt ?? nextCreatedAt() });
      await rpc('create_entry', { p_entry: entryToJson(entry) });
      return entry;
    },

    async updateEntry(id, input) {
      if (input.id !== id) throw new StorageError('รหัสรายการไม่ตรงกัน');
      const before = await fetchEntry(id);
      if (!before) throw new StorageError('ไม่พบรายการนี้ อาจถูกลบไปแล้ว');
      if (before.source === 'system') throw new StorageError('แก้ไขรายการยอดยกมาไม่ได้');
      if (before.source === 'recurring') throw new StorageError(RECURRING_LOCKED);
      const accounts = await loadAccounts();
      const built = createEntry(accounts, { ...input, createdAt: input.createdAt ?? before.createdAt });
      await rpc('update_entry', { p_entry: entryToJson(built) });
      const after = await fetchEntry(id);
      if (!after) throw new StorageError('ไม่พบรายการนี้ อาจถูกลบไปแล้ว');
      return { before, after };
    },

    async deleteEntry(id) {
      const entry = await fetchEntry(id);
      if (!entry) throw new StorageError('ไม่พบรายการนี้ อาจถูกลบไปแล้ว');
      if (entry.source === 'system') throw new StorageError('ลบรายการยอดยกมาไม่ได้');
      if (entry.source === 'recurring' || entry.bill !== undefined) {
        if (!entry.bill) throw new StorageError(RECURRING_LOCKED);
        await cancelPayment(entry);
        return entry;
      }
      await deleteEntryRow(id);
      return entry;
    },

    async exportSnapshot(now: Date = new Date()): Promise<Snapshot> {
      // ไม่มีธุรกรรมอ่านข้ามคำขอ: อ่านแล้วอ่านบิลซ้ำเพื่อเทียบ (บิลเปลี่ยน = มีการจ่าย/แก้แทรก) ไม่ตรงอ่านใหม่ สูงสุด 3 รอบ
      for (let attempt = 0; attempt < 3; attempt++) {
        const [ledger, bills, settings] = await Promise.all([loadLedger(), loadBills(), loadSettings()]);
        const again = await loadBills();
        if (JSON.stringify(again) === JSON.stringify(bills)) {
          return { schemaVersion: SCHEMA_VERSION, exportedAt: now.toISOString(), ...ledger, bills, settings };
        }
      }
      throw new StorageError('ข้อมูลเปลี่ยนระหว่างสำรอง ลองใหม่อีกครั้ง');
    },

    async resetAll() {
      if (!options.getPasswordForReset) throw new StorageError('ล้างข้อมูลออนไลน์ต้องยืนยันด้วยรหัสผ่าน (ยังไม่ได้ต่อช่องกรอกรหัส)');
      const password = await options.getPasswordForReset();
      const ok = await rpc('reset_my_ledger', { p_password: password });
      if (ok !== true) throw new StorageError('รหัสผ่านไม่ถูกต้อง ไม่ได้ล้างข้อมูล');
    },

    loadBills,

    async addBill(input, today) {
      const picked = pickBill(input);
      const bill: Bill = { ...picked, startMonth: picked.startMonth ?? currentMonth(today) };
      assertNotFuture(bill.lastPaidMonth, today);
      await assertBillWritableWith(await accountGetter(), bill);
      if (await fetchBill(bill.id)) throw new StorageError('มีบิลรหัสนี้อยู่แล้ว ไม่เขียนทับ');
      const { error } = await client.from('bills').insert({
        id: bill.id,
        ...billEditableColumns(bill),
        last_paid_month: bill.lastPaidMonth ?? null,
        start_month: bill.startMonth ?? null,
      });
      check(error);
      return bill;
    },

    async updateBill(input) {
      const picked = pickBill(input);
      const existing = await fetchBill(picked.id);
      if (!existing) throw new StorageError('ไม่พบบิลนี้ อาจถูกลบไปแล้ว');
      const { lastPaidMonth: _p, startMonth: _s, ...fields } = picked;
      void _p;
      void _s;
      const bill: Bill = { ...fields };
      if (existing.lastPaidMonth !== undefined) bill.lastPaidMonth = existing.lastPaidMonth;
      if (existing.startMonth !== undefined) bill.startMonth = existing.startMonth;
      await assertBillWritableWith(await accountGetter(), bill);
      const { error } = await client.from('bills').update(billEditableColumns(bill)).eq('id', bill.id);
      check(error);
      return bill;
    },

    async deleteBill(id) {
      const bill = await fetchBill(id);
      if (!bill) throw new StorageError('ไม่พบบิลนี้ อาจถูกลบไปแล้ว');
      const { error } = await client.from('bills').delete().eq('id', id);
      check(error);
      return bill;
    },

    async payBill(billId: string, options: PayBillOptions): Promise<PayBillResult> {
      currentMonth(options.today);
      const bill = await fetchBill(billId);
      if (!bill) throw new StorageError('ไม่พบบิลนี้ อาจถูกลบไปแล้ว');
      if (bill.archived === true) throw new StorageError(`บิล "${bill.name}" ถูกเก็บถาวรแล้ว จ่ายไม่ได้`);
      const problem = billProblem(bill);
      if (problem) throw new StorageError(`บิลไม่ถูกต้อง: ${problem}`);
      const cycle = payableCycle(bill, options.today);
      if (cycle !== null && options.expectedCycle !== undefined && options.expectedCycle !== cycle) {
        throw new StorageError('รอบที่ต้องจ่ายของบิลนี้เปลี่ยนไปแล้ว ปิดหน้าต่างนี้แล้วดูสถานะบิลอีกครั้ง');
      }
      if (cycle === null) throw new StorageError(`บิล "${bill.name}" จ่ายครบทุกรอบแล้ว`);
      try {
        markBillPaid(bill, cycle, options.today);
      } catch (e) {
        throw new StorageError(e instanceof Error ? e.message : String(e));
      }
      // ยอดที่จ่ายจริง (R15): ไม่ระบุ = ยอดบิล · ระบุได้ต่างจากยอดบิล (ค่าไฟ/ค่าน้ำ) ต้องเป็นจำนวนเต็มสตางค์บวกที่ปลอดภัย
      const amount = options.amount ?? bill.amount;
      const amountIssue = payAmountProblem(amount);
      if (amountIssue) throw new StorageError(amountIssue);
      const walletId = options.walletId ?? bill.walletId;
      const categoryId = options.categoryId ?? bill.categoryId;
      if (walletId === undefined) throw new StorageError('เลือกกระเป๋าที่จะจ่ายบิล');
      if (categoryId === undefined) throw new StorageError('เลือกหมวดรายจ่ายของบิล');
      const accounts = await loadAccounts();
      const wallet = accounts.find((a) => a.id === walletId);
      const category = accounts.find((a) => a.id === categoryId);
      if (!wallet || wallet.type !== 'asset' || wallet.currency !== 'THB' || wallet.archived === true) {
        throw new StorageError('กระเป๋าที่จ่ายต้องเป็นกระเป๋าเงินบาทที่ใช้งานอยู่');
      }
      if (!category || category.type !== 'expense' || category.currency !== 'THB' || category.archived === true) {
        throw new StorageError('หมวดต้องเป็นหมวดรายจ่ายที่ใช้งานอยู่');
      }
      const entry = createEntry(accounts, {
        id: options.entryId,
        date: options.today,
        memo: bill.name,
        source: 'recurring',
        bill: bill.lastPaidMonth === undefined ? { id: bill.id, cycle } : { id: bill.id, cycle, before: bill.lastPaidMonth },
        createdAt: nextCreatedAt(),
        lines: [
          { accountId: category.id, amount },
          { accountId: wallet.id, amount: -amount },
        ],
      });
      // ครั้งเดียว: ฐานข้อมูลสร้างรายการและตั้ง lastPaidMonth ในธุรกรรมเดียว (trigger) · รอบซ้ำ/สถานะเปลี่ยน = ปฏิเสธทั้งก้อน
      await rpc('create_entry', { p_entry: entryToJson(entry) });
      return { entry, cycle, before: bill.lastPaidMonth };
    },

    async undoPayBill(input) {
      const entry = await fetchEntry(input.entryId);
      if (!entry) throw new StorageError('ไม่พบรายการจ่ายบิลนี้ อาจถูกลบไปแล้ว');
      if (entry.source !== 'recurring') throw new StorageError('เลิกทำได้เฉพาะรายการที่เกิดจากการจ่ายบิล');
      const bill = await fetchBill(input.billId);
      if (!bill) throw new StorageError('ไม่พบบิลนี้ อาจถูกลบไปแล้ว');
      if (bill.lastPaidMonth !== input.cycle) throw new StorageError('สถานะจ่ายของบิลถูกเปลี่ยนไปแล้ว เลิกทำไม่ได้');
      await deleteEntryRow(input.entryId);
    },

    async cancelBillPayment(entryId) {
      const entry = await fetchEntry(entryId);
      if (!entry) throw new StorageError('ไม่พบรายการนี้ อาจถูกลบไปแล้ว');
      return { entry, bill: await cancelPayment(entry) };
    },

    async cancelLatestBillPayment(billId) {
      const bill = await fetchBill(billId);
      if (!bill) throw new StorageError('ไม่พบบิลนี้ อาจถูกลบไปแล้ว');
      if (bill.lastPaidMonth === undefined) throw new StorageError(`บิล "${bill.name}" ยังไม่เคยจ่าย`);
      const { data, error } = await client
        .from('entries')
        .select(ENTRY_COLUMNS)
        .eq('source', 'recurring')
        .eq('bill_id', billId)
        .eq('bill_cycle', bill.lastPaidMonth)
        .order('idx', { referencedTable: 'lines' })
        .limit(1);
      check(error);
      const row = (data as unknown as EntryRow[] | null)?.[0];
      if (!row) {
        throw new StorageError(`ไม่พบรายการจ่ายบิล "${bill.name}" รอบ ${bill.lastPaidMonth} ที่ผูกกับบิล (อาจจ่ายก่อนอัปเดต)`);
      }
      const entry = rowToEntry(row);
      return { entry, bill: await cancelPayment(entry) };
    },

    loadSettings,

    async importBackup(data: BackupData) {
      const report = runIntegrityCheck(data.accounts, data.entries);
      if (!report.ok) throw new StorageError(`ข้อมูลนำเข้าไม่ผ่านการตรวจ: ${report.issues[0]?.message ?? ''}`);
      const settingsIssue = settingsProblem(data.settings);
      if (settingsIssue) throw new StorageError(`ค่าตั้งค่าไม่ถูกต้อง: ${settingsIssue}`);
      // ครั้งเดียว: ฐานข้อมูลเขียนทุกส่วนในธุรกรรมเดียว ผิดข้อใด = ย้อนกลับทั้งก้อน · มีข้อมูลอยู่แล้ว = ปฏิเสธ
      const out = (await rpc('import_ledger', {
        p_data: {
          accounts: data.accounts.map(accountToJson),
          bills: data.bills.map(billToJson),
          entries: data.entries.map(entryToJson),
          settings: sanitizeSettings(data.settings),
        },
      })) as { accounts?: number; entries?: number; bills?: number } | null;
      return { accounts: out?.accounts ?? 0, entries: out?.entries ?? 0, bills: out?.bills ?? 0 };
    },

    async saveSettings(settings) {
      const problem = settingsProblem(settings);
      if (problem) throw new StorageError(`ค่าตั้งค่าไม่ถูกต้อง: ${problem}`);
      const clean = sanitizeSettings(settings);
      const { error } = await client.from('settings').upsert({ user_id: userId, value: clean }, { onConflict: 'user_id' });
      check(error);
      return clean;
    },
  };
}
