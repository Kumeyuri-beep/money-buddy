import type { BackupData } from '../domain/backup/parseBackup';
import type { FinanceSettings } from '../domain/bills/settings';
import type { SettingsKey, SettingsPatch } from '../domain/bills/settingsPatch';
import type { Bill } from '../domain/bills/types';
import { emptyInvestments, type Asset, type AssetKind, type AssetPrice, type InvestmentData, type TradeRecord } from '../domain/invest/types';
import type { Account, Entry, NewEntry } from '../domain/ledger/types';
import type { MoneyDB } from './db';
import * as dexie from './repository';
import { StorageError, type Ledger, type PayBillOptions, type PayBillResult, type Snapshot } from './repository';

/**
 * ช่องทางเดียวที่หน้าจอใช้อ่าน/เขียนข้อมูลการเงิน (แผน M2 ข้อ 4.4)
 * async ทุกเมธอดและไม่รู้ว่าข้างหลังเป็น Dexie (ในเครื่อง) หรือ Supabase (ออนไลน์)
 * ทุก implementation ต้องผ่านชุดเทสต์สัญญาเดียวกัน: tests/unit/repositoryContract.ts
 * ที่ยังอยู่นอก interface นี้โดยตั้งใจ: ตัวช่วยย้ายข้อมูลเฉพาะ Dexie (migration snapshot, local owner) จะหายไปใน M2-D
 */
/** รายงานความคืบหน้าการนำเข้า (รายการที่นำเข้าแล้ว, ทั้งหมด) */
export type ImportProgress = (done: number, total: number) => void;

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

  /**
   * นำเข้าข้อมูลจากไฟล์สำรองที่ผ่าน parseBackup แล้ว ทั้งก้อนในธุรกรรมเดียว (M2-D)
   * ปฏิเสธถ้ามีข้อมูลอยู่แล้ว (ไม่ทับ ไม่ซ้ำซ้อน) · ผิดข้อใดข้อหนึ่ง = ไม่เขียนอะไรเลย
   */
  importBackup(data: BackupData, onProgress?: ImportProgress): Promise<{ accounts: number; entries: number; bills: number }>;
  /** ออนไลน์เท่านั้น: มีการนำเข้าแบบแบ่งก้อนที่ค้างอยู่ (ยังไม่ครบ) หรือไม่ · Dexie คืน false เสมอ */
  hasUnfinishedImport(): Promise<boolean>;
  /** ล้างข้อมูลที่นำเข้าค้าง (ใช้ได้เฉพาะขณะมีการนำเข้าค้าง ไม่ถามรหัสผ่าน) · Dexie ไม่ทำอะไร */
  abortUnfinishedImport(): Promise<void>;

  loadSettings(): Promise<FinanceSettings>;
  saveSettings(settings: FinanceSettings): Promise<FinanceSettings>;
  /**
   * เปลี่ยนเฉพาะคีย์ที่ส่ง (ค่า = ตั้ง · null หรืออาร์เรย์ว่าง = ลบ · undefined = ไม่แตะ) คีย์ที่ไม่ส่งคงเดิมเสมอ
   * ออนไลน์: เรียก RPC merge_settings (รวมฝั่งฐานข้อมูลในคำสั่งเดียว) แก้ช่องแข่งเขียนตอนเปิดสองแท็บ · ในเครื่อง: ธุรกรรมเดียว
   */
  patchSettings(patch: SettingsPatch): Promise<FinanceSettings>;
  /**
   * แก้ค่าตั้งค่าเฉพาะคีย์ที่ประกาศ (keys) โดยคำนวณจาก "ค่าล่าสุด" เสมอ แล้วเขียนแบบ compare-and-set: ปิดช่องเขียนทับข้ามแท็บของค่าที่เป็นอาร์เรย์
   * (แผน DCA ป้ายภาษี รายชื่อเกษียณ) · ออนไลน์: RPC merge_settings_if ถ้าอีกแท็บแก้ไปก่อนจะอ่านใหม่แล้วคำนวณใหม่ (สูงสุด 5 ครั้ง) · ในเครื่อง: ธุรกรรมเดียว
   * baseline = ค่าที่หน้าจอแสดงอยู่ (ใช้กับฟอร์มที่ผู้ใช้เห็นค่าอยู่ก่อนแก้): ถ้าคีย์ที่ประกาศต่างจาก baseline แล้ว = SettingsConflictError ไม่เขียนทับและไม่ลองซ้ำ
   * compute ต้องแตะเฉพาะคีย์ใน keys (นอกนั้นเป็นข้อผิดพลาดของโค้ด) · ลองซ้ำหมดแล้วยังชน = SettingsConflictError
   */
  updateSettings(keys: readonly SettingsKey[], compute: (current: FinanceSettings) => SettingsPatch, options?: { baseline?: FinanceSettings }): Promise<FinanceSettings>;

  // ---- พอร์ตลงทุน (P3) · ออนไลน์เท่านั้น (ที่เก็บในเครื่องไม่รองรับ: อ่านได้ว่าง เขียนแล้วแจ้งข้อผิดพลาด) ----
  loadInvestments(): Promise<InvestmentData>;
  /** สร้างสินทรัพย์ + บัญชีลงทุน (kind = investment) ของมัน · ล้มกลางทางจะลบบัญชีที่สร้างทิ้ง */
  addAsset(input: { id: string; name: string; kind: AssetKind }): Promise<Asset>;
  /** สร้างกระเป๋าเงินสดบาท (บัญชี asset ไม่ใช่บัญชีลงทุน ยอดเริ่มต้น 0) · ใช้เมื่อยังไม่มีกระเป๋าให้ผูกรายการลงทุน */
  addWallet(input: { id: string; name: string }): Promise<Account>;
  /**
   * เปลี่ยนป้าย kind ของบัญชีเงินสดสกุลบาท (normal = เงินใช้จ่าย · investment = เงินลงทุน) แม้มีรายการแล้ว (R23) · ไม่แตะ Entry/Line · ออนไลน์ผ่าน RPC set_account_kind
   * บัญชีที่ผูกสินทรัพย์/บัญชี USD/บัญชีที่เป็นกระเป๋าจ่ายของบิล (เมื่อเปลี่ยนเป็นลงทุน) = StorageError · ที่เก็บในเครื่องไม่รองรับ
   */
  setAccountKind(id: string, kind: 'normal' | 'investment'): Promise<void>;
  /**
   * เปลี่ยน "ชื่อที่แสดง" ของกระเป๋าเงิน (เจ้าของตัดสิน 13 พ.ย. 2569) · เขียนเฉพาะคอลัมน์ name เท่านั้น ห้ามแตะรหัสบัญชี ชนิด สกุลเงิน ยอด หรือรายการ
   * ชื่อว่าง/ยาวเกิน/ซ้ำกับกระเป๋าอื่น/ไม่ใช่กระเป๋าเงิน (เช่น บัญชีลงทุน หมวด ยอดยกมา) = StorageError ไม่เปลี่ยนอะไร
   * ทั้งสอง implementation ต้องผ่านชุดเทสต์สัญญาเดียวกัน
   */
  renameWallet(id: string, name: string): Promise<Account>;
  /**
   * เปลี่ยน "ชื่อที่แสดง" ของหมวดรายรับ/รายจ่าย (เจ้าของสั่ง 13 พ.ย. 2569 แบบเดียวกับกระเป๋า) · เขียนเฉพาะคอลัมน์ name ห้ามแตะรหัสบัญชี ยอด หรือรายการ
   * ชื่อว่าง/ยาวเกิน/ซ้ำกับหมวดอื่นประเภทเดียวกัน/ไม่ใช่หมวดรายรับรายจ่าย (กระเป๋า ยอดยกมา บัญชีผลการลงทุน)/เก็บถาวร = StorageError ไม่เปลี่ยนอะไร
   */
  renameCategory(id: string, name: string): Promise<Account>;
  /**
   * เพิ่มหมวดรายรับ/รายจ่ายใหม่ (ฟีดแบ็กใช้งานจริง 14 พ.ย. 2569) · สกุลเงินบาท · ชื่อว่าง/ยาวเกิน/ซ้ำกับหมวดประเภทเดียวกัน (รวมที่ซ่อนอยู่)/รหัสซ้ำ = StorageError ไม่เพิ่มอะไร
   */
  addCategory(input: { id: string; type: 'income' | 'expense'; name: string }): Promise<Account>;
  /**
   * ซ่อน/เปิดกลับหมวด (ห้ามลบจริง เพราะรายการเก่ายังอ้างถึง) · เขียนเฉพาะสถานะ archived · ออนไลน์ผ่าน RPC set_category_archived (ตรวจเจ้าของฝั่งฐานข้อมูล)
   * ไม่ใช่หมวดรายรับ/รายจ่ายทั่วไป (กระเป๋า ยอดยกมา หมวดผลการลงทุนของระบบ)/ไม่มีอยู่/สถานะเดิมอยู่แล้ว/ซ่อนตัวสุดท้ายของประเภท = StorageError ไม่เปลี่ยนอะไร
   */
  setCategoryHidden(id: string, hidden: boolean): Promise<Account>;
  /**
   * บันทึกรายการลงทุน + รายการในสมุดบัญชีคู่ในธุรกรรมเดียว (P4 · RPC record_trade)
   * ตรวจกติกาลำดับ/ขายเกิน (domain/invest/rules) ก่อนส่ง และฐานข้อมูลตรวจซ้ำ (trigger กันสองแท็บ)
   * walletId = กระเป๋าเงินสดที่จ่าย/รับเงิน (ปันผลลงทุนต่อไม่ใช้)
   */
  recordTrade(input: { trade: TradeRecord; walletId?: string }): Promise<TradeRecord>;
  /** รายการที่ผูกสมุด = ลบรายการในสมุด (รายการลงทุนถูกลบตาม) · รายการเก่าที่ยังไม่ผูก = ลบตรงๆ ตามกติกาเดียวกัน */
  deleteTrade(id: string): Promise<void>;
  /** ราคาล่าสุดที่ผู้ใช้กรอกเอง (หนึ่งราคาต่อสินทรัพย์ต่อวัน · กรอกซ้ำวันเดิม = แก้ราคา) */
  savePrice(price: AssetPrice): Promise<void>;
}

const localInvestError = (): StorageError => new StorageError('พอร์ตลงทุนใช้ได้เฉพาะบัญชีออนไลน์ (ที่เก็บในเครื่องไม่รองรับ)');

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
    importBackup: (data) => dexie.importBackup(db, data),
    hasUnfinishedImport: () => Promise.resolve(false),
    abortUnfinishedImport: () => Promise.resolve(),
    loadSettings: () => dexie.loadSettings(db),
    saveSettings: (settings) => dexie.saveSettings(db, settings),
    patchSettings: (patch) => dexie.patchSettings(db, patch),
    updateSettings: (keys, compute, options) => dexie.updateSettings(db, keys, compute, options),
    loadInvestments: () => Promise.resolve(emptyInvestments()),
    addAsset: () => Promise.reject(localInvestError()),
    addWallet: () => Promise.reject(localInvestError()),
    setAccountKind: () => Promise.reject(localInvestError()),
    renameWallet: (id, name) => dexie.renameWallet(db, id, name),
    renameCategory: (id, name) => dexie.renameCategory(db, id, name),
    addCategory: (input) => dexie.addCategory(db, input),
    setCategoryHidden: (id, hidden) => dexie.setCategoryHidden(db, id, hidden),
    recordTrade: () => Promise.reject(localInvestError()),
    deleteTrade: () => Promise.reject(localInvestError()),
    savePrice: () => Promise.reject(localInvestError()),
  };
}
