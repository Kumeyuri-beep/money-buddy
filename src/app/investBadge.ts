/**
 * ป้ายที่หัวโหมดพอร์ต: "อัปเดต <วัน> · อัตรา <฿/$>" (ขั้น 1) · ฟังก์ชันล้วน ไม่มีสูตรเงิน
 * วันที่อัปเดต = วันล่าสุดที่ผู้ใช้กรอกราคาหรืออัตรา (ก่อนหรือเท่าวันนี้) · อัตราที่แสดง = อัตราล่าสุดตามกติกา latestFxRate (R20.7)
 * ไม่มีราคา/อัตราเลย = บอกตรงๆ ไม่เดา · ราคาอัตโนมัติ (เฟส B) จะมีเวลาละเอียดกว่านี้
 */
import { latestFxRate } from '../domain/invest/portfolioMoney';
import type { InvestmentData } from '../domain/invest/types';
import { formatMicro } from '../domain/money/micro';

export interface InvestBadge {
  /** วันที่ล่าสุดที่กรอกราคาหรืออัตรา (YYYY-MM-DD) · null = ยังไม่มี */
  updatedOn: string | null;
  /** อัตราล่าสุดที่กรอก (บาทต่อ 1 ดอลลาร์ x 10^6) · null = ยังไม่มี */
  rateMicro: number | null;
  /** ข้อความอัตรา เช่น "35.00 ฿/$" หรือ null */
  rateText: string | null;
}

export function buildInvestBadge(data: InvestmentData | null, today: string): InvestBadge {
  if (data === null) return { updatedOn: null, rateMicro: null, rateText: null };
  const fx = latestFxRate(data.fxRates ?? [], today);
  let latest: string | null = fx ? fx.date : null;
  for (const p of data.prices) if (p.date <= today && (latest === null || p.date > latest)) latest = p.date;
  let rateText: string | null = null;
  if (fx) {
    const [whole = '0', frac = ''] = formatMicro(fx.rateMicro).split('.');
    rateText = `${whole}.${frac.padEnd(2, '0')} ฿/$`;
  }
  return { updatedOn: latest, rateMicro: fx ? fx.rateMicro : null, rateText };
}
