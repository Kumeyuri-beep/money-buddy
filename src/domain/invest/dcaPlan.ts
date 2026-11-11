/**
 * แผนซื้อประจำ (DCA) แบบ "ตัวเตือน" (พอร์ตลงทุน P5 · R17) · ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล/เครือข่าย
 *   - แผนเก็บแค่ สินทรัพย์ + จำนวนเงินต่อรอบ + วันที่ของเดือน (ไม่มีรายการรอยืนยันในฐานข้อมูล) ถึงวันแล้วหน้าจอเตือน
 *     ผู้ใช้กดเปิดฟอร์มซื้อที่กรอกยอดไว้แล้วและยืนยันเอง · ไม่ซื้อให้เอง ไม่ดึงราคา
 *   - รอบ (cycle) = เดือน YYYY-MM · ครบกำหนดวันที่ dayOfMonth (เดือนที่สั้นกว่า ใช้วันสุดท้ายของเดือน)
 *   - รอบนั้น "ทำแล้ว" เมื่อมีรายการซื้อ (buy) ของสินทรัพย์เดียวกันลงวันที่ในเดือนนั้น (ไม่ว่ายอดเท่าใด · ผู้ใช้ตัดสินเอง)
 *   - เก็บในค่าตั้งค่าของผู้ใช้ (settings.dcaPlans) จึงรวมในไฟล์สำรองและถูกลบพร้อมข้อมูลของผู้ใช้โดยอัตโนมัติ
 */

import type { TradeRecord } from './types';
import { isValidIsoDate } from '../ledger/entry';
import { isSupportedEntryDate, lengthWithin, MAX_ID_LENGTH } from '../ledger/limits';

export interface DcaPlan {
  id: string;
  assetId: string;
  /** เงินที่ซื้อต่อรอบ (สตางค์ ≥ 1) ไม่รวมค่าธรรมเนียม */
  amount: number;
  /** วันที่ของเดือนที่ครบกำหนด 1-31 */
  dayOfMonth: number;
  /** เริ่มนับรอบตั้งแต่เดือนนี้ YYYY-MM (ไม่เตือนย้อนหลังก่อนสร้างแผน) */
  startMonth: string;
  /** พักแผน = ไม่เตือน */
  paused?: boolean;
}

export const MAX_DCA_PLANS = 50;
/** เตือนย้อนหลังได้ไม่เกินกี่เดือน (รอบที่เลยมานานกว่านี้ไม่แสดง) */
const LOOKBACK_MONTHS = 3;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isMonthKey = (v: unknown): v is string => typeof v === 'string' && MONTH.test(v) && isSupportedEntryDate(`${v}-01`);

/** เหตุผลที่แผนผิดรูป (null = ใช้ได้) */
export function dcaPlanProblem(p: DcaPlan): string | null {
  if (!lengthWithin(p.id, 1, MAX_ID_LENGTH)) return 'รหัสแผนไม่ถูกต้อง';
  if (!lengthWithin(p.assetId, 1, MAX_ID_LENGTH)) return 'รหัสสินทรัพย์ไม่ถูกต้อง';
  if (!Number.isSafeInteger(p.amount) || p.amount < 1 || p.amount > MAX_SAFE) return 'เงินซื้อต่อรอบต้องเป็นสตางค์จำนวนเต็มอย่างน้อย 1';
  if (!Number.isInteger(p.dayOfMonth) || p.dayOfMonth < 1 || p.dayOfMonth > 31) return 'วันที่ของเดือนต้องเป็น 1-31';
  if (!isMonthKey(p.startMonth)) return 'เดือนเริ่มต้องเป็น YYYY-MM';
  if (p.paused !== undefined && typeof p.paused !== 'boolean') return 'สถานะพักแผนไม่ถูกต้อง';
  return null;
}

/** อ่านค่าจากภายนอก (ฐานข้อมูล/ไฟล์) แบบไม่เชื่อ: เก็บเฉพาะแผนที่ถูกต้อง ไม่ซ้ำรหัส ไม่เกินเพดาน */
export function sanitizeDcaPlans(raw: unknown): DcaPlan[] {
  if (!Array.isArray(raw)) return [];
  const out: DcaPlan[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_DCA_PLANS) break;
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.assetId !== 'string' || typeof r.amount !== 'number' || typeof r.dayOfMonth !== 'number' || typeof r.startMonth !== 'string') continue;
    const plan: DcaPlan = { id: r.id, assetId: r.assetId, amount: r.amount, dayOfMonth: r.dayOfMonth, startMonth: r.startMonth };
    if (r.paused === true) plan.paused = true;
    if (dcaPlanProblem(plan) !== null || seen.has(plan.id)) continue;
    seen.add(plan.id);
    out.push(plan);
  }
  return out;
}

const monthOf = (date: string): string => date.slice(0, 7);

function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  const year = (idx - (idx % 12)) / 12; // idx ไม่ติดลบ: หารลงตัวด้วยจำนวนเต็ม ไม่ใช้ปัดเศษทศนิยม
  return `${String(year).padStart(4, '0')}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** วันครบกำหนดของรอบ: วันที่ที่ตั้งไว้ ถ้าเดือนนั้นสั้นกว่าให้ใช้วันสุดท้ายของเดือน */
export function dcaDueDate(month: string, dayOfMonth: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Math.min(dayOfMonth, last);
  const iso = `${month}-${String(day).padStart(2, '0')}`;
  if (!isValidIsoDate(iso)) throw new RangeError(`วันที่ไม่ถูกต้อง: ${iso}`);
  return iso;
}

export type DcaStatus =
  | { state: 'paused' }
  /** ถึงกำหนดแล้วและยังไม่มีรายการซื้อในรอบนั้น (cycle = รอบที่ค้างเก่าสุดจากรอบที่ค้างทั้งหมด ไม่เกิน LOOKBACK) */
  | { state: 'due'; cycle: string; dueDate: string; daysLate: number; pendingCycles: number }
  | { state: 'upcoming'; cycle: string; dueDate: string; daysUntil: number }
  | { state: 'unknown-asset' };

const daysBetween = (from: string, to: string): number => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000; // เที่ยงคืน UTC ทั้งคู่: หารลงตัวเสมอ

/**
 * สถานะแผน ณ วันนี้ · today = YYYY-MM-DD ของผู้ใช้ · trades = รายการลงทุนทั้งหมด (ใช้เฉพาะรายการซื้อของสินทรัพย์ของแผน)
 * ถึงกำหนดและยังไม่ซื้อ = due (แสดงรอบที่ค้างล่าสุดให้กดซื้อ) · ไม่ค้าง = upcoming (วันถึงกำหนดถัดไป)
 */
export function dcaStatus(plan: DcaPlan, trades: readonly TradeRecord[], today: string, assetExists = true): DcaStatus {
  if (!assetExists) return { state: 'unknown-asset' };
  if (plan.paused === true) return { state: 'paused' };
  const boughtMonths = new Set<string>();
  for (const t of trades) if (t.assetId === plan.assetId && t.kind === 'buy') boughtMonths.add(monthOf(t.date));
  const thisMonth = monthOf(today);
  const first = addMonths(thisMonth, -(LOOKBACK_MONTHS - 1));
  const startFrom = plan.startMonth > first ? plan.startMonth : first;
  const pending: string[] = [];
  for (let m = startFrom; m <= thisMonth; m = addMonths(m, 1)) {
    if (dcaDueDate(m, plan.dayOfMonth) <= today && !boughtMonths.has(m)) pending.push(m);
  }
  if (pending.length > 0) {
    const cycle = pending[pending.length - 1]!;
    const dueDate = dcaDueDate(cycle, plan.dayOfMonth);
    return { state: 'due', cycle, dueDate, daysLate: daysBetween(dueDate, today), pendingCycles: pending.length };
  }
  // ไม่มีรอบค้าง: รอบถัดไปคือเดือนนี้ (ถ้ายังไม่ถึงวัน และเดือนนี้ยังไม่ซื้อ) หรือเดือนถัดไป
  let cycle = thisMonth < plan.startMonth ? plan.startMonth : thisMonth;
  if (cycle === thisMonth && (dcaDueDate(cycle, plan.dayOfMonth) <= today || boughtMonths.has(cycle))) cycle = addMonths(cycle, 1);
  const dueDate = dcaDueDate(cycle, plan.dayOfMonth);
  return { state: 'upcoming', cycle, dueDate, daysUntil: daysBetween(today, dueDate) };
}
