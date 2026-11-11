/**
 * โมเดลสัดส่วนพอร์ตสำหรับแสดงผล (การ์ดภาพรวม + การ์ดแชร์) · ฟังก์ชันล้วน ไม่แตะ DOM/เครือข่าย
 *   - ใช้มูลค่าตามราคาที่ผู้ใช้กรอกเมื่อ "ทุกสินทรัพย์ที่ถืออยู่" มีราคา ไม่ครบ = ใช้ต้นทุนแทนและบอกชัดว่าเป็นสัดส่วนตามต้นทุน
 *     (ไม่ผสมมูลค่ากับต้นทุนในกราฟเดียว)
 *   - ผลลัพธ์มีเฉพาะสัดส่วน (bps) และป้ายชื่อ · **ไม่มียอดเงิน** · ชื่อสินทรัพย์ซ่อนเป็นค่าเริ่มต้น (showNames = false → "สินทรัพย์ 1…")
 */

import { allocateBps, groupSmallShares } from '../domain/invest/allocation';
import type { Portfolio } from './portfolio';

export type AllocationBasis = 'value' | 'cost';

export interface AllocationSlice {
  key: string;
  label: string;
  /** สัดส่วน (basis points จำนวนเต็ม รวมกัน 10,000) */
  bps: number;
  isOther: boolean;
}

export interface AllocationModel {
  basis: AllocationBasis;
  slices: AllocationSlice[];
  /** จำนวนสินทรัพย์ที่ถืออยู่ */
  holdings: number;
}

export interface AllocationOptions {
  /** แสดงชื่อกองทุน/หุ้นจริง (ค่าเริ่มต้น false = ซ่อน) */
  showNames?: boolean;
  /** จำนวนชิ้นสูงสุดที่แสดง (ที่เกินรวมเป็น "อื่นๆ") */
  maxVisible?: number;
}

export const OTHER_KEY = '__other__';

export function buildAllocationModel(portfolio: Portfolio, options: AllocationOptions = {}): AllocationModel | null {
  const showNames = options.showNames === true;
  const maxVisible = options.maxVisible ?? 6;
  const holdings = portfolio.rows.filter((r) => r.error === undefined && r.position.units > 0n);
  if (holdings.length === 0) return null;
  const basis: AllocationBasis = holdings.every((r) => r.market !== null) ? 'value' : 'cost';
  const weights = holdings.map((r) => ({ key: r.asset.id, weight: basis === 'value' ? (r.market as NonNullable<typeof r.market>).value : r.position.cost }));
  const shares = groupSmallShares(allocateBps(weights), maxVisible, OTHER_KEY);
  if (shares.length === 0) return null;
  const nameOf = new Map(holdings.map((r) => [r.asset.id, r.asset.name]));
  const slices = shares.map((s, i): AllocationSlice => {
    const isOther = s.key === OTHER_KEY;
    const label = isOther ? 'อื่นๆ' : showNames ? String(nameOf.get(s.key) ?? '') : `สินทรัพย์ ${i + 1}`;
    return { key: s.key, label, bps: s.bps, isOther };
  });
  return { basis, slices, holdings: holdings.length };
}

/** ข้อความสรุปสั้นสำหรับโปรแกรมอ่านหน้าจอ (ใช้ป้ายชื่อตามที่เลือกเท่านั้น) */
export function describeAllocation(model: AllocationModel, formatBps: (bps: number) => string): string {
  const basisText = model.basis === 'value' ? 'ตามมูลค่า' : 'ตามต้นทุน';
  return `สัดส่วนพอร์ต${basisText}: ${model.slices.map((s) => `${s.label} ${formatBps(s.bps)}`).join(' · ')}`;
}
