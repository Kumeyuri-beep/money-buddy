/**
 * โมเดลของแท็บ "วิเคราะห์" · ประกอบผลจากฟังก์ชัน domain เท่านั้น ไม่มีสูตรเงินใหม่ (R24/R25/R17/R20.7)
 *   ตารางถือครอง: buildUsPortfolio · สัดส่วนต่อหุ้น: allocateBps · ผลตอบแทนรายเดือน: computeMonthlyReturns
 *   ปันผล: computeDividendMetrics · แหล่งกำไร: computeProfitSources · เงินสด USD เป็นบาท: convertMinor ที่อัตราล่าสุดที่กรอก
 * ข้อมูลไม่ครบ = null (หน้าจอแสดง "—" หรือการ์ดไม่พร้อม) ห้ามใช้ต้นทุนแทนมูลค่าตลาดและห้ามเดา
 */
import { buildUsPortfolio, type UsPortfolio, type UsStockRow } from '../../../app/usPortfolio';
import { allocateBps, type AllocationShare } from '../../../domain/invest/allocation';
import { computeDividendMetrics, computeMonthlyReturns, computeProfitSources, type DividendMetrics, type ProfitResult } from '../../../domain/invest/metrics';
import type { InvestmentData } from '../../../domain/invest/types';
import type { Account, Entry } from '../../../domain/ledger/types';
import { safeAdd } from '../../../domain/money/safe';
import { buildDashboardView, type DonutSlice } from '../dashboard/dashboardView';

export interface AnalysisRow {
  row: UsStockRow;
  /** สัดส่วนมูลค่าบาท (bps) · null = ยังไม่มีมูลค่า (ไม่มีราคา/อัตรา) */
  shareBps: number | null;
  /** ลำดับสีของแถบสี 0-6 (ตามลำดับแถว) */
  colorIndex: number;
}

export type MonthCell = { kind: 'none' } | { kind: 'ok'; bps: number } | { kind: 'na'; reason: 'missing' | 'zero-base' };

export interface MonthlyYearRow {
  year: string;
  /** 12 ช่อง ม.ค.-ธ.ค. */
  cells: MonthCell[];
  /** ผลตอบแทนทั้งปี (bps) · null = มีเดือนที่คำนวณไม่ได้ */
  total: number | null;
}

export type CurrencyShares =
  | { kind: 'ok'; shares: DonutSlice[] }
  | { kind: 'none' } // ไม่มีสินทรัพย์ดอลลาร์
  | { kind: 'incomplete' }; // ข้อมูลไม่ครบ (ไม่มีราคา/อัตรา) หรือเงินสดติดลบ จึงแบ่งไม่ได้

export interface AnalysisModel {
  hasStocks: boolean;
  us: UsPortfolio;
  rows: AnalysisRow[];
  /** แถวใหม่สุดก่อน (ปีล่าสุดอยู่บน) */
  monthly: MonthlyYearRow[];
  dividend: DividendMetrics;
  profit: ProfitResult;
  /** ปันผลสะสมสุทธิรวมทุกหุ้น (เซนต์ USD) · ผลบวกของค่าที่ buildUsPortfolio คำนวณแล้ว */
  dividendNetUsdTotal: number | null;
  /** สัดส่วน USD เทียบบาท (มูลค่าตลาด) */
  currencyShares: CurrencyShares;
}

export function buildAnalysisModel(accounts: readonly Account[], entries: readonly Entry[], data: InvestmentData, today: string): AnalysisModel {
  const us = buildUsPortfolio(accounts, entries, data, today);
  const hasStocks = us.rows.length > 0;

  let shares: AllocationShare[] = [];
  try {
    shares = allocateBps(us.rows.filter((r) => r.valueThb !== null && r.valueThb > 0).map((r) => ({ key: r.assetId, weight: r.valueThb! })));
  } catch {
    shares = []; // ตัวเลขนอกช่วงปลอดภัย: ไม่แสดงสัดส่วน (ไม่ทำให้หน้าล้ม)
  }
  const shareOf = new Map(shares.map((s) => [s.key, s.bps]));
  const rows: AnalysisRow[] = us.rows.map((row, i) => ({ row, shareBps: shareOf.get(row.assetId) ?? null, colorIndex: i % 7 }));

  const mr = guard(() => computeMonthlyReturns(data, today), { months: [], years: {} });
  const byYear = new Map<string, MonthCell[]>();
  for (const m of mr.months) {
    const y = m.month.slice(0, 4);
    const cells = byYear.get(y) ?? Array.from({ length: 12 }, (): MonthCell => ({ kind: 'none' }));
    const idx = Number(m.month.slice(5, 7)) - 1;
    cells[idx] = m.bps === null ? { kind: 'na', reason: m.na ?? 'missing' } : { kind: 'ok', bps: m.bps };
    byYear.set(y, cells);
  }
  const monthly: MonthlyYearRow[] = [...byYear.keys()]
    .sort()
    .reverse()
    .map((year) => ({ year, cells: byYear.get(year)!, total: mr.years[year] ?? null }));

  return {
    hasStocks,
    us,
    rows,
    monthly,
    dividend: guard(() => computeDividendMetrics(data, today), { fromExclusive: today, toInclusive: today, grossThb: 0, netThb: 0, grossUsd: 0, netUsd: 0, yieldBps: null, yieldOnCostBps: null, incomplete: true, loadError: true }),
    profit: guard(() => computeProfitSources(data, today, { strictRate: true }), { complete: false, missing: [], thb: null, usd: null, parts: null }),
    dividendNetUsdTotal: guard<number | null>(() => us.rows.reduce((n, r) => (r.needsRate || r.error !== undefined ? n : safeAdd(n, r.dividendNetUsd)), 0), null),
    currencyShares: currencySharesOf(accounts, entries, data, today, hasStocks),
  };
}

/** สัดส่วนสกุลเงิน USD เทียบบาท ใช้นิยามเดียวกับแดชบอร์ด (buildDashboardView: เงินสด USD ติดลบหักออกตามเครื่องหมาย wealthSummary) */
function currencySharesOf(accounts: readonly Account[], entries: readonly Entry[], data: InvestmentData, today: string, hasRows: boolean): CurrencyShares {
  if (!hasRows) return { kind: 'none' };
  const slices = guard(() => buildDashboardView(accounts, entries, data, today).currencySlices, null);
  return slices === null ? { kind: 'incomplete' } : { kind: 'ok', shares: slices };
}

/** ตัวเลขใหญ่เกินช่วงปลอดภัย (RangeError) ในส่วนใดส่วนหนึ่ง = ส่วนนั้นใช้ค่าสำรอง ไม่ทำให้ทั้งหน้าล้ม */
function guard<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RangeError) return fallback;
    throw e;
  }
}
