/**
 * ตัวชี้วัดพอร์ตหุ้นสหรัฐ (กฎ R24 กำไรรวม 6 แหล่ง · R25 ปันผล/yield/IRR/ผลตอบแทนรายเดือน · ต่อยอด R17/R20) · ฟังก์ชันล้วน ไม่แตะ DOM/เครือข่าย
 * ใช้ BigInt/จำนวนเต็มล้วน ไม่มีทศนิยมลอยตัว · ปัดครึ่งออกจากศูนย์ด้วย roundHalfUpBig ตัวเดียว (R8)
 * ข้อมูลที่ต้องใช้ไม่มี (ราคา/อัตรา) = คืน null พร้อมเหตุผล ไม่เดา ไม่ใช้ต้นทุนแทนมูลค่าตลาด (R20.7)
 * หน้าจอ (แดชบอร์ด/วิเคราะห์) ต้องเรียกฟังก์ชันในไฟล์นี้เท่านั้น ห้ามคำนวณเงินเองใน component
 */

import { roundHalfUpBig } from '../money/round';
import { safeAdd, safeSub } from '../money/safe';
import { applyBuyFx, applySellFx, emptyPositionFx, replayTradesFx, type PositionFx, type TradeFx } from './costBasisFx';
import { convertMinor } from './fx';
import { latestFxRate } from './fxRate';
import { splitTradesByRate, toTradesFx, type MissingRateTrade } from './tradesFx';
import { assetCurrency, type Asset, type InvestmentData, type TradeRecord } from './types';
import { toSafeSatang, valueInSatang } from './units';

// ───────────────────────── ตัวช่วยพื้นฐาน ─────────────────────────

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** แปลงเซนต์ (อาจติดลบ) เป็นสตางค์ ปัดครั้งเดียว: ขนาดแล้วคืนเครื่องหมาย (ปัดครึ่งออกจากศูนย์สมมาตร) */
function convertSigned(cents: number, fxRateMicro: number): number {
  return cents < 0 ? -convertMinor(-cents, fxRateMicro) || 0 : convertMinor(cents, fxRateMicro);
}

function daysBetweenIso(from: string, to: string): number {
  const f = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const t = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return (t - f) / 86_400_000; // UTC เที่ยงคืนทั้งคู่ จึงหารลงตัวเสมอ (จำนวนเต็มวัน)
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
const daysInMonthOf = (year: number, month1: number): number => new Date(Date.UTC(year, month1, 0)).getUTCDate();
const isoOf = (y: number, m1: number, d: number): string => `${pad(y, 4)}-${pad(m1)}-${pad(d)}`;

/** วันที่ย้อนไป n เดือนปฏิทิน (วันที่เกินสิ้นเดือนปลายทางปรับเป็นสิ้นเดือน) */
export function addMonthsClamped(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1;
  const d = Number(iso.slice(8, 10));
  const total = y * 12 + m + months;
  const ny = (total - (((total % 12) + 12) % 12)) / 12;
  const nm = total - ny * 12 + 1;
  return isoOf(ny, nm, Math.min(d, daysInMonthOf(ny, nm)));
}

// ───────────────────────── เล่นซ้ำพร้อมส่วนค่าธรรมเนียม (R24 กฎปัดเศษที่เพิ่ม) ─────────────────────────

export interface SellDetail {
  id: string;
  date: string;
  fxRateMicro: number;
  grossUsd: number;
  netUsd: number;
  /** ต้นทุน USD ที่ตัดออก ไม่รวมส่วนค่าธรรมเนียม */
  principalOutUsd: number;
  proceedsThb: number;
  costOutThb: number;
  /** ส่วนต่างราคาที่ขายแล้วของรายการนี้ (บาท ที่อัตราวันขาย) = แปลง(เงินขายก่อนหัก − ต้นทุน USD ไม่รวมค่าธรรมเนียม) */
  priceGainThb: number;
  /** ค่าธรรมเนียมขายเป็นบาท = แปลง(ค่าธรรมเนียมขายของรายการนี้) ที่อัตราวันขาย (R24 แหล่ง (6) · ปรับ 20 พ.ย. 2569 ให้ตรงกับ R26 Fee & tax ในตาราง Transactions) */
  sellFeeThb: number;
  feeUsd: number;
}

export interface FeeReplay {
  position: PositionFx;
  /** ส่วนค่าธรรมเนียมที่ติดอยู่ในต้นทุนของที่ถืออยู่ */
  heldFeeUsd: number;
  heldFeeThb: number;
  /** รวมทุกรายการ (ซื้อ+ขาย) · บาท = ผลบวกของค่าธรรมเนียมที่แปลงทีละรายการ (R24 แหล่ง (6)) */
  buyFeesUsd: number;
  buyFeesThb: number;
  sellFeesUsd: number;
  sellFeesThb: number;
  investedUsd: number;
  investedThb: number;
  netProceedsUsd: number;
  realizedGainThb: number;
  sells: SellDetail[];
  buys: { id: string; date: string; outlayUsd: number; outlayThb: number }[];
}

/**
 * เล่นซ้ำรายการซื้อ/ขายของสินทรัพย์ USD หนึ่งตัวด้วยต้นทุน 2 ถังเดิม (R20.3) และจำส่วนค่าธรรมเนียมที่ติดในต้นทุนเพิ่ม (R24)
 * ผลต้นทุน 2 ถังและกำไรขายเท่าเดิมทุกสตางค์ (เรียก applyBuyFx/applySellFx ตัวเดิม) · ส่วนค่าธรรมเนียมเป็นการแยกส่วนย่อยของต้นทุนเท่านั้น
 */
export function replayWithFees(trades: readonly TradeFx[]): FeeReplay {
  const ordered = [...trades].sort((a, b) => cmp(a.date, b.date) || cmp(a.createdAt, b.createdAt) || cmp(a.id, b.id));
  let pos = emptyPositionFx();
  let heldFeeUsd = 0;
  let heldFeeThb = 0;
  const out: FeeReplay = {
    position: pos, heldFeeUsd: 0, heldFeeThb: 0, buyFeesUsd: 0, buyFeesThb: 0, sellFeesUsd: 0, sellFeesThb: 0, investedUsd: 0, investedThb: 0,
    netProceedsUsd: 0, realizedGainThb: 0, sells: [], buys: [],
  };
  for (const t of ordered) {
    if (t.kind === 'buy') {
      pos = applyBuyFx(pos, t);
      const outlayUsd = safeAdd(t.amount, t.fee);
      const outlayThb = convertMinor(outlayUsd, t.fxRateMicro);
      // ส่วนค่าธรรมเนียมที่ติดในต้นทุนบาท (ไว้ตัดตามสัดส่วนเมื่อขาย) ใช้ผลต่างเพื่อให้ต้นทุน 2 ถังตรงเดิม (R20.3) · ไม่ใช่ตัวเลขแหล่ง (6)
      const feeInCostThb = safeSub(outlayThb, convertMinor(t.amount, t.fxRateMicro));
      heldFeeUsd = safeAdd(heldFeeUsd, t.fee);
      heldFeeThb = safeAdd(heldFeeThb, feeInCostThb);
      out.buyFeesUsd = safeAdd(out.buyFeesUsd, t.fee);
      out.buyFeesThb = safeAdd(out.buyFeesThb, convertMinor(t.fee, t.fxRateMicro)); // แหล่ง (6): แปลงค่าธรรมเนียมของรายการนี้เอง
      out.investedUsd = safeAdd(out.investedUsd, outlayUsd);
      out.investedThb = safeAdd(out.investedThb, outlayThb);
      out.buys.push({ id: t.id, date: t.date, outlayUsd, outlayThb });
    } else {
      const held = pos.units;
      const r = applySellFx(pos, t);
      const full = t.units === held;
      const feeOutUsd = full ? heldFeeUsd : Math.min(toSafeSatang(roundHalfUpBig(BigInt(heldFeeUsd) * t.units, held)), heldFeeUsd);
      const feeOutThb = full ? heldFeeThb : Math.min(toSafeSatang(roundHalfUpBig(BigInt(heldFeeThb) * t.units, held)), heldFeeThb);
      heldFeeUsd = safeSub(heldFeeUsd, feeOutUsd);
      heldFeeThb = safeSub(heldFeeThb, feeOutThb);
      pos = r.position;
      const principalOutUsd = safeSub(r.costOutUsd, feeOutUsd);
      const sellFeeThb = convertMinor(t.fee, t.fxRateMicro); // แหล่ง (6): แปลงค่าธรรมเนียมขายของรายการนี้เอง (ไม่ใช้ผลต่างของสองก้อน)
      out.sellFeesUsd = safeAdd(out.sellFeesUsd, t.fee);
      out.sellFeesThb = safeAdd(out.sellFeesThb, sellFeeThb);
      out.netProceedsUsd = safeAdd(out.netProceedsUsd, r.netUsd);
      out.realizedGainThb = safeAdd(out.realizedGainThb, r.gainThb);
      out.sells.push({
        id: t.id, date: t.date, fxRateMicro: t.fxRateMicro, grossUsd: r.grossUsd, netUsd: r.netUsd, principalOutUsd, proceedsThb: r.proceedsThb,
        costOutThb: r.costOutThb, priceGainThb: convertSigned(safeSub(r.grossUsd, principalOutUsd), t.fxRateMicro), sellFeeThb, feeUsd: t.fee,
      });
    }
  }
  out.position = pos;
  out.heldFeeUsd = heldFeeUsd;
  out.heldFeeThb = heldFeeThb;
  return out;
}

// ───────────────────────── ข้อมูลของพอร์ต USD ─────────────────────────

interface UsdAssetData {
  asset: Asset;
  trades: TradeRecord[];
}

function usdAssets(data: InvestmentData, asOf: string): UsdAssetData[] {
  return data.assets
    .filter((a) => assetCurrency(a) === 'USD')
    .map((asset) => ({ asset, trades: data.trades.filter((t) => t.assetId === asset.id && t.date <= asOf && t.fxRateMicro !== undefined) }));
}

/** รายการ USD ที่ไม่มีเรต ณ asOf (ซื้อ/ขาย/ปันผล) · ไม่นับเป็น 0 ไม่เดาเรต (R26) */
export function usdMissingRate(data: InvestmentData, asOf: string): MissingRateTrade[] {
  const ids = new Set(data.assets.filter((a) => assetCurrency(a) === 'USD').map((a) => a.id));
  return splitTradesByRate(data.trades.filter((t) => ids.has(t.assetId) && t.date <= asOf)).missingRate;
}

function latestPriceMicro(data: InvestmentData, assetId: string, asOf: string): number | null {
  let best: { date: string; priceMicro: number } | null = null;
  for (const p of data.prices) if (p.assetId === assetId && p.date <= asOf && (best === null || p.date > best.date)) best = p;
  return best ? best.priceMicro : null;
}

interface DividendRow {
  date: string;
  grossUsd: number;
  whtUsd: number;
  grossThb: number;
  whtThb: number;
}

function dividendsOf(trades: readonly TradeRecord[]): DividendRow[] {
  const out: DividendRow[] = [];
  for (const t of trades) {
    if (t.kind !== 'dividend' || t.fxRateMicro === undefined) continue;
    const gross = t.amount ?? 0;
    out.push({ date: t.date, grossUsd: gross, whtUsd: t.withholding, grossThb: convertMinor(gross, t.fxRateMicro), whtThb: convertMinor(t.withholding, t.fxRateMicro) });
  }
  return out;
}

// ───────────────────────── R24 กำไรรวม 6 แหล่ง ─────────────────────────

export interface ProfitSourcesThb {
  /** (1) ส่วนต่างราคาที่ยังไม่ขาย */
  priceUnrealized: number;
  /** (2) ขายแล้ว */
  priceRealized: number;
  /** (3) ออปชั่น (0 ในเฟส A) */
  options: number;
  /** (4) ปันผลก่อนภาษี */
  dividendGross: number;
  /** (5) ค่าเงิน = ส่วนที่เหลือ */
  fx: number;
  /** (6) ค่าธรรมเนียมและภาษีที่ถูกหัก (ติดลบเสมอ) */
  feesAndTax: number;
  /** กำไรรวม P = รวม 6 แหล่งตรงเป๊ะ */
  total: number;
}

export interface ProfitSourcesUsd {
  priceUnrealized: number;
  priceRealized: number;
  options: number;
  dividendGross: number;
  feesAndTax: number;
  total: number;
}

export type MissingInput = { kind: 'price'; assetId: string } | { kind: 'fx' } | { kind: 'rate'; tradeIds: string[] };

export interface ProfitResult {
  /** false = มีหุ้นที่ยังถืออยู่แต่ไม่มีราคาหรือไม่มีอัตรา · มุมมองที่ต้องใช้ข้อมูลนั้นเป็น null */
  complete: boolean;
  missing: MissingInput[];
  /** มุมมองบาท (ต้องมีราคาและอัตราของหุ้นที่ถืออยู่) · null = ไม่ครบ */
  thb: ProfitSourcesThb | null;
  /** มุมมอง USD (ต้องมีราคาของหุ้นที่ถืออยู่ ไม่ต้องมีอัตรา) */
  usd: ProfitSourcesUsd | null;
  /** ส่วนประกอบเดิมของกำไรรวมบาท (R20.4): ยังไม่ขาย + ขายแล้ว + ปันผลสุทธิ · null เมื่อไม่ครบ */
  parts: { unrealizedThb: number; realizedThb: number; dividendNetThb: number } | null;
}

interface Holdings {
  valueUsd: number;
  valueThb: number | null;
  costThb: number;
  /** ต้นทุน USD ไม่รวมค่าธรรมเนียม ของที่ถืออยู่ */
  principalUsd: number;
}

/** รวมมูลค่าของที่ถืออยู่ ณ asOf · คืน null ในส่วนที่ไม่มีข้อมูล (และรายการที่ขาด) */
function valueHoldings(
  data: InvestmentData,
  held: { asset: Asset; replay: FeeReplay }[],
  asOf: string,
): { holdings: Holdings | null; thbOk: boolean; missing: MissingInput[] } {
  const missing: MissingInput[] = [];
  const fx = latestFxRate(data.fxRates ?? [], asOf);
  const holding = held.filter((h) => h.replay.position.units > 0n);
  let pricesOk = true;
  for (const h of holding) {
    if (latestPriceMicro(data, h.asset.id, asOf) === null) {
      missing.push({ kind: 'price', assetId: h.asset.id });
      pricesOk = false;
    }
  }
  if (holding.length > 0 && fx === null) missing.push({ kind: 'fx' });
  if (!pricesOk) return { holdings: null, thbOk: false, missing };
  let valueUsd = 0;
  let valueThb: number | null = 0;
  let costThb = 0;
  let principalUsd = 0;
  for (const h of holding) {
    const p = latestPriceMicro(data, h.asset.id, asOf)!;
    const v = valueInSatang(h.replay.position.units, p);
    valueUsd = safeAdd(valueUsd, v);
    if (fx !== null && valueThb !== null) valueThb = safeAdd(valueThb, convertMinor(v, fx.rateMicro));
    costThb = safeAdd(costThb, h.replay.position.costThb);
    principalUsd = safeAdd(principalUsd, safeSub(h.replay.position.costUsd, h.replay.heldFeeUsd));
  }
  if (fx === null && holding.length > 0) valueThb = null;
  return { holdings: { valueUsd, valueThb, costThb, principalUsd }, thbOk: valueThb !== null, missing };
}

/** กำไรรวมและ 6 แหล่งของพอร์ตหุ้นสหรัฐ ณ วัน asOf (R24) · ใช้เฉพาะรายการ/ราคา/อัตราที่มีวันที่ไม่เกิน asOf */
/**
 * strictRate: true = ถ้ามีรายการที่ไม่มีเรต ผลเป็น incomplete และไม่คืนตัวเลข (ใช้กับหน้าจอที่แสดงยอดรวม)
 * ไม่ใส่ = พฤติกรรมเดิม (reportSeries จัดการ needs-rate รายเดือนเอง ไม่แก้)
 */
export function computeProfitSources(data: InvestmentData, asOf: string, opts: { strictRate?: boolean } = {}): ProfitResult {
  const per = usdAssets(data, asOf).map(({ asset, trades }) => ({ asset, trades, replay: replayWithFees(toTradesFx(trades)) }));
  const { holdings, thbOk, missing } = valueHoldings(data, per, asOf);
  const fx = latestFxRate(data.fxRates ?? [], asOf);

  // ส่วนที่ไม่ขึ้นกับมูลค่าปัจจุบัน
  // มีรายการที่ไม่มีเรต: หน่วย/ต้นทุน/ปันผลขาด ยอดรวมจึงไม่ครบ ไม่แสดงตัวเลข ไม่นับเป็น 0 (R26)
  const noRate = usdMissingRate(data, asOf);
  if (opts.strictRate && noRate.length > 0) return { complete: false, missing: [...missing, { kind: 'rate', tradeIds: noRate.map((t) => t.id) }], thb: null, usd: null, parts: null };
  let priceRealizedThb = 0;
  let priceRealizedUsd = 0;
  let realizedThb = 0;
  let divGrossThb = 0;
  let divGrossUsd = 0;
  let whtThb = 0;
  let whtUsd = 0;
  let feesThb = 0;
  let feesUsd = 0;
  let investedUsd = 0;
  let netProceedsUsd = 0;
  for (const { trades, replay } of per) {
    for (const s of replay.sells) {
      priceRealizedThb = safeAdd(priceRealizedThb, s.priceGainThb);
      priceRealizedUsd = safeAdd(priceRealizedUsd, safeSub(s.grossUsd, s.principalOutUsd));
    }
    realizedThb = safeAdd(realizedThb, replay.realizedGainThb);
    for (const d of dividendsOf(trades)) {
      divGrossThb = safeAdd(divGrossThb, d.grossThb);
      divGrossUsd = safeAdd(divGrossUsd, d.grossUsd);
      whtThb = safeAdd(whtThb, d.whtThb);
      whtUsd = safeAdd(whtUsd, d.whtUsd);
    }
    feesThb = safeAdd(feesThb, safeAdd(replay.buyFeesThb, replay.sellFeesThb));
    feesUsd = safeAdd(feesUsd, safeAdd(replay.buyFeesUsd, replay.sellFeesUsd));
    investedUsd = safeAdd(investedUsd, replay.investedUsd);
    netProceedsUsd = safeAdd(netProceedsUsd, replay.netProceedsUsd);
  }
  const feesAndTaxThb = -safeAdd(feesThb, whtThb) || 0;
  const feesAndTaxUsd = -safeAdd(feesUsd, whtUsd) || 0;
  const divNetUsd = safeSub(divGrossUsd, whtUsd);
  const divNetThb = safeSub(divGrossThb, whtThb);

  let usd: ProfitSourcesUsd | null = null;
  if (holdings !== null) {
    const priceUnrealized = safeSub(holdings.valueUsd, holdings.principalUsd);
    const total = safeAdd(safeAdd(holdings.valueUsd, netProceedsUsd), safeSub(divNetUsd, investedUsd));
    usd = { priceUnrealized, priceRealized: priceRealizedUsd, options: 0, dividendGross: divGrossUsd, feesAndTax: feesAndTaxUsd, total };
  }

  let thb: ProfitSourcesThb | null = null;
  let parts: ProfitResult['parts'] = null;
  if (holdings !== null && thbOk) {
    const valueThb = holdings.valueThb ?? 0;
    const unrealizedThb = safeSub(valueThb, holdings.costThb);
    const priceUnrealized = fx === null ? 0 : convertSigned(safeSub(holdings.valueUsd, holdings.principalUsd), fx.rateMicro);
    const total = safeAdd(safeAdd(unrealizedThb, realizedThb), divNetThb);
    const fxPart = safeSub(total, safeAdd(safeAdd(safeAdd(priceUnrealized, priceRealizedThb), divGrossThb), feesAndTaxThb));
    thb = { priceUnrealized, priceRealized: priceRealizedThb, options: 0, dividendGross: divGrossThb, fx: fxPart || 0, feesAndTax: feesAndTaxThb, total };
    parts = { unrealizedThb, realizedThb, dividendNetThb: divNetThb };
  }
  return { complete: missing.length === 0, missing, thb, usd, parts };
}

// ───────────────────────── R25.1-R25.2 ปันผลต่อปีและ yield ─────────────────────────

export interface DividendMetrics {
  /** ช่วงที่นับ: หลังวันนี้ย้อน 12 เดือนปฏิทิน (ไม่รวมวันขอบล่าง) ถึงวันนี้ */
  fromExclusive: string;
  toInclusive: string;
  grossThb: number;
  netThb: number;
  grossUsd: number;
  netUsd: number;
  /** yield (bps) = ปันผลก่อนภาษี 12 เดือน ÷ มูลค่าตลาดปัจจุบัน · null = ไม่มีหุ้นที่ถืออยู่/ไม่มีราคาหรืออัตรา */
  yieldBps: number | null;
  /** yield on cost (bps) = ปันผลก่อนภาษี 12 เดือน ÷ ต้นทุนบาทของที่ถืออยู่ */
  yieldOnCostBps: number | null;
  /** true = มีรายการ USD ที่ไม่มีเรต (ปันผลที่ขาดไม่ถูกนับ และ yield ไม่คำนวณ) · ไม่นับเป็น 0 (R26) */
  incomplete: boolean;
  /** true = คำนวณปันผลไม่สำเร็จ (ตัวเลขไม่ใช่ 0 จริง) หน้าจอแสดง Couldn't load (R26) · ไม่ตั้ง = ปกติ */
  loadError?: boolean;
}

export function computeDividendMetrics(data: InvestmentData, asOf: string): DividendMetrics {
  const from = addMonthsClamped(asOf, -12);
  const per = usdAssets(data, asOf).map(({ asset, trades }) => ({ asset, trades, replay: replayWithFees(toTradesFx(trades)) }));
  let grossThb = 0;
  let netThb = 0;
  let grossUsd = 0;
  let netUsd = 0;
  for (const { trades } of per) {
    for (const d of dividendsOf(trades)) {
      if (d.date <= from || d.date > asOf) continue;
      grossThb = safeAdd(grossThb, d.grossThb);
      netThb = safeAdd(netThb, safeSub(d.grossThb, d.whtThb));
      grossUsd = safeAdd(grossUsd, d.grossUsd);
      netUsd = safeAdd(netUsd, safeSub(d.grossUsd, d.whtUsd));
    }
  }
  const { holdings, thbOk } = valueHoldings(data, per, asOf);
  const holding = per.some((p) => p.replay.position.units > 0n);
  let yieldBps: number | null = null;
  let yieldOnCostBps: number | null = null;
  const incomplete = usdMissingRate(data, asOf).length > 0;
  if (!incomplete && holding && holdings !== null && thbOk) {
    const value = holdings.valueThb ?? 0;
    if (value > 0) yieldBps = toSafeSatang(roundHalfUpBig(BigInt(grossThb) * 10_000n, BigInt(value)));
    if (holdings.costThb > 0) yieldOnCostBps = toSafeSatang(roundHalfUpBig(BigInt(grossThb) * 10_000n, BigInt(holdings.costThb)));
  }
  return { fromExclusive: from, toInclusive: asOf, grossThb, netThb, grossUsd, netUsd, yieldBps, yieldOnCostBps, incomplete };
}

// ───────────────────────── R25.3 IRR (XIRR ด้วยจำนวนเต็มล้วน) ─────────────────────────

export interface CashFlow {
  /** YYYY-MM-DD */
  date: string;
  /** สตางค์ (ติดลบ = เงินออกจากกระเป๋าไปลงทุน · บวก = เงินกลับมา) */
  amount: bigint;
}

export type IrrNa = 'few-flows' | 'no-sign' | 'short' | 'no-root' | 'missing';
export type IrrResult = { kind: 'ok'; bps: number } | { kind: 'na'; reason: IrrNa };

/** ช่วงน้อยกว่านี้ (วัน) ไม่แสดง IRR ต่อปี (R25.3) */
export const IRR_MIN_DAYS = 30;

const SCALE = 10n ** 24n;
const sign = (x: bigint): number => (x > 0n ? 1 : x < 0n ? -1 : 0);

/** (f / SCALE)^n แบบทศนิยมคงที่ (ตัดเศษทุกครั้ง · f > 0) */
function powFixed(f: bigint, n: number): bigint {
  let result = SCALE;
  let base = f;
  let e = n;
  while (e > 0) {
    if (e & 1) result = (result * base) / SCALE;
    base = (base * base) / SCALE;
    e = (e - (e % 2)) / 2;
  }
  return result;
}

/**
 * XIRR: หาอัตราต่อปี (bps) ที่ทำให้มูลค่ารวมของกระแสเงินเป็น 0 นับวันจริง/365 · BigInt ล้วน (แบ่งครึ่งบนอัตรารายวัน -2% ถึง +5%)
 * เงื่อนไขไม่คำนวณ: กระแสเงินน้อยกว่า 2 รายการ · ไม่มีทั้งเข้าและออก · ช่วงน้อยกว่า 30 วัน · ไม่มีคำตอบในช่วงค้นหา
 */
export function xirrBps(flows: readonly CashFlow[], spanEnd?: string): IrrResult {
  const live = flows.filter((f) => f.amount !== 0n);
  if (live.length < 2) return { kind: 'na', reason: 'few-flows' };
  if (!live.some((f) => f.amount < 0n) || !live.some((f) => f.amount > 0n)) return { kind: 'na', reason: 'no-sign' };
  const sorted = [...live].sort((a, b) => cmp(a.date, b.date));
  const first = sorted[0]!.date;
  // R25.3: ช่วงนับจากรายการแรกถึงวันนี้ (spanEnd) · ถ้าไม่ระบุ ใช้กระแสสุดท้าย
  const lastDate = sorted[sorted.length - 1]!.date;
  const span = daysBetweenIso(first, spanEnd !== undefined && spanEnd > lastDate ? spanEnd : lastDate);
  if (span < IRR_MIN_DAYS) return { kind: 'na', reason: 'short' };
  const offsets = sorted.map((f) => ({ t: daysBetweenIso(first, f.date), amount: f.amount }));
  const T = offsets[offsets.length - 1]!.t;
  const fv = (f: bigint): bigint => {
    let sum = 0n;
    for (const o of offsets) sum += o.amount * powFixed(f, T - o.t);
    return sum;
  };
  let lo = SCALE - SCALE / 50n; // −2% ต่อวัน
  let hi = SCALE + SCALE / 20n; // +5% ต่อวัน
  const sLo = sign(fv(lo));
  const sHi = sign(fv(hi));
  if (sLo === 0) return { kind: 'ok', bps: annualBps(lo) };
  if (sHi === 0) return { kind: 'ok', bps: annualBps(hi) };
  if (sLo === sHi) return { kind: 'na', reason: 'no-root' };
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    const s = sign(fv(mid));
    if (s === 0) {
      lo = hi = mid;
      break;
    }
    if (s === sLo) lo = mid;
    else hi = mid;
  }
  return { kind: 'ok', bps: annualBps((lo + hi) / 2n) };
}

function annualBps(dailyFactor: bigint): number {
  const annual = powFixed(dailyFactor, 365);
  return toSafeSatang(roundHalfUpBig((annual - SCALE) * 10_000n, SCALE));
}

/** IRR ของพอร์ตหุ้นสหรัฐ (R25.3): กระแสเงินบาทตามรายการจริง + มูลค่าตลาดที่ถืออยู่ ณ วันนี้เป็นกระแสสุดท้าย */
export function computeIrr(data: InvestmentData, asOf: string): IrrResult {
  const per = usdAssets(data, asOf).map(({ asset, trades }) => ({ asset, trades, replay: replayWithFees(toTradesFx(trades)) }));
  if (usdMissingRate(data, asOf).length > 0) return { kind: 'na', reason: 'missing' };
  const { holdings, thbOk } = valueHoldings(data, per, asOf);
  const holding = per.some((p) => p.replay.position.units > 0n);
  if (holding && (holdings === null || !thbOk)) return { kind: 'na', reason: 'missing' };
  const flows: CashFlow[] = [];
  for (const { trades, replay } of per) {
    for (const b of replay.buys) flows.push({ date: b.date, amount: -BigInt(b.outlayThb) });
    for (const s of replay.sells) flows.push({ date: s.date, amount: BigInt(s.proceedsThb) });
    for (const d of dividendsOf(trades)) flows.push({ date: d.date, amount: BigInt(d.grossThb - d.whtThb) });
  }
  if (holding && holdings && holdings.valueThb !== null && holdings.valueThb > 0) flows.push({ date: asOf, amount: BigInt(holdings.valueThb) });
  return xirrBps(flows, asOf);
}

// ───────────────────────── R25.4 ผลตอบแทนรายเดือน (Modified Dietz) ─────────────────────────

export interface MonthReturn {
  /** YYYY-MM */
  month: string;
  /** ผลตอบแทนเดือนนั้น (bps · ติดลบได้) · null = คำนวณไม่ได้ */
  bps: number | null;
  /** เหตุผลเมื่อ null */
  na?: 'missing' | 'zero-base';
}

export interface MonthlyReturns {
  /** เรียงตามเดือน เริ่มเดือนที่มีรายการแรก ถึงเดือนของ asOf (เดือนที่ไม่มีหุ้นและไม่มีรายการถูกข้าม) */
  months: MonthReturn[];
  /** ผลตอบแทนทั้งปี (bps) · null = มีเดือนที่คำนวณไม่ได้ */
  years: Record<string, number | null>;
}

interface ValueAt {
  value: bigint;
}

function unitsAt(per: { replay: (date: string) => FeeReplay }[], date: string): bigint {
  let u = 0n;
  for (const p of per) u += p.replay(date).position.units;
  return u;
}

export function computeMonthlyReturns(data: InvestmentData, asOf: string): MonthlyReturns {
  const assets = usdAssets(data, asOf);
  const allTrades = assets.flatMap((a) => a.trades);
  // รายการที่ไม่มีเรตไม่ถูกเล่นซ้ำ: เดือนที่ถูกกระทบ = missing (ไม่นับเป็น 0 · R26) ซื้อ/ขายกระทบทุกเดือนหลังจากนั้น ปันผลกระทบเฉพาะเดือนของมัน
  const noRate = usdMissingRate(data, asOf);
  const dated = [...allTrades.map((t) => t.date), ...noRate.map((t) => t.date)];
  if (dated.length === 0) return { months: [], years: {} };
  const firstDate = dated.reduce((m, d) => (d < m ? d : m), dated[0]!);

  const replayAt = (a: UsdAssetData, date: string): FeeReplay => replayWithFees(toTradesFx(a.trades.filter((t) => t.date <= date)));
  const per = assets.map((a) => ({ a, replay: (date: string) => replayAt(a, date) }));

  /** มูลค่าพอร์ต (สตางค์) ณ วัน · null = หุ้นที่ถืออยู่ขาดราคาหรืออัตรา */
  const valueOn = (date: string): ValueAt | null => {
    let sum = 0n;
    for (const p of per) {
      const units = p.replay(date).position.units;
      if (units === 0n) continue;
      const price = latestPriceMicro(data, p.a.asset.id, date);
      const fx = latestFxRate(data.fxRates ?? [], date);
      if (price === null || fx === null) return null;
      sum += BigInt(convertMinor(valueInSatang(units, price), fx.rateMicro));
    }
    return { value: sum };
  };

  const months: MonthReturn[] = [];
  const activeBps = new Map<string, (number | null)[]>();
  let y = Number(firstDate.slice(0, 4));
  let m = Number(firstDate.slice(5, 7));
  const lastY = Number(asOf.slice(0, 4));
  const lastM = Number(asOf.slice(5, 7));
  while (y < lastY || (y === lastY && m <= lastM)) {
    const monthKey = `${pad(y, 4)}-${pad(m)}`;
    const monthStart = isoOf(y, m, 1);
    const prevEnd = m === 1 ? isoOf(y - 1, 12, 31) : isoOf(y, m - 1, daysInMonthOf(y, m - 1));
    const full = daysInMonthOf(y, m);
    const end = y === lastY && m === lastM ? asOf : isoOf(y, m, full);
    const L = BigInt(Number(end.slice(8, 10)));
    const inMonth = (d: string): boolean => d >= monthStart && d <= end;

    const startUnits = unitsAt(per, prevEnd);
    const endUnits = unitsAt(per, end);
    const monthTrades = allTrades.filter((t) => inMonth(t.date));
    const noRateHit = noRate.some((t) => (t.kind === 'dividend' ? inMonth(t.date) : t.date <= end));
    const active = startUnits > 0n || endUnits > 0n || monthTrades.length > 0 || noRate.some((t) => inMonth(t.date));
    if (active) {
      const v0 = noRateHit ? null : valueOn(prevEnd);
      const v1 = noRateHit ? null : valueOn(end);
      let entry: MonthReturn;
      if (v0 === null || v1 === null) entry = { month: monthKey, bps: null, na: 'missing' };
      else {
        let flowSum = 0n;
        let weighted = 0n;
        let div = 0n;
        for (const p of per) {
          const r = replayAt(p.a, end);
          for (const b of r.buys) if (inMonth(b.date)) {
            flowSum += BigInt(b.outlayThb);
            weighted += BigInt(b.outlayThb) * (L - BigInt(Number(b.date.slice(8, 10))));
          }
          for (const s of r.sells) if (inMonth(s.date)) {
            flowSum -= BigInt(s.proceedsThb);
            weighted -= BigInt(s.proceedsThb) * (L - BigInt(Number(s.date.slice(8, 10))));
          }
          for (const d of dividendsOf(p.a.trades)) if (inMonth(d.date)) div += BigInt(d.grossThb - d.whtThb);
        }
        const numerator = v1.value - v0.value - flowSum + div;
        const denomScaled = v0.value * L + weighted;
        if (denomScaled <= 0n) entry = { month: monthKey, bps: null, na: 'zero-base' };
        else entry = { month: monthKey, bps: toSafeSatang(roundHalfUpBig(numerator * 10_000n * L, denomScaled)) };
      }
      months.push(entry);
      const yk = monthKey.slice(0, 4);
      const list = activeBps.get(yk) ?? [];
      list.push(entry.bps);
      activeBps.set(yk, list);
    }
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }

  const years: Record<string, number | null> = {};
  for (const [yk, list] of activeBps) {
    if (list.some((b) => b === null)) {
      years[yk] = null;
      continue;
    }
    let num = 1n;
    for (const b of list as number[]) num *= BigInt(10_000 + b);
    years[yk] = toSafeSatang(roundHalfUpBig(num, 10_000n ** BigInt(list.length - 1))) - 10_000;
  }
  return { months, years };
}

// ───────────────────────── R24.5 กำไรรวมเป็น % ─────────────────────────

/**
 * กำไรรวมเป็น bps = กำไรรวม ÷ ต้นทุนของที่ยังถืออยู่ (R24.5) · หน่วยของทั้งสองค่าต้องเป็นสกุลเดียวกัน (สตางค์/สตางค์ หรือ เซนต์/เซนต์)
 * null = ไม่คำนวณ: กำไรรวมไม่มี (ข้อมูลไม่ครบ) หรือต้นทุนที่ถืออยู่เป็น 0 (เช่น ขายหมดแล้ว) · ปัดครึ่งออกจากศูนย์ ด้วย BigInt
 */
export function profitPercentBps(total: number | null, heldCost: number): number | null {
  if (total === null || heldCost <= 0) return null;
  return toSafeSatang(roundHalfUpBig(BigInt(total) * 10_000n, BigInt(heldCost)));
}
