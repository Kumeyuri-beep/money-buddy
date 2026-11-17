/**
 * หน่วยลงทุนและราคา (กฎ R9, R17) · ฟังก์ชันล้วน ไม่แตะ DOM/เครือข่าย · BigInt ตลอด ไม่ผ่านทศนิยมลอยตัว
 *   - จำนวนหน่วย = จำนวนเต็ม x 10^8 (bigint)
 *   - ราคาต่อ 1 หน่วย = micro ของสกุลสินทรัพย์ (x 10^6: micro-baht สำหรับ THB, micro-USD สำหรับ USD ตาม R20) จำนวนเต็มบวก
 *   - มูลค่า (สตางค์) = roundHalfUp(units x priceMicro / 10^12) ปัดครั้งเดียวตอนแปลงเป็นสตางค์
 * ห้ามใช้ mulMicro/parseMicro เดิมกับหน่วย (ผิดสเกล 100 เท่า / รับเลขลบ)
 */

import { roundHalfUpBig } from '../money/round';
import { rangeError, syntaxError } from './errorCodes';

export const UNIT_SCALE = 100_000_000n;
const UNIT_DECIMALS = 8;
const PRICE_DECIMALS = 6;
/** จำนวนหน่วยสูงสุด (x 10^8) = int64 สูงสุด เพื่อให้เก็บในคอลัมน์ bigint ของฐานข้อมูลได้ (ผลตรวจ money-auditor) */
export const MAX_UNITS = 2n ** 63n - 1n;
/** units x priceMicro / SATANG_DIVISOR = สตางค์ (10^8 x 10^6 / 10^2 สตางค์ต่อบาท... = 10^12) */
export const SATANG_DIVISOR = 1_000_000_000_000n;

/** ตัวคั่นหลักพันต้องเป็นกลุ่มละ 3 หลัก ("1,5" และ "1,2,3" ถูกปฏิเสธ) ช่องว่างกลางตัวเลขไม่รับ */
const PLAIN_DECIMAL = /^(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d*))?$/;

interface Decimal {
  int: string;
  frac: string;
}

/** อ่านเลขทศนิยมล้วน: ไม่รับเครื่องหมาย, scientific, ข้อความว่าง · ตัด "," และช่องว่าง */
function readDecimal(input: string, kind: 'units' | 'price'): Decimal {
  const cleaned = input.trim();
  const m = PLAIN_DECIMAL.exec(cleaned);
  const int = (m?.[1] ?? '').replace(/,/g, '');
  const frac = m?.[2] ?? '';
  if (!m || (int === '' && frac === '')) throw syntaxError('units.unreadable', { kind, input });
  return { int: int === '' ? '0' : int, frac };
}

/** ตัดทศนิยมเป็น decimals หลัก ปัดครึ่งออกจากศูนย์ที่หลักถัดไป (ค่าบวกเสมอ) */
function scaleUp(d: Decimal, decimals: number): bigint {
  const kept = BigInt(d.int + d.frac.slice(0, decimals).padEnd(decimals, '0'));
  const next = d.frac.length > decimals ? d.frac.charCodeAt(decimals) - 48 : 0;
  return next >= 5 ? kept + 1n : kept;
}

/** "1,000.5" -> 100_050_000_000n · ลบ/ศูนย์/ปัดแล้วเป็นศูนย์ ปฏิเสธ (SyntaxError) · เกิน 10^12 หน่วย RangeError */
export function parseUnits(input: string): bigint {
  const d = readDecimal(input, 'units');
  const value = scaleUp(d, UNIT_DECIMALS);
  if (value === 0n) throw syntaxError('units.zero');
  assertUnitsInRange(value);
  return value;
}

export function assertUnitsInRange(units: bigint): void {
  if (units > MAX_UNITS) throw rangeError('units.tooMany');
}

/** "12.3456" -> 12_345_600 micro-baht · ต่ำกว่า 0.000001 บาท/ลบ/ศูนย์ ปฏิเสธ (ไม่ปัดเป็น 0 เงียบๆ) */
export function parsePriceMicro(input: string): number {
  const d = readDecimal(input, 'price');
  const value = scaleUp(d, PRICE_DECIMALS);
  if (value === 0n) throw syntaxError('units.priceZero');
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw rangeError('units.priceTooHigh');
  return Number(value);
}

/** 150_000_000n -> "1.5" (ตัดศูนย์ท้าย) */
export function formatUnits(units: bigint): string {
  if (units < 0n) throw rangeError('units.negative');
  const whole = units / UNIT_SCALE;
  const frac = (units % UNIT_SCALE).toString().padStart(UNIT_DECIMALS, '0').replace(/0+$/, '');
  return `${whole}${frac ? `.${frac}` : ''}`;
}

export function assertPriceMicro(priceMicro: number): void {
  if (!Number.isSafeInteger(priceMicro) || priceMicro <= 0) {
    throw rangeError('units.priceMicroInvalid', { got: String(priceMicro) });
  }
}

export function toSafeSatang(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw rangeError('units.resultOutOfRange');
  }
  return Number(value) || 0; // กัน -0
}

/** มูลค่า = units x ราคา เป็นสตางค์ ปัดครั้งเดียว (ค่า 0 สตางค์เป็นไปได้ ผู้เรียกระดับรายการต้องปฏิเสธเอง) */
export function valueInSatang(units: bigint, priceMicro: number): number {
  if (units < 0n) throw rangeError('units.negative');
  assertPriceMicro(priceMicro);
  return toSafeSatang(roundHalfUpBig(units * BigInt(priceMicro), SATANG_DIVISOR));
}
