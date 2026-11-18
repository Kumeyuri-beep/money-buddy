/**
 * ผลตอบแทนต่อเนื่องหลายเดือนและ Modified Dietz รายเดือนแบบเซนต์ (กฎ R25.4 · R27 · R26) · ฟังก์ชันล้วน ไม่แตะ DOM/เครือข่าย
 * BigInt/จำนวนเต็มล้วน ไม่มีทศนิยมลอยตัว · ปัดครึ่งออกจากศูนย์ด้วย roundHalfUpBig ตัวเดียว (R8)
 * ข้อมูลไม่ครบ (ไม่มีราคา) = null ไม่เดา ไม่ใช้ต้นทุนแทนมูลค่าตลาด (R20.7)
 * `computeMonthlyReturns` เดิมใน metrics.ts เป็นมุมมองบาท (สตางค์) ไม่แก้ · ไฟล์นี้เพิ่มมุมมอง USD (เซนต์) โดยไม่ผ่านอัตราแลกเปลี่ยน
 */

import { roundHalfUpBig } from '../money/round';
import { replayWithFees, type FeeReplay } from './metrics';
import { toTradesFx } from './tradesFx';
import { assetCurrency, type Asset, type InvestmentData, type TradeRecord } from './types';
import { toSafeSatang, valueInSatang } from './units';

// ───────────────────────── R27 ต่อทบผลตอบแทนรายเดือน ─────────────────────────

/**
 * ต่อทบผลตอบแทนรายเดือน (bps) เป็นผลรวมของช่วง (R27):
 *   total = roundHalfUp((∏(10,000 + bᵢ) − 10,000^n) / 10,000^(n−1)) · ปัดครั้งเดียวตอนท้าย ครึ่งออกจากศูนย์ (−149.5 → −150)
 * null = ไม่มีเดือนที่คำนวณได้ หรือมีเดือนใดเป็น null (ห้ามข้ามเดือนแล้วคิดต่อ) · bᵢ < −10,000 โยน RangeError
 */
export function compoundBps(monthly: readonly (number | null)[]): number | null {
  if (monthly.length === 0) return null;
  let product = 1n;
  for (const b of monthly) {
    if (b === null) return null;
    if (!Number.isSafeInteger(b)) throw new RangeError(`bps ต้องเป็นจำนวนเต็มปลอดภัย (ได้รับ ${String(b)})`);
    if (b < -10_000) throw new RangeError(`ผลตอบแทนรายเดือนต่ำกว่า −100% ไม่ได้ (ได้รับ ${String(b)} bps)`);
    product *= BigInt(10_000 + b);
  }
  // ปัดที่ "ผลตอบแทน" (ไม่ใช่ที่ผลคูณ) ครึ่งออกจากศูนย์ สมมาตรบวก/ลบ (R27 · เจ้าของสั่ง 18 พ.ย. 2569)
  return toSafeSatang(roundHalfUpBig(product - 10_000n ** BigInt(monthly.length), 10_000n ** BigInt(monthly.length - 1))) || 0;
}

// ───────────────────────── ตัวช่วยร่วม (ใช้ใน reportSeries ด้วย) ─────────────────────────

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
const daysInMonthOf = (year: number, month1: number): number => new Date(Date.UTC(year, month1, 0)).getUTCDate();
/** YYYY-MM-DD ของวันที่ d ในเดือน m1 ปี y */
export const isoDate = (y: number, m1: number, d: number): string => `${pad(y, 4)}-${pad(m1)}-${pad(d)}`;
/** วันสุดท้ายของเดือนก่อนเดือน (y, m1) */
export const prevMonthEnd = (y: number, m1: number): string => (m1 === 1 ? isoDate(y - 1, 12, 31) : isoDate(y, m1 - 1, daysInMonthOf(y, m1 - 1)));
export const monthEnd = (y: number, m1: number): string => isoDate(y, m1, daysInMonthOf(y, m1));

export interface UsdAssetTrades {
  asset: Asset;
  /** รายการที่มีอัตรา (fxRateMicro) และวันที่ไม่เกิน asOf */
  trades: TradeRecord[];
}

/** สินทรัพย์ USD พร้อมรายการที่นับได้ ณ asOf (เหมือนกติกาใน metrics.ts) */
export function usdAssetTrades(data: InvestmentData, asOf: string): UsdAssetTrades[] {
  return data.assets
    .filter((a) => assetCurrency(a) === 'USD')
    .map((asset) => ({ asset, trades: data.trades.filter((t) => t.assetId === asset.id && t.date <= asOf && t.fxRateMicro !== undefined) }));
}

/** ราคาล่าสุดที่กรอกก่อนหรือเท่าวันนั้น (micro-USD) · null = ไม่มี */
export function priceMicroAt(data: InvestmentData, assetId: string, asOf: string): number | null {
  let best: { date: string; priceMicro: number } | null = null;
  for (const p of data.prices) if (p.assetId === assetId && p.date <= asOf && (best === null || p.date > best.date)) best = p;
  return best ? best.priceMicro : null;
}

/** รายการซื้อ/ขาย/ปันผลของสินทรัพย์ USD ที่ไม่มี fxRateMicro (ไม่ถูกเล่นซ้ำใน R24/R25) วันที่ไม่เกิน asOf */
export function noRateTrades(data: InvestmentData, asOf: string): TradeRecord[] {
  const usdIds = new Set(data.assets.filter((a) => assetCurrency(a) === 'USD').map((a) => a.id));
  return data.trades.filter((t) => usdIds.has(t.assetId) && t.date <= asOf && t.fxRateMicro === undefined && (t.kind === 'buy' || t.kind === 'sell' || t.kind === 'dividend'));
}

/**
 * เดือน (YYYY-MM) ที่คำนวณไม่ได้เพราะรายการไม่มีอัตราแลกเปลี่ยน (R26 ห้ามเดา · ห้ามข้ามเงียบ):
 *   ซื้อ/ขายที่ไม่มีอัตรา → เปลี่ยนจำนวนหน่วยที่ถือ จึงกระทบเดือนนั้นและทุกเดือนหลังจากนั้น
 *   ปันผลที่ไม่มีอัตรา → กระทบเฉพาะเดือนของปันผล (ผลต่างของกำไรสะสมเดือนอื่นไม่เปลี่ยน)
 */
export function needsRateMonths(data: InvestmentData, spans: readonly MonthSpan[], asOf: string): Set<string> {
  const out = new Set<string>();
  for (const t of noRateTrades(data, asOf)) {
    const key = t.date.slice(0, 7);
    for (const sp of spans) if (t.kind === 'dividend' ? sp.key === key : sp.key >= key) out.add(sp.key);
  }
  return out;
}

export interface MonthSpan {
  /** YYYY-MM */
  key: string;
  year: number;
  month: number;
  /** วันสิ้นเดือน (เดือนของ asOf ใช้ asOf) */
  end: string;
  /** วันสิ้นเดือนก่อนหน้า */
  prevEnd: string;
  /** วันแรกของเดือน */
  start: string;
}

/**
 * เดือนที่มีหุ้นหรือมีรายการ ตั้งแต่เดือนของรายการแรกถึงเดือนของ asOf (R25.4: เดือนที่ไม่มีหุ้นและไม่มีรายการ = ข้าม)
 * กติกาเดียวกับ computeMonthlyReturns (มีเทสต์ตรวจว่าตรงกัน)
 */
export function activeMonths(data: InvestmentData, asOf: string): MonthSpan[] {
  const assets = usdAssetTrades(data, asOf);
  const all = assets.flatMap((a) => a.trades);
  /** รายการที่ไม่มีอัตรา (ไม่ถูกเล่นซ้ำ) ก็นับเป็นกิจกรรมของเดือนนั้น เพื่อให้เดือนนั้นอยู่ในรายงานและถูกติดธง needs-rate (R26) */
  const noRate = noRateTrades(data, asOf);
  if (all.length === 0 && noRate.length === 0) return [];
  const dates = [...all, ...noRate].map((t) => t.date);
  const first = dates.reduce((m, d) => (d < m ? d : m), dates[0]!);
  const replays = assets.map((a) => (date: string): FeeReplay => replayWithFees(toTradesFx(a.trades.filter((t) => t.date <= date))));
  const out: MonthSpan[] = [];
  let y = Number(first.slice(0, 4));
  let m = Number(first.slice(5, 7));
  const lastY = Number(asOf.slice(0, 4));
  const lastM = Number(asOf.slice(5, 7));
  while (y < lastY || (y === lastY && m <= lastM)) {
    const start = isoDate(y, m, 1);
    const end = y === lastY && m === lastM ? asOf : monthEnd(y, m);
    const prevEnd = prevMonthEnd(y, m);
    const hasTrade = dates.some((d) => d >= start && d <= end);
    // ซื้อ/ขายที่ไม่มีอัตราไม่ถูกเล่นซ้ำ จำนวนหน่วยหลังจากนั้นจึงไม่แน่นอน → ถือว่าอาจถืออยู่ (เดือนไม่ถูกข้าม · ถูกติดธง needs-rate)
    const unknownBy = (date: string): boolean => noRate.some((t) => t.kind !== 'dividend' && t.date <= date);
    const heldBefore = unknownBy(prevEnd) || replays.some((r) => r(prevEnd).position.units > 0n);
    const heldAfter = unknownBy(end) || replays.some((r) => r(end).position.units > 0n);
    if (hasTrade || heldBefore || heldAfter) out.push({ key: `${pad(y, 4)}-${pad(m)}`, year: y, month: m, end, prevEnd, start });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

// ───────────────────────── R25.4 Modified Dietz แบบเซนต์ (มุมมอง USD) ─────────────────────────

/** เหตุที่รายเดือนเป็น null: ขาดราคา · ตัวหารศูนย์ · มีรายการไม่มีอัตรา (needs-rate · R26) */
export interface UsdMonthReturn {
  /** YYYY-MM */
  month: string;
  bps: number | null;
  na?: 'missing' | 'zero-base' | 'needs-rate';
}
export interface UsdMonthlyReturns {
  months: UsdMonthReturn[];
  years: Record<string, number | null>;
}

/**
 * ผลตอบแทนรายเดือน (Modified Dietz · R25.4) ของพอร์ตหุ้นสหรัฐ **คิดเป็นเซนต์โดยตรง** ไม่ผ่านอัตราแลกเปลี่ยน (R26 มุมมอง USD)
 *   ต่อเดือน = (มูลค่าสิ้นเดือน − มูลค่าต้นเดือน − เงินใส่เพิ่มสุทธิ + ปันผลสุทธิ) ÷ (มูลค่าต้นเดือน + Σ เงินใส่เพิ่ม × วันที่เหลือ ÷ วันในเดือน)
 *   เงินใส่เพิ่มสุทธิ = ซื้อ(มูลค่า+ค่าธรรมเนียม) − ขาย(สุทธิ) เป็นเซนต์ · ปันผลสุทธิ = ปันผล − ภาษีหัก
 *   มูลค่า ณ วัน = หน่วยที่ถือ × ราคาล่าสุดที่กรอกก่อนหรือเท่าวันนั้น · เดือนปัจจุบันใช้ asOf เป็นวันสิ้นสุด
 * เดือนที่หุ้นที่ถืออยู่ตัวใดไม่มีราคา = null (na 'missing') · ตัวหาร ≤ 0 = null (na 'zero-base') · ทั้งปี = ต่อทบ (R27) ถ้าครบทุกเดือน
 */
export function computeMonthlyReturnsUsd(data: InvestmentData, asOf: string): UsdMonthlyReturns {
  const assets = usdAssetTrades(data, asOf);
  const spans = activeMonths(data, asOf);
  const replayAt = (a: UsdAssetTrades, date: string): FeeReplay => replayWithFees(toTradesFx(a.trades.filter((t) => t.date <= date)));

  /** มูลค่าพอร์ต (เซนต์) ณ วัน · null = หุ้นที่ถืออยู่ขาดราคา */
  const valueOn = (date: string): bigint | null => {
    let sum = 0n;
    for (const a of assets) {
      const units = replayAt(a, date).position.units;
      if (units === 0n) continue;
      const price = priceMicroAt(data, a.asset.id, date);
      if (price === null) return null;
      sum += BigInt(valueInSatang(units, price));
    }
    return sum;
  };

  const months: UsdMonthReturn[] = [];
  const gaps = needsRateMonths(data, spans, asOf);
  const byYear = new Map<string, (number | null)[]>();
  for (const sp of spans) {
    const L = BigInt(Number(sp.end.slice(8, 10)));
    const inMonth = (d: string): boolean => d >= sp.start && d <= sp.end;
    const v0 = valueOn(sp.prevEnd);
    const v1 = valueOn(sp.end);
    let entry: UsdMonthReturn;
    if (gaps.has(sp.key)) entry = { month: sp.key, bps: null, na: 'needs-rate' };
    else if (v0 === null || v1 === null) entry = { month: sp.key, bps: null, na: 'missing' };
    else {
      let flowSum = 0n;
      let weighted = 0n;
      let div = 0n;
      for (const a of assets) {
        const r = replayAt(a, sp.end);
        for (const b of r.buys) {
          if (!inMonth(b.date)) continue;
          flowSum += BigInt(b.outlayUsd);
          weighted += BigInt(b.outlayUsd) * (L - BigInt(Number(b.date.slice(8, 10))));
        }
        for (const s of r.sells) {
          if (!inMonth(s.date)) continue;
          flowSum -= BigInt(s.netUsd);
          weighted -= BigInt(s.netUsd) * (L - BigInt(Number(s.date.slice(8, 10))));
        }
        for (const t of a.trades) if (t.kind === 'dividend' && inMonth(t.date)) div += BigInt((t.amount ?? 0) - t.withholding);
      }
      const numerator = v1 - v0 - flowSum + div;
      const denomScaled = v0 * L + weighted;
      if (denomScaled <= 0n) entry = { month: sp.key, bps: null, na: 'zero-base' };
      else entry = { month: sp.key, bps: toSafeSatang(roundHalfUpBig(numerator * 10_000n * L, denomScaled)) };
    }
    months.push(entry);
    const yk = sp.key.slice(0, 4);
    byYear.set(yk, [...(byYear.get(yk) ?? []), entry.bps]);
  }
  const years: Record<string, number | null> = {};
  for (const [yk, list] of byYear) years[yk] = compoundBps(list);
  return { months, years };
}
