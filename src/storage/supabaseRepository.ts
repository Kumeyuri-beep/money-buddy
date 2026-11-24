import type { SupabaseClient } from '@supabase/supabase-js';
import { chunkEntries } from '../domain/backup/chunk';
import { buildTradeEntry, TradeLinkError } from '../domain/invest/ledgerLink';
import { checkTradeAddCoded, checkTradeDeleteCoded, replayRecords } from '../domain/invest/rules';
import { tradesFingerprint } from '../domain/invest/tradesFingerprint';
import { withCode } from '../domain/errors/coded';
import { replayTradesFx } from '../domain/invest/costBasisFx';
import { fxRateFromExchange } from '../domain/invest/fx';
import { buildFxExchangeEntry, buildUsdTradeEntry, UsdLinkError } from '../domain/invest/ledgerLinkFx';
import { toTradesFx } from '../domain/invest/tradesFx';
import { categoriesProblem } from '../domain/invest/categories';
import { INSTRUMENT_EXCHANGES, assetCurrency, type AssetCategory } from '../domain/invest/types';
import { lengthWithin, MAX_NAME_LENGTH } from '../domain/ledger/limits';
import {
  ASSET_KINDS,
  FX_DIRECTIONS,
  TRADE_KINDS,
  emptyInvestments,
  isEmptyInvestments,
  type Asset,
  type AssetPrice,
  type FxExchangeRecord,
  type FxRateRecord,
  type InvestmentData,
  type TradeRecord,
} from '../domain/invest/types';
import { SINGLE_IMPORT_MAX_ENTRIES, SINGLE_IMPORT_MAX_LINES, type BackupData } from '../domain/backup/parseBackup';
import { payAmountProblem } from '../domain/bills/payAmount';
import { billProblem, markBillPaid, payableCycle } from '../domain/bills/schedule';
import { sanitizeSettings, settingsProblem, type FinanceSettings } from '../domain/bills/settings';
import {
  applySettingsPlan,
  planConflictProblem,
  planOutsideKeysProblem,
  planSettingsPatch,
  planSettingsReplace,
  SETTINGS_UPDATE_MAX_ATTEMPTS,
  settingsKeysChanged,
  type SettingsKey,
  type SettingsPatch,
  type SettingsPlanResult,
} from '../domain/bills/settingsPatch';
import type { Bill } from '../domain/bills/types';
import { isCashWallet, isInvestResultAccount } from '../domain/ledger/accountKind';
import { checkCategoryAdd, checkCategoryHide, checkCategoryRename, checkWalletRename } from '../domain/ledger/accountName';
import { createEntry } from '../domain/ledger/entry';
import { runIntegrityCheck } from '../domain/ledger/integrity';
import type { Account, AccountType, Entry, EntrySource, NewEntry } from '../domain/ledger/types';
import { SCHEMA_VERSION } from './db';
import { buildCashAdjustmentEntry, CashAdjustmentError } from '../domain/invest/cashAdjustment';
import { carryCode, type NumberField } from './storageMessages';
import type { ImportProgress, LedgerRepository } from './ledgerRepository';
import {
  assertBillWritableWith,
  assertNotFuture,
  compareEntries,
  currentMonth,
  nextCreatedAt,
  pickBill,
  SettingsConflictError, StorageError, storeError,
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
const OWN_CODES = new Set(['28000', '42501', '25006', '23514', '40001', 'PT409', '53400', '23503', '23505', 'P0002', '22007', '22023', '55000', '54000']);

/** แปลง error ของ PostgREST เป็น StorageError · ข้อความไทยที่ฐานข้อมูลตั้งใจส่งมาใช้ได้เลย ที่เหลือไม่โชว์รายละเอียดภายใน */
export function storageErrorFrom(error: DbError): StorageError {
  const message = String(error.message ?? '');
  if (THAI.test(message) && error.code !== undefined && OWN_CODES.has(error.code)) return new StorageError(message);
  if (/bill_cycle_once/i.test(message)) return new StorageError('รอบนี้จ่ายแล้ว (อาจจ่ายจากอีกหน้าต่างหนึ่งไปก่อนแล้ว) โหลดใหม่เพื่อดูสถานะล่าสุด');
  if (error.code === '23505' || /duplicate key/i.test(message)) return storeError('store.dbDuplicate');
  if (error.code === '23503') return storeError('store.dbBadReference');
  if (error.code === '23514' || error.code === '22003' || error.code === '22023') {
    return storeError('store.dbRejected');
  }
  if (/fetch|network|timeout/i.test(message)) return storeError('store.network');
  return storeError('store.saveFailed');
}

// ---------- แปลงแถวฐานข้อมูล <-> โดเมน (ฟังก์ชันล้วน ทดสอบได้โดยไม่ต้องมีฐานข้อมูล) ----------

export interface AccountRow {
  id: string;
  type: string;
  name: string;
  currency: string;
  archived: boolean;
  sort_order: number | null;
  /** ไม่มี/normal = บัญชีทั่วไป · investment = บัญชีลงทุน (ฐานข้อมูลหลัง migration พอร์ตลงทุน P2) */
  kind?: string;
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

function safeInt(value: unknown, field: NumberField): number {
  const n = typeof value === 'string' ? (/^-?[0-9]{1,16}$/.test(value) ? Number(value) : Number.NaN) : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n)) throw storeError('store.badNumber', { field });
  return n;
}

export function rowToAccount(row: AccountRow): Account {
  const account: Account = { id: row.id, type: row.type as AccountType, name: row.name, currency: row.currency };
  if (row.archived) account.archived = true;
  if (row.kind === 'investment') account.kind = 'investment';
  else if (row.kind !== undefined && row.kind !== 'normal') throw storeError('store.badAccountKind', { value: row.kind });
  if (row.sort_order !== null && row.sort_order !== undefined) account.sortOrder = row.sort_order;
  return account;
}

export function accountToJson(a: Account): Record<string, unknown> {
  const out: Record<string, unknown> = { id: a.id, type: a.type, name: a.name, currency: a.currency };
  if (a.archived !== undefined) out.archived = a.archived;
  if (a.kind === 'investment') out.kind = a.kind;
  if (a.sortOrder !== undefined) out.sortOrder = a.sortOrder;
  return out;
}

export interface AssetRow {
  id: string;
  name: string;
  kind: string;
  account_id: string;
  archived: boolean;
  /** สกุลของสินทรัพย์ (migration 20261115000100) · ไม่มีคอลัมน์/ค่าว่าง = THB */
  instrument_currency?: string | null;
  ticker?: string | null;
  exchange?: string | null;
  /** migration 20261121000100 */
  sector?: string | null;
  category_id?: string | null;
}

export interface CategoryRow {
  id: string;
  name: string;
  target_bps: number | null;
  sort_order: number;
}

export interface TradeRow {
  id: string;
  asset_id: string;
  kind: string;
  date: string;
  created_at: string;
  /** ข้อความจำนวนเต็ม x 10^8 (ไม่ใช่ number: เกิน 2^53 ได้) */
  units: string | null;
  price_micro: number | string | null;
  amount: number | string | null;
  fee: number | string;
  withholding: number | string;
  memo: string;
  entry_id: string | null;
  /** บาทต่อ 1 USD x 10^6 (เฉพาะรายการของสินทรัพย์ USD) */
  fx_rate_micro?: number | string | null;
}

export interface FxRateRow {
  account_id: string;
  date: string;
  rate_micro: number | string;
}

export interface FxExchangeRow {
  id: string;
  date: string;
  created_at: string;
  direction: string;
  thb_satang: number | string;
  usd_cents: number | string;
  rate_micro: number | string;
  memo: string;
  entry_id: string;
}

export interface PriceRow {
  asset_id: string;
  date: string;
  price_micro: number | string;
}

export function rowToAsset(row: AssetRow): Asset {
  if (!(ASSET_KINDS as readonly string[]).includes(row.kind)) throw storeError('store.badAssetKind', { value: row.kind });
  const asset: Asset = { id: row.id, name: row.name, kind: row.kind as Asset['kind'], accountId: row.account_id };
  if (row.archived) asset.archived = true;
  if (row.instrument_currency === 'USD') asset.currency = 'USD';
  else if (row.instrument_currency !== undefined && row.instrument_currency !== null && row.instrument_currency !== 'THB') {
    throw storeError('store.badAssetCurrency', { value: row.instrument_currency });
  }
  if (typeof row.ticker === 'string' && row.ticker !== '') asset.ticker = row.ticker;
  if (typeof row.exchange === 'string' && row.exchange !== '') asset.exchange = row.exchange;
  if (typeof row.sector === 'string' && row.sector !== '') asset.sector = row.sector;
  if (typeof row.category_id === 'string' && row.category_id !== '') asset.categoryId = row.category_id;
  return asset;
}

/** ปัญหาของหมวด → รหัส error ของชั้น storage (ข้อความจากแม่แบบ th/en ใน storageMessages) */
const CATEGORY_STORE_CODE = {
  count: 'store.categoryCount',
  id: 'store.categoryId',
  name: 'store.categoryName',
  sort: 'store.categorySort',
  target: 'store.categoryTarget',
  duplicateId: 'store.categoryDuplicateId',
  duplicateName: 'store.categoryDuplicateName',
  targetTotal: 'store.categoryTargetTotal',
} as const;

export function rowToCategory(row: CategoryRow): AssetCategory {
  return { id: row.id, name: row.name, targetBps: row.target_bps === null ? null : safeInt(row.target_bps, 'categoryTarget'), sortOrder: safeInt(row.sort_order, 'categorySort') };
}

export function categoryToJson(c: AssetCategory): Record<string, unknown> {
  const out: Record<string, unknown> = { id: c.id, name: c.name, sortOrder: c.sortOrder };
  if (c.targetBps !== null) out.targetBps = c.targetBps;
  return out;
}

/** เวลาจากฐานข้อมูล → ISO · ค่าที่แปลงไม่ได้ (เช่น infinity) = StorageError ไม่ใช่ RangeError ที่ทำให้ส่งออกไม่ได้เงียบๆ */
function instantOf(value: string): string {
  const t = Date.parse(value);
  if (Number.isNaN(t) || t < Date.UTC(1900, 0, 1) || t > Date.UTC(2999, 11, 31)) {
    throw storeError('store.badTimestamp');
  }
  return new Date(t).toISOString();
}

export function rowToTrade(row: TradeRow): TradeRecord {
  if (!(TRADE_KINDS as readonly string[]).includes(row.kind)) throw storeError('store.badTradeKind', { value: row.kind });
  if (row.units !== null && (typeof row.units !== 'string' || !/^[0-9]{1,19}$/.test(row.units))) {
    throw storeError('store.badUnits');
  }
  const trade: TradeRecord = {
    id: row.id,
    assetId: row.asset_id,
    kind: row.kind as TradeRecord['kind'],
    date: row.date,
    createdAt: instantOf(row.created_at),
    fee: safeInt(row.fee, 'fee'),
    withholding: safeInt(row.withholding, 'withholding'),
    memo: row.memo,
  };
  if (row.units !== null) trade.units = row.units;
  if (row.price_micro !== null) trade.priceMicro = safeInt(row.price_micro, 'unitPrice');
  if (row.amount !== null) trade.amount = safeInt(row.amount, 'tradeValue');
  if (row.entry_id !== null) trade.entryId = row.entry_id;
  if (row.fx_rate_micro !== undefined && row.fx_rate_micro !== null) trade.fxRateMicro = safeInt(row.fx_rate_micro, 'fxRate');
  return trade;
}

export function rowToFxRate(row: FxRateRow): FxRateRecord {
  return { accountId: row.account_id, date: row.date, rateMicro: safeInt(row.rate_micro, 'fxRate') };
}

export function rowToFxExchange(row: FxExchangeRow): FxExchangeRecord {
  if (!(FX_DIRECTIONS as readonly string[]).includes(row.direction)) throw storeError('store.badFxDirection', { value: row.direction });
  return {
    id: row.id,
    date: row.date,
    createdAt: instantOf(row.created_at),
    direction: row.direction as FxExchangeRecord['direction'],
    thbSatang: safeInt(row.thb_satang, 'thbExchanged'),
    usdCents: safeInt(row.usd_cents, 'usdExchanged'),
    rateMicro: safeInt(row.rate_micro, 'fxRate'),
    memo: row.memo,
    entryId: row.entry_id,
  };
}

export function rowToPrice(row: PriceRow): AssetPrice {
  return { assetId: row.asset_id, date: row.date, priceMicro: safeInt(row.price_micro, 'price') };
}

export function assetToJson(a: Asset): Record<string, unknown> {
  const out: Record<string, unknown> = { id: a.id, name: a.name, kind: a.kind, accountId: a.accountId };
  if (a.archived === true) out.archived = true;
  if (a.currency === 'USD') out.currency = 'USD';
  if (a.ticker !== undefined) out.ticker = a.ticker;
  if (a.exchange !== undefined) out.exchange = a.exchange;
  if (a.sector !== undefined) out.sector = a.sector;
  if (a.categoryId !== undefined) out.categoryId = a.categoryId;
  return out;
}

export function tradeToJson(t: TradeRecord): Record<string, unknown> {
  const out: Record<string, unknown> = { id: t.id, assetId: t.assetId, kind: t.kind, date: t.date, createdAt: t.createdAt, fee: t.fee, withholding: t.withholding, memo: t.memo };
  if (t.units !== undefined) out.units = t.units;
  if (t.priceMicro !== undefined) out.priceMicro = t.priceMicro;
  if (t.amount !== undefined) out.amount = t.amount;
  if (t.entryId !== undefined) out.entryId = t.entryId;
  if (t.fxRateMicro !== undefined) out.fxRateMicro = t.fxRateMicro;
  return out;
}

export function fxExchangeToJson(x: FxExchangeRecord): Record<string, unknown> {
  return { id: x.id, date: x.date, createdAt: x.createdAt, direction: x.direction, thbSatang: x.thbSatang, usdCents: x.usdCents, rateMicro: x.rateMicro, memo: x.memo, entryId: x.entryId };
}

/** ไฟล์สำรอง/คำสั่งนำเข้า: ฟิลด์ USD ใส่เฉพาะเมื่อมีข้อมูล (ข้อมูลบาทเดิมได้ไฟล์เหมือนเดิมทุกไบต์) */
export function investmentsToJson(d: InvestmentData): Record<string, unknown> {
  const out: Record<string, unknown> = {
    assets: d.assets.map(assetToJson),
    trades: d.trades.map(tradeToJson),
    prices: d.prices.map((p) => ({ assetId: p.assetId, date: p.date, priceMicro: p.priceMicro })),
  };
  if ((d.fxRates?.length ?? 0) > 0) out.fxRates = (d.fxRates ?? []).map((r) => ({ accountId: r.accountId, date: r.date, rateMicro: r.rateMicro }));
  if ((d.fxExchanges?.length ?? 0) > 0) out.fxExchanges = (d.fxExchanges ?? []).map(fxExchangeToJson);
  if ((d.categories?.length ?? 0) > 0) out.categories = (d.categories ?? []).map(categoryToJson);
  return out;
}

export function rowToEntry(row: EntryRow): Entry {
  const lines = [...(row.lines ?? [])]
    .sort((a, b) => a.idx - b.idx)
    .map((l) => ({ accountId: l.account_id, amount: safeInt(l.amount, 'lineAmount') }));
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
  const bill: Bill = { id: row.id, name: row.name, amount: safeInt(row.amount, 'billAmount'), dueDay: row.due_day };
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
  /** keyOf = กุญแจเฉพาะของแถว (ค่าตั้งต้น id) · countColumn = คอลัมน์ที่ใช้นับจำนวนทั้งหมดเทียบ (ตารางไม่มี id เช่น asset_prices ต้องระบุ) */
  async function fetchAll<T>(
    table: string,
    build: (from: number, to: number) => PromiseLike<{ data: unknown; error: DbError | null }>,
    keyOf: (row: T) => string = (row) => (row as { id: string }).id,
    countColumn = 'id',
    /** อ่านเฉพาะแถวที่ column = value: คำสั่งนับต้องกรองเหมือนกัน (ไม่งั้นจำนวนไม่ตรงแล้วล้มทุกครั้ง) */
    scope?: { column: string; value: string },
  ): Promise<T[]> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const byId = new Map<string, T>();
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await build(from, from + PAGE - 1);
        check(error);
        const rows = (data ?? []) as T[];
        for (const row of rows) byId.set(keyOf(row), row);
        if (rows.length < PAGE) break;
      }
      const counter = client.from(table).select(countColumn, { count: 'exact', head: true });
      const { count, error } = await (scope ? counter.eq(scope.column, scope.value) : counter);
      check(error);
      if (count === null || count === undefined || count === byId.size) return [...byId.values()];
    }
    throw storeError('store.readIncomplete');
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

  /**
   * ไฟล์ใหญ่ (เกิน SINGLE_IMPORT_MAX_ENTRIES): แบ่งเป็นหลายคำสั่งเพื่อไม่ชนเพดานเวลา · ไม่อะตอมมิกทั้งไฟล์
   * ฐานข้อมูลจำ "เซสชันนำเข้า" ไว้ (import_ledger_begin เปิด ครบจำนวนที่ประกาศจึงปิด) ถ้าก้อนใดล้ม: สั่งล้างส่วนที่ค้างทันที
   * ล้างไม่ได้ (เช่นเน็ตหลุด) = เซสชันยังเปิด แอปจะพาไปหน้าล้างตอนเปิดครั้งหน้า ไม่ปล่อยเข้าใช้งานด้วยข้อมูลครึ่งเดียว
   */
  async function importChunked(data: BackupData, onProgress?: ImportProgress) {
    const [first = [], ...rest] = chunkEntries(data.entries);
    const total = data.entries.length;
    const begin = (await rpc('import_ledger_begin', {
      p_data: {
        accounts: data.accounts.map(accountToJson),
        bills: data.bills.map(billToJson),
        entries: first.map(entryToJson),
        settings: sanitizeSettings(data.settings),
      },
      p_total_entries: total,
    })) as { accounts?: number; entries?: number; bills?: number } | null;
    // ถึงตรงนี้เซสชันเปิดแล้ว: ล้มหลังจากนี้ต้องล้างส่วนที่ค้าง
    let done = begin?.entries ?? first.length;
    onProgress?.(done, total);
    try {
      for (const chunk of rest) {
        const out = (await rpc('import_ledger_append', { p_entries: chunk.map(entryToJson) })) as { entries?: number } | null;
        done += out?.entries ?? chunk.length;
        onProgress?.(done, total);
      }
    } catch (e) {
      const reason = e instanceof StorageError ? e.message : 'เกิดข้อผิดพลาด';
      try {
        await abortImport();
      } catch {
        throw new StorageError(`นำเข้าไม่สำเร็จ (${reason}) และล้างส่วนที่นำเข้าค้างไม่ได้ เปิดแอปใหม่แล้วแอปจะให้ล้างส่วนที่ค้างก่อนลองใหม่`);
      }
      throw new StorageError(`นำเข้าไม่สำเร็จ (${reason}) ระบบล้างส่วนที่นำเข้าค้างให้แล้ว ลองนำเข้าใหม่ได้`);
    }
    return { accounts: begin?.accounts ?? 0, entries: done, bills: begin?.bills ?? 0 };
  }

  /** ล้างส่วนที่นำเข้าค้างเป็นชุด (ฐานข้อมูลลบทีละ ≤ 500 รายการ คืน 'more' จนกว่าจะหมด) · หยุดที่ 200 รอบกันวนไม่รู้จบ */
  async function abortImport(): Promise<void> {
    for (let i = 0; i < 200; i++) {
      const result = await rpc('import_ledger_abort', {});
      if (result !== 'more') return;
    }
    throw new StorageError('ล้างส่วนที่นำเข้าค้างไม่หมด ลองอีกครั้ง');
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

  /** ข้อมูลลงทุนของผู้ใช้ (RLS กรองเฉพาะของตัวเอง) · เรียงให้ผลคงที่ */
  async function loadInvestments(): Promise<InvestmentData> {
    const [assets, trades, prices, fxRates, fxExchanges, categories] = await Promise.all([
      fetchAll<AssetRow>('assets', (from, to) => client.from('assets').select('*').order('id').range(from, to)),
      fetchAll<TradeRow>('trades', (from, to) => client.from('trades').select('*').order('date').order('created_at').order('id').range(from, to)),
      fetchAll<PriceRow>(
        'asset_prices',
        (from, to) => client.from('asset_prices').select('*').order('asset_id').order('date').range(from, to),
        (row) => `${row.asset_id}\u0000${row.date}`,
        'asset_id',
      ),
      fetchAll<FxRateRow>(
        'fx_rates',
        (from, to) => client.from('fx_rates').select('*').order('account_id').order('date').range(from, to),
        (row) => `${row.account_id}\u0000${row.date}`,
        'account_id',
      ),
      fetchAll<FxExchangeRow>('fx_exchanges', (from, to) => client.from('fx_exchanges').select('*').order('date').order('created_at').order('id').range(from, to)),
      fetchAll<CategoryRow>('asset_categories', (from, to) => client.from('asset_categories').select('id,name,target_bps,sort_order').order('sort_order').order('id').range(from, to)),
    ]);
    const data: InvestmentData = { assets: assets.map(rowToAsset), trades: trades.map(rowToTrade), prices: prices.map(rowToPrice) };
    if (fxRates.length > 0) data.fxRates = fxRates.map(rowToFxRate);
    if (fxExchanges.length > 0) data.fxExchanges = fxExchanges.map(rowToFxExchange);
    if (categories.length > 0) data.categories = categories.map(rowToCategory);
    return data;
  }

  /** นำเข้าข้อมูลลงทุนหลังสมุดบัญชีนำเข้าเสร็จ (ฟังก์ชันฐานข้อมูลเดียว อะตอมมิก) · ล้ม = สมุดนำเข้าแล้วแต่ข้อมูลลงทุนยังไม่เข้า */
  async function importInvestments(d: InvestmentData | undefined): Promise<void> {
    if (isEmptyInvestments(d)) return;
    try {
      await rpc('import_ledger_investments', { p_data: investmentsToJson(d ?? emptyInvestments()) });
    } catch (e) {
      const reason = e instanceof StorageError ? e.message : 'เกิดข้อผิดพลาด';
      throw new StorageError(`นำเข้าสมุดบัญชีสำเร็จแล้ว แต่นำเข้าข้อมูลลงทุนไม่สำเร็จ (${reason}) ข้อมูลลงทุนยังไม่เข้า (ไม่ได้เข้าครึ่งเดียว) แจ้งผู้ดูแลระบบหรือลองนำเข้าข้อมูลลงทุนอีกครั้งภายหลัง`);
    }
  }

  async function loadSettings(): Promise<FinanceSettings> {
    const { data, error } = await client.from('settings').select('value').maybeSingle();
    check(error);
    return sanitizeSettings((data as { value?: unknown } | null)?.value);
  }

  /**
   * เขียนค่าตั้งค่าด้วย RPC merge_settings (รวมฝั่งฐานข้อมูลในคำสั่งเดียว ไม่อ่านแล้วเขียนทั้งก้อนจากหน้าเว็บ)
   * อ่านค่าปัจจุบันเพียงเพื่อ "ตรวจขนาดรวมล่วงหน้า" ให้ข้อความไทยชัด (ไม่ใช่เพื่อเขียนกลับ) ฐานข้อมูลยังบังคับเพดาน 16 KB จริงเสมอ
   */
  async function writeSettingsPlan(planned: SettingsPlanResult): Promise<FinanceSettings> {
    if (!planned.ok) throw new StorageError(`ค่าตั้งค่าไม่ถูกต้อง: ${planned.problem}`);
    const current = await loadSettings();
    const conflict = planConflictProblem(current, planned.plan);
    if (conflict) throw new StorageError(`ค่าตั้งค่าไม่ถูกต้อง: ${conflict}`);
    const sizeProblem = settingsProblem(applySettingsPlan(current, planned.plan));
    if (sizeProblem) throw new StorageError(`ค่าตั้งค่าไม่ถูกต้อง: ${sizeProblem}`);
    const data = await rpc('merge_settings', { p_patch: planned.plan.set, p_remove: planned.plan.remove });
    return sanitizeSettings(data);
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
        const [ledger, bills, settings, investments] = await Promise.all([loadLedger(), loadBills(), loadSettings(), loadInvestments()]);
        const [again, againInvestments] = await Promise.all([loadBills(), loadInvestments()]);
        if (JSON.stringify(again) === JSON.stringify(bills) && JSON.stringify(againInvestments) === JSON.stringify(investments)) {
          // ข้อมูลลงทุนใส่ในไฟล์เฉพาะเมื่อมี (ไฟล์ของผู้ที่ไม่ใช้พอร์ตลงทุนเหมือนเดิมทุกประการ)
          return { schemaVersion: SCHEMA_VERSION, exportedAt: now.toISOString(), ...ledger, bills, settings, ...(isEmptyInvestments(investments) ? {} : { investments }) };
        }
      }
      throw new StorageError('ข้อมูลเปลี่ยนระหว่างสำรอง ลองใหม่อีกครั้ง');
    },

    async resetAll() {
      if (!options.getPasswordForReset) throw new StorageError('ล้างข้อมูลออนไลน์ต้องยืนยันด้วยรหัสผ่าน (ยังไม่ได้ต่อช่องกรอกรหัส)');
      const password = await options.getPasswordForReset();
      // ล้างเป็นชุดละ ≤ 500 รายการ (ข้อมูลหนักมากล้างในคำสั่งเดียวชนเพดานเวลา 8 วินาที) · ฐานข้อมูลตรวจรหัสผ่านและด่านอื่นทุกชุด
      // more = ยังเหลือ เรียกซ้ำ · หยุดที่ 200 ชุด (= 100,000 รายการ) กันวนไม่รู้จบ · ค่าที่ไม่รู้จักถือว่าผิดพลาด ไม่เดาว่าสำเร็จ
      for (let i = 0; i < 200; i++) {
        const result = await rpc('reset_my_ledger_step', { p_password: password });
        if (result === 'done') return;
        if (result === 'wrong') throw new StorageError('รหัสผ่านไม่ถูกต้อง ไม่ได้ล้างข้อมูล');
        if (result !== 'more') throw new StorageError('ล้างข้อมูลไม่สำเร็จ ลองอีกครั้ง');
      }
      throw new StorageError('ล้างข้อมูลไม่หมด ลองอีกครั้ง (ข้อมูลที่เหลือล้างต่อได้)');
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
      if (!wallet || !isCashWallet(wallet)) {
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

    loadInvestments,
    async saveCategories(categories, assignments) {
      const problem = categoriesProblem(categories);
      if (problem !== null) throw storeError(CATEGORY_STORE_CODE[problem]);
      await rpc('save_categories', { p_categories: categories.map(categoryToJson), p_assignments: assignments });
    },

    async addAsset(input) {
      const id = String(input.id ?? '').trim();
      const name = String(input.name ?? '').trim();
      if (id === '' || id.length > 90) throw storeError('store.assetIdInvalid');
      if (!lengthWithin(name, 1, MAX_NAME_LENGTH)) throw storeError('store.assetNameLength', { max: MAX_NAME_LENGTH });
      if (!(ASSET_KINDS as readonly string[]).includes(input.kind)) throw storeError('store.assetKindInvalid');
      const accountId = `inv-${id}`;
      const acc = await client.from('accounts').insert({ id: accountId, type: 'asset', name, currency: 'THB', kind: 'investment' });
      check(acc.error);
      const ins = await client.from('assets').insert({ id, name, kind: input.kind, account_id: accountId });
      if (ins.error) {
        // ล้างบัญชีที่เพิ่งสร้างไว้ (เฉพาะบัญชีลงทุน · ไม่มีรายการอ้างอิง) ถ้าล้างไม่สำเร็จเหลือบัญชีลงทุนว่างๆ ไม่กระทบยอดเงินสด
        await client.from('accounts').delete().eq('id', accountId).eq('kind', 'investment');
        check(ins.error);
      }
      return { id, name, kind: input.kind, accountId };
    },

    async addWallet(input) {
      const id = String(input.id ?? '').trim();
      const name = String(input.name ?? '').trim();
      if (id === '' || id.length > 90) throw storeError('store.walletIdInvalid');
      if (!lengthWithin(name, 1, MAX_NAME_LENGTH)) throw storeError('store.walletNameLength', { max: MAX_NAME_LENGTH });
      const { error } = await client.from('accounts').insert({ id, type: 'asset', name, currency: 'THB', kind: 'normal' });
      check(error);
      return { id, type: 'asset', name, currency: 'THB', kind: 'normal' };
    },

    async setAccountKind(id, kind) {
      if (typeof id !== 'string' || id === '' || (kind !== 'normal' && kind !== 'investment')) throw new StorageError('ข้อมูลไม่ครบหรือป้ายไม่ถูกต้อง');
      await rpc('set_account_kind', { p_id: id, p_kind: kind });
    },

    async renameWallet(id, rawName) {
      // ตรวจกติกาชื่อจากบัญชีทั้งหมดของผู้ใช้ (ซ้ำ/ไม่ใช่กระเป๋า) แล้วเขียนเฉพาะคอลัมน์ name (ไม่แตะ id ชนิด สกุลเงิน ยอด) · RLS คุมเจ้าของแถว
      const accounts = await loadAccounts();
      const verdict = checkWalletRename(accounts, id, rawName);
      if (!verdict.ok) throw new StorageError(verdict.message ?? 'เปลี่ยนชื่อไม่ได้');
      const { data, error } = await client.from('accounts').update({ name: verdict.name }).eq('id', id).eq('type', 'asset').eq('kind', 'normal').select('*');
      check(error);
      const row = Array.isArray(data) ? (data[0] as AccountRow | undefined) : undefined;
      if (!row) throw new StorageError('ไม่พบกระเป๋านี้');
      return rowToAccount(row);
    },

    async renameCategory(id, rawName) {
      // ตรวจกติกาชื่อจากบัญชีทั้งหมดของผู้ใช้ แล้วเขียนเฉพาะคอลัมน์ name (สิทธิ์ฐานข้อมูลก็แก้ได้แค่ name) · เงื่อนไขชนิด/kind ซ้ำที่ฝั่งฐานข้อมูลกันชนกับแท็บอื่น
      const accounts = await loadAccounts();
      const verdict = checkCategoryRename(accounts, id, rawName);
      if (!verdict.ok) throw new StorageError(verdict.message ?? 'เปลี่ยนชื่อไม่ได้');
      const { data, error } = await client.from('accounts').update({ name: verdict.name }).eq('id', id).in('type', ['income', 'expense']).eq('kind', 'normal').select('*');
      check(error);
      const row = Array.isArray(data) ? (data[0] as AccountRow | undefined) : undefined;
      if (!row) throw new StorageError('ไม่พบหมวดนี้');
      return rowToAccount(row);
    },

    async addCategory(input) {
      const id = String(input.id ?? '').trim();
      if (id === '' || id.length > 90) throw new StorageError('รหัสหมวดไม่ถูกต้อง');
      const accounts = await loadAccounts();
      // รหัสของหมวดผลการลงทุนที่ระบบสร้าง (inv-gain ฯลฯ) ห้ามใช้เป็นหมวดทั่วไป (security-auditor)
      if (accounts.some((a) => a.id === id) || isInvestResultAccount({ id })) throw new StorageError('รหัสหมวดซ้ำ ลองอีกครั้ง');
      const verdict = checkCategoryAdd(accounts, input.type, input.name);
      if (!verdict.ok) throw new StorageError(verdict.message ?? 'เพิ่มหมวดไม่ได้');
      const { error } = await client.from('accounts').insert({ id, type: input.type, name: verdict.name, currency: 'THB', kind: 'normal' });
      check(error);
      return { id, type: input.type, name: verdict.name, currency: 'THB' };
    },

    async setCategoryHidden(id, hidden) {
      // ตรวจกติกาจากบัญชีทั้งหมดของผู้ใช้ก่อน แล้วให้ฐานข้อมูลตรวจซ้ำในฟังก์ชัน set_category_archived (เจ้าของแถว ชนิดบัญชี ต้องเหลืออย่างน้อย 1 หมวด · กันสองแท็บ)
      const accounts = await loadAccounts();
      const verdict = checkCategoryHide(accounts, id, hidden);
      if (!verdict.ok) throw new StorageError(verdict.message ?? 'ซ่อนหมวดไม่ได้');
      await rpc('set_category_archived', { p_id: id, p_archived: hidden });
      const { data, error } = await client.from('accounts').select('*').eq('id', id).maybeSingle();
      check(error);
      if (!data) throw new StorageError('ไม่พบหมวดนี้');
      return rowToAccount(data as AccountRow);
    },

    async recordTrade({ trade, walletId }) {
      const found = await client.from('assets').select('*').eq('id', trade.assetId).maybeSingle();
      check(found.error);
      if (!found.data) throw storeError('store.assetNotFound');
      const asset = rowToAsset(found.data as AssetRow);
      const siblings = await fetchAll<TradeRow>(
        'trades',
        (from, to) => client.from('trades').select('*').eq('asset_id', trade.assetId).order('id').range(from, to),
        (row) => row.id,
        'id',
        { column: 'asset_id', value: trade.assetId },
      );
      const existing = siblings.map(rowToTrade);
      const problem = checkTradeAddCoded(existing, trade);
      if (problem) throw problem.code ? withCode(new StorageError(problem.message), problem.code, problem.params ?? {}) : new StorageError(problem.message);
      let entryId = '';
      let built;
      try {
        const sell = trade.kind === 'sell' ? replayRecords([...existing, trade]).sells.find((s) => s.id === trade.id)?.result : undefined;
        entryId = `${trade.id}-entry`;
        built = buildTradeEntry({ trade, assetName: asset.name, assetAccountId: asset.accountId, walletId, entryId, sell });
      } catch (e) {
        if (e instanceof TradeLinkError) throw carryCode(new StorageError(e.message), e);
        throw e;
      }
      const linked: TradeRecord = { ...trade, entryId };
      // ครั้งเดียว: ฐานข้อมูลสร้างรายการในสมุด + รายการลงทุนในธุรกรรมเดียว · trigger ตรวจลำดับ/ขายเกินซ้ำ (กันสองแท็บ)
      await rpc('record_trade', {
        p_trade: {
          id: linked.id, assetId: linked.assetId, kind: linked.kind, date: linked.date, createdAt: linked.createdAt,
          units: linked.units, priceMicro: linked.priceMicro, amount: linked.amount, fee: linked.fee,
          withholding: linked.withholding, memo: linked.memo,
          basedOn: await tradesFingerprint(siblings), // ลายนิ้วมือรายการเดิมที่ใช้คำนวณต้นทุน · ฐานข้อมูลเทียบหลังล็อก (กันสองแท็บ รวมกรณีแก้รายการจำนวนเท่าเดิม)
        },
        p_entry: entryToJson(built.entry),
        p_accounts: built.resultAccountIds.map((id) => ({ id })),
      });
      return linked;
    },

    async addUsdCash(input) {
      const id = String(input.id ?? '').trim();
      const name = String(input.name ?? '').trim();
      if (id === '' || id.length > 90) throw storeError('store.usdAccountIdInvalid');
      if (!lengthWithin(name, 1, MAX_NAME_LENGTH)) throw storeError('store.usdAccountNameLength', { max: MAX_NAME_LENGTH });
      const { error } = await client.from('accounts').insert({ id, type: 'asset', name, currency: 'USD', kind: 'investment' });
      check(error);
      return { id, type: 'asset', name, currency: 'USD', kind: 'investment' };
    },

    async addUsdStock(input) {
      const id = String(input.id ?? '').trim();
      const name = String(input.name ?? '').trim();
      const ticker = String(input.ticker ?? '').trim().toUpperCase();
      const exchange = String(input.exchange ?? '').trim();
      if (id === '' || id.length > 90) throw storeError('store.assetIdInvalid');
      if (!lengthWithin(name, 1, MAX_NAME_LENGTH)) throw storeError('store.stockNameLength', { max: MAX_NAME_LENGTH });
      if (!lengthWithin(ticker, 1, 20)) throw storeError('store.tickerLength', { max: 20 });
      if (!(INSTRUMENT_EXCHANGES as readonly string[]).includes(exchange)) throw storeError('store.exchangeUnsupported');
      const accountId = `inv-${id}`;
      const acc = await client.from('accounts').insert({ id: accountId, type: 'asset', name, currency: 'USD', kind: 'investment' });
      check(acc.error);
      const ins = await client.from('assets').insert({ id, name, kind: 'stock', account_id: accountId, instrument_currency: 'USD', ticker, exchange });
      if (ins.error) {
        await client.from('accounts').delete().eq('id', accountId).eq('kind', 'investment');
        check(ins.error);
      }
      return { id, name, kind: 'stock', accountId, currency: 'USD', ticker, exchange } as Asset;
    },

    async recordTradeFx({ trade, cashAccountId }) {
      const found = await client.from('assets').select('*').eq('id', trade.assetId).maybeSingle();
      check(found.error);
      if (!found.data) throw storeError('store.assetNotFound');
      const asset = rowToAsset(found.data as AssetRow);
      if (assetCurrency(asset) !== 'USD') throw storeError('store.usdOnly');
      if (trade.fxRateMicro === undefined) throw storeError('store.fxRateRequired');
      const siblings = await fetchAll<TradeRow>(
        'trades',
        (from, to) => client.from('trades').select('*').eq('asset_id', trade.assetId).order('id').range(from, to),
        (row) => row.id,
        'id',
        { column: 'asset_id', value: trade.assetId },
      );
      const existing = siblings.map(rowToTrade);
      const problem = checkTradeAddCoded(existing, trade);
      if (problem) throw problem.code ? withCode(new StorageError(problem.message), problem.code, problem.params ?? {}) : new StorageError(problem.message);
      const entryId = `${trade.id}-entry`;
      let built;
      try {
        // เล่นซ้ำ 2 ถังรวมรายการใหม่: ตรวจ R20.3 (ต้นทุนบาทปัดเป็น 0) ขายเกิน และได้ต้นทุนที่ตัดออกของรายการขาย
        const replay = replayTradesFx(toTradesFx([...existing, trade]));
        const sell = trade.kind === 'sell' ? replay.sells.find((x) => x.id === trade.id)?.result : undefined;
        built = buildUsdTradeEntry({ trade, assetName: asset.name, assetAccountId: asset.accountId, cashAccountId, entryId, sell });
      } catch (e) {
        if (e instanceof UsdLinkError || e instanceof RangeError) throw carryCode(new StorageError(e.message), e);
        throw e;
      }
      const linked: TradeRecord = { ...trade, entryId };
      await rpc('record_trade_fx', {
        p_trade: {
          id: linked.id, assetId: linked.assetId, kind: linked.kind, date: linked.date, createdAt: linked.createdAt,
          units: linked.units, priceMicro: linked.priceMicro, amount: linked.amount, fee: linked.fee,
          withholding: linked.withholding, memo: linked.memo, fxRateMicro: linked.fxRateMicro,
          basedOn: await tradesFingerprint(siblings),
        },
        p_entry: entryToJson(built.entry),
        p_accounts: built.resultAccountIds.map((id) => ({ id })),
      });
      return linked;
    },

    async recordFxExchange({ exchange, walletId, cashAccountId }) {
      let rateMicro: number;
      try {
        rateMicro = fxRateFromExchange(exchange.thbSatang, exchange.usdCents);
      } catch (e) {
        if (e instanceof RangeError) throw carryCode(new StorageError(e.message), e);
        throw e;
      }
      const entryId = `${exchange.id}-entry`;
      let built;
      try {
        built = buildFxExchangeEntry({ exchange: { ...exchange, rateMicro, entryId }, walletId, cashAccountId, entryId });
      } catch (e) {
        if (e instanceof UsdLinkError) throw carryCode(new StorageError(e.message), e);
        throw e;
      }
      await rpc('record_fx_exchange', {
        p_exchange: {
          id: exchange.id, date: exchange.date, createdAt: exchange.createdAt, direction: exchange.direction,
          thbSatang: exchange.thbSatang, usdCents: exchange.usdCents, memo: exchange.memo,
        },
        p_entry: entryToJson(built.entry),
        p_accounts: built.suspenseAccountIds.map((id) => ({ id })),
      });
      return { ...exchange, rateMicro, entryId };
    },

    async recordCashAdjustment(input) {
      let built;
      try {
        built = buildCashAdjustmentEntry(input);
      } catch (e) {
        if (e instanceof CashAdjustmentError) throw carryCode(new StorageError(e.message), e);
        throw e;
      }
      await rpc('record_cash_adjustment', { p_entry: entryToJson(built.entry), p_accounts: built.adjustAccountIds.map((id) => ({ id })) });
    },

    async deleteFxExchange(id) {
      const found = await client.from('fx_exchanges').select('entry_id').eq('id', id).maybeSingle();
      check(found.error);
      const entryId = (found.data as { entry_id?: string } | null)?.entry_id;
      if (!entryId) throw storeError('store.fxExchangeNotFound');
      await deleteEntryRow(entryId);
    },

    async saveFxRate(rate: FxRateRecord) {
      if (!Number.isSafeInteger(rate.rateMicro) || rate.rateMicro <= 0) throw storeError('store.fxRateInvalid');
      const { error } = await client
        .from('fx_rates')
        .upsert({ user_id: userId, account_id: rate.accountId, date: rate.date, rate_micro: rate.rateMicro }, { onConflict: 'user_id,account_id,date' });
      check(error);
    },

    async deleteTrade(id) {
      const found = await client.from('trades').select('*').eq('id', id).maybeSingle();
      check(found.error);
      if (!found.data) throw storeError('store.tradeNotFound');
      const target = rowToTrade(found.data as TradeRow);
      const siblings = await fetchAll<TradeRow>(
        'trades',
        (from, to) => client.from('trades').select('*').eq('asset_id', target.assetId).order('id').range(from, to),
        (row) => row.id,
        'id',
        { column: 'asset_id', value: target.assetId },
      );
      const problem = checkTradeDeleteCoded(siblings.map(rowToTrade), id);
      if (problem) throw problem.code ? withCode(new StorageError(problem.message), problem.code, problem.params ?? {}) : new StorageError(problem.message);
      if (target.entryId !== undefined) {
        // ผูกสมุด: ลบรายการในสมุด (ฐานข้อมูลลบรายการลงทุนตาม และตรวจลำดับซ้ำ) ห้ามลบรายการลงทุนตรงๆ ไม่งั้นยอดในสมุดค้าง
        await deleteEntryRow(target.entryId);
        return;
      }
      const del = await client.from('trades').delete().eq('id', id).select('id');
      check(del.error);
      if ((del.data ?? []).length !== 1) throw storeError('store.tradeDeleteFailed');
    },

    async savePrice(price) {
      if (!Number.isSafeInteger(price.priceMicro) || price.priceMicro <= 0) throw storeError('store.priceInvalid');
      const { error } = await client
        .from('asset_prices')
        .upsert({ user_id: userId, asset_id: price.assetId, date: price.date, price_micro: price.priceMicro }, { onConflict: 'user_id,asset_id,date' });
      check(error);
    },

    async importBackup(data: BackupData, onProgress?: ImportProgress) {
      const report = runIntegrityCheck(data.accounts, data.entries);
      if (!report.ok) throw new StorageError(`ข้อมูลนำเข้าไม่ผ่านการตรวจ: ${report.issues[0]?.message ?? ''}`);
      const settingsIssue = settingsProblem(data.settings);
      if (settingsIssue) throw new StorageError(`ค่าตั้งค่าไม่ถูกต้อง: ${settingsIssue}`);
      const totalLines = data.entries.reduce((n, e) => n + e.lines.length, 0);
      if (data.entries.length > SINGLE_IMPORT_MAX_ENTRIES || totalLines > SINGLE_IMPORT_MAX_LINES) {
        const chunked = await importChunked(data, onProgress);
        await importInvestments(data.investments);
        return chunked;
      }
      // ครั้งเดียว: ฐานข้อมูลเขียนทุกส่วนในธุรกรรมเดียว ผิดข้อใด = ย้อนกลับทั้งก้อน · มีข้อมูลอยู่แล้ว = ปฏิเสธ
      const out = (await rpc('import_ledger', {
        p_data: {
          accounts: data.accounts.map(accountToJson),
          bills: data.bills.map(billToJson),
          entries: data.entries.map(entryToJson),
          settings: sanitizeSettings(data.settings),
        },
      })) as { accounts?: number; entries?: number; bills?: number } | null;
      onProgress?.(data.entries.length, data.entries.length);
      await importInvestments(data.investments);
      return { accounts: out?.accounts ?? 0, entries: out?.entries ?? 0, bills: out?.bills ?? 0 };
    },

    async hasUnfinishedImport() {
      return (await rpc('import_ledger_status', {})) === true;
    },

    async abortUnfinishedImport() {
      await abortImport();
    },

    async saveSettings(settings) {
      // แทนทั้งชุดแบบเดิม (ไม่ส่ง = ไม่ตั้ง ยกเว้น dcaPlans/retirementAssetIds ไม่ส่ง = คงเดิม) แต่ทำฝั่งฐานข้อมูลในคำสั่งเดียว
      return writeSettingsPlan(planSettingsReplace(settings));
    },
    async patchSettings(patch: SettingsPatch) {
      return writeSettingsPlan(planSettingsPatch(patch));
    },
    async updateSettings(keys: readonly SettingsKey[], compute: (current: FinanceSettings) => SettingsPatch, options?: { baseline?: FinanceSettings }) {
      // อ่านค่าดิบ → คำนวณจากค่าล่าสุด → เขียนด้วย RPC ที่ตรวจว่าค่าของคีย์ที่ประกาศยังเหมือนที่อ่านมา (compare-and-set ฝั่งฐานข้อมูล)
      // ชนกับแท็บอื่น (PT409) = อ่านใหม่แล้วคำนวณใหม่ · baseline ต่างจากค่าล่าสุด = ไม่ลองซ้ำ (ผู้ใช้ต้องเห็นค่าล่าสุดก่อน)
      for (let attempt = 0; attempt < SETTINGS_UPDATE_MAX_ATTEMPTS; attempt++) {
        const { data, error } = await client.from('settings').select('value').maybeSingle();
        check(error);
        const rawValue = (data as { value?: unknown } | null)?.value;
        const raw: Record<string, unknown> = typeof rawValue === 'object' && rawValue !== null && !Array.isArray(rawValue) ? (rawValue as Record<string, unknown>) : {};
        const current = sanitizeSettings(raw);
        if (options?.baseline && settingsKeysChanged(keys, current, sanitizeSettings(options.baseline))) throw new SettingsConflictError();
        const planned = planSettingsPatch(compute(current));
        if (!planned.ok) throw new StorageError(`ค่าตั้งค่าไม่ถูกต้อง: ${planned.problem}`);
        const outside = planOutsideKeysProblem(planned.plan, keys);
        if (outside) throw new StorageError(outside);
        const conflict = planConflictProblem(current, planned.plan);
        if (conflict) throw new StorageError(`ค่าตั้งค่าไม่ถูกต้อง: ${conflict}`);
        const sizeProblem = settingsProblem(applySettingsPlan(current, planned.plan));
        if (sizeProblem) throw new StorageError(`ค่าตั้งค่าไม่ถูกต้อง: ${sizeProblem}`);
        const expect: Record<string, unknown> = {};
        for (const k of keys) expect[k] = raw[k] ?? null;
        const res = await client.rpc('merge_settings_if', { p_patch: planned.plan.set, p_remove: planned.plan.remove, p_expect: expect });
        if (res.error?.code === 'PT409') {
          // อีกแท็บเพิ่งแก้คีย์เหล่านี้: พักสั้นๆ (สุ่ม กันชนซ้ำพร้อมกัน) แล้วอ่านใหม่คำนวณใหม่
          await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1) + Math.random() * 25));
          continue;
        }
        check(res.error);
        return sanitizeSettings(res.data);
      }
      throw new SettingsConflictError();
    },
  };
}
