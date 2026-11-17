/**
 * หลายสกุลเงิน (กฎ R20 · ที่มา docs/plans/phase-a-us-stocks.md) · ฟังก์ชันล้วน ไม่แตะ DOM/เครือข่าย/ฐานข้อมูล · BigInt ตลอดขั้นคูณ
 *   - USD เก็บเป็นเซนต์ (จำนวนเต็ม) · อัตรา fxRateMicro = บาทต่อ 1 USD x 10^6 (R10) จำนวนเต็มบวก
 *   - เซนต์ -> สตางค์ = roundHalfUp(cents x fxRateMicro / 10^6) ปัดครั้งเดียวด้วย roundHalfUpBig ตัวกลาง (R8)
 *   - มูลค่าหุ้นเป็นเซนต์ใช้ valueInSatang เดิม (ตัวหาร 10^12 ตัวเดียวกัน: หน่วย x10^8 คูณราคา x10^6 คูณ 100 หารออก 10^14)
 */

import { roundHalfUpBig } from '../money/round';
import { safeSub } from '../money/safe';
import { rangeError } from './errorCodes';
import { toSafeSatang } from './units';
import { DEFAULT_FOREIGN_DIVIDEND_WHT_BPS } from './fxConfig';

export const FX_SCALE = 1_000_000n;

/** อัตราต้องเป็นจำนวนเต็มบวกในช่วงปลอดภัย (ไม่รับ 0, ติดลบ, ทศนิยม, NaN) */
export function assertFxRateMicro(fxRateMicro: number): void {
  if (!Number.isSafeInteger(fxRateMicro) || fxRateMicro <= 0) {
    throw rangeError('fx.rateInvalid', { got: String(fxRateMicro) });
  }
}

/** จำนวนเงินหน่วยย่อย (เซนต์) ต้องเป็นจำนวนเต็มปลอดภัยไม่ติดลบ */
function assertMinor(value: number, name: 'amount' | 'dividend' | 'withholding'): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw rangeError('fx.minorInvalid', { name, got: String(value) });
  }
}

/** เซนต์ -> สตางค์ ที่อัตรา fxRateMicro ปัดครั้งเดียว (ผลเกินช่วงปลอดภัย = RangeError · 0 เซนต์ = 0 สตางค์) */
export function convertMinor(minor: number, fxRateMicro: number): number {
  assertMinor(minor, 'amount');
  assertFxRateMicro(fxRateMicro);
  return toSafeSatang(roundHalfUpBig(BigInt(minor) * BigInt(fxRateMicro), FX_SCALE));
}

/**
 * อัตราของรายการแลกเงิน คำนวณจากจำนวนสองฝั่งซึ่งเป็นข้อมูลหลัก: roundHalfUp(satang x 10^6 / cents)
 * (บาทต่อดอลลาร์ = สตางค์ต่อเซนต์) · ค่าอ้างอิงเท่านั้น · สองฝั่งต้อง >= 1 และอัตราที่ได้ต้อง >= 1 micro
 */
export function fxRateFromExchange(satang: number, cents: number): number {
  if (!Number.isSafeInteger(satang) || satang < 1) throw rangeError('fx.exchangeBahtInvalid');
  if (!Number.isSafeInteger(cents) || cents < 1) throw rangeError('fx.exchangeUsdInvalid');
  const rate = toSafeSatang(roundHalfUpBig(BigInt(satang) * FX_SCALE, BigInt(cents)));
  assertFxRateMicro(rate);
  return rate;
}

/**
 * ตัวช่วยเติมภาษีหัก ณ ที่จ่ายของปันผลเป็นค่าแนะนำ: W = roundHalfUp(D x bps / 10000) (ค่าตั้งต้น 15% จาก fxConfig)
 * ผู้ใช้แก้ได้ ค่าที่บันทึกคือค่าสุดท้ายที่ผู้ใช้ยืนยัน · ไม่ตัดสินสิทธิ์ W-8BEN
 */
export function suggestWithholding(dividendCents: number, bps: number = DEFAULT_FOREIGN_DIVIDEND_WHT_BPS): number {
  assertMinor(dividendCents, 'dividend');
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 10_000) throw rangeError('fx.whtBpsRange');
  return toSafeSatang(roundHalfUpBig(BigInt(dividendCents) * BigInt(bps), 10_000n));
}

export interface DividendThb {
  grossThb: number;
  whtThb: number;
  /** หักเอา = grossThb − whtThb (ไม่ปัดแยกอีกรอบ ให้ตัวเลขสามตัวรวมกันตรงเป๊ะ) */
  netThb: number;
}

/** ปันผลเป็นบาท (แสดงผล/ประมาณการ): 0 <= W < D (W ต้องน้อยกว่ายอดปันผล) */
export function dividendInThb(dividendCents: number, withholdingCents: number, fxRateMicro: number): DividendThb {
  assertMinor(dividendCents, 'dividend');
  assertMinor(withholdingCents, 'withholding');
  if (dividendCents < 1) throw rangeError('fx.dividendMin');
  if (withholdingCents >= dividendCents) throw rangeError('fx.whtNotBelowDividend');
  const grossThb = convertMinor(dividendCents, fxRateMicro);
  const whtThb = convertMinor(withholdingCents, fxRateMicro);
  return { grossThb, whtThb, netThb: safeSub(grossThb, whtThb) };
}
