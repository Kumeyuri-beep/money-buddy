/**
 * ตารางถือครอง Portfolio → Holdings ของโหมด /invest (invest-v2 · R17 R20 R24 R25 R26) · ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล
 * ไม่มีสูตรเงินใหม่ที่เป็นของตัวเอง ประกอบจาก:
 *   replayWithFees (หน่วย ต้นทุน 2 ถัง R20.3) · valueInSatang (มูลค่า) · dividendInThb (ปันผลสุทธิ) · computeProfitSources (R24 กำไรรวมและ 6 แหล่ง ต่อสินทรัพย์)
 *   computeDividendMetrics (R25 ปันผล 12 เดือน yield) · displayCurrency (R26 แปลงสกุลที่แสดง) · profitPercentBps (R24.5/R24.6) · allocateBps
 * ที่เพิ่มเอง: เลือก/ค้นหา/เรียง/ชุดคอลัมน์ต่อแท็บ · ราคาต่อหุ้นในสกุลที่แสดง (ปัดครึ่งออกจากศูนย์ครั้งเดียว ด้วย roundHalfUpBig)
 * ไม่มีราคา/เรต = null (หน้าจอแสดง "—" หรือ "Needs rate") ห้ามใช้ต้นทุนแทนมูลค่าตลาด ห้ามเดา (R20.7, R26)
 */
import { daysBetween } from '../bills/calendar';
import { roundHalfUpBig } from '../money/round';
import { safeAdd } from '../money/safe';
import { allocateBps } from './allocation';
import { sumDisplayed, toDisplayMinor, type DisplayCurrency } from './displayCurrency';
import { dividendInThb } from './fx';
import { computeDividendMetrics, computeProfitSources, profitPercentBps, replayWithFees } from './metrics';
import { latestFxRate, WEALTH_STALE_DAYS } from './portfolioMoney';
import { splitTradesByRate, toTradesFx } from './tradesFx';
import { checkTradeDeleteCoded } from './rules';
import type { CodedProblem } from '../errors/problem';
import { assetCurrency, type Asset, type InvestmentData, type TradeRecord } from './types';
import { toSafeSatang, UNIT_SCALE, valueInSatang } from './units';

export type HoldingsTab = 'holdings' | 'general' | 'dividends' | 'returns';
export const HOLDINGS_TABS: readonly { id: HoldingsTab; label: string }[] = [
  { id: 'holdings', label: 'My holdings' },
  { id: 'general', label: 'General' },
  { id: 'dividends', label: 'Dividends' },
  { id: 'returns', label: 'Returns' },
];

export type ColumnId =
  | 'shares'
  | 'costBasis'
  | 'currentValue'
  | 'dividends'
  | 'dividendYield'
  | 'totalProfit'
  | 'weight'
  | 'avgCost'
  | 'lastPrice'
  | 'unrealized'
  | 'div12m'
  | 'yieldCurrent'
  | 'yieldOnCost'
  | 'srcUnrealized'
  | 'srcRealized'
  | 'srcOptions'
  | 'srcDividends'
  | 'srcFx'
  | 'srcFees'
  | 'srcTotal';

/** ชุดคอลัมน์ต่อแท็บ (คอลัมน์ Daily ยังไม่มี: ต้องมีราคารายวันของเฟส B ก่อน) · คอลัมน์ชื่อสินทรัพย์และเมนู ⋯ มีทุกแท็บ */
export function columnsFor(tab: HoldingsTab): ColumnId[] {
  switch (tab) {
    case 'holdings':
      return ['shares', 'costBasis', 'currentValue', 'dividends', 'dividendYield', 'totalProfit'];
    case 'general':
      return ['shares', 'weight', 'avgCost', 'lastPrice', 'currentValue', 'unrealized'];
    case 'dividends':
      return ['dividends', 'div12m', 'yieldCurrent', 'yieldOnCost'];
    case 'returns':
      return ['srcUnrealized', 'srcRealized', 'srcOptions', 'srcDividends', 'srcFx', 'srcFees', 'srcTotal'];
  }
}

export interface ProfitSourcesRow {
  priceUnrealized: number;
  priceRealized: number;
  options: number;
  dividendGross: number;
  /** null = มุมมอง USD (R24: ไม่มีแหล่งค่าเงิน แสดง "—") */
  fx: number | null;
  feesAndTax: number;
  total: number;
}

export type MissingKind = 'price' | 'rate' | 'error';

export interface HoldingRow {
  assetId: string;
  name: string;
  ticker: string;
  units: bigint;
  /** มีรายการซื้อขายหรือปันผลแล้วอย่างน้อยหนึ่งรายการ */
  hasTrades: boolean;
  /** ถือ 0 หน่วย (ขายหมดแล้ว หรือลบรายการจนไม่เหลือ หรือเพิ่งเพิ่มหุ้นที่ยังไม่ซื้อ) = ซ่อนเป็นค่าเริ่มต้น แสดงเมื่อติ๊ก Show sold · แถวที่คำนวณไม่ได้ (error) ไม่ซ่อน (เจ้าของสั่ง 20 พ.ย. 2569) */
  sold: boolean;
  priceMicro: number | null;
  /** ราคาต่อหุ้นในสกุลที่แสดง (หน่วยย่อย) · null = ไม่มีราคา/เรต */
  pricePerShare: number | null;
  /** ต้นทุนที่ยังถืออยู่ (รวมค่าธรรมเนียมซื้อ ตามสกุลที่แสดง: USD = เซนต์ · THB = Cthb) */
  cost: number | null;
  costPerShare: number | null;
  /** มูลค่าตลาด = หน่วย × ราคาล่าสุด (ถือ 0 หน่วย = 0) · null = ไม่มีราคา หรือมุมมอง THB ไม่มีเรต */
  value: number | null;
  /** ปันผลสะสมสุทธิ (หลังหักภาษี) */
  dividends: number | null;
  /** ปันผล 12 เดือนล่าสุดสุทธิ (R25.1) */
  dividends12m: number | null;
  /** yield ปัจจุบัน / yield on cost (bps · R25.2) · null = ไม่คำนวณ */
  yieldBps: number | null;
  yieldOnCostBps: number | null;
  /** กำไรรวม P ต่อสินทรัพย์ (R24) และเป็น % ของต้นทุนที่ยังถืออยู่ (R24.5) */
  profit: number | null;
  profitBps: number | null;
  /** กำไรยังไม่ขาย = มูลค่า − ต้นทุนที่ถืออยู่ (R24.6) และ % */
  unrealized: number | null;
  unrealizedBps: number | null;
  /** สัดส่วนมูลค่า (bps รวม 10,000 ของแถวที่ถืออยู่) · null = พอร์ตไม่ครบจึงไม่แบ่ง */
  weightBps: number | null;
  sources: ProfitSourcesRow | null;
  /** ทำไมบางค่าเป็น null */
  missing: MissingKind | null;
}

export interface HoldingsView {
  currency: DisplayCurrency;
  rows: HoldingRow[];
  fx: { rateMicro: number; date: string; days: number; stale: boolean } | null;
}

const guard = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RangeError) return fallback;
    throw e;
  }
};

/** ราคาต่อหุ้น (micro-USD) → หน่วยย่อยของสกุลที่แสดง ปัดครั้งเดียว: USD = ÷10^4 · THB = × เรต ÷ 10^10 (เซนต์×เรต micro ÷ 10^6 ของ R26 ที่ยังไม่ปัดเป็นเซนต์) */
export function pricePerShareMinor(priceMicro: number, currency: DisplayCurrency, rateMicro: number | null): number | null {
  if (!Number.isSafeInteger(priceMicro) || priceMicro <= 0) return null;
  if (currency === 'USD') return toSafeSatang(roundHalfUpBig(BigInt(priceMicro), 10_000n));
  if (rateMicro === null || !Number.isSafeInteger(rateMicro) || rateMicro <= 0) return null;
  return toSafeSatang(roundHalfUpBig(BigInt(priceMicro) * BigInt(rateMicro), 10_000_000_000n));
}

/** เฉลี่ยต่อหุ้น = ยอดรวม (หน่วยย่อย) × 10^8 ÷ หน่วย ปัดครึ่งออกจากศูนย์ · ไม่มีหุ้น = null */
export function perShareMinor(totalMinor: number, units: bigint): number | null {
  if (units <= 0n) return null;
  return toSafeSatang(roundHalfUpBig(BigInt(totalMinor) * UNIT_SCALE, units));
}

function subsetOf(data: InvestmentData, assetId: string): InvestmentData {
  return {
    assets: data.assets.filter((a) => a.id === assetId),
    trades: data.trades.filter((t) => t.assetId === assetId),
    prices: data.prices.filter((p) => p.assetId === assetId),
    ...(data.fxRates ? { fxRates: data.fxRates } : {}),
  };
}

interface Base {
  asset: Asset;
  units: bigint;
  costUsd: number;
  costThb: number;
  priceMicro: number | null;
  valueUsd: number | null;
  dividendNetUsd: number;
  dividendNetThb: number;
  error: boolean;
  /** มีรายการที่ไม่มีเรต (R26) */
  needsRate: boolean;
}

/** หน่วย/ต้นทุนจากการเล่นซ้ำ + ราคาล่าสุด + ปันผลสะสมสุทธิ ของหุ้นหนึ่งตัว ณ วัน today · เล่นซ้ำไม่ผ่านหรือตัวเลขเกินช่วง = error (ไม่ทำให้ทั้งหน้าล้ม) */
function baseOf(asset: Asset, data: InvestmentData, today: string): Base {
  const own = data.trades.filter((t) => t.assetId === asset.id && t.date <= today);
  let divUsd = 0;
  let divThb = 0;
  let latest: { priceMicro: number; date: string } | null = null;
  for (const p of data.prices) if (p.assetId === asset.id && p.date <= today && (latest === null || p.date > latest.date)) latest = { priceMicro: p.priceMicro, date: p.date };
  const priceMicro = latest ? latest.priceMicro : null;
  try {
    for (const t of own) {
      if (t.kind !== 'dividend' || t.fxRateMicro === undefined) continue;
      const gross = t.amount ?? 0;
      divUsd = safeAdd(divUsd, gross - t.withholding);
      divThb = safeAdd(divThb, dividendInThb(gross, t.withholding, t.fxRateMicro).netThb);
    }
    const needsRate = splitTradesByRate(own).missingRate.length > 0;
    const pos = replayWithFees(toTradesFx(own)).position;
    return {
      asset, units: pos.units, costUsd: pos.costUsd, costThb: pos.costThb, priceMicro,
      valueUsd: pos.units > 0n && priceMicro !== null ? valueInSatang(pos.units, priceMicro) : null, dividendNetUsd: divUsd, dividendNetThb: divThb, error: false, needsRate,
    };
  } catch (e) {
    if (!(e instanceof Error)) throw e; // ข้อผิดพลาดจากกติกาซื้อขาย/ตัวเลขเกินช่วง = แถวนี้คำนวณไม่ได้
    return { asset, units: 0n, costUsd: 0, costThb: 0, priceMicro, valueUsd: null, dividendNetUsd: divUsd, dividendNetThb: divThb, error: true, needsRate: splitTradesByRate(own).missingRate.length > 0 };
  }
}

function buildRow(us: Base, data: InvestmentData, today: string, currency: DisplayCurrency, rateMicro: number | null): HoldingRow {
  const hasTrades = data.trades.some((t) => t.assetId === us.asset.id && t.date <= today);
  const held = us.units > 0n;
  const sold = !held && !us.error;
  const base = { assetId: us.asset.id, name: us.asset.name, ticker: us.asset.ticker ?? '', units: us.units, hasTrades, sold };
  const cost = currency === 'USD' ? us.costUsd : us.costThb;
  const dividends = currency === 'USD' ? us.dividendNetUsd : us.dividendNetThb;
  const priceMicro = us.priceMicro;

  if (us.needsRate) {
    // ขาดเรต: ไม่คำนวณ ไม่นับเป็น 0 (R26)
    return {
      ...base, priceMicro, pricePerShare: null, cost: null, costPerShare: null, value: null, dividends: null, dividends12m: null, yieldBps: null, yieldOnCostBps: null,
      profit: null, profitBps: null, unrealized: null, unrealizedBps: null, weightBps: null, sources: null, missing: 'rate',
    };
  }
  if (us.error) {
    return {
      ...base, priceMicro, pricePerShare: null, cost: null, costPerShare: null, value: null, dividends: null, dividends12m: null, yieldBps: null, yieldOnCostBps: null,
      profit: null, profitBps: null, unrealized: null, unrealizedBps: null, weightBps: null, sources: null, missing: 'error',
    };
  }

  // มูลค่า (R26): USD = เซนต์ต้นทาง · THB = แปลงด้วยเรตล่าสุดครั้งเดียว · ถือ 0 หน่วย = 0 ไม่ต้องมีราคา
  let value: number | null = 0;
  let missing: MissingKind | null = null;
  if (held) {
    if (us.valueUsd === null) {
      value = null;
      missing = 'price';
    } else {
      value = guard(() => toDisplayMinor('USD', us.valueUsd as number, currency, rateMicro), null);
      if (value === null) missing = 'rate';
    }
  }

  const sub = subsetOf(data, us.asset.id);
  const ps = guard(() => computeProfitSources(sub, today, { strictRate: true }), null);
  const src = ps === null ? null : currency === 'THB' ? ps.thb : ps.usd;
  const profit = src === null ? null : src.total;
  const sources: ProfitSourcesRow | null =
    src === null
      ? null
      : currency === 'THB' && ps!.thb
        ? { ...ps!.thb, fx: ps!.thb.fx }
        : { priceUnrealized: src.priceUnrealized, priceRealized: src.priceRealized, options: src.options, dividendGross: src.dividendGross, fx: null, feesAndTax: src.feesAndTax, total: src.total };

  const dm = guard(() => computeDividendMetrics(sub, today), null);
  const unrealized = value === null ? null : value - cost;

  return {
    ...base,
    priceMicro,
    pricePerShare: priceMicro === null ? null : pricePerShareMinor(priceMicro, currency, rateMicro),
    cost,
    costPerShare: perShareMinor(cost, us.units),
    value,
    dividends,
    dividends12m: dm === null ? null : currency === 'USD' ? dm.netUsd : dm.netThb,
    yieldBps: dm === null ? null : dm.yieldBps,
    yieldOnCostBps: dm === null ? null : dm.yieldOnCostBps,
    profit,
    profitBps: cost === null ? null : profitPercentBps(profit, cost),
    unrealized,
    unrealizedBps: held ? profitPercentBps(unrealized, cost) : null,
    weightBps: null,
    sources,
    missing: missing ?? (held && profit === null ? (currency === 'THB' && rateMicro === null ? 'rate' : 'price') : null),
  };
}

/** สร้างแถวถือครองทุกหุ้นสหรัฐ (รวมที่ขายหมดแล้ว · ตัวกรองอยู่ที่ filterAndSort) ในสกุลที่แสดง */
export function buildHoldingsView(data: InvestmentData, today: string, currency: DisplayCurrency): HoldingsView {
  const fxRaw = latestFxRate(data.fxRates ?? [], today);
  const fx = fxRaw ? (() => { const days = daysBetween(fxRaw.date, today); return { ...fxRaw, days, stale: days > WEALTH_STALE_DAYS }; })() : null;
  const rateMicro = fxRaw ? fxRaw.rateMicro : null;
  const rows = data.assets.filter((a) => assetCurrency(a) === 'USD').map((a) => buildRow(baseOf(a, data, today), data, today, currency, rateMicro));

  // สัดส่วนมูลค่าเฉพาะที่ถืออยู่ · ต้องมีมูลค่าครบทุกตัว ไม่งั้นไม่แบ่ง (ไม่เดา)
  const held = rows.filter((r) => r.units > 0n);
  if (held.length > 0 && held.every((r) => r.value !== null)) {
    const shares = guard(() => allocateBps(held.map((r) => ({ key: r.assetId, weight: r.value as number }))), []);
    const bps = new Map(shares.map((s) => [s.key, s.bps]));
    if (shares.length > 0) for (const r of held) r.weightBps = bps.get(r.assetId) ?? 0;
  }
  return { currency, rows, fx };
}

export type SortKey = 'holding' | 'shares' | 'cost' | 'value' | 'profit' | 'dividends';
export const SORT_KEYS: readonly { id: SortKey; label: string }[] = [
  { id: 'holding', label: 'Holding' },
  { id: 'shares', label: 'Shares' },
  { id: 'cost', label: 'Cost basis' },
  { id: 'value', label: 'Current value' },
  { id: 'profit', label: 'Total profit' },
  { id: 'dividends', label: 'Dividends' },
];
export type SortDir = 'asc' | 'desc';

export interface HoldingsQuery {
  showSold: boolean;
  query: string;
  sortKey: SortKey;
  dir: SortDir;
}

export const DEFAULT_HOLDINGS_QUERY: HoldingsQuery = { showSold: false, query: '', sortKey: 'holding', dir: 'asc' };

const labelOf = (r: HoldingRow): string => (r.ticker !== '' ? r.ticker : r.name).toLowerCase();

function sortValue(r: HoldingRow, key: SortKey): number | bigint | null {
  switch (key) {
    case 'shares': return r.units;
    case 'cost': return r.cost;
    case 'value': return r.value;
    case 'profit': return r.profit;
    case 'dividends': return r.dividends;
    case 'holding': return null;
  }
}

/** กรอง (Show sold · ค้นหาจากชื่อ/ชื่อย่อ) แล้วเรียง · ค่า null (ไม่มีข้อมูล) อยู่ท้ายเสมอไม่ว่าเรียงทางไหน · เท่ากันเรียงตามชื่อย่อ ให้ผลคงที่ */
export function filterAndSort(rows: readonly HoldingRow[], q: HoldingsQuery): HoldingRow[] {
  const needle = q.query.trim().toLowerCase();
  const kept = rows.filter((r) => (q.showSold || !r.sold) && (needle === '' || r.ticker.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle)));
  const sign = q.dir === 'asc' ? 1 : -1;
  const byLabel = (a: HoldingRow, b: HoldingRow): number => (labelOf(a) < labelOf(b) ? -1 : labelOf(a) > labelOf(b) ? 1 : a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0);
  return [...kept].sort((a, b) => {
    if (q.sortKey === 'holding') return sign * byLabel(a, b);
    const av = sortValue(a, q.sortKey);
    const bv = sortValue(b, q.sortKey);
    if (av === null && bv === null) return byLabel(a, b);
    if (av === null) return 1;
    if (bv === null) return -1;
    const c = av < bv ? -1 : av > bv ? 1 : 0;
    return c !== 0 ? sign * c : byLabel(a, b);
  });
}

export interface HoldingsTotals {
  count: number;
  cost: number | null;
  /** null = มีแถวที่ถืออยู่แต่ไม่มีราคา/เรต (รวมไม่ครบ ไม่นับเป็น 0) */
  value: number | null;
  dividends: number | null;
  profit: number | null;
  profitBps: number | null;
  unrealized: number | null;
  unrealizedBps: number | null;
  sources: ProfitSourcesRow | null;
  complete: boolean;
}

/** แถวรวม (R26): ผลรวม = ผลบวกค่าที่แปลงแล้วของแต่ละแถวที่แสดง · มีแถวใดเป็น null = รวมเป็น null (flag ไม่ครบ) */
export function totalsOf(rows: readonly HoldingRow[], currency: DisplayCurrency): HoldingsTotals {
  const cost = sumDisplayed(rows.map((r) => r.cost));
  const value = sumDisplayed(rows.map((r) => r.value));
  const dividends = sumDisplayed(rows.map((r) => r.dividends));
  const profit = sumDisplayed(rows.map((r) => r.profit));
  const unrealized = sumDisplayed(rows.map((r) => r.unrealized));
  const allSources = rows.length > 0 && rows.every((r) => r.sources !== null);
  const pick = (f: (s: ProfitSourcesRow) => number): number => sumDisplayed(rows.map((r) => f(r.sources as ProfitSourcesRow))) ?? 0;
  const sources: ProfitSourcesRow | null = allSources
    ? {
        priceUnrealized: pick((s) => s.priceUnrealized),
        priceRealized: pick((s) => s.priceRealized),
        options: pick((s) => s.options),
        dividendGross: pick((s) => s.dividendGross),
        fx: currency === 'THB' ? pick((s) => s.fx ?? 0) : null,
        feesAndTax: pick((s) => s.feesAndTax),
        total: pick((s) => s.total),
      }
    : null;
  return {
    count: rows.length,
    cost,
    value,
    dividends,
    profit,
    profitBps: cost === null ? null : profitPercentBps(profit, cost),
    unrealized,
    unrealizedBps: unrealized === null || cost === null ? null : profitPercentBps(unrealized, cost),
    sources,
    complete: rows.every((r) => r.missing === null),
  };
}

export type DeletePlan = { ok: true; ids: string[] } | { ok: false; problem: CodedProblem };

/**
 * ลำดับการลบรายการทั้งหมดของสินทรัพย์หนึ่งตัว (เมนู Delete ของแถว) ตามกติกา R17: ลบจากล่าสุดย้อนกลับ · วันเดียวกันขายก่อนซื้อ
 * จำลองลบทีละรายการด้วย checkTradeDeleteCoded (ตัวเดียวกับที่ repository ใช้) · ผิดกติกาตรงไหน = ไม่ลบสักรายการ คืน CodedProblem ให้หน้าจอแปลงเป็นข้อความ
 */
export function planHoldingDelete(trades: readonly TradeRecord[], assetId: string): DeletePlan {
  const own = trades.filter((t) => t.assetId === assetId);
  const rank = (t: TradeRecord): number => (t.kind === 'sell' ? 0 : 1);
  const order = [...own].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : rank(a) - rank(b) || (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0)));
  let rest = own;
  for (const t of order) {
    const p = checkTradeDeleteCoded(rest, t.id);
    if (p) return { ok: false, problem: p };
    rest = rest.filter((x) => x.id !== t.id);
  }
  return { ok: true, ids: order.map((t) => t.id) };
}
