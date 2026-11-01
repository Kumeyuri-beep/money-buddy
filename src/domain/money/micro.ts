/**
 * ราคาและจำนวนหุ้นเก็บเป็นจำนวนเต็ม x 10^6 (micro-units) (กฎ R3, R9)
 * ตอนคูณใช้ BigInt เพราะ micro x micro เกิน Number.MAX_SAFE_INTEGER ได้ง่าย
 * (เช่น ราคา $500 x 100 หุ้น) แล้วแปลงกลับเมื่อผลลัพธ์อยู่ในช่วงปลอดภัยเท่านั้น
 */

import { satang, type Satang } from './satang';

export const MICRO = 1_000_000;

const DECIMAL_PATTERN = /^([+-])?(\d+)?(?:\.(\d*))?$/;

/** "32.834" -> 32_834_000  (ทศนิยมเกิน 6 หลักปัดครึ่งออกจากศูนย์ที่หลักที่ 7) */
export function parseMicro(input: string): number {
  const cleaned = input.replace(/[,\s]/g, '');
  const match = DECIMAL_PATTERN.exec(cleaned);
  const intPart = match?.[2];
  const fracPart = match?.[3];
  if (!match || (intPart === undefined && !fracPart)) {
    throw new SyntaxError(`อ่านตัวเลขไม่ได้: "${input}"`);
  }
  const frac = fracPart ?? '';
  const sixDigits = BigInt(frac.slice(0, 6).padEnd(6, '0'));
  const roundUp = frac.length > 6 && Number(frac[6]) >= 5 ? 1n : 0n;
  const magnitude = BigInt(intPart ?? '0') * BigInt(MICRO) + sixDigits + roundUp;
  const value = toSafeNumber(magnitude);
  return match[1] === '-' ? -value : value;
}

/** 32_834_000 -> "32.834" (ตัดศูนย์ท้ายทศนิยม) */
export function formatMicro(value: number): string {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError('micro-units ต้องเป็นจำนวนเต็มที่อยู่ในช่วงปลอดภัย');
  }
  const abs = Math.abs(value);
  const whole = Math.floor(abs / MICRO);
  const frac = String(abs % MICRO).padStart(6, '0').replace(/0+$/, '');
  return `${value < 0 ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** (a x b) / d ปัดครึ่งออกจากศูนย์ ด้วย BigInt ทุกขั้น */
export function mulDivRound(a: number, b: number, d: number): number {
  const A = BigInt(a);
  const B = BigInt(b);
  const D = BigInt(d);
  if (D === 0n) throw new RangeError('mulDivRound: ตัวหารเป็นศูนย์');
  const product = A * B;
  const negative = product < 0n !== D < 0n;
  const n = product < 0n ? -product : product;
  const divisor = D < 0n ? -D : D;
  let quotient = n / divisor;
  if ((n % divisor) * 2n >= divisor) quotient += 1n;
  return toSafeNumber(negative ? -quotient : quotient);
}

/** micro x micro -> micro  (เช่น ราคา x จำนวนหุ้น) */
export function mulMicro(a: number, b: number): number {
  return mulDivRound(a, b, MICRO);
}

/**
 * แปลงเงินต่างสกุล (micro) เป็นสตางค์ด้วยอัตราแลกเปลี่ยนที่ระบุชัดเจน (กฎ R10)
 * fxRateMicro = บาทต่อ 1 หน่วยสกุลต่างประเทศ x 10^6
 * satang = amountMicro x fxRateMicro / 10^10   (10^6 x 10^6 / 100 สตางค์)
 */
export function convertToSatang(amountMicro: number, fxRateMicro: number): Satang {
  return satang(mulDivRound(amountMicro, fxRateMicro, 10_000_000_000));
}

function toSafeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError('ผลลัพธ์เกินช่วงจำนวนเต็มปลอดภัย');
  }
  return Number(value) || 0;
}
