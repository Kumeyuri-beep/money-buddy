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
  /** จำนวนสินทรัพย์ที่ไม่ถูกนับในสัดส่วน (ข้อมูลรายการผิดพลาด หรือน้ำหนักเป็น 0 สตางค์) · > 0 = สัดส่วนไม่ครบทั้งพอร์ต ต้องเตือนผู้ใช้ */
  excluded: number;
  /** เกณฑ์มูลค่าแต่มีราคาที่เก่ากว่าที่กำหนด (ตัวเลขอาจไม่ทันสมัย) */
  stalePrices: boolean;
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
  const errored = portfolio.rows.filter((r) => r.error !== undefined).length;
  const holdings = portfolio.rows.filter((r) => r.error === undefined && r.position.units > 0n);
  if (holdings.length === 0) return null;
  const basis: AllocationBasis = holdings.every((r) => r.market !== null) ? 'value' : 'cost';
  const weights = holdings.map((r) => ({ key: r.asset.id, weight: basis === 'value' ? (r.market as NonNullable<typeof r.market>).value : r.position.cost }));
  const allShares = allocateBps(weights);
  if (allShares.length === 0) return null;
  const zeroWeight = weights.filter((w) => w.weight === 0).length;
  const shares = groupSmallShares(allShares, maxVisible, OTHER_KEY);
  const nameOf = new Map(holdings.map((r) => [r.asset.id, r.asset.name]));
  const slices = shares.map((s, i): AllocationSlice => {
    const isOther = s.key === OTHER_KEY;
    // ชื่อที่ผู้ใช้ตั้ง: ตัดอักขระควบคุมและอักขระทิศทาง (เช่น U+202E) ก่อนวาด ไม่ให้ข้อความในรูปกลับด้านหรือหลอกตา
    const label = isOther ? 'อื่นๆ' : showNames ? String(nameOf.get(s.key) ?? '').replace(/[\p{Cc}\p{Cf}]/gu, '') : `สินทรัพย์ ${i + 1}`;
    return { key: s.key, label, bps: s.bps, isOther };
  });
  const stalePrices = basis === 'value' && holdings.some((r) => r.priceStale);
  return { basis, slices, holdings: holdings.length, excluded: errored + zeroWeight, stalePrices };
}

/** ข้อความสรุปสั้นสำหรับโปรแกรมอ่านหน้าจอ (ใช้ป้ายชื่อตามที่เลือกเท่านั้น) */
export function describeAllocation(model: AllocationModel, formatBps: (bps: number) => string): string {
  const basisText = model.basis === 'value' ? 'ตามมูลค่า' : 'ตามต้นทุน';
  return `สัดส่วนพอร์ต${basisText}: ${model.slices.map((s) => `${s.label} ${formatBps(s.bps)}`).join(' · ')}`;
}
