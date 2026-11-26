import type { BackupData } from '../domain/backup/parseBackup';
import type { FinanceSettings } from '../domain/bills/settings';
import type { SettingsKey, SettingsPatch } from '../domain/bills/settingsPatch';
import type { Bill } from '../domain/bills/types';
import { emptyInvestments, type Asset, type AssetCategory, type AssetKind, type AssetPrice, type FxExchangeRecord, type FxRateRecord, type InvestmentData, type TradeRecord } from '../domain/invest/types';
import type { CashAdjustmentInput } from '../domain/invest/cashAdjustment';
import type { Account, Entry, NewEntry } from '../domain/ledger/types';
import type { MoneyDB } from './db';
import * as dexie from './repository';
import { StorageError, storeError, type Ledger, type PayBillOptions, type PayBillResult, type Snapshot } from './repository';

/**
 * ช่องทางเดียวที่หน้าจอใช้อ่าน/เขียนข้อมูลการเงิน (แผน M2 ข้อ 4.4)
 * async ทุกเมธอดและไม่รู้ว่าข้างหลังเป็น Dexie (ในเครื่อง) หรือ Supabase (ออนไลน์)
 * ทุก implementation ต้องผ่านชุดเทสต์สัญญาเดียวกัน: tests/unit/repositoryContract.ts
 * ที่ยังอยู่นอก interface นี้โดยตั้งใจ: ตัวช่วยย้ายข้อมูลเฉพาะ Dexie (migration snapshot, local owner) จะหายไปใน M2-D
 */
/** รายงานความคืบหน้าการนำเข้า (รายการที่นำเข้าแล้ว, ทั้งหมด) */
export type ImportProgress = (done: number, total: number) => void;

export interface ImportOptions {
  /** จำนวนหมวดเดิมที่ผู้ใช้ยืนยันให้ลบแล้ว (> 0) · ฐานข้อมูลลบและนำเข้าข้อมูลลงทุนในธุรกรรมเดียว จำนวนไม่ตรง = ไม่ลบ */
  replaceCategories?: number;
}

/** การจัดหมวด/sector ของสินทรัพย์หนึ่งตัว (ส่งเฉพาะ key ที่ต้องการเปลี่ยน · null = ล้างค่า) */
export interface CategoryAssignment {
  assetId: string;
  categoryId?: string | null;
  sector?: string | null;
}

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
  importBackup(data: BackupData, onProgress?: ImportProgress, options?: ImportOptions): Promise<{ accounts: number; entries: number; bills: number }>;
  /** จำนวนหมวดสินทรัพย์ที่มีอยู่ (ใช้ถามผู้ใช้ก่อนนำเข้า) · Dexie คืน 0 เสมอ */
  countCategories(): Promise<number>;
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
  /**
   * บันทึกหมวด + การจัดหมวด/sector ของสินทรัพย์ในธุรกรรมเดียว (RPC save_categories · R2 Categories)
   * categories = ทั้งชุด (หมวดที่ไม่อยู่ในชุดถูกลบ · สินทรัพย์ในหมวดนั้นกลับเป็นไม่มีหมวด) · assignments เฉพาะ key ที่ใส่มาเท่านั้นที่เปลี่ยน (null = ล้างค่า)
   * ตรวจฝั่งเว็บก่อน (categoriesProblem) แล้วฐานข้อมูลตรวจซ้ำ · เป้ารวมต้อง 100% หรือไม่ตั้งเลย
   */
  saveCategories(categories: readonly AssetCategory[], assignments: readonly CategoryAssignment[]): Promise<void>;
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
  /**
   * แก้รายการลงทุนที่บันทึกแล้ว (R2 · RPC replace_trade ธุรกรรมเดียว: กลับรายการเดิม + ลงรายการใหม่) · ออนไลน์เท่านั้น
   * input.trade = รายการใหม่ (รหัสใหม่ · assetId/kind ต้องเท่าเดิม) · THB ใช้ walletId · USD (หุ้นสหรัฐ) ใช้ cashAccountId + fxRateMicro ในรายการ
   * ตรวจก่อนส่ง: แก้ได้เฉพาะรายการที่กติกาอนุญาต (ซื้อ/ปันผลลงทุนต่อต้องหลังรายการขายล่าสุด · ขายต้องเป็นล่าสุด) · ต้นทุนที่ตัดออกของรายการขายคำนวณด้วย replay ที่ไม่รวมรายการเดิม ·
   * basedOn = ลายนิ้วมือของรายการทั้งหมดของสินทรัพย์ (ชนกัน PT409/40P01/40001 = store.dataChanged)
   */
  replaceTrade(input: { oldId: string; trade: TradeRecord; walletId?: string; cashAccountId?: string }): Promise<TradeRecord>;
  /** ลบสินทรัพย์ที่ไม่เหลือรายการ + บัญชีต้นทุนของมัน (RPC delete_asset) · ยังมีรายการ/บัญชีต้นทุนมีบรรทัด = StorageError ไม่ลบอะไร */
  deleteAsset(id: string): Promise<void>;
  /** ราคาล่าสุดที่ผู้ใช้กรอกเอง (หนึ่งราคาต่อสินทรัพย์ต่อวัน · กรอกซ้ำวันเดิม = แก้ราคา) */
  savePrice(price: AssetPrice): Promise<void>;

  // ---- หุ้นสหรัฐและการแลกเงิน (A3-2 · R20) · ออนไลน์เท่านั้น ----
  /** สร้างบัญชีเงินสด USD (บัญชีสินทรัพย์สกุล USD ป้ายเงินลงทุน ไม่ผูกสินทรัพย์ ยอดเริ่มต้น 0) · รหัสซ้ำ/ชื่อผิดกติกา = StorageError */
  addUsdCash(input: { id: string; name: string }): Promise<Account>;
  /** สร้างหุ้นสหรัฐ: สินทรัพย์สกุล USD (ticker + ตลาด) + บัญชีต้นทุน USD ของมัน · ล้มกลางทางจะลบบัญชีที่สร้างทิ้ง */
  addUsdStock(input: { id: string; name: string; ticker: string; exchange: string }): Promise<Asset>;
  /**
   * บันทึกซื้อ/ขาย/ปันผลของหุ้นสหรัฐ + รายการในสมุด USD ในธุรกรรมเดียว (RPC record_trade_fx)
   * trade.fxRateMicro = อัตราบาทต่อ 1 USD ณ วันรายการ (บังคับ) · เล่นซ้ำ 2 ถังและตรวจ R20.3 ก่อนส่ง · ฐานข้อมูลตรวจซ้ำ
   * cashAccountId = บัญชีเงินสด USD ที่จ่าย/รับเงิน
   */
  recordTradeFx(input: { trade: TradeRecord; cashAccountId: string }): Promise<TradeRecord>;
  /** บันทึกการแลกเงินบาท↔USD + Entry 4 บรรทัดในธุรกรรมเดียว (RPC record_fx_exchange) · อัตราคำนวณจากสองจำนวน (R20.2) */
  recordFxExchange(input: { exchange: Omit<FxExchangeRecord, 'rateMicro' | 'entryId'>; walletId: string; cashAccountId: string }): Promise<FxExchangeRecord>;
  /** ลบการแลกเงิน = ลบรายการในสมุดที่ผูก (แถวแลกเงินถูกลบตาม) · เงินสด USD อาจติดลบได้ (หน้าจอเตือน) */
  deleteFxExchange(id: string): Promise<void>;
  /**
   * ปรับยอดเงินสดของพอร์ต (R23/R20 · เงินเข้า/ออกจากภายนอกพอร์ต หรือปรับให้ตรงใบแจ้งยอดโบรกเกอร์) · RPC record_cash_adjustment
   * Entry 2 บรรทัด: เงินสดของพอร์ต ± จำนวน และบัญชีพักการปรับยอดสกุลเดียวกัน (ไม่ใช่รายรับ/รายจ่าย) · ถอนเกินยอดคงเหลือไม่ได้ (ฐานข้อมูลตรวจ)
   */
  recordCashAdjustment(input: CashAdjustmentInput): Promise<void>;
  /** อัตราแลกเปลี่ยนล่าสุดที่ผู้ใช้กรอกเอง (หนึ่งอัตราต่อบัญชี USD ต่อวัน · ซ้ำวันเดิม = แก้) ใช้คำนวณมูลค่าพอร์ตเป็นบาท */
  saveFxRate(rate: FxRateRecord): Promise<void>;
}

const localInvestError = (): StorageError => storeError('store.localInvestUnsupported');

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
    countCategories: () => Promise.resolve(0),
    hasUnfinishedImport: () => Promise.resolve(false),
    abortUnfinishedImport: () => Promise.resolve(),
    loadSettings: () => dexie.loadSettings(db),
    saveSettings: (settings) => dexie.saveSettings(db, settings),
    patchSettings: (patch) => dexie.patchSettings(db, patch),
    updateSettings: (keys, compute, options) => dexie.updateSettings(db, keys, compute, options),
    loadInvestments: () => Promise.resolve(emptyInvestments()),
    saveCategories: () => Promise.reject(localInvestError()),
    addAsset: () => Promise.reject(localInvestError()),
    addWallet: () => Promise.reject(localInvestError()),
    setAccountKind: () => Promise.reject(localInvestError()),
    renameWallet: (id, name) => dexie.renameWallet(db, id, name),
    renameCategory: (id, name) => dexie.renameCategory(db, id, name),
    addCategory: (input) => dexie.addCategory(db, input),
    setCategoryHidden: (id, hidden) => dexie.setCategoryHidden(db, id, hidden),
    recordTrade: () => Promise.reject(localInvestError()),
    deleteTrade: () => Promise.reject(localInvestError()),
    replaceTrade: () => Promise.reject(localInvestError()),
    deleteAsset: () => Promise.reject(localInvestError()),
    savePrice: () => Promise.reject(localInvestError()),
    addUsdCash: () => Promise.reject(localInvestError()),
    addUsdStock: () => Promise.reject(localInvestError()),
    recordTradeFx: () => Promise.reject(localInvestError()),
    recordFxExchange: () => Promise.reject(localInvestError()),
    recordCashAdjustment: () => Promise.reject(localInvestError()),
    deleteFxExchange: () => Promise.reject(localInvestError()),
    saveFxRate: () => Promise.reject(localInvestError()),
  };
}
