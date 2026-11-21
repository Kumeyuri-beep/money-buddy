/**
 * อัตราแลกเปลี่ยนล่าสุดที่ผู้ใช้กรอก (R20.7) · แยกจาก portfolioMoney.ts เพื่อให้ฟังก์ชันผลตอบแทน (metrics, twr, reportSeries, reportRows)
 * ไม่ต้อง import โมดูลที่แตะสมุดบัญชี/เงินสด (R25.3-R25.4: ผลตอบแทนไม่รวมเงินสด) · ฟังก์ชันล้วน ไม่แตะ DOM/เครือข่าย/ฐานข้อมูล
 */

import type { FxRateRecord } from './types';

/**
 * อัตราแลกเปลี่ยนล่าสุดที่ผู้ใช้กรอก ณ วัน asOf (R20.7): วันที่ล่าสุดก่อนหรือเท่า asOf · วันเดียวกันหลายบัญชี USD ให้รหัสบัญชีมากสุดชนะ (กติกาเดียวกันทุกหน้าจอ ตัวเลขจึงตรงกัน)
 * ไม่มี = null (ไม่เดา)
 */
export function latestFxRate(rates: readonly FxRateRecord[], asOf: string): { date: string; rateMicro: number } | null {
  let best: FxRateRecord | null = null;
  for (const r of rates) {
    if (r.date > asOf) continue;
    if (best === null || r.date > best.date || (r.date === best.date && r.accountId > best.accountId)) best = r;
  }
  return best ? { date: best.date, rateMicro: best.rateMicro } : null;
}
