import { roundHalfUp } from '../domain/money/round';
import { formatBaht } from '../domain/money/satang';
import type { Satang } from '../domain/money/satang';

/**
 * ตัวช่วยจัดรูปแบบสำหรับการ์ดสรุป (ไม่แตะ React/DOM)
 * ร้อยละรับเป็น basis points จำนวนเต็ม แล้วปัดเป็นทศนิยม 1 ตำแหน่งด้วย roundHalfUp (R8) ไม่ใช้ float (R1)
 */

const MINUS = '−';

function tenthsOfPercent(bps: number): number {
  return roundHalfUp(bps, 10);
}

function fixed1(tenths: number): string {
  const abs = Math.abs(tenths);
  return `${Math.floor(abs / 10)}.${abs % 10}`;
}

/** 2000 -> "20.0%", -1250 -> "−12.5%" (ค่าที่ปัดแล้วเป็นศูนย์ไม่ขึ้นเครื่องหมาย) */
export function formatPercentBps(bps: number): string {
  const t = tenthsOfPercent(bps);
  return `${t < 0 ? MINUS : ''}${fixed1(t)}%`;
}

/** เหมือน formatPercentBps แต่ค่าบวกมี "+" นำหน้า */
export function formatSignedPercentBps(bps: number): string {
  const t = tenthsOfPercent(bps);
  return `${t > 0 ? '+' : ''}${formatPercentBps(bps)}`;
}

/** จำนวนเดือน ×10 -> "4.3 เดือน" */
export function formatMonthsTenths(tenths: number): string {
  return `${fixed1(tenths)} เดือน`;
}

/** "+฿123.45" / "−฿123.45" / "฿0.00" */
export function formatSignedBaht(value: Satang): string {
  return `${value > 0 ? '+' : ''}${formatBaht(value)}`;
}

/** ความกว้างแถบวัดผล 0-100 (จำนวนเต็ม) จากค่าเทียบเป้า เป้า <= 0 = 0 */
export function meterPercent(value: number, target: number): number {
  if (target <= 0 || value <= 0) return 0;
  if (value >= target) return 100;
  return roundHalfUp(value * 100, target);
}

export interface Point {
  x: number;
  y: number;
}

/**
 * พิกัดเส้นแนวโน้ม (หน่วยพิกเซล เพื่อวาดเท่านั้น ไม่ใช่ยอดเงิน) ค่าสูงสุดอยู่ y=0
 * ต่ำกว่า 2 จุดคืน [] ค่าเท่ากันทั้งหมดวาดเส้นกลาง
 */
export function sparklinePoints(values: readonly number[], width: number, height: number): Point[] {
  if (values.length < 2) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const last = values.length - 1;
  return values.map((v, i) => ({
    x: (width * i) / last,
    y: span === 0 ? height / 2 : height - (height * (v - min)) / span,
  }));
}
