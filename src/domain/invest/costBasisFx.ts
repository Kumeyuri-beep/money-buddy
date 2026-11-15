/**
 * ต้นทุนเฉลี่ยของสินทรัพย์สกุลต่างประเทศ 2 ถัง (กฎ R20.3-R20.4 · ต่อยอด R11/R17) · ฟังก์ชันล้วน
 *   ถัง USD: costUsd (เซนต์ รวมค่าธรรมเนียมซื้อ) · ถังบาท: costThb (สตางค์ ที่อัตราวันซื้อของแต่ละรายการ)
 *   ซื้อ:  costUsd += A+F · costThb += roundHalfUp((A+F) x fxซื้อ / 10^6)  (ปฏิเสธถ้าต้นทุนบาทของรายการปัดเป็น 0)
 *   ขาย u: costOut = (u = ทั้งหมด ? ทั้งก้อน : min(roundHalfUp(C x u / U), C − 1)) แยกอิสระต่อถัง
 *   กำไรรวมบาท = proceedsThb − costOutThb · ส่วนราคา = roundHalfUp(priceGainUsd x fxขาย) · ส่วนค่าเงิน = ที่เหลือ (ผลรวมตรงเป๊ะ)
 * ส่วนแยกราคา/ค่าเงินเป็นค่าแสดงผล (คลาดได้ราว fx/2 สตางค์ต่อการขาย) และไม่ใช่ฐานภาษีไทย
 */

import { roundHalfUpBig } from '../money/round';
import { safeAdd, safeSub } from '../money/safe';
import { convertMinor, assertFxRateMicro } from './fx';
import { assertPriceMicro, assertUnitsInRange, toSafeSatang, valueInSatang } from './units';

export interface PositionFx {
  /** จำนวนหน่วย x 10^8 */
  units: bigint;
  /** ต้นทุนรวมเซนต์ USD รวมค่าธรรมเนียมซื้อ */
  costUsd: number;
  /** ต้นทุนรวมสตางค์ (แปลงแต่ละรายการที่อัตราวันซื้อ) */
  costThb: number;
}

export const emptyPositionFx = (): PositionFx => ({ units: 0n, costUsd: 0, costThb: 0 });

export interface BuyFxInput {
  units: bigint;
  /** มูลค่าซื้อ (เซนต์) ≥ 1 */
  amount: number;
  /** ค่าธรรมเนียม (เซนต์) ≥ 0 (รับเป็น USD อย่างเดียวตาม R20) */
  fee: number;
  fxRateMicro: number;
}

export interface SellFxInput {
  units: bigint;
  /** ราคาต่อหน่วย micro-USD */
  priceMicro: number;
  fee: number;
  fxRateMicro: number;
}

export interface SellFxResult {
  position: PositionFx;
  grossUsd: number;
  netUsd: number;
  costOutUsd: number;
  costOutThb: number;
  proceedsThb: number;
  /** กำไร/ขาดทุนรวมบาท = proceedsThb − costOutThb */
  gainThb: number;
  /** กำไรจากราคาหุ้น (เซนต์ USD) = netUsd − costOutUsd */
  priceGainUsd: number;
  /** ส่วนที่มาจากราคาหุ้น คิดที่อัตราวันขาย (สตางค์) */
  priceGainThb: number;
  /** ส่วนที่มาจากค่าเงิน = gainThb − priceGainThb (ส่วนที่เหลือ ค่าแสดงผล) */
  fxGainThb: number;
}

function assertInt(value: number, name: string, min: number): void {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new RangeError(`${name} ต้องเป็นจำนวนเต็มที่ไม่ต่ำกว่า ${min} (ได้รับ ${String(value)})`);
  }
}

function assertPositionValid(p: PositionFx): void {
  if (
    p.units < 0n || !Number.isSafeInteger(p.costUsd) || p.costUsd < 0 || !Number.isSafeInteger(p.costThb) || p.costThb < 0 ||
    (p.units > 0n && (p.costUsd < 1 || p.costThb < 1)) || (p.units === 0n && (p.costUsd !== 0 || p.costThb !== 0))
  ) {
    throw new RangeError('ตำแหน่งการลงทุนไม่ถูกต้อง');
  }
}

export function applyBuyFx(position: PositionFx, input: BuyFxInput): PositionFx {
  if (input.units <= 0n) throw new RangeError('จำนวนหน่วยที่ซื้อต้องมากกว่า 0');
  assertInt(input.amount, 'มูลค่าซื้อ', 1);
  assertInt(input.fee, 'ค่าธรรมเนียม', 0);
  assertFxRateMicro(input.fxRateMicro);
  const outlay = safeAdd(input.amount, input.fee);
  const outlayThb = convertMinor(outlay, input.fxRateMicro);
  if (outlayThb < 1) throw new RangeError('ต้นทุนบาทของรายการซื้อปัดเป็น 0 สตางค์ (อัตราต่ำหรือจำนวนเงินน้อยเกินไป) บันทึกไม่ได้');
  const units = position.units + input.units;
  assertUnitsInRange(units);
  return { units, costUsd: safeAdd(position.costUsd, outlay), costThb: safeAdd(position.costThb, outlayThb) };
}

/** ตัดต้นทุนแบบสัดส่วนของถังหนึ่ง: ขายหมดตัดทั้งก้อน ไม่งั้น min(roundHalfUp(C x u / U), C − 1) */
function costOutOf(cost: number, units: bigint, held: bigint): number {
  if (units === held) return cost;
  const prorated = toSafeSatang(roundHalfUpBig(BigInt(cost) * units, held));
  return Math.min(prorated, cost - 1);
}

export function applySellFx(position: PositionFx, input: SellFxInput): SellFxResult {
  assertPositionValid(position);
  if (input.units <= 0n) throw new RangeError('จำนวนหน่วยที่ขายต้องมากกว่า 0');
  if (input.units > position.units) throw new RangeError('ขายเกินจำนวนหน่วยที่ถืออยู่');
  assertInt(input.fee, 'ค่าธรรมเนียม', 0);
  assertPriceMicro(input.priceMicro);
  assertFxRateMicro(input.fxRateMicro);
  const grossUsd = valueInSatang(input.units, input.priceMicro); // หน่วยเป็นเซนต์ (ตัวหารเดียวกับสตางค์)
  if (grossUsd < 1) throw new RangeError('ขายแล้วได้เงิน 0 เซนต์ (หน่วยน้อยหรือราคาต่ำเกินไป) บันทึกไม่ได้');
  if (input.fee > grossUsd) throw new RangeError('ค่าธรรมเนียมขายเกินเงินที่ขายได้');
  const netUsd = safeSub(grossUsd, input.fee);

  const costOutUsd = costOutOf(position.costUsd, input.units, position.units);
  const costOutThb = costOutOf(position.costThb, input.units, position.units);
  const proceedsThb = convertMinor(netUsd, input.fxRateMicro);
  const gainThb = safeSub(proceedsThb, costOutThb);
  const priceGainUsd = safeSub(netUsd, costOutUsd);
  // ส่วนราคาอาจติดลบ (ขาดทุนราคา): convertMinor รับเฉพาะไม่ติดลบ จึงแปลงขนาดแล้วคืนเครื่องหมาย (ปัดครึ่งออกจากศูนย์ สมมาตรกับ roundHalfUp)
  const priceGainThb = priceGainUsd < 0 ? -convertMinor(-priceGainUsd, input.fxRateMicro) : convertMinor(priceGainUsd, input.fxRateMicro);
  const fxGainThb = safeSub(gainThb, priceGainThb);

  return {
    position: {
      units: position.units - input.units,
      costUsd: safeSub(position.costUsd, costOutUsd),
      costThb: safeSub(position.costThb, costOutThb),
    },
    grossUsd,
    netUsd,
    costOutUsd,
    costOutThb,
    proceedsThb,
    gainThb,
    priceGainUsd,
    priceGainThb: priceGainThb || 0, // กัน -0
    fxGainThb: fxGainThb || 0,
  };
}

export type TradeFx =
  | { kind: 'buy'; id: string; date: string; createdAt: string; units: bigint; amount: number; fee: number; fxRateMicro: number }
  | { kind: 'sell'; id: string; date: string; createdAt: string; units: bigint; priceMicro: number; fee: number; fxRateMicro: number };

export interface ReplayFxResult {
  position: PositionFx;
  totalCostUsd: number;
  totalCostOutUsd: number;
  totalCostThb: number;
  totalCostOutThb: number;
  /** Σ กำไรรวมบาท · Σ ส่วนราคา · Σ ส่วนค่าเงิน (ผลรวมสองส่วนหลังเท่าตัวแรกเป๊ะ) */
  realizedGainThb: number;
  realizedPriceGainThb: number;
  realizedFxGainThb: number;
  sells: { id: string; result: SellFxResult }[];
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** เล่นซ้ำรายการเรียง (date, createdAt, id) และตรวจ invariant ของทั้งสองถัง: Σต้นทุนซื้อ = ΣcostOut + C เหลือ */
export function replayTradesFx(trades: readonly TradeFx[]): ReplayFxResult {
  const ordered = [...trades].sort((a, b) => cmp(a.date, b.date) || cmp(a.createdAt, b.createdAt) || cmp(a.id, b.id));
  let position = emptyPositionFx();
  let totalCostUsd = 0;
  let totalCostThb = 0;
  let totalCostOutUsd = 0;
  let totalCostOutThb = 0;
  let realizedGainThb = 0;
  let realizedPriceGainThb = 0;
  let realizedFxGainThb = 0;
  const sells: ReplayFxResult['sells'] = [];
  for (const t of ordered) {
    if (t.kind === 'buy') {
      const before = position;
      position = applyBuyFx(position, t);
      totalCostUsd = safeAdd(totalCostUsd, safeSub(position.costUsd, before.costUsd));
      totalCostThb = safeAdd(totalCostThb, safeSub(position.costThb, before.costThb));
    } else {
      const r = applySellFx(position, t);
      position = r.position;
      totalCostOutUsd = safeAdd(totalCostOutUsd, r.costOutUsd);
      totalCostOutThb = safeAdd(totalCostOutThb, r.costOutThb);
      realizedGainThb = safeAdd(realizedGainThb, r.gainThb);
      realizedPriceGainThb = safeAdd(realizedPriceGainThb, r.priceGainThb);
      realizedFxGainThb = safeAdd(realizedFxGainThb, r.fxGainThb);
      sells.push({ id: t.id, result: r });
    }
  }
  if (
    totalCostUsd !== totalCostOutUsd + position.costUsd || totalCostThb !== totalCostOutThb + position.costThb ||
    (position.units === 0n) !== (position.costUsd === 0) || (position.units === 0n) !== (position.costThb === 0) ||
    realizedGainThb !== realizedPriceGainThb + realizedFxGainThb
  ) {
    throw new RangeError('ต้นทุนไม่สมดุลหลังเล่นซ้ำรายการ');
  }
  return { position, totalCostUsd, totalCostOutUsd, totalCostThb, totalCostOutThb, realizedGainThb, realizedPriceGainThb, realizedFxGainThb, sells };
}
