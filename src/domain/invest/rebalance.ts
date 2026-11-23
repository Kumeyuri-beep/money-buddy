/**
 * Portfolio Rebalancing (กฎ R29 · docs/proposals/R29-rebalancing.md) · ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล/React
 * เป็น "Result" ที่คำนวณจากเป้าที่ผู้ใช้ตั้งเอง ไม่ใช่คำแนะนำการลงทุน ไม่สร้างรายการซื้อขาย ไม่ลงสมุด (R16)
 * - คำนวณเป็น USD เซนต์ จำนวนเต็ม BigInt ล้วน ห้าม float
 * - การแบ่งเงิน/หน่วยใช้ปัดลงผ่าน floorDivBig ตัวเดียว + largest remainder (ข้อยกเว้นการปัดเศษของ R8 เฉพาะ R29)
 * - "หน่วย x ราคา -> เซนต์" ใช้ valueInSatang (ปัดครึ่งออกจากศูนย์ R8/R17)
 * - ข้อความไทย/อังกฤษทำที่ชั้นหน้าจอ ไฟล์นี้คืนรหัส (enum) เท่านั้น
 *
 * ชนิดอินพุตเป็นโครงสร้างที่เข้ากับ AssetCategory ของ Categories (R2): id, name, sortOrder, targetBps
 */

import { floorDivBig } from '../money/round';
import { SATANG_DIVISOR, UNIT_SCALE, toSafeSatang, valueInSatang } from './units';

export const REBALANCE_BPS_TOTAL = 10_000;
/** ราคาเก่ากว่านี้ (วัน) ขึ้นคำเตือน (เหมือน R26) */
export const REBALANCE_STALE_DAYS = 30;

const BPS = 10_000n;
const FRACTION_STEP = 100_000n; // 0.001 หุ้น

export interface RebalanceCategory {
  id: string;
  name: string;
  sortOrder: number;
  /** bps จำนวนเต็ม · null = ยังไม่ตั้ง */
  targetBps: number | null;
}

export interface RebalanceHolding {
  id: string;
  ticker: string;
  /** null = ไม่มีหมวด */
  categoryId: string | null;
  currency: 'THB' | 'USD';
  /** หน่วย x 10^8 (ไม่ติดลบ) */
  units: bigint;
  /** ราคาล่าสุดที่ผู้ใช้กรอก (micro-USD) · null = ไม่มีราคา */
  priceMicro: number | null;
  /** YYYY-MM-DD ของราคา (ไม่บังคับ ใช้เตือนราคาเก่า) */
  priceDate?: string;
}

export type RebalanceMode = 'deposit' | 'withdraw';

export interface RebalanceInput {
  mode: RebalanceMode;
  /** เซนต์ · ฝาก D >= 0 · ถอน W > 0 */
  amountCents: number;
  allowSales: boolean;
  /** เปิดเศษหุ้น (ทศนิยม 3 ตำแหน่ง) · ปิด = เต็มหน่วย */
  fractional: boolean;
  /** ยอดสั่งขั้นต่ำของแถวซื้อ (เซนต์ >= 0) */
  minOrderCents: number;
  categories: readonly RebalanceCategory[];
  holdings: readonly RebalanceHolding[];
  /** YYYY-MM-DD ของวันนี้ (ใช้เตือนราคาเก่า · ไม่ส่ง = ไม่ตรวจ) */
  today?: string;
}

export type RebalanceErrorReason =
  | 'invalidAmount'
  | 'invalidOption'
  | 'invalidHolding'
  | 'noTargets'
  | 'targetsNotComplete'
  | 'holdingWithoutCategory'
  | 'bahtAssetInCategory'
  | 'needsPrice'
  | 'nothingToDo'
  | 'withdrawExceedsValue';

export type RebalanceWarningCode = 'sellsWholePosition' | 'sellsWholeCategory' | 'stalePrice' | 'noHoldingToBuy' | 'alreadyAtTargets';

export interface RebalanceWarning {
  code: RebalanceWarningCode;
  holdingIds?: string[];
  categoryIds?: string[];
}

export type DroppedReason = 'unitsZero' | 'belowMinOrder';

export interface RebalanceRow {
  holdingId: string;
  ticker: string;
  categoryId: string;
  side: 'buy' | 'sell';
  /** หน่วย x 10^8 (ปัดแล้ว: เศษหุ้น = พหุคูณ 100,000 · ไม่มีเศษ = พหุคูณ 10^8) แสดง ส่งออก ใช้ต่อ ต้องเป็นค่านี้ค่าเดียว */
  units: bigint;
  /** valueInSatang(units, priceMicro) */
  cents: number;
  priceMicro: number;
  priceDate?: string;
}

export interface DroppedRow {
  holdingId: string;
  ticker: string;
  categoryId: string;
  reason: DroppedReason;
}

export interface RebalanceCategoryRow {
  categoryId: string;
  name: string;
  targetBps: number;
  /** มูลค่าปัจจุบัน Vc */
  nowCents: number;
  /** มูลค่าหลังทำรายการ คิดจากหน่วยที่ปัดจริง */
  afterCents: number;
  /** เงินที่ได้รับจัดสรรซื้อ (ac · 0 ถ้าไม่ใช่โหมดฝากหรือไม่ขาด) */
  allocatedCents: number;
  /** ยอดขายที่ตั้งไว้ของหมวด (ก่อนปัดหน่วย) */
  sellBudgetCents: number;
}

export type RebalanceResult =
  | { ok: false; reason: RebalanceErrorReason; categoryIds?: string[]; holdingIds?: string[] }
  | {
      ok: true;
      mode: RebalanceMode;
      /** V: มูลค่าตลาดของหุ้นที่ถือ (ไม่รวมเงินสด) */
      totalNowCents: number;
      totalAfterCents: number;
      /** เงินซื้อ F (โหมดฝาก) */
      buyFundsCents: number;
      /** เงินที่ได้จริงจากการขาย (P ของ Allow sales หรือยอดถอนที่ได้) */
      saleProceedsCents: number;
      buys: RebalanceRow[];
      sells: RebalanceRow[];
      droppedRows: DroppedRow[];
      /** "Left over" (โหมดฝาก) */
      leftOverCents: number;
      /** "Short by" (โหมดถอน) */
      shortByCents: number;
      categoryRows: RebalanceCategoryRow[];
      warnings: RebalanceWarning[];
    };

// ---------- ตัวช่วยเรียงลำดับ ----------

const encoder = new TextEncoder();

/** เทียบแบบไบต์ (UTF-8) */
export function compareBytes(a: string, b: string): number {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i += 1) {
    const d = (x[i] as number) - (y[i] as number);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

const compareCategories = (a: RebalanceCategory, b: RebalanceCategory): number => a.sortOrder - b.sortOrder || compareBytes(a.id, b.id);

/** ชื่อย่อ (ตัวพิมพ์ใหญ่ เทียบไบต์) แล้ว id */
const compareHoldings = (a: RebalanceHolding, b: RebalanceHolding): number =>
  compareBytes(a.ticker.toUpperCase(), b.ticker.toUpperCase()) || compareBytes(a.id, b.id);

/**
 * แบ่ง total ตามน้ำหนัก: floor(total x w / sum) แล้วเติมเศษทีละ 1 ให้ตัวที่เศษมากสุด (เทียบเศษเป็นตัวเศษจำนวนเต็ม)
 * เศษเท่ากัน -> ตัวที่อยู่ก่อนในลำดับ (ผู้เรียกเรียงลำดับตัดสินใจไว้แล้ว) · ผลรวม = total พอดี · sum ต้อง > 0
 */
export function allocateLargestRemainder(total: bigint, weights: readonly bigint[]): bigint[] {
  let sum = 0n;
  for (const w of weights) {
    if (w < 0n) throw new RangeError('allocate: น้ำหนักต้องไม่ติดลบ');
    sum += w;
  }
  if (sum <= 0n) throw new RangeError('allocate: ผลรวมน้ำหนักต้องเป็นบวก');
  const base: bigint[] = [];
  const rem: bigint[] = [];
  let given = 0n;
  for (const w of weights) {
    const num = total * w;
    const q = floorDivBig(num, sum);
    base.push(q);
    rem.push(num - q * sum);
    given += q;
  }
  let extra = total - given;
  const order = weights.map((_, i) => i).sort((i, j) => {
    const a = rem[i] as bigint;
    const b = rem[j] as bigint;
    if (a === b) return i - j;
    return a > b ? -1 : 1;
  });
  for (const i of order) {
    if (extra <= 0n) break;
    // น้ำหนัก 0 มีเศษ 0 จึงอยู่ท้ายสุด และ extra < จำนวนตัวที่มีน้ำหนัก > 0 เสมอ
    base[i] = (base[i] as bigint) + 1n;
    extra -= 1n;
  }
  return base;
}

// ---------- ตรวจอินพุต ----------

interface Prepared {
  cats: RebalanceCategory[];
  /** ถือจริง (หน่วย > 0) แยกตามหมวด เรียงตามชื่อย่อ/id */
  byCat: Map<string, RebalanceHolding[]>;
  /** มูลค่าต่อหุ้น (เซนต์) */
  value: Map<string, bigint>;
  catValue: Map<string, bigint>;
  total: bigint;
}

const isCents = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);

function validate(input: RebalanceInput): RebalanceResult | Prepared {
  if (!isCents(input.amountCents) || (input.mode === 'deposit' ? input.amountCents < 0 : input.amountCents <= 0)) {
    return { ok: false, reason: 'invalidAmount' };
  }
  if (!isCents(input.minOrderCents) || input.minOrderCents < 0) return { ok: false, reason: 'invalidOption' };

  const cats = [...input.categories].sort(compareCategories);
  const catIds = new Set(cats.map((c) => c.id));
  if (cats.length === 0 || cats.every((c) => c.targetBps === null)) return { ok: false, reason: 'noTargets' };
  let total = 0;
  for (const c of cats) {
    if (c.targetBps === null || !Number.isSafeInteger(c.targetBps) || c.targetBps < 0 || c.targetBps > REBALANCE_BPS_TOTAL) {
      return { ok: false, reason: 'targetsNotComplete' };
    }
    total += c.targetBps;
  }
  if (total !== REBALANCE_BPS_TOTAL) return { ok: false, reason: 'targetsNotComplete' };

  for (const h of input.holdings) {
    if (typeof h.units !== 'bigint' || h.units < 0n) return { ok: false, reason: 'invalidHolding', holdingIds: [h.id] };
  }
  // หุ้นที่ถืออยู่แต่ไม่มีหมวด (หรือหมวดไม่อยู่ในรายการ)
  const orphans = input.holdings.filter((h) => h.units > 0n && (h.categoryId === null || !catIds.has(h.categoryId)));
  if (orphans.length > 0) return { ok: false, reason: 'holdingWithoutCategory', holdingIds: orphans.map((h) => h.id) };
  // สินทรัพย์สกุลบาทในหมวด (ห้ามบวกข้ามสกุล R20)
  const baht = new Set<string>();
  for (const h of input.holdings) if (h.currency === 'THB' && h.units > 0n && h.categoryId !== null && catIds.has(h.categoryId)) baht.add(h.categoryId);
  if (baht.size > 0) return { ok: false, reason: 'bahtAssetInCategory', categoryIds: cats.filter((c) => baht.has(c.id)).map((c) => c.id) };
  // หุ้นที่ถืออยู่ไม่มีราคา
  const noPrice = input.holdings.filter((h) => h.units > 0n && (h.priceMicro === null || !Number.isSafeInteger(h.priceMicro) || h.priceMicro <= 0));
  if (noPrice.length > 0) return { ok: false, reason: 'needsPrice', holdingIds: noPrice.map((h) => h.id) };

  const byCat = new Map<string, RebalanceHolding[]>();
  const value = new Map<string, bigint>();
  const catValue = new Map<string, bigint>();
  for (const c of cats) {
    byCat.set(c.id, []);
    catValue.set(c.id, 0n);
  }
  let sum = 0n;
  for (const h of [...input.holdings].sort(compareHoldings)) {
    if (h.units === 0n || h.categoryId === null) continue;
    const v = BigInt(valueInSatang(h.units, h.priceMicro as number));
    value.set(h.id, v);
    (byCat.get(h.categoryId) as RebalanceHolding[]).push(h);
    catValue.set(h.categoryId, (catValue.get(h.categoryId) as bigint) + v);
    sum += v;
  }

  if (input.mode === 'deposit' && input.amountCents === 0 && !input.allowSales) return { ok: false, reason: 'nothingToDo' };
  if (input.mode === 'withdraw' && BigInt(input.amountCents) > sum) return { ok: false, reason: 'withdrawExceedsValue' };
  return { cats, byCat, value, catValue, total: sum };
}

const isPrepared = (x: RebalanceResult | Prepared): x is Prepared => 'cats' in x;

// ---------- แปลงเงินเป็นหน่วยและแถว ----------

const unitStep = (fractional: boolean): bigint => (fractional ? FRACTION_STEP : UNIT_SCALE);

/** หน่วยจากเงิน: floor(cents x 10^12 / (price x step)) x step */
function unitsForCents(cents: bigint, priceMicro: number, fractional: boolean): bigint {
  const step = unitStep(fractional);
  return floorDivBig(cents * SATANG_DIVISOR, BigInt(priceMicro) * step) * step;
}

/** แบ่ง cents ให้หุ้นในหมวดตามมูลค่า (หุ้นมูลค่า 0 ไม่ได้เงิน) · ผลเรียงตามลำดับหุ้นของหมวด */
function splitByValue(cents: bigint, holds: readonly RebalanceHolding[], value: ReadonlyMap<string, bigint>): bigint[] {
  return allocateLargestRemainder(
    cents,
    holds.map((h) => value.get(h.id) as bigint),
  );
}

const toRow = (h: RebalanceHolding, side: 'buy' | 'sell', units: bigint): RebalanceRow => ({
  holdingId: h.id,
  ticker: h.ticker,
  categoryId: h.categoryId as string,
  side,
  units,
  cents: valueInSatang(units, h.priceMicro as number),
  priceMicro: h.priceMicro as number,
  ...(h.priceDate !== undefined ? { priceDate: h.priceDate } : {}),
});

// ---------- ตัวคำนวณหลัก ----------

/**
 * สมมติฐานของอินพุต (ผู้เรียกรับผิดชอบ): id ของหมวดและหุ้นต้องไม่ซ้ำ · priceDate ต้องเป็น YYYY-MM-DD · ผลที่เป็นเซนต์ทุกตัวเกิน 2^53-1 โยน RangeError
 */
export function rebalance(input: RebalanceInput): RebalanceResult {
  const prep = validate(input);
  if (!isPrepared(prep)) return prep;
  const { cats, byCat, value, catValue, total: V } = prep;
  const tc = new Map(cats.map((c) => [c.id, BigInt(c.targetBps as number)]));
  const amount = BigInt(input.amountCents);
  const T = input.mode === 'deposit' ? V + amount : V - amount;
  const warnings: RebalanceWarning[] = [];

  /** ส่วนขาด/ส่วนเกินของหมวด (หน่วย เซนต์ x 10,000) */
  const gap = (id: string): bigint => (T * (tc.get(id) as bigint)) - (catValue.get(id) as bigint) * BPS;
  const sc = (id: string): bigint => (gap(id) > 0n ? gap(id) : 0n);
  const ec = (id: string): bigint => (gap(id) < 0n ? -gap(id) : 0n);

  const sells: RebalanceRow[] = [];
  const buys: RebalanceRow[] = [];
  const dropped: DroppedRow[] = [];
  const sellBudget = new Map<string, bigint>();
  const allocated = new Map<string, bigint>();

  /** ขาย cents ของหมวด แบ่งตามมูลค่า · หน่วย = min(คำนวณ, ที่ถือ) */
  const sellInCategory = (catId: string, cents: bigint): void => {
    sellBudget.set(catId, cents);
    const holds = byCat.get(catId) as RebalanceHolding[];
    if (cents <= 0n || holds.length === 0 || (catValue.get(catId) as bigint) === 0n) return;
    const shares = splitByValue(cents, holds, value);
    holds.forEach((h, i) => {
      const calc = unitsForCents(shares[i] as bigint, h.priceMicro as number, input.fractional);
      const units = calc < h.units ? calc : h.units;
      if (units > 0n) sells.push(toRow(h, 'sell', units));
    });
  };

  let buyFunds = 0n;
  let leftOver = 0n;
  let shortBy = 0n;
  let proceeds = 0n;

  if (input.mode === 'withdraw') {
    const order = cats.filter((c) => ec(c.id) > 0n).sort((a, b) => (ec(a.id) === ec(b.id) ? compareCategories(a, b) : ec(a.id) > ec(b.id) ? -1 : 1));
    let remaining = amount;
    for (const c of order) {
      if (remaining <= 0n) break;
      const cap = floorDivBig(ec(c.id), BPS);
      const take = cap < remaining ? cap : remaining;
      sellInCategory(c.id, take);
      remaining -= take;
    }
    proceeds = sells.reduce((s, r) => s + BigInt(r.cents), 0n);
    shortBy = amount > proceeds ? amount - proceeds : 0n;
  } else {
    if (input.allowSales) {
      for (const c of cats) {
        const e = ec(c.id);
        if (e > 0n) sellInCategory(c.id, floorDivBig(e, BPS));
      }
      proceeds = sells.reduce((s, r) => s + BigInt(r.cents), 0n);
    }
    buyFunds = amount + proceeds;
    const gaps = cats.map((c) => sc(c.id));
    const sumSc = gaps.reduce((s, g) => s + g, 0n);
    if (sumSc === 0n) {
      // พอร์ตตรงเป้าพอดี (D = 0 + Allow sales) ไม่มีรายการ ไม่หารด้วยศูนย์
      warnings.push({ code: 'alreadyAtTargets' });
    } else {
      const ac = allocateLargestRemainder(buyFunds, gaps);
      const noHolding: string[] = [];
      cats.forEach((c, i) => {
        const money = ac[i] as bigint;
        allocated.set(c.id, money);
        const holds = byCat.get(c.id) as RebalanceHolding[];
        if (money <= 0n) return;
        if ((catValue.get(c.id) as bigint) === 0n) {
          noHolding.push(c.id);
          return;
        }
        const shares = splitByValue(money, holds, value);
        holds.forEach((h, k) => {
          const share = shares[k] as bigint;
          if (share <= 0n) return;
          const units = unitsForCents(share, h.priceMicro as number, input.fractional);
          if (units <= 0n) {
            dropped.push({ holdingId: h.id, ticker: h.ticker, categoryId: c.id, reason: 'unitsZero' });
            return;
          }
          // หน่วย > 0 แต่เงินปัดเป็น 0 เซนต์ -> ตัดเป็น belowMinOrder (R29 · เงินกลับเป็น Left over) · ตรวจ unitsZero ก่อนเสมอ
          const row = toRow(h, 'buy', units);
          if (row.cents <= 0 || row.cents < input.minOrderCents) {
            dropped.push({ holdingId: h.id, ticker: h.ticker, categoryId: c.id, reason: 'belowMinOrder' });
            return;
          }
          buys.push(row);
        });
      });
      if (noHolding.length > 0) warnings.push({ code: 'noHoldingToBuy', categoryIds: noHolding });
    }
    leftOver = buyFunds - buys.reduce((s, r) => s + BigInt(r.cents), 0n);
  }

  // คำเตือน: ขายหมดตำแหน่ง/หมวด
  const heldUnits = new Map<string, bigint>();
  for (const list of byCat.values()) for (const h of list) heldUnits.set(h.id, h.units);
  const wholePos = sells.filter((r) => r.units === heldUnits.get(r.holdingId)).map((r) => r.holdingId);
  if (wholePos.length > 0) warnings.push({ code: 'sellsWholePosition', holdingIds: wholePos });
  const wholeCat = cats
    .filter((c) => c.targetBps === 0)
    .filter((c) => {
      const list = byCat.get(c.id) as RebalanceHolding[];
      return list.length > 0 && list.every((h) => wholePos.includes(h.id));
    })
    .map((c) => c.id);
  if (wholeCat.length > 0) warnings.push({ code: 'sellsWholeCategory', categoryIds: wholeCat });
  if (input.today !== undefined) {
    const stale = [...byCat.values()]
      .flat()
      .filter((h) => h.priceDate !== undefined && daysBetween(h.priceDate, input.today as string) > REBALANCE_STALE_DAYS)
      .map((h) => h.id);
    if (stale.length > 0) warnings.push({ code: 'stalePrice', holdingIds: stale });
  }

  // ตาราง Now / Target / After จากหน่วยที่ปัดจริง
  const delta = new Map<string, bigint>();
  for (const r of buys) delta.set(r.holdingId, (delta.get(r.holdingId) ?? 0n) + r.units);
  for (const r of sells) delta.set(r.holdingId, (delta.get(r.holdingId) ?? 0n) - r.units);
  let totalAfter = 0n;
  const categoryRows: RebalanceCategoryRow[] = cats.map((c) => {
    let after = 0n;
    for (const h of byCat.get(c.id) as RebalanceHolding[]) {
      after += BigInt(valueInSatang(h.units + (delta.get(h.id) ?? 0n), h.priceMicro as number));
    }
    totalAfter += after;
    return {
      categoryId: c.id,
      name: c.name,
      targetBps: c.targetBps as number,
      nowCents: toSafeSatang(catValue.get(c.id) as bigint),
      afterCents: toSafeSatang(after),
      allocatedCents: toSafeSatang(allocated.get(c.id) ?? 0n),
      sellBudgetCents: toSafeSatang(sellBudget.get(c.id) ?? 0n),
    };
  });

  return {
    ok: true,
    mode: input.mode,
    totalNowCents: toSafeSatang(V),
    totalAfterCents: toSafeSatang(totalAfter),
    buyFundsCents: toSafeSatang(buyFunds),
    saleProceedsCents: toSafeSatang(proceeds),
    buys,
    sells,
    droppedRows: dropped,
    leftOverCents: toSafeSatang(leftOver),
    shortByCents: toSafeSatang(shortBy),
    categoryRows,
    warnings,
  };
}

/** จำนวนวันระหว่างสองวันที่ YYYY-MM-DD (to - from) นับด้วยจำนวนเต็มวันตามปฏิทิน ไม่ใช้เวลาของเครื่อง */
function daysBetween(from: string, to: string): number {
  const toDays = (s: string): number => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d) / 86_400_000;
  };
  return toDays(to) - toDays(from);
}

