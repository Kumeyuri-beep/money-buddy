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
  accounts.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'th'));
  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
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
    const entry = createEntry(accounts, input);
    await db.entries.add(entry); // id ซ้ำจะ error ไม่เขียนทับ
    return entry;
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
  const { accounts, entries } = await loadLedger(db);
  return { schemaVersion: SCHEMA_VERSION, exportedAt: now.toISOString(), accounts, entries };
}

/** ล้างข้อมูลทั้งหมด (ต้องให้ผู้ใช้ยืนยันและแนะนำให้สำรองก่อนเสมอ) */
export async function resetAll(db: MoneyDB): Promise<void> {
  await db.transaction('rw', db.accounts, db.entries, db.meta, async () => {
    await db.accounts.clear();
    await db.entries.clear();
    await db.meta.clear();
  });
}
