/**
 * ตารางรายการรวมของ Portfolio → Transactions ในโหมด /invest (invest-v2 · R16 R17 R20 R23 R26) · ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล
 * ไม่มีสูตรเงินใหม่ของตัวเอง ประกอบจาก:
 *   toDisplayMinor / sumDisplayed (R26 แปลงสกุลที่แสดง ปัดครั้งเดียวต่อค่า) · valueInSatang (เงินขาย) · pricePerShareMinor / perShareMinor (ราคาต่อหุ้น)
 *   classifyPortfolioTransfer (R23 โอนเข้า/ออกพอร์ต) · checkTradeDeleteCoded (R17 ลบรายการ) · negativeUsdCash (เตือนเงินสด USD ติดลบ)
 * รวมรายการจาก 4 แหล่ง: trades · fx_exchanges · Entry โอนเงินบาทเข้า/ออกพอร์ต · Entry ปรับยอดเงินสด (บรรทัดบัญชีพัก CASH_ADJUST_ACCOUNT_IDS)
 * เรตของมุมมอง THB ตามชนิดตัวเลข (R26): รายการซื้อขายปันผลค่าธรรมเนียม = เรตของรายการนั้น (fxRateMicro) · เงินสด/โอนบาท = เรตล่าสุดที่กรอก
 * ไม่มีเรต = null + needsRate (หน้าจอแสดง "Needs rate") ห้ามนับเป็น 0 ห้ามใช้เรตอื่นแทน
 * สินทรัพย์บาท (กองทุน/หุ้นไทย) ในมุมมอง USD ไม่แปลง (R26 ขอบเขต): แสดงเป็นบาทตามต้นทาง (native) และไม่นับในยอดรวม
 */
import type { CodedProblem } from '../errors/problem';
import type { Account, Entry } from '../ledger/types';
import { roundHalfUpBig } from '../money/round';
import { CASH_ADJUST_ACCOUNT_IDS } from './cashAdjustment';
import { sumDisplayed, toDisplayMinor, type DisplayCurrency } from './displayCurrency';
import { perShareMinor, pricePerShareMinor } from './holdingsView';
import { classifyPortfolioTransfer, latestFxRate } from './portfolioMoney';
import { checkTradeDeleteCoded } from './rules';
import { assetCurrency, type Asset, type FxExchangeRecord, type InvestmentData, type TradeRecord } from './types';
import { toSafeSatang, UNIT_SCALE, valueInSatang } from './units';
import { negativeUsdCash, type UsdCashBalance } from './usdIntegrity';

export type TxKind = 'buy' | 'sell' | 'dividend' | 'reinvest' | 'fx' | 'transfer_in' | 'transfer_out' | 'cash_in' | 'cash_out';

export const TX_KINDS: readonly TxKind[] = ['buy', 'sell', 'dividend', 'reinvest', 'fx', 'transfer_in', 'transfer_out', 'cash_in', 'cash_out'];

export const TX_KIND_LABEL: Record<TxKind, string> = {
  buy: 'Buy',
  sell: 'Sell',
  dividend: 'Dividend',
  reinvest: 'Dividend reinvested',
  fx: 'Currency exchange',
  transfer_in: 'Transfer to portfolio',
  transfer_out: 'Transfer from portfolio',
  cash_in: 'Cash deposit',
  cash_out: 'Cash withdrawal',
};

export type TxTab = 'all' | 'trades' | 'incomes';
export const TX_TABS: readonly { id: TxTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'trades', label: 'Trades' },
  { id: 'incomes', label: 'Incomes' },
];
/** แท็บ Trades = ซื้อ/ขาย/ปันผลลงทุนต่อ · Incomes = ปันผลเงินสด · All = ทุกชนิด */
const TAB_KINDS: Record<TxTab, readonly TxKind[] | null> = { all: null, trades: ['buy', 'sell', 'reinvest'], incomes: ['dividend'] };

/** จำนวนเงินหน่วยย่อยพร้อมสกุล (สตางค์/เซนต์) */
export interface TxAmount {
  minor: number;
  currency: DisplayCurrency;
}

export type TxSource = 'trade' | 'fx' | 'entry';

export interface TxRow {
  /** กุญแจไม่ซ้ำของแถว (ชนิดแหล่ง + รหัส) */
  key: string;
  source: TxSource;
  /** รหัสของ trade / fx_exchange / Entry ที่ใช้ลบ */
  sourceId: string;
  kind: TxKind;
  date: string;
  createdAt: string;
  assetId: string | null;
  /** ชื่อสินทรัพย์ที่โชว์ในคอลัมน์ Asset (ticker ถ้ามี ไม่มีใช้ชื่อ · แลกเงิน/เงินสด = ข้อความตายตัว) */
  label: string;
  name: string;
  memo: string;
  /** สกุลต้นทางของรายการ ('THB↔USD' = แลกเงิน) */
  sourceCurrency: 'THB' | 'USD' | 'THB↔USD';
  /** จำนวนหน่วย × 10^8 */
  units: bigint | null;
  /** ราคาต่อหุ้น (ซื้อ = เฉลี่ยของรายการ · ขาย = ราคาขาย) · แลกเงิน = null (ดู fxRateMicro) */
  price: TxAmount | null;
  /** มูลค่า (ขนาดล้วน ไม่มีเครื่องหมาย: ชนิดรายการบอกทิศทาง) */
  value: TxAmount | null;
  /** ค่าธรรมเนียม + ภาษีหัก ณ ที่จ่าย (แปลงครั้งเดียวจากผลบวกต้นทาง) · เฉพาะรายการซื้อขายปันผล */
  feeTax: TxAmount | null;
  /** ปันผลสุทธิ (หลังหักภาษี) เฉพาะ kind = dividend */
  dividendNet: TxAmount | null;
  /** อัตราของรายการแลกเงิน (micro) */
  fxRateMicro: number | null;
  /** ต้องใช้เรตแต่ไม่มี (R26) · ค่าเงินทุกช่องของแถวนี้เป็น null */
  needsRate: boolean;
  /** แสดงเป็นสกุลต้นทางไม่แปลง (สินทรัพย์บาทในมุมมอง USD) · ไม่นับในยอดรวม */
  native: boolean;
}

export interface TxAssetOption {
  id: string;
  label: string;
}

export interface TransactionsView {
  currency: DisplayCurrency;
  /** ใหม่ก่อน: วันที่ → เวลาบันทึก → รหัส (ย้อนลำดับ) */
  rows: TxRow[];
  assets: TxAssetOption[];
  fx: { rateMicro: number; date: string } | null;
  /** บัญชีเงินสด USD ที่ติดลบ (ให้หน้าจอเตือน) */
  negativeCash: UsdCashBalance[];
}

export interface TransactionsInput {
  data: InvestmentData;
  accounts: readonly Account[];
  entries: readonly Entry[];
  currency: DisplayCurrency;
  today: string;
}

/** แปลงค่าต้นทางหนึ่งค่า · null = ต้องใช้เรตแต่ไม่มี */
function convert(from: DisplayCurrency, minor: number, view: DisplayCurrency, rate: number | null | undefined): TxAmount | null {
  const v = toDisplayMinor(from, minor, view, rate);
  return v === null ? null : { minor: v, currency: view };
}

const cmpRowDesc = (a: TxRow, b: TxRow): number =>
  a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? 1 : -1) : a.key < b.key ? 1 : a.key > b.key ? -1 : 0;

/** ราคาซื้อเฉลี่ยต่อหุ้นของรายการซื้อ (สกุลที่แสดง): ปัดครั้งเดียว · ต่างสกุล = เซนต์ × เรต × 10^8 ÷ (หน่วย × 10^6) */
function buyPrice(amountMinor: number, units: bigint, from: DisplayCurrency, view: DisplayCurrency, rate: number | null): TxAmount | null {
  if (units <= 0n) return null;
  if (from === view) {
    const v = perShareMinor(amountMinor, units);
    return v === null ? null : { minor: v, currency: view };
  }
  if (rate === null || from !== 'USD') return null;
  return { minor: toSafeSatang(roundHalfUpBig(BigInt(amountMinor) * BigInt(rate) * UNIT_SCALE, units * 1_000_000n)), currency: view };
}

/** ราคาขายต่อหุ้น (micro ของสกุลสินทรัพย์) → หน่วยย่อยที่แสดง · สกุลเดียวกัน = ÷10^4 (ปัดครั้งเดียว) */
function sellPrice(priceMicro: number, from: DisplayCurrency, view: DisplayCurrency, rate: number | null): TxAmount | null {
  if (from === view) {
    const v = pricePerShareMinor(priceMicro, 'USD', null); // สูตร ÷10^4 ใช้กับสกุลใดก็ได้เมื่อไม่แปลง
    return v === null ? null : { minor: v, currency: view };
  }
  if (from !== 'USD') return null;
  const v = pricePerShareMinor(priceMicro, view, rate);
  return v === null ? null : { minor: v, currency: view };
}

function tradeRow(t: TradeRecord, asset: Asset | undefined, view: DisplayCurrency): TxRow {
  const from: DisplayCurrency = asset ? assetCurrency(asset) : 'USD';
  const isBahtInUsdView = from === 'THB' && view === 'USD';
  const target: DisplayCurrency = isBahtInUsdView ? 'THB' : view; // สินทรัพย์บาทในมุมมอง USD ไม่แปลง
  const rate = t.fxRateMicro ?? null;
  const units = t.units !== undefined ? BigInt(t.units) : null;
  const needsRate = from === 'USD' && view === 'THB' && rate === null;
  const cv = (minor: number): TxAmount | null => (needsRate ? null : convert(from, minor, target, rate));

  let valueMinor: number | null = null;
  if (t.kind === 'sell') valueMinor = units !== null && t.priceMicro !== undefined ? valueInSatang(units, t.priceMicro) : null;
  else valueMinor = t.amount ?? null; // ซื้อ = มูลค่าซื้อ · ปันผล = ยอดก่อนภาษี · ปันผลลงทุนต่อ = ต้นทุนที่เพิ่ม

  let price: TxAmount | null = null;
  if (!needsRate) {
    if (t.kind === 'sell' && t.priceMicro !== undefined) price = sellPrice(t.priceMicro, from, target, rate);
    else if ((t.kind === 'buy' || t.kind === 'reinvest') && valueMinor !== null && units !== null) price = buyPrice(valueMinor, units, from, target, rate);
  }

  const taxSum = t.fee + t.withholding;
  const netMinor = t.kind === 'dividend' && valueMinor !== null ? valueMinor - t.withholding : null;
  const label = asset ? asset.ticker || asset.name : 'Unknown asset';
  return {
    key: `trade:${t.id}`,
    source: 'trade',
    sourceId: t.id,
    kind: t.kind,
    date: t.date,
    createdAt: t.createdAt,
    assetId: t.assetId,
    label,
    name: asset?.name ?? '',
    memo: t.memo,
    sourceCurrency: from,
    units,
    price,
    value: valueMinor === null ? null : cv(valueMinor),
    feeTax: cv(taxSum),
    dividendNet: netMinor === null ? null : cv(netMinor),
    fxRateMicro: rate,
    needsRate,
    native: isBahtInUsdView,
  };
}

function fxRow(x: FxExchangeRecord, view: DisplayCurrency): TxRow {
  return {
    key: `fx:${x.id}`,
    source: 'fx',
    sourceId: x.id,
    kind: 'fx',
    date: x.date,
    createdAt: x.createdAt,
    assetId: null,
    label: x.direction === 'thb_to_usd' ? 'THB → USD' : 'USD → THB',
    name: 'Currency exchange',
    memo: x.memo,
    sourceCurrency: 'THB↔USD',
    units: null,
    price: null,
    // สองฝั่งเป็นข้อมูลหลักของรายการ (R20.2): แสดงฝั่งที่ตรงกับสกุลที่เลือกตรงๆ ไม่แปลง
    value: view === 'THB' ? { minor: x.thbSatang, currency: 'THB' } : { minor: x.usdCents, currency: 'USD' },
    feeTax: null,
    dividendNet: null,
    fxRateMicro: x.rateMicro,
    needsRate: false,
    native: false,
  };
}

export interface CashAdjustLine {
  currency: 'THB' | 'USD';
  direction: 'deposit' | 'withdraw';
  amountMinor: number;
}

/** Entry ปรับยอดเงินสดของพอร์ต = 2 บรรทัด มีบรรทัดหนึ่งเป็นบัญชีพักการปรับยอด (CASH_ADJUST_ACCOUNT_IDS) · อ่านจากบรรทัดบัญชี ไม่ใช่ข้อความ memo */
export function classifyCashAdjustEntry(entry: Entry): CashAdjustLine | null {
  if (entry.lines.length !== 2) return null;
  const [a, b] = entry.lines;
  if (!a || !b || a.amount === 0 || a.amount !== -b.amount) return null;
  const adjust = [a, b].find((l) => l.accountId === CASH_ADJUST_ACCOUNT_IDS.THB || l.accountId === CASH_ADJUST_ACCOUNT_IDS.USD);
  if (!adjust) return null;
  const cash = adjust === a ? b : a;
  if (cash.accountId === CASH_ADJUST_ACCOUNT_IDS.THB || cash.accountId === CASH_ADJUST_ACCOUNT_IDS.USD) return null;
  return { currency: adjust.accountId === CASH_ADJUST_ACCOUNT_IDS.USD ? 'USD' : 'THB', direction: cash.amount > 0 ? 'deposit' : 'withdraw', amountMinor: Math.abs(cash.amount) };
}

function entryRow(
  e: Entry,
  kind: TxKind,
  src: 'THB' | 'USD',
  amountMinor: number,
  view: DisplayCurrency,
  latestRate: number | null,
): TxRow {
  const value = convert(src, amountMinor, view, latestRate); // เงินสด/โอนบาท = เรตล่าสุดที่กรอก (R26)
  const labels: Record<string, string> = { transfer_in: 'Baht cash', transfer_out: 'Baht cash', cash_in: `${src} cash`, cash_out: `${src} cash` };
  return {
    key: `entry:${e.id}`,
    source: 'entry',
    sourceId: e.id,
    kind,
    date: e.date,
    createdAt: e.createdAt ?? '',
    assetId: null,
    label: labels[kind] ?? '',
    name: '',
    memo: e.memo,
    sourceCurrency: src,
    units: null,
    price: null,
    value,
    feeTax: null,
    dividendNet: null,
    fxRateMicro: null,
    needsRate: value === null,
    native: false,
  };
}

export function buildTransactionsView(input: TransactionsInput): TransactionsView {
  const { data, accounts, entries, currency, today } = input;
  const assetById = new Map(data.assets.map((a) => [a.id, a] as const));
  const rows: TxRow[] = [];

  for (const t of data.trades) rows.push(tradeRow(t, assetById.get(t.assetId), currency));
  for (const x of data.fxExchanges ?? []) rows.push(fxRow(x, currency));

  const latest = latestFxRate(data.fxRates ?? [], today);
  const latestRate = latest ? latest.rateMicro : null;
  const linked = new Set<string>();
  for (const t of data.trades) if (t.entryId !== undefined) linked.add(t.entryId);
  for (const x of data.fxExchanges ?? []) linked.add(x.entryId);
  const accountById = new Map(accounts.map((a) => [a.id, a] as const));
  const assetAccountIds = new Set(data.assets.map((a) => a.accountId));
  for (const e of entries) {
    if (linked.has(e.id)) continue;
    const adj = classifyCashAdjustEntry(e);
    if (adj) {
      rows.push(entryRow(e, adj.direction === 'deposit' ? 'cash_in' : 'cash_out', adj.currency, adj.amountMinor, currency, latestRate));
      continue;
    }
    const kind = classifyPortfolioTransfer(e, accountById, assetAccountIds, linked);
    if (kind === null) continue;
    const invLine = e.lines.find((l) => accountById.get(l.accountId)?.kind === 'investment');
    if (!invLine) continue;
    rows.push(entryRow(e, kind === 'to-portfolio' ? 'transfer_in' : 'transfer_out', 'THB', Math.abs(invLine.amount), currency, latestRate));
  }

  rows.sort(cmpRowDesc);
  const used = new Set(data.trades.map((t) => t.assetId));
  const assets = data.assets
    .filter((a) => used.has(a.id))
    .map((a) => ({ id: a.id, label: a.ticker || a.name }))
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : a.id < b.id ? -1 : 1));
  return { currency, rows, assets, fx: latest, negativeCash: negativeUsdCash(accounts, entries, data) };
}

export interface TxQuery {
  tab: TxTab;
  /** '' = ทุกชนิด */
  kind: TxKind | '';
  /** '' = ทุกสินทรัพย์ */
  assetId: string;
  /** YYYY-MM-DD รวมวันที่ระบุ · '' = ไม่จำกัด */
  from: string;
  to: string;
  query: string;
}

export const DEFAULT_TX_QUERY: TxQuery = { tab: 'all', kind: '', assetId: '', from: '', to: '', query: '' };

/** ตัวกรองนอกเหนือจากแท็บทำงานอยู่ไหม (ใช้โชว์ปุ่ม Clear filters) */
export const hasActiveFilters = (q: TxQuery): boolean => q.kind !== '' || q.assetId !== '' || q.from !== '' || q.to !== '' || q.query.trim() !== '';

/** ช่วงวันที่ย้อนกัน (from > to) = ไม่มีผลลัพธ์ · หน้าจอบอกผู้ใช้ */
export const dateRangeReversed = (q: Pick<TxQuery, 'from' | 'to'>): boolean => q.from !== '' && q.to !== '' && q.from > q.to;

export function filterTransactions(rows: readonly TxRow[], q: TxQuery): TxRow[] {
  const tabKinds = TAB_KINDS[q.tab];
  const needle = q.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (tabKinds !== null && !tabKinds.includes(r.kind)) return false;
    if (q.kind !== '' && r.kind !== q.kind) return false;
    if (q.assetId !== '' && r.assetId !== q.assetId) return false;
    if (q.from !== '' && r.date < q.from) return false;
    if (q.to !== '' && r.date > q.to) return false;
    if (needle !== '') {
      const hay = `${TX_KIND_LABEL[r.kind]} ${r.label} ${r.name} ${r.memo} ${r.date}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

export interface TxTotals {
  count: number;
  /** ผลบวกของค่าที่แปลงแล้วต่อแถว (R26) · null = มีแถวที่ไม่มีเรต (ไม่นับเป็น 0) */
  buy: number | null;
  sell: number | null;
  feeTax: number | null;
  dividendNet: number | null;
  /** มีแถวที่ไม่มีเรตอยู่ในผลลัพธ์ = ยอดที่เกี่ยวข้องไม่ครบ */
  incomplete: boolean;
  /** จำนวนแถวสินทรัพย์บาทที่แสดงตามต้นทางและไม่นับในยอดรวม (มุมมอง USD) */
  excluded: number;
}

/** ยอดสรุปของแถวที่แสดง (ชิป Buy / Sell / Fee & tax / Dividends) · แถว native ไม่นับ · แถวที่ไม่มีเรตทำให้ยอดนั้นเป็น null */
export function totalsOf(rows: readonly TxRow[]): TxTotals {
  const counted = rows.filter((r) => !r.native);
  const sum = (kinds: readonly TxKind[], pick: (r: TxRow) => TxAmount | null): number | null =>
    sumDisplayed(counted.filter((r) => kinds.includes(r.kind)).map((r) => pick(r)?.minor ?? null));
  const feeKinds: readonly TxKind[] = ['buy', 'sell', 'dividend', 'reinvest'];
  return {
    count: rows.length,
    buy: sum(['buy'], (r) => r.value),
    sell: sum(['sell'], (r) => r.value),
    feeTax: sum(feeKinds, (r) => r.feeTax),
    dividendNet: sum(['dividend'], (r) => r.dividendNet),
    incomplete: rows.some((r) => r.needsRate),
    excluded: rows.length - counted.length,
  };
}

export type TxDeletePlan = { ok: true; source: TxSource; id: string } | { ok: false; problem: CodedProblem };

/**
 * แผนลบหนึ่งแถว · รายการซื้อขาย/ปันผลต้องผ่าน R17 (checkTradeDeleteCoded ตัวเดียวกับที่ repository ใช้ตรวจซ้ำ) · ไม่ผ่าน = ปฏิเสธพร้อมเหตุผลที่แปลได้
 * แลกเงิน/โอน/ปรับยอดเงินสด = ลบ Entry ที่ผูก (ไม่มีกฎลำดับของ R17) · เงินสด USD อาจติดลบหลังลบ หน้าจอเตือนจาก negativeCash
 */
export function planTransactionDelete(row: Pick<TxRow, 'source' | 'sourceId' | 'assetId'>, data: InvestmentData): TxDeletePlan {
  if (row.source === 'trade') {
    const own = data.trades.filter((t) => t.assetId === row.assetId);
    const p = checkTradeDeleteCoded(own, row.sourceId);
    if (p) return { ok: false, problem: p };
  }
  return { ok: true, source: row.source, id: row.sourceId };
}
