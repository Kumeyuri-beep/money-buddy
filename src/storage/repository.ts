import { monthOf } from '../domain/bills/calendar';
import { billProblem } from '../domain/bills/schedule';
import { sanitizeSettings, settingsProblem, type FinanceSettings } from '../domain/bills/settings';
import type { Bill } from '../domain/bills/types';
import { createEntry } from '../domain/ledger/entry';
import { runIntegrityCheck } from '../domain/ledger/integrity';
import type { Account, Entry, NewEntry } from '../domain/ledger/types';
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
function nextCreatedAt(): string {
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
  return db.transaction('rw', db.entries, async () => {
    const entry = await db.entries.get(id);
    if (!entry) throw new StorageError('ไม่พบรายการนี้ อาจถูกลบไปแล้ว');
    if (entry.source === 'system') throw new StorageError('ลบรายการยอดยกมาไม่ได้');
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
function pickBill(raw: unknown): Bill {
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
  const problem = billProblem(bill) ?? (bill.name.trim() === '' ? 'ชื่อบิลต้องไม่ว่าง' : null);
  if (problem) throw new StorageError(`บิลไม่ถูกต้อง: ${problem}`);
  if (bill.id.trim() === '') throw new StorageError('บิลไม่ถูกต้อง: รหัสบิลต้องไม่ว่าง');
  if (bill.walletId !== undefined) {
    const wallet = await db.accounts.get(bill.walletId);
    if (!wallet || wallet.type !== 'asset') throw new StorageError('บิลไม่ถูกต้อง: กระเป๋าที่จ่ายต้องเป็นกระเป๋าที่มีอยู่จริง');
  }
  if (bill.categoryId !== undefined) {
    const category = await db.accounts.get(bill.categoryId);
    if (!category || category.type !== 'expense') throw new StorageError('บิลไม่ถูกต้อง: หมวดต้องเป็นหมวดรายจ่ายที่มีอยู่จริง');
  }
}

/** อ่านบิลทั้งหมด (รวมที่เก็บถาวร) เรียงตามชื่อแล้วรหัส */
export async function loadBills(db: MoneyDB): Promise<Bill[]> {
  const bills = await db.bills.toArray();
  return bills.sort((a, b) => String(a.name).localeCompare(String(b.name), 'th') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** เดือนของวันนี้ ถ้าวันที่ผิดรูปให้เป็น StorageError (ชนิด error สม่ำเสมอ) */
function currentMonth(today: string): string {
  try {
    return monthOf(today);
  } catch {
    throw new StorageError(`วันที่ไม่ถูกต้อง: "${String(today)}"`);
  }
}

/** lastPaidMonth ต้องไม่เกินเดือนปัจจุบันในทุกเส้นทางเขียน (ข้อ 16) ไม่งั้นเทียบแบบ >= จะทำให้บิลหายจากยอดค้างถาวร */
function assertNotFuture(month: string | undefined, today: string): void {
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
