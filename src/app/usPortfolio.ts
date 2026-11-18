/**
 * มุมมองพอร์ตหุ้นสหรัฐ (A3-2 · R20.4, R20.7, R23) · ฟังก์ชันล้วน ไม่แตะ DOM/เครือข่าย · ไม่มีสูตรเงินใหม่ (เรียกฟังก์ชันของโดเมนทั้งหมด)
 *   มูลค่าตลาด USD = หน่วย x ราคาล่าสุดที่ผู้ใช้กรอก · มูลค่าบาท = แปลงที่ "อัตราล่าสุดที่กรอก" (R20.7)
 *   กำไรยังไม่ขาย (บาท) = มูลค่าบาทตอนนี้ − ต้นทุนบาท (ถังบาทของ R20.3) · แยก "จากราคาหุ้น" = กำไร USD แปลงที่อัตราตอนนี้ · "จากค่าเงิน" = ส่วนที่เหลือ
 * ไม่มีราคา/อัตรา = ไม่เดาและไม่ใช้ต้นทุนแทน (R20.7): ค่าที่ต้องใช้เป็น null และตัวรวมมี complete = false
 */

import { daysBetween } from '../domain/bills/calendar';
import { hasCode, type ErrorParams } from '../domain/errors/coded';
import { allocateBps, groupSmallShares, type AllocationShare } from '../domain/invest/allocation';
import { replayTradesFx } from '../domain/invest/costBasisFx';
import { convertMinor, dividendInThb } from '../domain/invest/fx';
import { WEALTH_STALE_DAYS, latestFxRate } from '../domain/invest/portfolioMoney';
import { splitTradesByRate, toTradesFx, type MissingRateTrade } from '../domain/invest/tradesFx';
import { assetCurrency, type FxDirection, type InvestmentData, type TradeRecord } from '../domain/invest/types';
import { toSafeSatang, valueInSatang } from '../domain/invest/units';
import { usdCashBalances, type UsdCashBalance } from '../domain/invest/usdIntegrity';
import type { Account, Entry } from '../domain/ledger/types';
import { roundHalfUpBig } from '../domain/money/round';
import { safeAdd, safeSub } from '../domain/money/safe';
import { formMsg } from './formMessages';

export interface UsStockRow {
  assetId: string;
  name: string;
  ticker: string;
  exchange: string;
  units: bigint;
  /** ต้นทุนรวมของที่ยังถืออยู่ (เซนต์ USD รวมค่าธรรมเนียม) */
  costUsd: number;
  /** ต้นทุนรวมของที่ยังถืออยู่ (สตางค์ ที่อัตราวันซื้อของแต่ละรายการ) */
  costThb: number;
  /** ต้นทุนเฉลี่ยต่อหุ้น (micro-USD) · ไม่มีหุ้น = null */
  avgCostMicro: number | null;
  price: { priceMicro: number; date: string; days: number; stale: boolean } | null;
  valueUsd: number | null;
  valueThb: number | null;
  unrealizedThb: number | null;
  /** ส่วนของกำไรยังไม่ขายที่มาจากราคาหุ้น (สตางค์ · อาจติดลบ) */
  priceGainThb: number | null;
  /** ส่วนที่มาจากค่าเงิน = กำไรยังไม่ขาย − ส่วนราคา (ส่วนที่เหลือ ค่าแสดงผล) */
  fxGainThb: number | null;
  /** ปันผลสะสมสุทธิหลังหักภาษี (เซนต์ / สตางค์ที่อัตราวันรายการ) */
  dividendNetUsd: number;
  dividendNetThb: number;
  realizedGainThb: number;
  /** true = หุ้นนี้มีรายการ (ซื้อ/ขาย/ปันผล) ที่ไม่มีเรต → มูลค่า/กำไรไม่คำนวณ ปันผล/กำไรขายส่งเป็น 0 เพื่อไม่ให้ยอดบางส่วนเข้ายอดรวม (หน้าจอต้องแสดง Needs rate ตามธง)  แสดง "Needs rate" ไม่นับเป็น 0 (R26) */
  needsRate?: boolean;
  error?: string;
  /** รหัส + พารามิเตอร์ของ error (ให้ UI แปลเป็นภาษาอื่น · ไม่มี = error ต้นทางยังไม่มีรหัส) */
  errorCode?: string;
  errorParams?: ErrorParams;
}

export interface UsDividendRow {
  id: string;
  date: string;
  assetName: string;
  ticker: string;
  grossUsd: number;
  whtUsd: number;
  netUsd: number;
  netThb: number;
}

export interface UsExchangeRow {
  id: string;
  date: string;
  direction: FxDirection;
  thbSatang: number;
  usdCents: number;
  rateMicro: number;
  memo: string;
}

export interface UsPortfolioTotals {
  valueUsd: number;
  valueThb: number;
  costThb: number;
  unrealizedThb: number;
  priceGainThb: number;
  fxGainThb: number;
  dividendNetThb: number;
  realizedGainThb: number;
  /** false = มีหุ้นที่ยังถืออยู่แต่ไม่มีราคา หรือไม่มีอัตรา จึงรวมไม่ครบ (ต้องแสดงคู่กับตัวเลข) */
  complete: boolean;
}

export interface UsPortfolio {
  /** มีข้อมูล USD ใดๆ (หุ้นสหรัฐ บัญชีเงินสด USD หรือการแลกเงิน) · ไม่มี = หน้าจอแสดงสถานะเริ่มต้น */
  hasUsd: boolean;
  rows: UsStockRow[];
  dividendNetUsdTotal: number;
  /** รายการซื้อ/ขาย/ปันผลของหุ้น USD ที่ไม่มีเรต (ไม่ถูกนับ ไม่เป็น 0) · ไม่ว่าง = totals.complete เป็น false (R26) */
  missingRate: MissingRateTrade[];
  /** ปันผลล่าสุด (ใหม่ก่อน ไม่เกิน 20 แถว) */
  dividends: UsDividendRow[];
  /** ประวัติแลกเงิน (ใหม่ก่อน) */
  exchanges: UsExchangeRow[];
  fx: { rateMicro: number; date: string; days: number; stale: boolean } | null;
  totals: UsPortfolioTotals;
  cash: UsdCashBalance[];
  cashUsd: number;
  negativeCash: UsdCashBalance[];
  /** สัดส่วนมูลค่าบาทตามหุ้น (bps · รวมเป็น 10,000 เมื่อมีมูลค่า · ท้ายสุดรวมก้อน "อื่นๆ" ถ้ามีเกิน 6) */
  allocation: AllocationShare[];
}

const MAX_DIVIDEND_ROWS = 20;
const cmpDesc = (a: string, b: string): number => (a < b ? 1 : a > b ? -1 : 0);

/** ต้นทุนเฉลี่ยต่อหุ้น micro-USD = เซนต์ x 10^12 / หน่วย (หน่วย x 10^8 · เซนต์ x 10^4 = micro-USD) ปัดครึ่งขึ้น */
function avgCostMicroOf(costUsd: number, units: bigint): number | null {
  if (units <= 0n || costUsd <= 0) return null;
  try {
    return toSafeSatang(roundHalfUpBig(BigInt(costUsd) * 1_000_000_000_000n, units));
  } catch {
    return null;
  }
}

export function buildUsPortfolio(accounts: readonly Account[], entries: readonly Entry[], data: InvestmentData, today: string): UsPortfolio {
  const usdAssets = data.assets.filter((a) => assetCurrency(a) === 'USD');
  const fxRaw = latestFxRate(data.fxRates ?? [], today);
  const fx = fxRaw ? (() => { const days = daysBetween(fxRaw.date, today); return { ...fxRaw, days, stale: days > WEALTH_STALE_DAYS }; })() : null;

  const rows: UsStockRow[] = [];
  const dividends: UsDividendRow[] = [];
  const missingRate: MissingRateTrade[] = [];
  let complete = true;
  const totals = { valueUsd: 0, valueThb: 0, costThb: 0, unrealizedThb: 0, priceGainThb: 0, fxGainThb: 0, dividendNetThb: 0, realizedGainThb: 0 };
  let dividendNetUsdTotal = 0;

  for (const asset of usdAssets) {
    const own: TradeRecord[] = data.trades.filter((t) => t.assetId === asset.id && t.date <= today);
    const assetMissing = splitTradesByRate(own).missingRate;
    missingRate.push(...assetMissing);
    if (assetMissing.length > 0) complete = false;
    const base = { assetId: asset.id, name: asset.name, ticker: asset.ticker ?? '', exchange: asset.exchange ?? '' };
    let divUsd = 0;
    let divThb = 0;
    for (const t of own) {
      if (t.kind !== 'dividend' || t.fxRateMicro === undefined) continue;
      const gross = t.amount ?? 0;
      const wht = t.withholding;
      const thb = dividendInThb(gross, wht, t.fxRateMicro);
      divUsd = safeAdd(divUsd, gross - wht);
      divThb = safeAdd(divThb, thb.netThb);
      dividends.push({ id: t.id, date: t.date, assetName: asset.name, ticker: base.ticker, grossUsd: gross, whtUsd: wht, netUsd: gross - wht, netThb: thb.netThb });
    }
    let replay;
    try {
      replay = replayTradesFx(toTradesFx(own));
    } catch (e) {
      rows.push({
        ...base, units: 0n, costUsd: 0, costThb: 0, avgCostMicro: null, price: null, valueUsd: null, valueThb: null, unrealizedThb: null, priceGainThb: null, fxGainThb: null,
        dividendNetUsd: assetMissing.length > 0 ? 0 : divUsd, dividendNetThb: assetMissing.length > 0 ? 0 : divThb, realizedGainThb: 0, ...(assetMissing.length > 0 ? { needsRate: true } : {}), error: e instanceof Error ? e.message : formMsg('usp.calcFailed'),
        ...(hasCode(e) ? { errorCode: e.code, errorParams: e.params } : e instanceof Error ? {} : { errorCode: 'usp.calcFailed', errorParams: {} }),
      });
      complete = false;
      continue;
    }
    const pos = replay.position;
    let latest: { priceMicro: number; date: string } | null = null;
    for (const p of data.prices) if (p.assetId === asset.id && p.date <= today && (latest === null || p.date > latest.date)) latest = { priceMicro: p.priceMicro, date: p.date };
    const price = latest ? (() => { const days = daysBetween(latest.date, today); return { ...latest, days, stale: days > WEALTH_STALE_DAYS }; })() : null;

    let valueUsd: number | null = null;
    let valueThb: number | null = null;
    let unrealized: number | null = null;
    let priceGain: number | null = null;
    let fxGain: number | null = null;
    let rowError: string | undefined;
    if (pos.units > 0n) {
      if (price === null || fx === null) complete = false;
      try {
        if (price !== null) {
          valueUsd = valueInSatang(pos.units, price.priceMicro);
          if (fx !== null) {
            valueThb = convertMinor(valueUsd, fx.rateMicro);
            unrealized = safeSub(valueThb, pos.costThb);
            const gainUsd = safeSub(valueUsd, pos.costUsd);
            priceGain = gainUsd < 0 ? -convertMinor(-gainUsd, fx.rateMicro) : convertMinor(gainUsd, fx.rateMicro);
            priceGain = priceGain || 0; // กัน -0
            fxGain = safeSub(unrealized, priceGain) || 0;
          }
        }
      } catch (e) {
        if (!(e instanceof RangeError)) throw e;
        // ตัวเลขใหญ่เกินช่วงปลอดภัย: แถวนี้ไม่แสดงมูลค่า/กำไร (ไม่ทำให้ทั้งหน้าล้ม) และรวมไม่ครบ
        valueUsd = valueThb = unrealized = priceGain = fxGain = null;
        rowError = formMsg('usp.valueTooLarge');
        complete = false;
      }
    }
    if (assetMissing.length > 0) {
      // ขาดเรต: หน่วย/ต้นทุนที่เล่นซ้ำได้ไม่ครบ → ไม่แสดงมูลค่า/กำไร และไม่รวมเข้ายอดรวม (R26 ห้ามเดา ห้ามนับเป็น 0)
      rows.push({
        ...base, units: pos.units, costUsd: pos.costUsd, costThb: pos.costThb, avgCostMicro: null, price, valueUsd: null, valueThb: null, unrealizedThb: null, priceGainThb: null,
        fxGainThb: null, dividendNetUsd: 0, dividendNetThb: 0, realizedGainThb: 0, needsRate: true,
      });
      continue;
    }
    rows.push({
      ...base, units: pos.units, costUsd: pos.costUsd, costThb: pos.costThb, avgCostMicro: avgCostMicroOf(pos.costUsd, pos.units), price,
      valueUsd, valueThb, unrealizedThb: unrealized, priceGainThb: priceGain, fxGainThb: fxGain,
      dividendNetUsd: divUsd, dividendNetThb: divThb, realizedGainThb: replay.realizedGainThb, ...(rowError ? { error: rowError, errorCode: 'usp.valueTooLarge', errorParams: {} } : {}),
    });
    totals.costThb = safeAdd(totals.costThb, pos.costThb);
    totals.dividendNetThb = safeAdd(totals.dividendNetThb, divThb);
    dividendNetUsdTotal = safeAdd(dividendNetUsdTotal, divUsd);
    totals.realizedGainThb = safeAdd(totals.realizedGainThb, replay.realizedGainThb);
    if (valueUsd !== null) totals.valueUsd = safeAdd(totals.valueUsd, valueUsd);
    if (valueThb !== null) totals.valueThb = safeAdd(totals.valueThb, valueThb);
    if (unrealized !== null) totals.unrealizedThb = safeAdd(totals.unrealizedThb, unrealized);
    if (priceGain !== null) totals.priceGainThb = safeAdd(totals.priceGainThb, priceGain);
    if (fxGain !== null) totals.fxGainThb = safeAdd(totals.fxGainThb, fxGain);
  }

  dividends.sort((a, b) => cmpDesc(a.date, b.date) || cmpDesc(a.id, b.id));
  const exchanges: UsExchangeRow[] = [...(data.fxExchanges ?? [])]
    .filter((x) => x.date <= today)
    .sort((a, b) => cmpDesc(a.date, b.date) || cmpDesc(a.createdAt, b.createdAt) || cmpDesc(a.id, b.id))
    .map((x) => ({ id: x.id, date: x.date, direction: x.direction, thbSatang: x.thbSatang, usdCents: x.usdCents, rateMicro: x.rateMicro, memo: x.memo }));

  const upTo = entries.filter((e) => e.date <= today);
  const cash = usdCashBalances(accounts, upTo, data);
  const cashUsd = cash.reduce((n, c) => safeAdd(n, c.cents), 0);

  const shares = allocateBps(rows.filter((r) => r.valueThb !== null && r.valueThb > 0).map((r) => ({ key: r.assetId, weight: r.valueThb! })));
  const allocation = groupSmallShares(shares, 6, 'other');

  return {
    hasUsd: usdAssets.length > 0 || cash.length > 0 || exchanges.length > 0,
    rows,
    /** ปันผลสุทธิรวม USD (เซนต์) ข้ามแถว needsRate เหมือน totals.dividendNetThb */
    dividendNetUsdTotal,
    missingRate,
    dividends: dividends.slice(0, MAX_DIVIDEND_ROWS),
    exchanges,
    fx,
    totals: { ...totals, complete },
    cash,
    cashUsd,
    negativeCash: cash.filter((c) => c.cents < 0),
    allocation,
  };
}
