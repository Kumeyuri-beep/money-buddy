/**
 * ต้นทุนเฉลี่ยถ่วงน้ำหนัก (กฎ R11, R17) · ฟังก์ชันล้วน
 *   - ซื้อ: ต้นทุน += มูลค่าซื้อ + ค่าธรรมเนียม (ตรงกับเงินที่ออกจากกระเป๋า)
 *   - ขาย u หน่วย: net = gross − ค่าธรรมเนียม
 *     costOut = (u = ทั้งหมด ? C : min(roundHalfUp(C x u / U), C − 1)) · gain = net − costOut
 *   - ค่าเงินแต่ละตัวปัดครั้งเดียวตอนแปลงเป็นสตางค์ · สตางค์ที่บันทึกแล้วเป็นจำนวนเต็มตั้งต้นของขั้นถัดไป
 *   - ตำแหน่ง (U, C) คำนวณจากการเล่นซ้ำรายการเสมอ ไม่เก็บเป็นยอดตายตัว (R16)
 */

import { roundHalfUpBig } from '../money/round';
import { safeAdd, safeSub } from '../money/safe';
import { rangeError } from './errorCodes';
import { assertPriceMicro, assertUnitsInRange, SATANG_DIVISOR, toSafeSatang, valueInSatang } from './units';

export interface Position {
  /** จำนวนหน่วย x 10^8 */
  units: bigint;
  /** ต้นทุนรวม (สตางค์) รวมค่าธรรมเนียมซื้อ */
  cost: number;
}

export const emptyPosition = (): Position => ({ units: 0n, cost: 0 });

export interface BuyInput {
  units: bigint;
  /** มูลค่าซื้อ (สตางค์) ≥ 1 */
  amount: number;
  /** ค่าธรรมเนียม (สตางค์) ≥ 0 */
  fee: number;
}

export interface SellInput {
  units: bigint;
  priceMicro: number;
  fee: number;
}

export interface SellResult {
  position: Position;
  gross: number;
  net: number;
  costOut: number;
  gain: number;
}

function assertSatangInt(value: number, name: 'buyValue' | 'fee', min: number): void {
  if (!Number.isSafeInteger(value) || value < min) {
    throw rangeError('trade.satangInt', { name, min, got: String(value) });
  }
}

export function applyBuy(position: Position, input: BuyInput): Position {
  if (input.units <= 0n) throw rangeError('trade.buyUnitsPositive');
  assertSatangInt(input.amount, 'buyValue', 1);
  assertSatangInt(input.fee, 'fee', 0);
  const cost = safeAdd(position.cost, safeAdd(input.amount, input.fee));
  const units = position.units + input.units;
  assertUnitsInRange(units);
  return { units, cost };
}

export function applySell(position: Position, input: SellInput): SellResult {
  if (position.units < 0n || !Number.isSafeInteger(position.cost) || position.cost < 0 || (position.units > 0n && position.cost < 1)) {
    throw rangeError('trade.positionInvalid');
  }
  if (input.units <= 0n) throw rangeError('trade.sellUnitsPositive');
  if (input.units > position.units) throw rangeError('trade.sellExceedsHeld');
  assertSatangInt(input.fee, 'fee', 0);
  const gross = valueInSatang(input.units, input.priceMicro);
  if (input.fee > gross) throw rangeError('trade.sellFeeExceedsGross');
  const net = safeSub(gross, input.fee);

  let costOut: number;
  if (input.units === position.units) {
    costOut = position.cost; // ขายหมด: ต้นทุนเหลือ 0 ตรงเป๊ะ
  } else {
    const prorated = toSafeSatang(roundHalfUpBig(BigInt(position.cost) * input.units, position.units));
    // ยังถือหน่วยอยู่ ต้องเหลือต้นทุน >= 1 (U' > 0 แล้ว C' >= 1) รักษา invariant U' = 0 <=> C' = 0
    costOut = Math.min(prorated, position.cost - 1);
  }
  return {
    position: { units: position.units - input.units, cost: safeSub(position.cost, costOut) },
    gross,
    net,
    costOut,
    gain: safeSub(net, costOut),
  };
}

/** ราคาเฉลี่ยต่อหน่วย (micro-baht) เพื่อแสดงผลเท่านั้น ห้ามนำไปคำนวณต่อ · ไม่มีหน่วย = null */
export function averageCostMicro(position: Position): number | null {
  if (position.units === 0n) return null;
  if (position.units < 0n || !Number.isSafeInteger(position.cost) || position.cost < 0) {
    throw rangeError('trade.positionInvalid');
  }
  return toSafeSatang(roundHalfUpBig(BigInt(position.cost) * SATANG_DIVISOR, position.units));
}

export type Trade =
  | { kind: 'buy'; id: string; date: string; createdAt: string; units: bigint; amount: number; fee: number }
  | { kind: 'sell'; id: string; date: string; createdAt: string; units: bigint; priceMicro: number; fee: number };

export interface ReplayResult {
  position: Position;
  /** Σ ต้นทุนซื้อ (A+F) */
  totalCost: number;
  /** Σ ต้นทุนที่ตัดออกตอนขาย */
  totalCostOut: number;
  /** Σ กำไร/ขาดทุนที่รับรู้ (net − costOut) */
  realizedGain: number;
  sells: { id: string; result: SellResult }[];
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** เล่นซ้ำรายการเรียง (date, createdAt, id) และตรวจ invariant: Σต้นทุนซื้อ = ΣcostOut + C เหลือ */
export function replayTrades(trades: readonly Trade[]): ReplayResult {
  const ordered = [...trades].sort((a, b) => cmp(a.date, b.date) || cmp(a.createdAt, b.createdAt) || cmp(a.id, b.id));
  let position = emptyPosition();
  let totalCost = 0;
  let totalCostOut = 0;
  let realizedGain = 0;
  const sells: ReplayResult['sells'] = [];
  for (const t of ordered) {
    if (t.kind === 'buy') {
      position = applyBuy(position, t);
      totalCost = safeAdd(totalCost, safeAdd(t.amount, t.fee));
    } else {
      assertPriceMicro(t.priceMicro);
      const r = applySell(position, t);
      position = r.position;
      totalCostOut = safeAdd(totalCostOut, r.costOut);
      realizedGain = safeAdd(realizedGain, r.gain);
      sells.push({ id: t.id, result: r });
    }
  }
  if (totalCost !== totalCostOut + position.cost || (position.units === 0n) !== (position.cost === 0)) {
    throw rangeError('trade.costImbalance');
  }
  return { position, totalCost, totalCostOut, realizedGain, sells };
}
