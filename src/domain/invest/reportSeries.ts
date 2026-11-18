/**
 * ตารางรายงานรายเดือน/ไตรมาส/ปี ของพอร์ตหุ้นสหรัฐ (หน้า Analytics → Report · กฎ R24 R25.4 R26 R27) · ฟังก์ชันล้วน ไม่แตะ DOM/เครือข่าย
 *   - กำไรรายเดือน = ผลต่างของกำไรสะสม (R24 computeProfitSources ณ ปลายเดือน − ปลายเดือนก่อน) แยกเป็นแหล่งที่ผลรวมตรงเป๊ะ
 *   - ผลตอบแทน % รายเดือน = Modified Dietz (R25.4): บาท = computeMonthlyReturns เดิม · USD = computeMonthlyReturnsUsd (เซนต์)
 *   - ไตรมาส/ปี/Total = ผลบวกของเดือน (แถวเงิน) และต่อทบจากรายเดือน (R27 · ไม่ต่อจากค่ากลุ่มที่ปัดแล้ว)
 *   - มูลค่าปลายเดือน = ราคาที่บันทึกล่าสุดก่อนหรือเท่าวันนั้น (+ เรตล่าสุดก่อนหรือเท่าวันนั้นในมุมมองบาท) · ไม่มี = null (ห้ามนับเป็น 0)
 * ทุกค่าเงินเป็นจำนวนเต็มหน่วยย่อย (สตางค์/เซนต์) · ห้าม float · ใช้ safeAdd/safeSub (เกินช่วงปลอดภัย = RangeError)
 */

import { safeAdd, safeSub } from '../money/safe';
import { convertMinor } from './fx';
import { computeMonthlyReturns, computeProfitSources, replayWithFees, type FeeReplay, type ProfitResult } from './metrics';
import { latestFxRate } from './portfolioMoney';
import { toTradesFx } from './tradesFx';
import { activeMonths, compoundBps, computeMonthlyReturnsUsd, needsRateMonths, priceMicroAt, usdAssetTrades, type MonthSpan } from './twr';
import type { InvestmentData } from './types';
import { valueInSatang } from './units';

export type ReportCurrency = 'THB' | 'USD';
export type ReportGrouping = 'monthly' | 'quarterly' | 'yearly';
export type ReportPeriod = 'last1y' | 'last3y' | 'ytd' | 'all';
/** เหตุที่คำนวณไม่ได้: ไม่มีราคาของหุ้นที่ถืออยู่ หรือไม่มีอัตราแลกเปลี่ยน (มุมมองบาท) */
export type ReportMissing = 'price' | 'rate';
/** null = คำนวณไม่ได้ (ไม่ใช่ 0) */
export type Cell = number | null;

export interface ReportColumn {
  /** เดือน "YYYY-MM" · ไตรมาส "YYYY-Qn" · ปี "YYYY" · ทั้งช่วง "total" */
  key: string;
  /** มูลค่าต้น/ปลายงวด และผลต่าง (Portfolio value) */
  begin: Cell;
  end: Cell;
  change: Cell;
  /** กำไรรวมของงวด = ผลรวม 5 แถวถัดไป (price + realized + dividends + fx + fees + taxes · fx เป็น null ในมุมมอง USD) */
  profit: Cell;
  /** กำไรรวม % (bps · Modified Dietz รายเดือน / ต่อทบตาม R27) */
  profitBps: Cell;
  price: Cell;
  realized: Cell;
  dividends: Cell;
  /** ผลค่าเงิน (R24 แหล่ง 5) · null เสมอในมุมมอง USD (ไม่มีผลค่าเงิน) */
  fx: Cell;
  fees: Cell;
  taxes: Cell;
  /** เงินซื้อ (รวมค่าธรรมเนียม) และเงินขาย (สุทธิ) ของงวด */
  purchases: Cell;
  sales: Cell;
  buys: Cell;
  sells: Cell;
  /** เหตุที่ค่าใดค่าหนึ่งเป็น null (null = ครบทุกค่า) */
  missing: ReportMissing | null;
  /** มีรายการลงทุนที่ไม่มีอัตราแลกเปลี่ยนกระทบงวดนี้ (R26) → ทุกค่าเป็น null แสดง "Needs rate" · ไม่นับเป็น 0 */
  needsRate: boolean;
}

export interface ReportTable {
  currency: ReportCurrency;
  /** คอลัมน์ตามการจัดกลุ่ม (เดือน/ไตรมาส/ปี) ตามช่วงเวลาที่เลือก */
  columns: ReportColumn[];
  /** รวมทั้งช่วง (null = ไม่มีเดือนในช่วง) */
  total: ReportColumn | null;
  /** มีค่าที่คำนวณไม่ได้ในช่วงนี้ (ติดธง incomplete · R23) */
  incomplete: boolean;
  /** เหตุที่พบ (ใช้เลือกข้อความแจ้งผู้ใช้) */
  missing: ReportMissing[];
}

// ───────────────────────── ภาพรวม ณ วันหนึ่ง ─────────────────────────

interface Snapshot {
  /** มูลค่าตลาดของที่ถืออยู่ ในสกุลมุมมอง · null = ขาดราคา/อัตรา */
  value: Cell;
  missing: ReportMissing | null;
  /** กำไรสะสม ณ วันนั้นในสกุลมุมมอง (R24) · null = ขาดข้อมูล */
  profit: { total: number; price: number; realized: number; dividends: number; fx: number | null; fees: number; taxes: number } | null;
  replays: FeeReplay[];
}

function snapshotAt(data: InvestmentData, date: string, currency: ReportCurrency): Snapshot {
  const assets = usdAssetTrades(data, date);
  const replays = assets.map((a) => replayWithFees(toTradesFx(a.trades)));
  const fx = latestFxRate(data.fxRates ?? [], date);

  // มูลค่า (R25.4): ราคาล่าสุดที่กรอกก่อนหรือเท่าวันนั้น · มุมมองบาทแปลงทีละสินทรัพย์ด้วยเรตล่าสุดก่อนหรือเท่าวันนั้น
  let value: Cell = 0;
  let missing: ReportMissing | null = null;
  for (let i = 0; i < assets.length; i += 1) {
    const units = replays[i]!.position.units;
    if (units === 0n) continue;
    const price = priceMicroAt(data, assets[i]!.asset.id, date);
    if (price === null) {
      missing = 'price';
      value = null;
    } else if (currency === 'THB' && fx === null) {
      if (missing === null) missing = 'rate';
      value = null;
    } else if (value !== null) {
      const usdValue = valueInSatang(units, price);
      value = safeAdd(value, currency === 'USD' ? usdValue : convertMinor(usdValue, fx!.rateMicro));
    }
  }

  const r: ProfitResult = computeProfitSources(data, date);
  const view = currency === 'USD' ? r.usd : r.thb;
  let profit: Snapshot['profit'] = null;
  if (view !== null) {
    // ค่าธรรมเนียมและภาษีหัก แยกจากแหล่ง (6) ของ R24: fees + taxes = feesAndTax ตรงเป๊ะ
    let fees = 0;
    let taxes = 0;
    for (let i = 0; i < assets.length; i += 1) {
      const rep = replays[i]!;
      fees = safeSub(fees, currency === 'USD' ? safeAdd(rep.buyFeesUsd, rep.sellFeesUsd) : safeAdd(rep.buyFeesThb, rep.sellFeesThb));
      for (const t of assets[i]!.trades) {
        if (t.kind !== 'dividend' || t.fxRateMicro === undefined) continue;
        taxes = safeSub(taxes, currency === 'USD' ? t.withholding : convertMinor(t.withholding, t.fxRateMicro));
      }
    }
    profit = {
      total: view.total,
      price: view.priceUnrealized,
      realized: view.priceRealized,
      dividends: view.dividendGross,
      fx: currency === 'THB' ? (r.thb ? r.thb.fx : null) : null,
      fees,
      taxes,
    };
  }
  // เหตุที่ขาดข้อมูลจาก R24 ด้วย (ขาดราคา > ขาดเรต)
  if (missing === null && view === null) missing = r.missing.some((m) => m.kind === 'price') ? 'price' : 'rate';
  return { value, missing, profit, replays };
}

// ───────────────────────── คอลัมน์รายเดือน ─────────────────────────

const diff = (a: Cell, b: Cell): Cell => (a === null || b === null ? null : safeSub(a, b));

function monthColumn(sp: MonthSpan, begin: Snapshot, end: Snapshot, bps: Cell, currency: ReportCurrency, needsRate: boolean): ReportColumn {
  if (needsRate) {
    return { key: sp.key, begin: null, end: null, change: null, profit: null, profitBps: null, price: null, realized: null, dividends: null, fx: null, fees: null, taxes: null, purchases: null, sales: null, buys: null, sells: null, missing: 'rate', needsRate: true };
  }
  const inMonth = (d: string): boolean => d >= sp.start && d <= sp.end;
  let purchases = 0;
  let sales = 0;
  let buys = 0;
  let sells = 0;
  for (const rep of end.replays) {
    for (const b of rep.buys) {
      if (!inMonth(b.date)) continue;
      purchases = safeAdd(purchases, currency === 'USD' ? b.outlayUsd : b.outlayThb);
      buys += 1;
    }
    for (const s of rep.sells) {
      if (!inMonth(s.date)) continue;
      sales = safeAdd(sales, currency === 'USD' ? s.netUsd : s.proceedsThb);
      sells += 1;
    }
  }
  const p0 = begin.profit;
  const p1 = end.profit;
  const both = p0 !== null && p1 !== null;
  const d = (pick: (p: NonNullable<Snapshot['profit']>) => number): Cell => (both ? safeSub(pick(p1), pick(p0)) : null);
  const missing = begin.missing ?? end.missing;
  return {
    key: sp.key,
    begin: begin.value,
    end: end.value,
    change: diff(end.value, begin.value),
    profit: d((p) => p.total),
    profitBps: both ? bps : null,
    price: d((p) => p.price),
    realized: d((p) => p.realized),
    dividends: d((p) => p.dividends),
    fx: currency === 'USD' || !both ? null : safeSub(p1.fx ?? 0, p0.fx ?? 0),
    fees: d((p) => p.fees),
    taxes: d((p) => p.taxes),
    purchases,
    sales,
    buys,
    sells,
    missing,
    needsRate: false,
  };
}

const sumCells = (cells: readonly Cell[]): Cell => {
  let s = 0;
  for (const c of cells) {
    if (c === null) return null;
    s = safeAdd(s, c);
  }
  return s;
};

/** รวมหลายคอลัมน์รายเดือนเป็นหนึ่งคอลัมน์ (ไตรมาส/ปี/Total): ต้นงวดของเดือนแรก · ปลายงวดของเดือนสุดท้าย · แถวเงิน = ผลบวก · % = ต่อทบ R27 */
function aggregate(key: string, cols: readonly ReportColumn[], currency: ReportCurrency): ReportColumn {
  const first = cols[0]!;
  const last = cols[cols.length - 1]!;
  const sum = (pick: (c: ReportColumn) => Cell): Cell => sumCells(cols.map(pick));
  return {
    key,
    begin: first.begin,
    end: last.end,
    change: diff(last.end, first.begin),
    profit: sum((c) => c.profit),
    profitBps: compoundBps(cols.map((c) => c.profitBps)),
    price: sum((c) => c.price),
    realized: sum((c) => c.realized),
    dividends: sum((c) => c.dividends),
    fx: currency === 'USD' ? null : sum((c) => c.fx),
    fees: sum((c) => c.fees),
    taxes: sum((c) => c.taxes),
    purchases: sum((c) => c.purchases),
    sales: sum((c) => c.sales),
    buys: sum((c) => c.buys),
    sells: sum((c) => c.sells),
    missing: cols.some((c) => c.needsRate) ? 'rate' : (cols.find((c) => c.missing !== null)?.missing ?? null),
    needsRate: cols.some((c) => c.needsRate),
  };
}

// ───────────────────────── ช่วงเวลา/จัดกลุ่ม ─────────────────────────

const monthIndex = (iso: string): number => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;

/** เดือนแรกที่รวมในช่วง (YYYY-MM · เปรียบเทียบเป็นข้อความได้) · 'all' = '' (ทุกเดือน) */
export function periodStartKey(period: ReportPeriod, asOf: string): string {
  if (period === 'all') return '';
  if (period === 'ytd') return `${asOf.slice(0, 4)}-01`;
  const back = period === 'last1y' ? 11 : 35;
  const idx = monthIndex(asOf) - back;
  const y = (idx - (idx % 12)) / 12;
  return `${String(y).padStart(4, '0')}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

function groupKey(monthKey: string, grouping: ReportGrouping): string {
  if (grouping === 'monthly') return monthKey;
  if (grouping === 'yearly') return monthKey.slice(0, 4);
  const m0 = Number(monthKey.slice(5, 7)) - 1;
  return `${monthKey.slice(0, 4)}-Q${(m0 - (m0 % 3)) / 3 + 1}`;
}

/**
 * สร้างตารางรายงาน ณ วัน asOf ในสกุลที่เลือก (R26) · เดือนที่ไม่มีหุ้นและไม่มีรายการถูกข้าม (R25.4)
 * ผลรวม 6 แหล่งของแต่ละเดือน = กำไรรวมของเดือนนั้นตรงเป๊ะ (ผลต่างของ R24 ณ ปลายเดือน) เมื่อทุกค่าคำนวณได้
 */
export function buildReport(data: InvestmentData, asOf: string, currency: ReportCurrency, grouping: ReportGrouping, period: ReportPeriod): ReportTable {
  const from = periodStartKey(period, asOf);
  const spans = activeMonths(data, asOf).filter((sp) => sp.key >= from);
  if (spans.length === 0) return { currency, columns: [], total: null, incomplete: false, missing: [] };

  const bpsByMonth = new Map<string, Cell>();
  for (const m of (currency === 'USD' ? computeMonthlyReturnsUsd(data, asOf) : computeMonthlyReturns(data, asOf)).months) bpsByMonth.set(m.month, m.bps);

  const memo = new Map<string, Snapshot>();
  const snap = (date: string): Snapshot => {
    let s = memo.get(date);
    if (s === undefined) {
      s = snapshotAt(data, date, currency);
      memo.set(date, s);
    }
    return s;
  };
  const gaps = needsRateMonths(data, spans, asOf);
  const months = spans.map((sp) => monthColumn(sp, snap(sp.prevEnd), snap(sp.end), bpsByMonth.get(sp.key) ?? null, currency, gaps.has(sp.key)));

  let columns: ReportColumn[];
  if (grouping === 'monthly') columns = months;
  else {
    const groups = new Map<string, ReportColumn[]>();
    for (const c of months) {
      const k = groupKey(c.key, grouping);
      groups.set(k, [...(groups.get(k) ?? []), c]);
    }
    columns = [...groups].map(([k, cols]) => aggregate(k, cols, currency));
  }
  const total = aggregate('total', months, currency);
  const missing = [...new Set(months.map((c) => c.missing).filter((m): m is ReportMissing => m !== null))];
  return { currency, columns, total, incomplete: missing.length > 0, missing };
}
