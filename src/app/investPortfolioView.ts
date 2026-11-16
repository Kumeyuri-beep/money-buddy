/**
 * ตัวช่วยของการ์ด Portfolio ในแดชบอร์ดโหมด /invest (R17, R20, R24) · ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล
 * ไม่มีสูตรเงินใหม่: มูลค่า/ต้นทุนมาจาก buildUsPortfolio · สัดส่วนจาก allocateBps (แจกเศษรวม 10,000 พอดี) · % กำไรใช้ profitPercentBps (ปัดครึ่งออกจากศูนย์ BigInt)
 * ที่เพิ่มเองมีแค่ "กำไรของแต่ละตัว = มูลค่า − ต้นทุนที่ยังถืออยู่" (ลบจำนวนเต็มปลอดภัย) และการเลือก/เรียงข้อมูลแสดงผล
 * ข้อมูลไม่ครบ (ไม่มีราคา/อัตรา) = null เสมอ ห้ามใช้ 0 หรือต้นทุนแทน (R20.7)
 */
import { allocateBps, groupSmallShares } from '../domain/invest/allocation';
import { profitPercentBps } from '../domain/invest/metrics';
import { safeSub } from '../domain/money/safe';
import type { UsPortfolio, UsStockRow } from './usPortfolio';

export type PortfolioCurrency = 'THB' | 'USD';

export interface HoldingRow {
  assetId: string;
  name: string;
  ticker: string;
  /** มูลค่าตลาด (สตางค์/เซนต์ตามสกุลที่เลือก) · null = ไม่มีราคา/อัตรา */
  value: number | null;
  /** ต้นทุนที่ยังถืออยู่ */
  invested: number;
  /** กำไรที่ยังไม่ขาย = มูลค่า − ต้นทุน · null = คำนวณไม่ได้ */
  gain: number | null;
  /** กำไร ÷ ต้นทุน (bps) · null = ต้นทุน 0 หรือกำไรคำนวณไม่ได้ */
  gainBps: number | null;
  /** สัดส่วนของพอร์ต (bps · รวม 10,000) · null = พอร์ตไม่ครบจึงไม่แบ่งสัดส่วน */
  bps: number | null;
}

export interface DonutPiece {
  key: string;
  label: string;
  bps: number;
}

export interface ConcentrationEntry {
  assetId: string;
  name: string;
  ticker: string;
  bps: number;
}

export interface Concentration {
  /** มีหุ้นตัวเดียวเกิน 20% ของพอร์ต (ปุ่ม Warning แสดงเฉพาะกรณีนี้) */
  warn: boolean;
  holdings: number;
  /** ตัวที่ใหญ่ที่สุด */
  top: ConcentrationEntry | null;
  /** 5 อันดับสัดส่วนมากสุด */
  largest: ConcentrationEntry[];
}

/** เกณฑ์เตือน: หุ้นตัวเดียวเกิน 20.00% (เกิน 2,000 bps) */
export const CONCENTRATION_LIMIT_BPS = 2000;
const MAX_DONUT_PIECES = 9;

const heldRows = (us: UsPortfolio): UsStockRow[] => us.rows.filter((r) => r.units > 0n);

/** แถวหุ้นที่ถืออยู่ เรียงสัดส่วนมาก→น้อย (เท่ากันเรียงตามชื่อย่อ ให้ผลคงที่) */
export function buildHoldingRows(us: UsPortfolio, currency: PortfolioCurrency): HoldingRow[] {
  const held = heldRows(us);
  const priced = held.length > 0 && held.every((r) => r.valueThb !== null);
  const shares = priced ? allocateBps(held.map((r) => ({ key: r.assetId, weight: r.valueThb as number }))) : [];
  // มูลค่ารวม 0 (เช่น กรอกราคา 0 ทุกตัว) = ไม่มีฐานให้แบ่งสัดส่วน → null ไม่ใช่ 0% ทุกแถว
  const complete = priced && shares.length > 0;
  const bpsOf = new Map(shares.map((s) => [s.key, s.bps]));
  const rows = held.map<HoldingRow>((r) => {
    const value = currency === 'THB' ? r.valueThb : r.valueUsd;
    const invested = currency === 'THB' ? r.costThb : r.costUsd;
    const gain = value === null ? null : safeSub(value, invested);
    return {
      assetId: r.assetId,
      name: r.name,
      ticker: r.ticker,
      value,
      invested,
      gain,
      gainBps: profitPercentBps(gain, invested),
      bps: complete ? (bpsOf.get(r.assetId) ?? 0) : null,
    };
  });
  return rows.sort((a, b) => (b.bps ?? -1) - (a.bps ?? -1) || (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0));
}

/** ชิ้นโดนัทจากแถวหุ้น (เกิน 9 ชิ้นรวมท้ายเป็น "Other") · พอร์ตไม่ครบ = ไม่มีชิ้น */
export function buildDonutPieces(rows: readonly HoldingRow[]): DonutPiece[] {
  if (rows.length === 0 || rows.some((r) => r.bps === null)) return [];
  const grouped = groupSmallShares(
    rows.map((r) => ({ key: r.assetId, bps: r.bps as number })),
    MAX_DONUT_PIECES,
  );
  return grouped.map((s) => ({ key: s.key, label: s.key === 'other' ? 'Other' : (rows.find((r) => r.assetId === s.key)?.ticker ?? s.key), bps: s.bps }));
}

/** ความเสี่ยงกระจุกตัว: เตือนเมื่อมีตัวเดียวเกิน 20% */
export function buildConcentration(rows: readonly HoldingRow[]): Concentration {
  const ranked = rows.filter((r) => r.bps !== null && r.bps > 0).map<ConcentrationEntry>((r) => ({ assetId: r.assetId, name: r.name, ticker: r.ticker, bps: r.bps as number }));
  ranked.sort((x, y) => y.bps - x.bps || (x.ticker < y.ticker ? -1 : x.ticker > y.ticker ? 1 : 0));
  const top = ranked[0] ?? null;
  return { warn: top !== null && top.bps > CONCENTRATION_LIMIT_BPS, holdings: rows.length, top, largest: ranked.slice(0, 5) };
}
