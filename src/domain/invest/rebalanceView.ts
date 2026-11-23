/**
 * ตัวแปลงอินพุตและแถวแสดงผลของหน้า Tools → Rebalancing (R29 · R20 · R26) · ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล/React
 * - แปลงข้อความยอดเงิน → เซนต์ (ไม่ใช้ float) · ปฏิเสธลบ ทศนิยมเกิน 2 ตำแหน่ง ไม่ใช่ตัวเลข
 * - ประกอบอินพุตของ rebalance() จากข้อมูลลงทุน (หมวด/เป้า/หน่วย/ราคา) ไม่คิดสูตรเงินเอง
 * - สร้างแถวแสดงผลจาก "หน่วยที่ปัดจริง" ของ rebalance() เท่านั้น (ตัวเลขหุ้นที่แสดง = ส่งออก = ที่คิด)
 * - ข้อความบังคับของ R29 อยู่ที่นี่ที่เดียว ใช้ทั้งหน้าจอและไฟล์ส่งออก · ไม่มีคำแนะนำ ไม่มีปุ่มสร้างรายการ
 */

import { allocateBps } from './allocation';
import { buildHoldingsView } from './holdingsView';
import { type DroppedReason, type RebalanceErrorReason, type RebalanceInput, type RebalanceMode, type RebalanceResult, type RebalanceRow, type RebalanceWarning } from './rebalance';
import { csvText, minorToDecimal } from './reportRows';
import { toReplayTrades } from './rules';
import { splitTradesByRate } from './tradesFx';
import { replayTrades } from './costBasis';
import { assetCurrency, type Asset, type InvestmentData } from './types';

// ---------- ข้อความ (อังกฤษ ตามกติกาของโหมดนี้) ----------

/** ข้อความบังคับของ R29: ติดกับ Result ทุกครั้งบนหน้าจอและในไฟล์ส่งออก (คัดลอกตรงตัวจาก docs/money-rules.md R29) */
export const REBALANCE_DISCLAIMER =
  'Result calculated from the targets and prices you entered. Not investment advice: the app does not buy or sell for you. Taxes, fees and price or currency changes are not included. Thai tax on foreign income may arise when money is brought into Thailand. Check with the Revenue Department or a tax adviser, and decide for yourself before trading. Targets are set by you; the app does not assess what suits you.';

export const REBALANCE_RESULT_TITLE = 'Result';
export const REBALANCE_TRADES_TITLE = 'Trades needed to reach your target';

// ---------- ยอดเงิน (ข้อความ → เซนต์) ----------

export type AmountProblem = 'notNumber' | 'negative' | 'tooManyDecimals' | 'tooLarge';
export type AmountParse = { ok: true; cents: number; empty: boolean } | { ok: false; problem: AmountProblem };

export const AMOUNT_PROBLEM_TEXT: Record<AmountProblem, string> = {
  notNumber: 'Enter a number such as 300 or 300.50.',
  negative: 'The amount cannot be negative.',
  tooManyDecimals: 'Use at most 2 decimal places.',
  tooLarge: 'That amount is too large.',
};

const MAX_INT_DIGITS = 12;
const PLAIN = /^(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d*))?$/;

/** "1,234.5" -> 123450 เซนต์ · ว่าง = 0 (empty) · ลบ/ทศนิยมเกิน 2 ตำแหน่ง/ไม่ใช่ตัวเลข/เลขใหญ่เกิน = ปฏิเสธ */
export function parseUsdCents(text: string): AmountParse {
  const t = text.trim().replace(/^\$/, '').trim();
  if (t === '') return { ok: true, cents: 0, empty: true };
  if (/^-/.test(t) && /\d/.test(t)) return { ok: false, problem: 'negative' };
  const m = PLAIN.exec(t);
  if (!m || (m[1] === undefined && (m[2] === undefined || m[2] === ''))) return { ok: false, problem: 'notNumber' };
  const int = (m[1] ?? '0').replace(/,/g, '');
  const frac = m[2] ?? '';
  if (frac.length > 2) return { ok: false, problem: 'tooManyDecimals' };
  if (int.replace(/^0+(?=\d)/, '').length > MAX_INT_DIGITS) return { ok: false, problem: 'tooLarge' };
  return { ok: true, cents: Number(BigInt(int) * 100n + BigInt(frac.padEnd(2, '0'))), empty: false };
}

// ---------- ค่าตั้ง (Set up) ----------

export interface RebalanceSettings {
  allowSales: boolean;
  fractional: boolean;
  /** ข้อความที่ผู้ใช้พิมพ์ (ยอดสั่งขั้นต่ำ USD) */
  minOrder: string;
}
export const DEFAULT_REBALANCE_SETTINGS: RebalanceSettings = { allowSales: false, fractional: true, minOrder: '' };

/** อ่านค่าตั้งที่เก็บไว้ในเบราว์เซอร์ · ข้อมูลเสีย/ชนิดผิด = ใช้ค่าเริ่มต้นเฉพาะช่องนั้น */
export function parseStoredSettings(raw: string | null): RebalanceSettings {
  if (raw === null) return { ...DEFAULT_REBALANCE_SETTINGS };
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const minOrder = typeof o.minOrder === 'string' && o.minOrder.length <= 20 ? o.minOrder : DEFAULT_REBALANCE_SETTINGS.minOrder;
    return {
      allowSales: typeof o.allowSales === 'boolean' ? o.allowSales : DEFAULT_REBALANCE_SETTINGS.allowSales,
      fractional: typeof o.fractional === 'boolean' ? o.fractional : DEFAULT_REBALANCE_SETTINGS.fractional,
      minOrder,
    };
  } catch {
    return { ...DEFAULT_REBALANCE_SETTINGS };
  }
}

// ---------- ประกอบอินพุตจากข้อมูลลงทุน ----------

export interface RebalanceOptions {
  mode: RebalanceMode;
  amountCents: number;
  allowSales: boolean;
  fractional: boolean;
  minOrderCents: number;
}

export type BuildInputFailure = 'noCategories' | 'needsRate' | 'holdingError';
export type BuildInputResult = { ok: true; input: RebalanceInput } | { ok: false; reason: BuildInputFailure; holdingIds: string[] };

function latestPrice(data: InvestmentData, assetId: string, today: string): { priceMicro: number; date: string } | null {
  let best: { priceMicro: number; date: string } | null = null;
  for (const p of data.prices) if (p.assetId === assetId && p.date <= today && (best === null || p.date > best.date)) best = { priceMicro: p.priceMicro, date: p.date };
  return best;
}

/**
 * ประกอบอินพุตของ rebalance() · หุ้นสหรัฐใช้หน่วยจาก buildHoldingsView (ตัวเดียวกับหน้า Holdings) · สินทรัพย์บาทหาหน่วยด้วย replay (ให้โดเมนหยุดคำนวณเมื่อยังถืออยู่ในหมวด)
 * รายการหุ้นสหรัฐที่ไม่มีเรตหรือเล่นซ้ำไม่ผ่าน = หน่วยที่ถืออาจผิด จึงไม่คำนวณ (ไม่เดา R20.7)
 */
export function buildRebalanceInput(data: InvestmentData, today: string, opts: RebalanceOptions): BuildInputResult {
  const categories = data.categories ?? [];
  if (categories.length === 0) return { ok: false, reason: 'noCategories', holdingIds: [] };
  const view = buildHoldingsView(data, today, 'USD');
  const rowOf = new Map(view.rows.map((r) => [r.assetId, r]));
  const broken: string[] = [];
  const noRate: string[] = [];
  const holdings: RebalanceInput['holdings'][number][] = [];
  for (const a of data.assets) {
    const cur = assetCurrency(a);
    const own = data.trades.filter((t) => t.assetId === a.id && t.date <= today);
    let units: bigint;
    if (cur === 'USD') {
      const row = rowOf.get(a.id);
      if (row === undefined || row.missing === 'error') {
        broken.push(a.id);
        continue;
      }
      if (splitTradesByRate(own).missingRate.length > 0) {
        noRate.push(a.id);
        continue;
      }
      units = row.units;
    } else {
      try {
        units = replayTrades(toReplayTrades(own)).position.units;
      } catch {
        broken.push(a.id);
        continue;
      }
    }
    if (units <= 0n) continue;
    const price = latestPrice(data, a.id, today);
    holdings.push({
      id: a.id,
      ticker: tickerOf(a),
      categoryId: a.categoryId ?? null,
      currency: cur,
      units,
      priceMicro: price === null ? null : price.priceMicro,
      ...(price === null ? {} : { priceDate: price.date }),
    });
  }
  if (broken.length > 0) return { ok: false, reason: 'holdingError', holdingIds: broken };
  if (noRate.length > 0) return { ok: false, reason: 'needsRate', holdingIds: noRate };
  return {
    ok: true,
    input: {
      mode: opts.mode,
      amountCents: opts.amountCents,
      allowSales: opts.allowSales,
      fractional: opts.fractional,
      minOrderCents: opts.minOrderCents,
      categories: categories.map((c) => ({ id: c.id, name: c.name, sortOrder: c.sortOrder, targetBps: c.targetBps })),
      holdings,
      today,
    },
  };
}

export const tickerOf = (a: Pick<Asset, 'ticker' | 'name'>): string => (a.ticker !== undefined && a.ticker !== '' ? a.ticker : a.name);

// ---------- ข้อความเหตุผล/คำเตือน ----------

export const REBALANCE_REASON_TEXT: Record<RebalanceErrorReason, string> = {
  invalidAmount: 'Enter an amount greater than 0 (withdrawal) or 0 or more (deposit).',
  invalidOption: 'The minimum order amount must be 0 or more.',
  invalidHolding: 'A holding has an invalid number of shares, so nothing was calculated.',
  noTargets: 'No category targets are set yet. Set them in Categories first.',
  targetsNotComplete: 'Your category targets do not add up to 100%. Fix them in Categories first.',
  holdingWithoutCategory: 'Some holdings are not in a category. Put every holding you own in a category in Categories.',
  bahtAssetInCategory: 'A category contains a holding priced in baht. Amounts here are in USD and are never added across currencies, so nothing was calculated.',
  needsPrice: 'A holding has no price yet. Add its latest price in Holdings. No cost is used in place of a price.',
  nothingToDo: 'Enter a deposit amount, or turn on "Allow sales" in Set up to rebalance without adding money.',
  withdrawExceedsValue: 'The withdrawal is more than the market value of your holdings.',
};

export const BUILD_FAILURE_TEXT: Record<BuildInputFailure, string> = {
  noCategories: 'Set up categories and target allocations first.',
  needsRate: 'A US holding has a trade without an exchange rate, so its share count may be wrong. Nothing was calculated.',
  holdingError: 'A holding could not be calculated from its trades, so nothing was calculated.',
};

export const DROPPED_REASON_TEXT: Record<DroppedReason, string> = {
  unitsZero: 'Not enough money for one share (or 0.001 share) at this price.',
  belowMinOrder: 'Below your minimum order amount.',
};

export function warningText(w: RebalanceWarning, nameOf: (id: string) => string): string {
  const list = (ids: string[] | undefined): string => (ids ?? []).map(nameOf).join(', ');
  switch (w.code) {
    case 'sellsWholePosition':
      return `This sells your whole position in: ${list(w.holdingIds)}.`;
    case 'sellsWholeCategory':
      return `This sells every holding in a category with a 0% target: ${list(w.categoryIds)}.`;
    case 'stalePrice':
      return `Price is older than 30 days for: ${list(w.holdingIds)}. Update the price in Holdings.`;
    case 'noHoldingToBuy':
      return `No holding to buy in: ${list(w.categoryIds)}. That money stays in Left over.`;
    case 'alreadyAtTargets':
      return 'Already at your targets';
  }
}

// ---------- รูปตัวเลข ----------

/** หน่วย (x 10^8) -> ข้อความหุ้น: เปิดเศษหุ้น = 3 ทศนิยมตายตัว (ตรงกับหน่วยที่ปัดลงแล้ว) · ปิด = จำนวนเต็ม · แสดงจากหน่วยที่คำนวณจริงเท่านั้น */
export function formatShares(units: bigint, fractional: boolean): string {
  const SCALE = 100_000_000n;
  const whole = units / SCALE;
  if (!fractional) return whole.toString();
  const milli = (units % SCALE) / 100_000n;
  return `${whole.toString()}.${milli.toString().padStart(3, '0')}`;
}

/** bps -> "45" / "7.5" / "12.34" (ไม่ใช้ float) */
export function bpsText(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const frac = String(Math.abs(bps % 100)).padStart(2, '0').replace(/0+$/, '');
  return frac === '' ? String(whole) : `${whole}.${frac}`;
}

// ---------- แถวแสดงผล ----------

export interface TradeViewRow {
  holdingId: string;
  side: 'buy' | 'sell';
  ticker: string;
  name: string;
  categoryName: string;
  sharesText: string;
  priceMicro: number;
  priceDate: string | null;
  cents: number;
}

export interface DroppedViewRow {
  holdingId: string;
  ticker: string;
  categoryName: string;
  reasonText: string;
}

export interface CategoryViewRow {
  categoryId: string;
  name: string;
  targetBps: number;
  nowCents: number;
  afterCents: number;
  /** สัดส่วนมูลค่า (bps) · null = ไม่มีมูลค่ารวมให้หาร */
  nowBps: number | null;
  afterBps: number | null;
}

export interface RebalanceViewContext {
  assets: readonly Asset[];
  categoryName: (id: string) => string;
  fractional: boolean;
}

export interface RebalanceView {
  mode: RebalanceMode;
  /** ขายก่อน ซื้อทีหลัง */
  trades: TradeViewRow[];
  dropped: DroppedViewRow[];
  categories: CategoryViewRow[];
  buyTotalCents: number;
  sellTotalCents: number;
  leftOverCents: number;
  shortByCents: number;
  totalNowCents: number;
  totalAfterCents: number;
  warnings: string[];
  alreadyAtTargets: boolean;
  noTrades: boolean;
}

function sharesOfCents(rows: readonly { cents: number }[]): number {
  return rows.reduce((s, r) => s + r.cents, 0);
}

function bpsOf(items: { key: string; cents: number }[]): Map<string, number> {
  const shares = allocateBps(items.map((i) => ({ key: i.key, weight: i.cents })));
  return new Map(shares.map((s) => [s.key, s.bps]));
}

/** แปลงผลของ rebalance() (ok) เป็นแถวแสดงผล · ไม่คำนวณใหม่: ทุกตัวเลขมาจากผลโดยตรง */
export function buildRebalanceView(result: Extract<RebalanceResult, { ok: true }>, ctx: RebalanceViewContext): RebalanceView {
  const assetOf = new Map(ctx.assets.map((a) => [a.id, a]));
  const toRow = (r: RebalanceRow): TradeViewRow => ({
    holdingId: r.holdingId,
    side: r.side,
    ticker: r.ticker,
    name: assetOf.get(r.holdingId)?.name ?? r.ticker,
    categoryName: ctx.categoryName(r.categoryId),
    sharesText: formatShares(r.units, ctx.fractional),
    priceMicro: r.priceMicro,
    priceDate: r.priceDate ?? null,
    cents: r.cents,
  });
  const nowBps = result.totalNowCents > 0 ? bpsOf(result.categoryRows.map((c) => ({ key: c.categoryId, cents: c.nowCents }))) : null;
  const afterBps = result.totalAfterCents > 0 ? bpsOf(result.categoryRows.map((c) => ({ key: c.categoryId, cents: c.afterCents }))) : null;
  const nameOfHolding = (id: string): string => {
    const a = assetOf.get(id);
    return a === undefined ? id : tickerOf(a);
  };
  const alreadyAtTargets = result.warnings.some((w) => w.code === 'alreadyAtTargets');
  return {
    mode: result.mode,
    trades: [...result.sells, ...result.buys].map(toRow),
    dropped: result.droppedRows.map((d) => ({ holdingId: d.holdingId, ticker: d.ticker, categoryName: ctx.categoryName(d.categoryId), reasonText: DROPPED_REASON_TEXT[d.reason] })),
    categories: result.categoryRows.map((c) => ({
      categoryId: c.categoryId,
      name: c.name,
      targetBps: c.targetBps,
      nowCents: c.nowCents,
      afterCents: c.afterCents,
      nowBps: nowBps === null ? null : (nowBps.get(c.categoryId) ?? 0),
      afterBps: afterBps === null ? null : (afterBps.get(c.categoryId) ?? 0),
    })),
    buyTotalCents: sharesOfCents(result.buys),
    sellTotalCents: sharesOfCents(result.sells),
    leftOverCents: result.leftOverCents,
    shortByCents: result.shortByCents,
    totalNowCents: result.totalNowCents,
    totalAfterCents: result.totalAfterCents,
    warnings: result.warnings.map((w) => warningText(w, (id) => (w.code === 'sellsWholeCategory' || w.code === 'noHoldingToBuy' ? ctx.categoryName(id) : nameOfHolding(id)))),
    alreadyAtTargets,
    noTrades: result.sells.length + result.buys.length === 0,
  };
}

// ---------- ส่งออก CSV ----------

const priceText = (micro: number): string => {
  const whole = Math.floor(micro / 1_000_000);
  const frac = String(micro % 1_000_000).padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${whole}.${frac}`;
};

export const rebalanceCsvFilename = (today: string): string => `rebalancing-result-${today}.csv`;

/** CSV ของ Result (BOM + CRLF · ข้อความผ่าน csvText กัน formula injection) · ข้อความบังคับเป็นบรรทัดท้ายไฟล์ · ไม่มีคำแนะนำ */
export function buildRebalanceCsv(view: RebalanceView, meta: { amountCents: number; allowSales: boolean; fractional: boolean; minOrderCents: number }): string {
  const L: string[] = [];
  L.push(csvText(`${REBALANCE_RESULT_TITLE}: ${REBALANCE_TRADES_TITLE}`));
  L.push(['Mode', view.mode === 'deposit' ? 'Deposit' : 'Withdrawal'].map(csvText).join(','));
  L.push(['Amount (USD)', minorToDecimal(meta.amountCents)].map(csvText).join(','));
  L.push(['Allow sales', meta.allowSales ? 'Yes' : 'No'].join(','));
  L.push(['Fractional shares', meta.fractional ? 'Yes (3 decimals)' : 'No (whole shares)'].join(','));
  L.push(['Minimum order (USD)', minorToDecimal(meta.minOrderCents)].join(','));
  L.push('');
  L.push(['Action', 'Ticker', 'Name', 'Category', 'Shares', 'Price (USD)', 'Price date', 'Amount (USD)'].join(','));
  for (const t of view.trades) {
    L.push([t.side === 'buy' ? 'Buy' : 'Sell', csvText(t.ticker), csvText(t.name), csvText(t.categoryName), t.sharesText, priceText(t.priceMicro), t.priceDate ?? '', minorToDecimal(t.cents)].join(','));
  }
  L.push(['Total buy (USD)', minorToDecimal(view.buyTotalCents)].join(','));
  L.push(['Total sell (USD)', minorToDecimal(view.sellTotalCents)].join(','));
  if (view.mode === 'deposit') L.push(['Left over (USD)', minorToDecimal(view.leftOverCents)].join(','));
  else L.push(['Short by (USD)', minorToDecimal(view.shortByCents)].join(','));
  for (const d of view.dropped) L.push(['Not traded', csvText(d.ticker), csvText(d.categoryName), csvText(d.reasonText)].join(','));
  L.push('');
  L.push(['Category', 'Target (%)', 'Now (USD)', 'After (USD)'].join(','));
  for (const c of view.categories) L.push([csvText(c.name), bpsText(c.targetBps), minorToDecimal(c.nowCents), minorToDecimal(c.afterCents)].join(','));
  for (const w of view.warnings) L.push(['Note', csvText(w)].join(','));
  L.push('');
  L.push(['Note', csvText(REBALANCE_DISCLAIMER)].join(','));
  return `﻿${L.join('\r\n')}\r\n`;
}
