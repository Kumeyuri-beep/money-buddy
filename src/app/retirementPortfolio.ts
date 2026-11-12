/**
 * ผูกเครื่องคิดเลขเกษียณกับพอร์ตลงทุนจริง (เฟส 2 · กฎ R18 ข้อ 18.8) · ฟังก์ชันล้วน ไม่เขียนข้อมูล ไม่ดึงราคาจากเว็บ
 *   - มูลค่า = มูลค่าตามราคาที่ผู้ใช้ป้อน (ตัวอ่านพอร์ต R17 `buildPortfolio`) **ห้ามใช้ราคาทุนแทนเงียบๆ**
 *   - ยังไม่มีราคา = null ("ยังไม่มีราคา") และถูกนับแยกเพื่อบอกว่ามูลค่ารวมไม่ครบ (ไม่นับเป็น 0 เงียบๆ)
 *   - ราคาเก่ากว่า 30 วัน (เวลาไทย ตามวันที่ที่ส่งเข้ามา) ต้องเตือน
 *   - ผู้ใช้เลือกเองว่าสินทรัพย์ไหนนับเป็นเงินเกษียณ (ค่าเริ่มต้นไม่เลือก) · THB เท่านั้น (R17)
 *   - แผน DCA นับเฉพาะที่ไม่พักของสินทรัพย์ที่เลือก เป็น "แผนที่ตั้งไว้" ไม่ใช่เงินออม
 */

import { daysBetween } from '../domain/bills/calendar';
import type { DcaPlan } from '../domain/invest/dcaPlan';
import type { AssetKind, InvestmentData } from '../domain/invest/types';
import { safeAdd } from '../domain/money/safe';
import { buildPortfolio } from './portfolio';

/** ราคาเก่ากว่านี้ (วัน) ต้องเตือน (R18 ข้อ 18.8) */
export const RETIREMENT_STALE_PRICE_DAYS = 30;

export interface RetirementAssetOption {
  assetId: string;
  name: string;
  kind: AssetKind;
  archived: boolean;
  /** มูลค่าตามราคาที่ป้อน (สตางค์) · null = ยังไม่มีราคา */
  valueSatang: number | null;
  priceDate: string | null;
  priceStale: boolean;
  /** ข้อมูลรายการของสินทรัพย์นี้ไม่สอดคล้อง (ไม่นับมูลค่า) */
  error?: string;
}

/** สินทรัพย์ที่ผู้ใช้เลือกนับเป็นเงินเกษียณได้: เฉพาะที่ยังถือหน่วยอยู่ (หรือข้อมูลมีปัญหาต้องบอก) */
export function retirementAssetOptions(data: InvestmentData, today: string): RetirementAssetOption[] {
  const out: RetirementAssetOption[] = [];
  for (const row of buildPortfolio(data, today).rows) {
    if (row.error === undefined && row.position.units <= 0n) continue;
    const priceDate = row.latestPrice?.date ?? null;
    const option: RetirementAssetOption = {
      assetId: row.asset.id,
      name: row.asset.name,
      kind: row.asset.kind,
      archived: row.asset.archived === true,
      valueSatang: row.error === undefined && row.market ? row.market.value : null,
      priceDate,
      priceStale: priceDate !== null && daysBetween(priceDate, today) > RETIREMENT_STALE_PRICE_DAYS,
    };
    if (row.error !== undefined) option.error = row.error;
    out.push(option);
  }
  return out;
}

/**
 * การเลือกเริ่มต้นจากที่เคยบันทึกไว้ (เฟส 2b): เฉพาะรหัสที่ยังมีในตัวเลือก · รหัสของสินทรัพย์ที่ถูกลบ/ไม่มีหน่วยแล้วถูกข้ามเงียบๆ (ไม่ error)
 * ไม่เคยเลือก = ไม่เลือกอะไร (ค่าเริ่มต้นตามกฎ 18.8)
 */
export function initialRetirementSelection(savedIds: readonly string[] | undefined, options: readonly RetirementAssetOption[]): Set<string> {
  const available = new Set(options.map((o) => o.assetId));
  const out = new Set<string>();
  for (const id of savedIds ?? []) if (available.has(id)) out.add(id);
  return out;
}

export interface RetirementPortfolioSummary {
  selectedCount: number;
  /** มูลค่ารวมของสินทรัพย์ที่เลือกและมีราคา (สตางค์) */
  valueSatang: number;
  /** ที่เลือกแต่ยังไม่มีราคา/ข้อมูลมีปัญหา → มูลค่ารวมไม่ครบ */
  unpricedCount: number;
  staleCount: number;
  /** วันที่ของราคาที่เก่าที่สุดในที่เลือก (null = ไม่มีราคา) */
  oldestPriceDate: string | null;
  /** รวมแผน DCA ต่อเดือนของสินทรัพย์ที่เลือก (สตางค์ · แผนที่ตั้งไว้) */
  dcaMonthly: number;
  dcaPlanCount: number;
}

export function summarizeRetirementPortfolio(
  data: InvestmentData,
  today: string,
  selectedIds: ReadonlySet<string>,
  dcaPlans: readonly DcaPlan[],
): RetirementPortfolioSummary {
  const summary: RetirementPortfolioSummary = { selectedCount: 0, valueSatang: 0, unpricedCount: 0, staleCount: 0, oldestPriceDate: null, dcaMonthly: 0, dcaPlanCount: 0 };
  const chosen = new Set<string>();
  for (const o of retirementAssetOptions(data, today)) {
    if (!selectedIds.has(o.assetId)) continue;
    chosen.add(o.assetId);
    summary.selectedCount += 1;
    if (o.valueSatang === null) summary.unpricedCount += 1;
    else summary.valueSatang = safeAdd(summary.valueSatang, o.valueSatang);
    if (o.priceStale) summary.staleCount += 1;
    if (o.priceDate !== null && (summary.oldestPriceDate === null || o.priceDate < summary.oldestPriceDate)) summary.oldestPriceDate = o.priceDate;
  }
  for (const p of dcaPlans) {
    if (p.paused === true || !chosen.has(p.assetId)) continue;
    summary.dcaMonthly = safeAdd(summary.dcaMonthly, p.amount);
    summary.dcaPlanCount += 1;
  }
  return summary;
}
