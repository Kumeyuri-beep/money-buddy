/**
 * ตัวจัดรูปแบบเงิน USD และอัตราแลกเปลี่ยนที่หน้าจอใช้ร่วมกัน (A3-2) · รับเซนต์จำนวนเต็ม (R1/R20) · ไม่มีสูตรเงิน
 */
import { formatMicro } from '../domain/money/micro';

/** เซนต์ → "$1,234.56" · ติดลบ "-$1,234.56" · ไม่ใช่จำนวนเต็มปลอดภัย = RangeError */
export function usd(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError('จำนวนเซนต์ต้องเป็นจำนวนเต็มที่อยู่ในช่วงปลอดภัย');
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const frac = String(abs % 100).padStart(2, '0');
  return `${cents < 0 ? '−' : ''}$${whole}.${frac}`;
}

/** เหมือน usd แต่ค่าบวกมี "+" นำหน้า */
export const usdSigned = (cents: number): string => (cents > 0 ? `+${usd(cents)}` : usd(cents));

/** อัตรา micro → "35.0012 บาท/USD" (ตัดศูนย์ท้าย · อย่างน้อย 2 ตำแหน่ง) */
export function fxRateText(rateMicro: number): string {
  const t = formatMicro(rateMicro);
  const [whole = '0', frac = ''] = t.split('.');
  return `${whole}.${frac.padEnd(2, '0')} THB/USD`;
}

/** ราคาต่อหุ้น micro-USD → "$100.10" (อย่างน้อย 2 ตำแหน่ง · ราคาละเอียดเกิน 2 ตำแหน่งแสดงตามจริงถึง 6) */
export function usdPrice(priceMicro: number): string {
  const t = formatMicro(priceMicro);
  const [whole = '0', frac = ''] = t.split('.');
  return `$${Number(whole).toLocaleString('en-US')}.${frac.padEnd(2, '0')}`;
}
