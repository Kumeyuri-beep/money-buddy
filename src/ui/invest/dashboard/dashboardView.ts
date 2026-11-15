/**
 * มุมมองแดชบอร์ดของโหมดพอร์ต (R17, R20, R23, R24, R25) · ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล
 * ไม่มีสูตรเงินใหม่: ทุกตัวเลขมาจาก src/domain/invest (metrics, portfolioMoney, allocation) และ src/app/usPortfolio
 * ที่เพิ่มเองมีเพียง "การรวมยอดต่อเดือน" ของปันผลที่โดเมนแปลงเป็นบาทแล้ว (convertMinor ตัวเดียวกับ metrics.ts) และตัวจัดรูปแบบข้อความจากจำนวนเต็ม
 * ข้อมูลไม่ครบ = null (ห้ามเลขปลอม/ห้ามใช้ 0 แทน)
 */
import { buildUsPortfolio, type UsPortfolio } from '../../../app/usPortfolio';
import { computeDividendMetrics, computeIrr, computeProfitSources, type DividendMetrics, type IrrResult, type ProfitResult } from '../../../domain/invest/metrics';
import { allocateBps, groupSmallShares, type AllocationShare } from '../../../domain/invest/allocation';
import { convertMinor } from '../../../domain/invest/fx';
import { wealthSummary } from '../../../domain/invest/portfolioMoney';
import { assetCurrency, type InvestmentData } from '../../../domain/invest/types';
import type { Account, Entry } from '../../../domain/ledger/types';
import { safeAdd, safeSub } from '../../../domain/money/safe';

export type DashCurrency = 'THB' | 'USD';

export interface DonutSlice {
  key: string;
  label: string;
  bps: number;
}

export interface MonthlyDividend {
  /** 1-12 */
  month: number;
  grossThb: number;
  grossUsd: number;
}

export interface SourceRow {
  key: 'priceUnrealized' | 'priceRealized' | 'options' | 'dividendGross' | 'fx' | 'feesAndTax';
  label: string;
  /** null = แสดง "—" (เช่น ค่าเงินในมุมมอง USD) */
  value: number | null;
}

export interface DashboardView {
  /** ยังไม่มีหุ้นสหรัฐเลย → ทุกการ์ดแสดง empty state */
  empty: boolean;
  holding: boolean;
  /** มูลค่าตลาดของที่ถืออยู่ · null = ไม่ครบ (ไม่มีราคา/อัตรา) */
  valueThb: number | null;
  valueUsd: number | null;
  /** เงินลงทุน = ต้นทุนของที่ยังถืออยู่ (รวมค่าธรรมเนียม) */
  costThb: number;
  costUsd: number;
  profit: ProfitResult;
  dividend: DividendMetrics;
  irr: IrrResult;
  fxText: { rateMicro: number; stale: boolean; days: number } | null;
  stockSlices: DonutSlice[];
  /** null = แบ่งตามสกุลไม่ได้ (ข้อมูลไม่ครบ) */
  currencySlices: DonutSlice[] | null;
  monthly: MonthlyDividend[];
}

const LABEL_OTHER = 'อื่นๆ';

function sliceLabels(us: UsPortfolio): DonutSlice[] {
  return us.allocation.map((s: AllocationShare) => ({
    key: s.key,
    label: s.key === 'other' ? LABEL_OTHER : us.rows.find((r) => r.assetId === s.key)?.ticker || s.key,
    bps: s.bps,
  }));
}

/** ปันผลรายเดือนของปีที่ today อยู่ (ก่อนภาษี · ถึงวันนี้) · อัตราวันปันผลของแต่ละรายการ (R20) */
export function monthlyDividends(data: InvestmentData, today: string): MonthlyDividend[] {
  const year = today.slice(0, 4);
  const months: MonthlyDividend[] = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, grossThb: 0, grossUsd: 0 }));
  const usdIds = new Set(data.assets.filter((a) => assetCurrency(a) === 'USD').map((a) => a.id));
  for (const t of data.trades) {
    if (t.kind !== 'dividend' || !usdIds.has(t.assetId) || t.fxRateMicro === undefined) continue;
    if (t.date.slice(0, 4) !== year || t.date > today) continue;
    const m = months[Number(t.date.slice(5, 7)) - 1];
    if (!m) continue;
    const gross = t.amount ?? 0;
    m.grossUsd = safeAdd(m.grossUsd, gross);
    m.grossThb = safeAdd(m.grossThb, convertMinor(gross, t.fxRateMicro));
  }
  return months;
}

export function buildDashboardView(accounts: readonly Account[], entries: readonly Entry[], data: InvestmentData, today: string): DashboardView {
  const us = buildUsPortfolio(accounts, entries, data, today);
  const held = us.rows.filter((r) => r.units > 0n);
  const holding = held.length > 0;
  const valueThb = holding ? (held.every((r) => r.valueThb !== null) ? us.totals.valueThb : null) : 0;
  const valueUsd = holding ? (held.every((r) => r.valueUsd !== null) ? us.totals.valueUsd : null) : 0;
  const costUsd = us.rows.reduce((n, r) => safeAdd(n, r.costUsd), 0);

  let currencySlices: DonutSlice[] | null = null;
  if (us.fx !== null && us.totals.complete && us.rows.length > 0) {
    const w = wealthSummary(accounts, entries, data, today);
    if (!w.incomplete) {
      // เงินสด USD แปลงทีละบัญชี ด้วยเครื่องหมายเดียวกับ wealthSummary (ติดลบ = หักออก) เพื่อให้ USD + บาท = เงินลงทุนรวมพอดี
      let usdPart = us.totals.valueThb;
      for (const c of us.cash) {
        if (c.cents === 0) continue;
        usdPart = safeAdd(usdPart, c.cents > 0 ? convertMinor(c.cents, us.fx.rateMicro) : -convertMinor(-c.cents, us.fx.rateMicro));
      }
      const thbPart = safeSub(w.investmentThb, usdPart);
      if (usdPart >= 0 && thbPart >= 0) {
        const shares = allocateBps([
          { key: 'USD', weight: usdPart },
          { key: 'THB', weight: thbPart },
        ]);
        currencySlices = groupSmallShares(shares, 6).map((s) => ({ key: s.key, label: s.key === 'USD' ? 'ดอลลาร์สหรัฐ (USD)' : 'บาท (THB)', bps: s.bps }));
      }
    }
  }

  return {
    empty: us.rows.length === 0,
    holding,
    valueThb,
    valueUsd,
    costThb: us.totals.costThb,
    costUsd,
    profit: computeProfitSources(data, today),
    dividend: computeDividendMetrics(data, today),
    irr: computeIrr(data, today),
    fxText: us.fx ? { rateMicro: us.fx.rateMicro, stale: us.fx.stale, days: us.fx.days } : null,
    stockSlices: sliceLabels(us),
    currencySlices,
    monthly: monthlyDividends(data, today),
  };
}

/** 6 แหล่งกำไรตามสกุลที่เลือก · null = ไม่ครบ (ไม่มีราคา/อัตรา) */
export function profitSourceRows(profit: ProfitResult, currency: DashCurrency): SourceRow[] | null {
  if (currency === 'THB') {
    const s = profit.thb;
    if (s === null) return null;
    return [
      { key: 'priceUnrealized', label: 'ส่วนต่างราคา (ยังไม่ขาย)', value: s.priceUnrealized },
      { key: 'priceRealized', label: 'ส่วนต่างราคา (ขายแล้ว)', value: s.priceRealized },
      { key: 'options', label: 'ออปชั่น', value: s.options },
      { key: 'dividendGross', label: 'ปันผล (ก่อนภาษี)', value: s.dividendGross },
      { key: 'fx', label: 'ค่าเงิน', value: s.fx },
      { key: 'feesAndTax', label: 'ค่าธรรมเนียมและภาษีที่ถูกหัก', value: s.feesAndTax },
    ];
  }
  const s = profit.usd;
  if (s === null) return null;
  return [
    { key: 'priceUnrealized', label: 'ส่วนต่างราคา (ยังไม่ขาย)', value: s.priceUnrealized },
    { key: 'priceRealized', label: 'ส่วนต่างราคา (ขายแล้ว)', value: s.priceRealized },
    { key: 'options', label: 'ออปชั่น', value: s.options },
    { key: 'dividendGross', label: 'ปันผล (ก่อนภาษี)', value: s.dividendGross },
    { key: 'fx', label: 'ค่าเงิน', value: null },
    { key: 'feesAndTax', label: 'ค่าธรรมเนียมและภาษีที่ถูกหัก', value: s.feesAndTax },
  ];
}

/** ความยาวแถบเป็น % จำนวนเต็ม 0-100 เทียบค่าสัมบูรณ์สูงสุด (แสดงผลอย่างเดียว · BigInt กันเกินช่วง) */
export function barPercent(value: number, maxAbs: number): number {
  if (maxAbs <= 0) return 0;
  const p = Number((BigInt(Math.abs(value)) * 100n) / BigInt(maxAbs));
  return Math.min(100, p);
}

/** bps → "3.55%" / "-1.2%" ด้วยจำนวนเต็มล้วน (ไม่ใช้ float) · showPlus ใส่ "+" นำหน้าค่าบวก */
export function bpsText(bps: number, showPlus = false): string {
  if (!Number.isSafeInteger(bps)) throw new RangeError('bps ต้องเป็นจำนวนเต็ม');
  const neg = bps < 0;
  const abs = Math.abs(bps);
  const whole = (abs - (abs % 100)) / 100;
  const frac = abs % 100;
  const fracText = frac === 0 ? '' : `.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
  return `${neg ? '-' : showPlus && abs > 0 ? '+' : ''}${whole}${fracText}%`;
}

export const THAI_MONTH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'] as const;
