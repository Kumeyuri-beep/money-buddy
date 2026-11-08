import type { FinanceSettings } from '../domain/bills/settings';
import type { Bill } from '../domain/bills/types';
import type { Entry, NewEntry } from '../domain/ledger/types';
import type { MoneyDB } from './db';
import * as dexie from './repository';
import type { Ledger, PayBillOptions, PayBillResult, Snapshot } from './repository';

/**
 * ช่องทางเดียวที่หน้าจอใช้อ่าน/เขียนข้อมูลการเงิน (แผน M2 ข้อ 4.4)
 * async ทุกเมธอดและไม่รู้ว่าข้างหลังเป็น Dexie (ในเครื่อง) หรือ Supabase (ออนไลน์)
 * ทุก implementation ต้องผ่านชุดเทสต์สัญญาเดียวกัน: tests/unit/repositoryContract.ts
 * ที่ยังอยู่นอก interface นี้โดยตั้งใจ: ตัวช่วยย้ายข้อมูลเฉพาะ Dexie (migration snapshot, local owner) จะหายไปใน M2-D
 */
export interface LedgerRepository {
  loadLedger(): Promise<Ledger>;
  isEmpty(): Promise<boolean>;
  saveInitialLedger(ledger: Ledger): Promise<void>;
  appendEntry(input: NewEntry): Promise<Entry>;
  updateEntry(id: string, input: NewEntry): Promise<{ before: Entry; after: Entry }>;
  deleteEntry(id: string): Promise<Entry>;
  exportSnapshot(now?: Date): Promise<Snapshot>;
  resetAll(): Promise<void>;

  loadBills(): Promise<Bill[]>;
  addBill(input: Bill, today: string): Promise<Bill>;
  updateBill(input: Bill): Promise<Bill>;
  deleteBill(id: string): Promise<Bill>;
  payBill(billId: string, options: PayBillOptions): Promise<PayBillResult>;
  undoPayBill(input: { entryId: string; billId: string; cycle: string; before: string | undefined }): Promise<void>;
  cancelBillPayment(entryId: string): Promise<{ entry: Entry; bill: Bill | undefined }>;
  cancelLatestBillPayment(billId: string): Promise<{ entry: Entry; bill: Bill | undefined }>;

  loadSettings(): Promise<FinanceSettings>;
  saveSettings(settings: FinanceSettings): Promise<FinanceSettings>;
}

/** implementation เดิม (IndexedDB) ห่อฟังก์ชันใน repository.ts ไม่เปลี่ยนพฤติกรรม */
export function createDexieRepository(db: MoneyDB): LedgerRepository {
  return {
    loadLedger: () => dexie.loadLedger(db),
    isEmpty: () => dexie.isEmpty(db),
    saveInitialLedger: (ledger) => dexie.saveInitialLedger(db, ledger),
    appendEntry: (input) => dexie.appendEntry(db, input),
    updateEntry: (id, input) => dexie.updateEntry(db, id, input),
    deleteEntry: (id) => dexie.deleteEntry(db, id),
    exportSnapshot: (now) => dexie.exportSnapshot(db, now),
    resetAll: () => dexie.resetAll(db),
    loadBills: () => dexie.loadBills(db),
    addBill: (input, today) => dexie.addBill(db, input, today),
    updateBill: (input) => dexie.updateBill(db, input),
    deleteBill: (id) => dexie.deleteBill(db, id),
    payBill: (billId, options) => dexie.payBill(db, billId, options),
    undoPayBill: (input) => dexie.undoPayBill(db, input),
    cancelBillPayment: (entryId) => dexie.cancelBillPayment(db, entryId),
    cancelLatestBillPayment: (billId) => dexie.cancelLatestBillPayment(db, billId),
    loadSettings: () => dexie.loadSettings(db),
    saveSettings: (settings) => dexie.saveSettings(db, settings),
  };
}
