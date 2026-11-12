/**
 * ค่าตั้งค่าการเงินรายเดือน (ทุกค่าไม่บังคับ: ยังไม่ตั้ง = ไม่มีฟิลด์)
 * ยอดเงินเป็นสตางค์จำนวนเต็มไม่ติดลบเสมอ (กฎ R1) ตัวแปลงจากข้อความผู้ใช้อยู่ที่ขอบ UI (R2) ไม่ใช่ที่นี่
 */

import { dcaPlanProblem, sanitizeDcaPlans, MAX_DCA_PLANS, type DcaPlan } from '../invest/dcaPlan';
import { retirementAssetIdsProblem, sanitizeRetirementAssetIds } from '../invest/retirementSelection';
import { sanitizeTaxTagIds, taxTagsProblem } from '../invest/taxTags';
import { isValidIsoDate } from '../ledger/entry';

/** ขนาดรวมของค่าตั้งค่า (ไบต์ของ JSON) ที่ยอมรับ · ตารางฐานข้อมูลจำกัด 16 KB (jsonb ใหญ่กว่าข้อความเล็กน้อย) จึงเผื่อไว้ */
export const MAX_SETTINGS_BYTES = 12_000;

export interface FinanceSettings {
  /** วันเงินเดือนเข้าในเดือน 1-31 */
  payDay?: number;
  /** เป้าออมรายเดือน (สตางค์) ใช้เป็นเงินสำรองใน SAFE-TO-SPEND */
  monthlySavingsGoal?: number;
  /** เป้างบรายจ่ายรวมต่อเดือน (สตางค์) */
  monthlyBudget?: number;
  /** วันเงินเดือนถัดไปที่กำหนดเอง YYYY-MM-DD (ใช้ครั้งเดียว หมดอายุเมื่อถึงวันนั้น) ไม่ตั้ง = คำนวณจาก payDay */
  nextPaydayOverride?: string;
  /** แผนซื้อประจำ (DCA) แบบตัวเตือน (พอร์ตลงทุน P5) · ไม่ตั้ง = ยังไม่มีแผน */
  dcaPlans?: DcaPlan[];
  /** รหัสสินทรัพย์ที่ผู้ใช้เลือกนับเป็นเงินเกษียณ (เกษียณ เฟส 2b · R18) เก็บเฉพาะข้อมูลเข้า · ไม่ตั้ง = ไม่ได้เลือก */
  retirementAssetIds?: string[];
  /** รหัสสินทรัพย์ที่ผู้ใช้ติดป้าย RMF / Thai ESG (ภาษี เฟส 3 · ข้อมูลเข้า ไม่เก็บยอด) ติดได้ประเภทเดียว */
  taxRmfAssetIds?: string[];
  taxThaiEsgAssetIds?: string[];
}

const isSatang = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isDay = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 31;

/** เหตุผลที่ค่าตั้งค่านี้ผิดรูป (null = ใช้ได้) ฟิลด์ที่เป็น undefined ถือว่าไม่ได้ตั้ง */
export function settingsProblem(s: FinanceSettings): string | null {
  if (s.payDay !== undefined && !isDay(s.payDay)) return `วันเงินเดือนต้องเป็นจำนวนเต็ม 1-31 (ได้รับ ${String(s.payDay)})`;
  if (s.monthlySavingsGoal !== undefined && !isSatang(s.monthlySavingsGoal)) {
    return `เป้าออมต้องเป็นจำนวนเต็มสตางค์ที่ไม่ติดลบ (ได้รับ ${String(s.monthlySavingsGoal)})`;
  }
  if (s.monthlyBudget !== undefined && !isSatang(s.monthlyBudget)) {
    return `เป้างบต้องเป็นจำนวนเต็มสตางค์ที่ไม่ติดลบ (ได้รับ ${String(s.monthlyBudget)})`;
  }
  if (s.nextPaydayOverride !== undefined && !isValidIsoDate(s.nextPaydayOverride)) {
    return `วันเงินเดือนถัดไปต้องเป็นวันที่ที่มีจริง YYYY-MM-DD (ได้รับ ${String(s.nextPaydayOverride)})`;
  }
  if (s.dcaPlans !== undefined) {
    if (!Array.isArray(s.dcaPlans)) return 'แผนซื้อประจำต้องเป็นอาร์เรย์';
    if (s.dcaPlans.length > MAX_DCA_PLANS) return `แผนซื้อประจำมีได้ไม่เกิน ${MAX_DCA_PLANS} แผน`;
    const ids = new Set<string>();
    for (const p of s.dcaPlans) {
      const problem = dcaPlanProblem(p);
      if (problem) return `แผนซื้อประจำ: ${problem}`;
      if (ids.has(p.id)) return 'แผนซื้อประจำมีรหัสซ้ำ';
      ids.add(p.id);
    }
  }
  if (s.retirementAssetIds !== undefined) {
    const problem = retirementAssetIdsProblem(s.retirementAssetIds);
    if (problem) return problem;
  }
  if (s.taxRmfAssetIds !== undefined || s.taxThaiEsgAssetIds !== undefined) {
    const problem = taxTagsProblem(s.taxRmfAssetIds ?? [], s.taxThaiEsgAssetIds ?? []);
    if (problem) return problem;
  }
  if (new TextEncoder().encode(JSON.stringify(s)).length > MAX_SETTINGS_BYTES) return 'ค่าตั้งค่ามีขนาดใหญ่เกินไป ลดแผนซื้อประจำหรือสินทรัพย์ที่เลือกนับเป็นเงินเกษียณ';
  return null;
}

/** อ่านค่าที่มาจากภายนอก (ฐานข้อมูล/ไฟล์) แบบไม่เชื่อ: เก็บเฉพาะฟิลด์ที่รู้จักและถูกต้อง ทิ้งที่เหลือ */
export function sanitizeSettings(raw: unknown): FinanceSettings {
  if (typeof raw !== 'object' || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const out: FinanceSettings = {};
  if (isDay(r.payDay)) out.payDay = r.payDay;
  if (isSatang(r.monthlySavingsGoal)) out.monthlySavingsGoal = r.monthlySavingsGoal;
  if (isSatang(r.monthlyBudget)) out.monthlyBudget = r.monthlyBudget;
  if (typeof r.nextPaydayOverride === 'string' && isValidIsoDate(r.nextPaydayOverride)) out.nextPaydayOverride = r.nextPaydayOverride;
  if (Array.isArray(r.dcaPlans)) {
    const plans = sanitizeDcaPlans(r.dcaPlans);
    if (plans.length > 0) out.dcaPlans = plans;
  }
  const ids = sanitizeRetirementAssetIds(r.retirementAssetIds);
  if (ids.length > 0) out.retirementAssetIds = ids;
  const rmf = sanitizeTaxTagIds(r.taxRmfAssetIds);
  if (rmf.length > 0) out.taxRmfAssetIds = rmf;
  // สินทรัพย์หนึ่งติดได้ประเภทเดียว: ถ้าข้อมูลภายนอกซ้อนกัน RMF ชนะ
  const esg = sanitizeTaxTagIds(r.taxThaiEsgAssetIds).filter((id) => !rmf.includes(id));
  if (esg.length > 0) out.taxThaiEsgAssetIds = esg;
  return out;
}
