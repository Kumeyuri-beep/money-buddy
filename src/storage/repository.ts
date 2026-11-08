import { monthOf } from '../domain/bills/calendar';
import { payAmountProblem } from '../domain/bills/payAmount';
import { billProblem, markBillPaid, payableCycle } from '../domain/bills/schedule';
import { sanitizeSettings, settingsProblem, type FinanceSettings } from '../domain/bills/settings';
import type { Bill } from '../domain/bills/types';
import { createEntry } from '../domain/ledger/entry';
import { runIntegrityCheck } from '../domain/ledger/integrity';
import type { Account, Entry, NewEntry } from '../domain/ledger/types';
import type { BackupData } from '../domain/backup/parseBackup';
import { SCHEMA_VERSION, type MoneyDB } from './db';

export interface Ledger {
  accounts: Account[];
  entries: Entry[];
}

export interface Snapshot extends Ledger {
  schemaVersion: number;
  exportedAt: string;
  bills: Bill[];
  settings: FinanceSettings;
}

let lastStamp = 0;

/** เวลาบันทึกที่เพิ่มขึ้นเสมอ (กดบันทึกติดกันใน 1 มิลลิวินาทีก็ยังเรียงถูก) */
export function nextCreatedAt(): string {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
}

/**
 * ลำดับรายการ: วันที่ก่อน ภายในวันเดียวกันยอดยกมาของระบบมาก่อน แล้วตามเวลาที่บันทึก
 * (IndexedDB คืนค่าเรียงตามรหัส ซึ่งเป็นรหัสสุ่ม จึงต้องเรียงเองเสมอ)
 */
export function compareEntries(a: Entry, b: Entry): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const sys = Number(b.source === 'system') - Number(a.source === 'system');
  if (sys !== 0) return sys;
  const ca = a.createdAt ?? '';
  const cb = b.createdAt ?? '';
  if (ca !== cb) return ca < cb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** รายการจ่ายบิลผูกกับสถานะ "จ่ายแล้ว" ของบิล แก้/ลบจากสมุดบัญชีตรงๆ ไม่ได้ (กันบิลค้างสถานะจ่ายทั้งที่รายจ่ายหาย) */
const RECURRING_LOCKED = 'รายการนี้เกิดจากการจ่ายบิล แก้หรือลบจากสมุดบัญชีไม่ได้ (เลิกทำได้ทันทีหลังจ่ายจากปุ่ม "เลิกทำ")';

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

/** อ่านสมุดบัญชีทั้งหมด เรียงรายการตามวันที่ */
export async function loadLedger(db: MoneyDB): Promise<Ledger> {
  const [accounts, entries] = await Promise.all([db.accounts.toArray(), db.entries.toArray()]);
  // IndexedDB คืนค่าเรียงตามรหัส ("wallet-10" มาก่อน "wallet-2") จึงเรียงใหม่ตาม sortOrder
  const rank = (a: Account) => a.sortOrder ?? Number.MAX_SAFE_INTEGER;
  accounts.sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name), 'th'));
  entries.sort(compareEntries);
  return { accounts, entries };
}

/** ฐานข้อมูลยังว่าง = ยังไม่เคยตั้งต้นใช้งาน */
export async function isEmpty(db: MoneyDB): Promise<boolean> {
  return (await db.accounts.count()) === 0;
}

/**
 * บันทึกบัญชีและรายการตั้งต้นในธุรกรรมเดียว (สำเร็จทั้งหมดหรือไม่สำเร็จเลย)
 * ตรวจ Integrity ก่อนเขียน และไม่เขียนทับฐานข้อมูลที่มีข้อมูลอยู่แล้ว
 */
export async function saveInitialLedger(db: MoneyDB, ledger: Ledger): Promise<void> {
  const report = runIntegrityCheck(ledger.accounts, ledger.entries);
  if (!report.ok) {
    throw new StorageError(`ข้อมูลตั้งต้นไม่ผ่านการตรวจ: ${report.issues[0]?.message ?? ''}`);
  }
  await db.transaction('rw', db.accounts, db.entries, db.meta, async () => {
    if ((await db.accounts.count()) > 0) {
      throw new StorageError('มีข้อมูลอยู่แล้ว ไม่เขียนทับ (ถ้าต้องการเริ่มใหม่ให้ล้างข้อมูลก่อน)');
    }
    await db.accounts.bulkAdd(ledger.accounts);
    await db.entries.bulkAdd(ledger.entries);
    await db.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION });
  });
}

/**
 * นำเข้าไฟล์สำรอง (ผ่าน parseBackup มาแล้ว) ทั้งก้อนในธุรกรรมเดียว · ไม่ทับข้อมูลเดิม
 * ตรวจซ้ำที่นี่ด้วย (Integrity + บิล) เพื่อไม่พึ่งว่าผู้เรียกตรวจมาแล้ว
 */
export async function importBackup(db: MoneyDB, data: BackupData): Promise<{ accounts: number; entries: number; bills: number }> {
  const report = runIntegrityCheck(data.accounts, data.entries);
  if (!report.ok) throw new StorageError(`ข้อมูลนำเข้าไม่ผ่านการตรวจ: ${report.issues[0]?.message ?? ''}`);
  for (const bill of data.bills) {
    const problem = billProblem(bill);
    if (problem) throw new StorageError(`บิล ${bill.id} ไม่ถูกต้อง: ${problem}`);
  }
  const settingsIssue = settingsProblem(data.settings);
  if (settingsIssue) throw new StorageError(`ค่าตั้งค่าไม่ถูกต้อง: ${settingsIssue}`);
  await db.transaction('rw', db.accounts, db.entries, db.bills, db.meta, async () => {
    if ((await db.accounts.count()) > 0 || (await db.entries.count()) > 0 || (await db.bills.count()) > 0) {
      throw new StorageError('มีข้อมูลอยู่แล้ว นำเข้าไม่ได้ (ไม่ทับข้อมูลเดิม)');
    }
    await db.accounts.bulkAdd(data.accounts);
    await db.entries.bulkAdd(data.entries);
    await db.bills.bulkAdd(data.bills);
    const clean = sanitizeSettings(data.settings);
    if (Object.keys(clean).length > 0) await db.meta.put({ key: SETTINGS_KEY, value: clean });
    await db.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION });
  });
  return { accounts: data.accounts.length, entries: data.entries.length, bills: data.bills.length };
}

/** เพิ่มรายการใหม่ ผ่าน createEntry เสมอ รายการไม่สมดุลหรือบัญชีไม่มีจะถูกปฏิเสธก่อนเขียน */
export async function appendEntry(db: MoneyDB, input: NewEntry): Promise<Entry> {
  return db.transaction('rw', db.accounts, db.entries, async () => {
    const accounts = await db.accounts.toArray();
    // คง createdAt เดิมเมื่อกู้คืนรายการที่ลบ (เลิกทำการลบ) เพื่อให้กลับไปอยู่ตำแหน่งเดิม
    const entry = createEntry(accounts, { ...input, createdAt: input.createdAt ?? nextCreatedAt() });
    await db.entries.add(entry); // id ซ้ำจะ error ไม่เขียนทับ
    return entry;
  });
}

/**
 * แก้ไขรายการเดิม (รหัสเดิม) ผ่าน createEntry เสมอ ห้ามแก้รายการยอดยกมาของระบบ
 * คืนทั้งก่อนและหลังแก้ เพื่อให้ปุ่ม "เลิกทำ" ย้อนกลับได้
 */
export async function updateEntry(
  db: MoneyDB,
  id: string,
  input: NewEntry,
): Promise<{ before: Entry; after: Entry }> {
  if (input.id !== id) throw new StorageError('รหัสรายการไม่ตรงกัน');
  return db.transaction('rw', db.accounts, db.entries, async () => {
    const before = await db.entries.get(id);
    if (!before) throw new StorageError('ไม่พบรายการนี้ อาจถูกลบไปแล้ว');
    if (before.source === 'system') throw new StorageError('แก้ไขรายการยอดยกมาไม่ได้');
    if (before.source === 'recurring') throw new StorageError(RECURRING_LOCKED);
    // แก้ไขแล้วยังอยู่ตำแหน่งเดิมในวันนั้น
    const after = createEntry(await db.accounts.toArray(), { ...input, createdAt: input.createdAt ?? before.createdAt });
    await db.entries.put(after);
    return { before, after };
  });
}

/**
 * ลบรายการ (ใช้กับปุ่ม "เลิกทำ") ห้ามลบรายการยอดยกมาของระบบ
 * คืนรายการที่ลบไปเพื่อให้กู้คืนได้ในอนาคต
 */
export async function deleteEntry(db: MoneyDB, id: string): Promise<Entry> {
  return db.transaction('rw', db.entries, db.bills, async () => {
    const entry = await db.entries.get(id);
    if (!entry) throw new StorageError('ไม่พบรายการนี้ อาจถูกลบไปแล้ว');
    if (entry.source === 'system') throw new StorageError('ลบรายการยอดยกมาไม่ได้');
    if (entry.source === 'recurring' || entry.bill !== undefined) {
      // รายการจ่ายบิลที่ผูกกับบิลแล้ว: ลบ = ยกเลิกการจ่าย คืน lastPaidMonth พร้อมกัน (R15)
      if (!entry.bill) throw new StorageError(RECURRING_LOCKED);
      await cancelPaymentInTx(db, entry);
      return entry;
    }
    await db.entries.delete(id);
    return entry;
  });
}

/** สำเนาข้อมูลทั้งหมดสำหรับดาวน์โหลดเป็นไฟล์สำรอง */
export async function exportSnapshot(db: MoneyDB, now: Date = new Date()): Promise<Snapshot> {
  // อ่านทั้งหมดในธุรกรรมเดียว ไฟล์สำรองจึงสอดคล้องกันแม้มีการเขียนแทรก
  const { accounts, entries, bills, settings } = await db.transaction('r', [db.accounts, db.entries, db.bills, db.meta], async () => {
    const ledger = await loadLedger(db);
    return { ...ledger, bills: await loadBills(db), settings: await loadSettings(db) };
  });
  return { schemaVersion: SCHEMA_VERSION, exportedAt: now.toISOString(), accounts, entries, bills, settings };
}

/** ล้างข้อมูลทั้งหมด (ต้องให้ผู้ใช้ยืนยันและแนะนำให้สำรองก่อนเสมอ) */
export async function resetAll(db: MoneyDB): Promise<void> {
  await db.transaction('rw', db.accounts, db.entries, db.bills, db.meta, async () => {
    await db.accounts.clear();
    await db.entries.clear();
    await db.bills.clear();
    await db.meta.clear();
  });
}

// ---------- บิลประจำและค่าตั้งค่า (schema v2) ----------

const SETTINGS_KEY = 'settings';

/** ตรวจบิลก่อนเขียน: รูปแบบ (ยอด/วัน/เดือน) ชื่อไม่ว่าง และกระเป๋า/หมวดที่อ้างต้องมีจริงและเป็นชนิดที่ถูกต้อง */
/** สร้างบิลใหม่จากฟิลด์ที่รู้จักเท่านั้น (ไม่ copy ฟิลด์แปลก/__proto__) ชนิดผิดโยน StorageError ก่อนถึงตรวจรูปแบบ */
export function pickBill(raw: unknown): Bill {
  if (typeof raw !== 'object' || raw === null) throw new StorageError('บิลไม่ถูกต้อง: ข้อมูลไม่ใช่วัตถุ');
  const r = raw as Record<string, unknown>;
  const str = (key: string, required: boolean): string | undefined => {
    const v = r[key];
    if (v === undefined && !required) return undefined;
    if (typeof v !== 'string') throw new StorageError(`บิลไม่ถูกต้อง: ${key} ต้องเป็นข้อความ`);
    return v;
  };
  if (r.archived !== undefined && typeof r.archived !== 'boolean') {
    throw new StorageError('บิลไม่ถูกต้อง: archived ต้องเป็นจริง/เท็จ');
  }
  const bill = { id: str('id', true)!, name: str('name', true)!, amount: r.amount as number, dueDay: r.dueDay as number } as Bill;
  const optional = ['walletId', 'categoryId', 'lastPaidMonth', 'startMonth'] as const;
  for (const key of optional) {
    const v = str(key, false);
    if (v !== undefined) bill[key] = v;
  }
  if (r.archived !== undefined) bill.archived = r.archived;
  return bill;
}

async function assertBillWritable(db: MoneyDB, bill: Bill): Promise<void> {
  await assertBillWritableWith((id) => db.accounts.get(id), bill);
}

/** ตรวจบิลก่อนเขียนโดยไม่ผูกกับที่เก็บข้อมูล (ใช้ร่วมกับ Dexie และ Supabase) */
export async function assertBillWritableWith(getAccount: (id: string) => Promise<Account | undefined>, bill: Bill): Promise<void> {
  const problem = billProblem(bill) ?? (bill.name.trim() === '' ? 'ชื่อบิลต้องไม่ว่าง' : null);
  if (problem) throw new StorageError(`บิลไม่ถูกต้อง: ${problem}`);
  if (bill.id.trim() === '') throw new StorageError('บิลไม่ถูกต้อง: รหัสบิลต้องไม่ว่าง');
  if (bill.walletId !== undefined) {
    const wallet = await getAccount(bill.walletId);
    if (!wallet || wallet.type !== 'asset') throw new StorageError('บิลไม่ถูกต้อง: กระเป๋าที่จ่ายต้องเป็นกระเป๋าที่มีอยู่จริง');
  }
  if (bill.categoryId !== undefined) {
    const category = await getAccount(bill.categoryId);
    if (!category || category.type !== 'expense') throw new StorageError('บิลไม่ถูกต้อง: หมวดต้องเป็นหมวดรายจ่ายที่มีอยู่จริง');
  }
}

/** อ่านบิลทั้งหมด (รวมที่เก็บถาวร) เรียงตามชื่อแล้วรหัส */
export async function loadBills(db: MoneyDB): Promise<Bill[]> {
  const bills = await db.bills.toArray();
  return bills.sort((a, b) => String(a.name).localeCompare(String(b.name), 'th') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** เดือนของวันนี้ ถ้าวันที่ผิดรูปให้เป็น StorageError (ชนิด error สม่ำเสมอ) */
export function currentMonth(today: string): string {
  try {
    return monthOf(today);
  } catch {
    throw new StorageError(`วันที่ไม่ถูกต้อง: "${String(today)}"`);
  }
}

/** lastPaidMonth ต้องไม่เกินเดือนปัจจุบันในทุกเส้นทางเขียน (ข้อ 16) ไม่งั้นเทียบแบบ >= จะทำให้บิลหายจากยอดค้างถาวร */
export function assertNotFuture(month: string | undefined, today: string): void {
  if (month !== undefined && month > currentMonth(today)) {
    throw new StorageError(`บิลไม่ถูกต้อง: lastPaidMonth (${month}) เป็นเดือนในอนาคต`);
  }
}

/** เพิ่มบิล ถ้าไม่ระบุ startMonth จะตั้งเป็นเดือนของวันนี้ (บิลที่เพิ่งตั้งไม่ถูกมองว่าค้างมาก่อน) รหัสซ้ำถูกปฏิเสธ */
export async function addBill(db: MoneyDB, input: Bill, today: string): Promise<Bill> {
  const picked = pickBill(input);
  const bill: Bill = { ...picked, startMonth: picked.startMonth ?? currentMonth(today) };
  assertNotFuture(bill.lastPaidMonth, today);
  return db.transaction('rw', db.accounts, db.bills, async () => {
    await assertBillWritable(db, bill);
    if (await db.bills.get(bill.id)) throw new StorageError('มีบิลรหัสนี้อยู่แล้ว ไม่เขียนทับ');
    await db.bills.add(bill);
    return bill;
  });
}

/**
 * แก้บิลเดิม (รหัสเดิม) ไม่พบหรือข้อมูลผิดรูปถูกปฏิเสธโดยไม่แตะของเดิม
 * lastPaidMonth และ startMonth คงตามแถวเดิมเสมอ (ค่าที่ส่งมาถูกละเลย) กันฟอร์มเก่าทับสถานะจ่ายแล้วจ่ายซ้ำ (R15)
 * เปลี่ยน lastPaidMonth ผ่าน setBillPaidMonth เท่านั้น
 */
export async function updateBill(db: MoneyDB, input: Bill): Promise<Bill> {
  const picked = pickBill(input);
  return db.transaction('rw', db.accounts, db.bills, async () => {
    const existing = await db.bills.get(picked.id);
    if (!existing) throw new StorageError('ไม่พบบิลนี้ อาจถูกลบไปแล้ว');
    const { lastPaidMonth: _p, startMonth: _s, ...fields } = picked;
    void _p;
    void _s;
    const bill: Bill = { ...fields };
    if (existing.lastPaidMonth !== undefined) bill.lastPaidMonth = existing.lastPaidMonth;
    if (existing.startMonth !== undefined) bill.startMonth = existing.startMonth;
    await assertBillWritable(db, bill);
    await db.bills.put(bill);
    return bill;
  });
}

/**
 * ตั้ง/ล้าง lastPaidMonth ของบิล คืนค่าเดิม (before) เพื่อให้ Undo คืนค่าเดิมได้ (ไม่ใช่ลบทิ้ง)
 * month = undefined คือล้างค่า ปฏิเสธเดือนอนาคต ไม่ตรวจกฎจ่ายซ้ำที่นี่ (อยู่ใน domain markBillPaid)
 * options.ifCurrently: compare-and-set ใช้กับ Undo ถ้าค่าปัจจุบันไม่ตรง (ถูกเปลี่ยนไปแล้ว) จะปฏิเสธ ไม่ทับค่าที่ใหม่กว่า
 */
export async function setBillPaidMonth(
  db: MoneyDB,
  id: string,
  month: string | undefined,
  today: string,
  options: { ifCurrently?: string | undefined } = {},
): Promise<{ before: string | undefined; bill: Bill }> {
  assertNotFuture(month, today);
  return db.transaction('rw', db.bills, async () => {
    const current = await db.bills.get(id);
    if (!current) throw new StorageError('ไม่พบบิลนี้ อาจถูกลบไปแล้ว');
    const { lastPaidMonth: before, ...rest } = current;
    if ('ifCurrently' in options && options.ifCurrently !== before) {
      throw new StorageError('สถานะจ่ายของบิลถูกเปลี่ยนไปแล้ว เลิกทำไม่ได้');
    }
    const next: Bill = month === undefined ? rest : { ...rest, lastPaidMonth: month };
    const problem = billProblem(next);
    if (problem) throw new StorageError(`บิลไม่ถูกต้อง: ${problem}`);
    await db.bills.put(next);
    return { before, bill: next };
  });
}

export interface PayBillOptions {
  /** วันนี้ YYYY-MM-DD (วันที่ของรายการจ่าย) */
  today: string;
  /** รอบที่ผู้ใช้เห็นบนหน้าจอ ถ้าไม่ตรงกับรอบที่ต้องจ่ายจริงจะปฏิเสธ (กันจ่ายผิดรอบจากหน้าจอเก่า) */
  expectedCycle?: string;
  /** ยอดที่จ่ายจริง (สตางค์) ไม่ระบุ = ยอดบิล · ต่างจากยอดบิลได้ การถามยืนยันเมื่อต่างเกิน 20% เป็นหน้าที่ของหน้าจอ */
  amount?: number;
  /** รหัสรายการที่จะสร้าง */
  entryId: string;
  /** กระเป๋าที่จ่าย ถ้าไม่ระบุใช้ของบิล ไม่มีทั้งสองที่ = ปฏิเสธ (ไม่เลือกให้เงียบๆ) */
  walletId?: string;
  /** หมวดรายจ่าย ถ้าไม่ระบุใช้ของบิล */
  categoryId?: string;
}

export interface PayBillResult {
  entry: Entry;
  /** รอบที่จ่าย YYYY-MM */
  cycle: string;
  /** lastPaidMonth ก่อนจ่าย (ใช้เลิกทำ) */
  before: string | undefined;
}

/**
 * จ่ายบิล: สร้างรายจ่ายจริง (source 'recurring') และตั้ง lastPaidMonth ในธุรกรรมเดียว (R15, R4)
 * จ่ายรอบที่ค้างเก่าที่สุดเสมอ (payableCycle) จ่ายซ้ำ/บิลเก็บถาวร/ไม่มีรอบที่ต้องจ่าย = ปฏิเสธ
 * รายการล้มเหลวที่ขั้นใดก็ตาม บิลจะไม่ถูกตั้งว่าจ่าย
 */
export async function payBill(db: MoneyDB, billId: string, options: PayBillOptions): Promise<PayBillResult> {
  currentMonth(options.today); // วันที่ผิดรูป -> StorageError
  return db.transaction('rw', db.accounts, db.entries, db.bills, async () => {
    const bill = await db.bills.get(billId);
    if (!bill) throw new StorageError('ไม่พบบิลนี้ อาจถูกลบไปแล้ว');
    if (bill.archived === true) throw new StorageError(`บิล "${bill.name}" ถูกเก็บถาวรแล้ว จ่ายไม่ได้`);
    const problem = billProblem(bill);
    if (problem) throw new StorageError(`บิลไม่ถูกต้อง: ${problem}`);

    const cycle = payableCycle(bill, options.today);
    if (cycle !== null && options.expectedCycle !== undefined && options.expectedCycle !== cycle) {
      throw new StorageError('รอบที่ต้องจ่ายของบิลนี้เปลี่ยนไปแล้ว ปิดหน้าต่างนี้แล้วดูสถานะบิลอีกครั้ง');
    }
    if (cycle === null) throw new StorageError(`บิล "${bill.name}" จ่ายครบทุกรอบแล้ว`);
    let paid: Bill;
    try {
      paid = markBillPaid(bill, cycle, options.today);
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
    const accounts = await db.accounts.toArray();
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
    await db.entries.add(entry); // id ซ้ำจะ error ทั้งก้อน
    await db.bills.put(paid);
    return { entry, cycle, before: bill.lastPaidMonth };
  });
}

/**
 * เลิกทำการจ่ายบิล: ลบรายการจ่ายและคืน lastPaidMonth เดิมในธุรกรรมเดียว
 * ปฏิเสธถ้ารายการหาย ไม่ใช่รายการ recurring หรือสถานะจ่ายของบิลไม่ตรงกับที่เพิ่งตั้ง (ถูกเปลี่ยนไปแล้ว)
 */
export async function undoPayBill(
  db: MoneyDB,
  input: { entryId: string; billId: string; cycle: string; before: string | undefined },
): Promise<void> {
  await db.transaction('rw', db.entries, db.bills, async () => {
    const entry = await db.entries.get(input.entryId);
    if (!entry) throw new StorageError('ไม่พบรายการจ่ายบิลนี้ อาจถูกลบไปแล้ว');
    if (entry.source !== 'recurring') throw new StorageError('เลิกทำได้เฉพาะรายการที่เกิดจากการจ่ายบิล');
    const bill = await db.bills.get(input.billId);
    if (!bill) throw new StorageError('ไม่พบบิลนี้ อาจถูกลบไปแล้ว');
    if (bill.lastPaidMonth !== input.cycle) throw new StorageError('สถานะจ่ายของบิลถูกเปลี่ยนไปแล้ว เลิกทำไม่ได้');
    const { lastPaidMonth: _current, ...rest } = bill;
    void _current;
    const restored: Bill = input.before === undefined ? rest : { ...rest, lastPaidMonth: input.before };
    const bad = billProblem(restored);
    if (bad) throw new StorageError(`บิลไม่ถูกต้อง: ${bad}`);
    await db.entries.delete(input.entryId);
    await db.bills.put(restored);
  });
}

/**
 * ลบรายการจ่ายบิลและคืน lastPaidMonth ในธุรกรรมที่เรียกอยู่ (ต้องเปิด rw entries+bills มาแล้ว)
 * ยกเลิกได้เฉพาะรอบล่าสุด (lastPaidMonth ตรงกับรอบของรายการ) ไม่งั้นปฏิเสธ ไม่แตะอะไร
 * บิลถูกลบไปแล้ว = ลบเฉพาะรายการ (ไม่มีอะไรให้คืน)
 */
async function cancelPaymentInTx(db: MoneyDB, entry: Entry): Promise<Bill | undefined> {
  const link = entry.bill;
  if (entry.source !== 'recurring' || !link) {
    throw new StorageError('ยกเลิกได้เฉพาะรายการจ่ายบิลที่ผูกกับบิล (รายการที่จ่ายก่อนอัปเดตยังยกเลิกจากหน้านี้ไม่ได้)');
  }
  const bill = await db.bills.get(link.id);
  if (!bill) {
    await db.entries.delete(entry.id);
    return undefined;
  }
  if (bill.lastPaidMonth !== link.cycle) {
    throw new StorageError(`ยกเลิกรอบ ${link.cycle} ไม่ได้ เพราะบิลนี้จ่ายรอบหลังจากนั้นแล้ว ให้ยกเลิกรอบล่าสุดก่อน`);
  }
  const { lastPaidMonth: _current, ...rest } = bill;
  void _current;
  const restored: Bill = link.before === undefined ? rest : { ...rest, lastPaidMonth: link.before };
  if (link.before !== undefined && link.before >= link.cycle) {
    throw new StorageError('ข้อมูลลิงก์การจ่ายบิลผิดปกติ (รอบก่อนหน้าต้องมาก่อนรอบที่จ่าย) ไม่ลบรายการ');
  }
  const bad = billProblem(restored);
  if (bad) throw new StorageError(`บิลไม่ถูกต้อง: ${bad}`);
  await db.entries.delete(entry.id);
  await db.bills.put(restored);
  return restored;
}

/** ยกเลิกการจ่ายบิลตามรหัสรายการ (ทุกกรณีจบในธุรกรรมเดียว) คืนรายการที่ลบและบิลที่คืนค่าแล้ว */
export async function cancelBillPayment(db: MoneyDB, entryId: string): Promise<{ entry: Entry; bill: Bill | undefined }> {
  return db.transaction('rw', db.entries, db.bills, async () => {
    const entry = await db.entries.get(entryId);
    if (!entry) throw new StorageError('ไม่พบรายการนี้ อาจถูกลบไปแล้ว');
    return { entry, bill: await cancelPaymentInTx(db, entry) };
  });
}

/** ยกเลิกการจ่ายรอบล่าสุดของบิล (หน้าบิล) หารายการจากลิงก์ ไม่พบ = ปฏิเสธ */
export async function cancelLatestBillPayment(
  db: MoneyDB,
  billId: string,
): Promise<{ entry: Entry; bill: Bill | undefined }> {
  return db.transaction('rw', db.entries, db.bills, async () => {
    const bill = await db.bills.get(billId);
    if (!bill) throw new StorageError('ไม่พบบิลนี้ อาจถูกลบไปแล้ว');
    if (bill.lastPaidMonth === undefined) throw new StorageError(`บิล "${bill.name}" ยังไม่เคยจ่าย`);
    const entry = (await db.entries.toArray()).find(
      (e) => e.source === 'recurring' && e.bill?.id === billId && e.bill.cycle === bill.lastPaidMonth,
    );
    if (!entry) {
      throw new StorageError(`ไม่พบรายการจ่ายบิล "${bill.name}" รอบ ${bill.lastPaidMonth} ที่ผูกกับบิล (อาจจ่ายก่อนอัปเดต)`);
    }
    return { entry, bill: await cancelPaymentInTx(db, entry) };
  });
}

const MIGRATION_SNAPSHOT_KEY = 'snapshot:v1';

/** สรุปสำเนาก่อนอัปเกรด (ถ้ามี) ไม่เชื่อรูปแบบข้อมูลที่เก็บไว้ */
export async function migrationSnapshotInfo(
  db: MoneyDB,
): Promise<{ takenAt: string | undefined; accounts: number; entries: number } | null> {
  const row = await db.meta.get(MIGRATION_SNAPSHOT_KEY);
  if (!row) return null;
  const v = typeof row.value === 'object' && row.value !== null ? (row.value as Record<string, unknown>) : {};
  return {
    takenAt: typeof v.takenAt === 'string' ? v.takenAt : undefined,
    accounts: Array.isArray(v.accounts) ? v.accounts.length : 0,
    entries: Array.isArray(v.entries) ? v.entries.length : 0,
  };
}

/** ลบสำเนาก่อนอัปเกรด (ผู้ใช้สั่งเอง) ไม่แตะบัญชี รายการ หรือบิลจริง */
export async function clearMigrationSnapshot(db: MoneyDB): Promise<void> {
  await db.meta.delete(MIGRATION_SNAPSHOT_KEY);
}

/** ลบบิล คืนบิลที่ลบไปเพื่อให้กู้คืนได้ (เรียกใช้เมื่อผู้ใช้ยืนยันแล้วเท่านั้น) */
export async function deleteBill(db: MoneyDB, id: string): Promise<Bill> {
  return db.transaction('rw', db.bills, async () => {
    const bill = await db.bills.get(id);
    if (!bill) throw new StorageError('ไม่พบบิลนี้ อาจถูกลบไปแล้ว');
    await db.bills.delete(id);
    return bill;
  });
}

/** อ่านค่าตั้งค่า ไม่เชื่อข้อมูลที่เก็บไว้: คืนเฉพาะฟิลด์ที่รู้จักและถูกต้อง ยังไม่ตั้ง = {} */
export async function loadSettings(db: MoneyDB): Promise<FinanceSettings> {
  return sanitizeSettings((await db.meta.get(SETTINGS_KEY))?.value);
}

/** บันทึกค่าตั้งค่าแทนทั้งชุด (ฟิลด์ที่ไม่ส่งมา = ไม่ตั้ง) ค่าผิดรูปถูกปฏิเสธก่อนเขียน */
export async function saveSettings(db: MoneyDB, settings: FinanceSettings): Promise<FinanceSettings> {
  const problem = settingsProblem(settings);
  if (problem) throw new StorageError(`ค่าตั้งค่าไม่ถูกต้อง: ${problem}`);
  const clean = sanitizeSettings(settings);
  await db.meta.put({ key: SETTINGS_KEY, value: clean });
  return clean;
}
