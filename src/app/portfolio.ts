/**
 * สรุปพอร์ตลงทุน (P3 · กฎ R17) จากรายการลงทุน + ราคาล่าสุดที่ผู้ใช้กรอกเอง · ฟังก์ชันล้วน ไม่ดึงราคาจากเว็บ
 *   - ตำแหน่ง (หน่วย, ต้นทุนรวม) คำนวณจากการเล่นซ้ำรายการเสมอ · มูลค่า = หน่วย × ราคาล่าสุด ปัดครั้งเดียว
 *   - ยังไม่มีราคา = ไม่มีมูลค่า (ห้ามใช้ต้นทุนแทนเงียบๆ) · ราคาเก่ากว่า 7 วันติดป้ายเตือน
 *   - ข้อมูลที่ไม่สอดคล้องของสินทรัพย์หนึ่งไม่ทำให้ทั้งหน้าพัง (แถวนั้นแจ้งข้อผิดพลาด)
 *   - กำไร/ขาดทุนที่ยังไม่ขายเป็นค่าแสดงผล ไม่ลงสมุดบัญชี
 */

import { daysBetween } from '../domain/bills/calendar';
import { hasCode, type ErrorParams } from '../domain/errors/coded';
import { averageCostMicro, type Position } from '../domain/invest/costBasis';
import { marketSummary, type MarketSummary } from '../domain/invest/dca';
import { investMsg } from '../domain/invest/errorCodes';
import { replayRecords } from '../domain/invest/rules';
import type { Asset, InvestmentData } from '../domain/invest/types';
import { safeAdd } from '../domain/money/safe';

/** ราคาเก่ากว่านี้ (วัน) ติดป้ายเตือน */
export const STALE_PRICE_DAYS = 7;

export interface AssetRowView {
  asset: Asset;
  position: Position;
  /** ราคาเฉลี่ยต่อหน่วย (micro-baht) ค่าแสดงผล · ไม่มีหน่วย/คำนวณไม่ได้ = null */
  avgCostMicro: number | null;
  latestPrice: { priceMicro: number; date: string } | null;
  priceStale: boolean;
  market: MarketSummary | null;
  /** กำไร/ขาดทุนที่ขายแล้ว (สตางค์) */
  realizedGain: number;
  /** ปันผลเงินสดสุทธิหลังหักภาษี (สตางค์) */
  dividendsNet: number;
  error?: string;
  /** รหัส error + พารามิเตอร์ (ถ้ามี) ให้หน้า /invest แสดงข้อความอังกฤษ · message ไทยเดิมอยู่ใน error */
  errorCode?: string;
  errorParams?: ErrorParams;
}

export interface PortfolioTotals {
  /** ต้นทุนรวมของที่ยังถืออยู่ (สตางค์) */
  cost: number;
  /** มูลค่าตามราคาที่กรอก (เฉพาะสินทรัพย์ที่มีราคา) */
  value: number;
  /** กำไร/ขาดทุนที่ยังไม่ขายของสินทรัพย์ที่มีราคา */
  unrealized: number;
  /** จำนวนสินทรัพย์ที่ยังถืออยู่แต่ยังไม่มีราคา (มูลค่ารวมจึงไม่ครบ) */
  unpriced: number;
  realized: number;
  dividends: number;
}

export interface Portfolio {
  rows: AssetRowView[];
  totals: PortfolioTotals;
}

const byName = (a: Asset, b: Asset): number =>
  (a.archived === true ? 1 : 0) - (b.archived === true ? 1 : 0) ||
  String(a.name).localeCompare(String(b.name), 'th') ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function buildPortfolio(data: InvestmentData, today: string): Portfolio {
  const rows: AssetRowView[] = [];
  const totals: PortfolioTotals = { cost: 0, value: 0, unrealized: 0, unpriced: 0, realized: 0, dividends: 0 };

  for (const asset of [...data.assets].sort(byName)) {
    const trades = data.trades.filter((t) => t.assetId === asset.id);
    // ราคาที่ลงวันที่ในอนาคต (พิมพ์ปีผิด) ไม่ถูกใช้เป็นราคาล่าสุด
    const prices = data.prices.filter((p) => p.assetId === asset.id && p.date <= today).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const last = prices.at(-1);
    const latestPrice = last ? { priceMicro: last.priceMicro, date: last.date } : null;
    const priceStale = latestPrice !== null && daysBetween(latestPrice.date, today) > STALE_PRICE_DAYS;
    let row: AssetRowView;
    try {
      const dividendsNet = trades
        .filter((t) => t.kind === 'dividend')
        .reduce((sum, t) => safeAdd(sum, (t.amount as number) - t.withholding), 0);
      const next = { ...totals }; // รวมยอดในสำเนา: ถ้าแถวนี้ล้ม (เช่น ผลรวมล้นช่วง) ยอดรวมไม่ปนครึ่งๆ กลางๆ
      const replay = replayRecords(trades);
      const position = replay.position;
      let avg: number | null = null;
      try {
        avg = averageCostMicro(position);
      } catch {
        avg = null; // ต้นทุนเฉลี่ยต่อหน่วยล้นช่วงแสดงผล (หน่วยน้อยมาก) ไม่กระทบต้นทุนรวม
      }
      const market = position.units > 0n ? marketSummary(position, latestPrice?.priceMicro ?? null) : null;
      row = { asset, position, avgCostMicro: avg, latestPrice, priceStale, market, realizedGain: replay.realizedGain, dividendsNet };
      next.cost = safeAdd(next.cost, position.cost);
      next.realized = safeAdd(next.realized, replay.realizedGain);
      next.dividends = safeAdd(next.dividends, dividendsNet);
      if (market) {
        next.value = safeAdd(next.value, market.value);
        next.unrealized = safeAdd(next.unrealized, market.unrealized);
      } else if (position.units > 0n) {
        next.unpriced += 1;
      }
      Object.assign(totals, next);
    } catch (e) {
      row = {
        asset,
        position: { units: 0n, cost: 0 },
        avgCostMicro: null,
        latestPrice,
        priceStale,
        market: null,
        realizedGain: 0,
        dividendsNet: 0,
        error: e instanceof Error ? e.message : investMsg('portfolio.inconsistent'),
        ...(hasCode(e) ? { errorCode: e.code, errorParams: e.params } : e instanceof Error ? {} : { errorCode: 'portfolio.inconsistent' }),
      };
    }
    rows.push(row);
  }
  return { rows, totals };
}
