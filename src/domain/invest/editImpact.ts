/**
 * แก้รายการลงทุนที่บันทึกแล้ว: กติกา "แก้ได้ไหม" และผลกระทบ "ก่อนแก้ → หลังแก้" (R2 ข้อ 4 ส่วน B · กฎ R11, R17, R20)
 * ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล · ใช้ตัวเล่นซ้ำและตัวตรวจกติกาตัวเดียวกับที่ repository.replaceTrade ใช้ ไม่มีสูตรเงินของตัวเอง
 * ตัวเลขนี้เป็นค่าแสดงผลให้ผู้ใช้ตรวจก่อนกดยืนยัน ห้ามนำไปคำนวณต่อ (R16)
 */

import { averageCostMicro, replayTrades } from './costBasis';
import { replayTradesFx } from './costBasisFx';
import { problem } from './errorCodes';
import { checkTradeAddCoded, checkTradeDeleteCoded, toReplayTrades } from './rules';
import { toTradesFx } from './tradesFx';
import type { TradeRecord } from './types';
import { problemOfError, type CodedProblem } from '../errors/problem';

/**
 * รายการที่จะส่งเข้า replaceTrade จริง: วันที่ไม่เปลี่ยน = คงเวลาบันทึกเดิม (ลำดับในวันนั้นไม่ขยับ)
 * ต้องตรงกับที่ repository ทำ (supabaseRepository.replaceTrade) ไม่งั้นตัวอย่างที่แสดงจะต่างจากที่บันทึกจริง
 */
export function editedTradeOf(old: TradeRecord, next: TradeRecord): TradeRecord {
  return next.date === old.date ? { ...next, createdAt: old.createdAt } : next;
}

/** แก้รายการนี้ได้ไหม: กติกาเดียวกับลบ (R17) · null = แก้ได้ · ใช้ปิดปุ่ม Edit พร้อมเหตุผล */
export function tradeEditProblem(assetTrades: readonly TradeRecord[], id: string): CodedProblem | null {
  return checkTradeDeleteCoded(assetTrades, id);
}

/** ตัวเลขของสินทรัพย์หนึ่งตัว ณ จุดหนึ่ง (ก่อนหรือหลังแก้) · เงินเป็นหน่วยย่อยของสกุลสินทรัพย์ (สตางค์ หรือ เซนต์) */
export interface EditSide {
  units: bigint;
  /** ต้นทุนที่ยังถืออยู่รวมค่าธรรมเนียมซื้อ */
  costMinor: number;
  /** ต้นทุนเฉลี่ยต่อหน่วย (micro ของสกุลสินทรัพย์) · ไม่มีหน่วยเหลือ = null */
  avgCostMicro: number | null;
  /** กำไรที่ขายแล้ว: บาท = กำไรรวม · USD = ส่วนจากราคาหุ้น (เซนต์) */
  realizedMinor: number;
  /** เฉพาะ USD: ต้นทุนบาทของที่ถืออยู่ (สตางค์) และกำไรที่ขายแล้วรวมค่าเงิน (สตางค์) · สินทรัพย์บาท = null */
  costThb: number | null;
  realizedThb: number | null;
}

export type TradeEditPreview = { ok: true; before: EditSide; after: EditSide } | { ok: false; problem: CodedProblem };

function sideOf(trades: readonly TradeRecord[], usd: boolean): EditSide {
  if (usd) {
    const r = replayTradesFx(toTradesFx(trades));
    return {
      units: r.position.units,
      costMinor: r.position.costUsd,
      avgCostMicro: averageCostMicro({ units: r.position.units, cost: r.position.costUsd }),
      realizedMinor: r.sells.reduce((s, x) => s + x.result.priceGainUsd, 0),
      costThb: r.position.costThb,
      realizedThb: r.realizedGainThb,
    };
  }
  const r = replayTrades(toReplayTrades(trades));
  return { units: r.position.units, costMinor: r.position.cost, avgCostMicro: averageCostMicro(r.position), realizedMinor: r.realizedGain, costThb: null, realizedThb: null };
}

/**
 * ตรวจและแสดงผลกระทบของการแก้รายการ `oldId` ของสินทรัพย์หนึ่ง เป็น `next` (trades = รายการทั้งหมดของสินทรัพย์นั้น)
 * ผิดกติกา (แก้ไม่ได้ · ขายเกินที่ถือ · ย้ายวันขายไปก่อนวันซื้อ · USD ไม่มีอัตรา) = ok:false พร้อมเหตุผล ไม่คำนวณต่อ
 */
export function previewTradeEdit(input: { trades: readonly TradeRecord[]; oldId: string; next: TradeRecord; usd: boolean }): TradeEditPreview {
  const { trades, oldId, next, usd } = input;
  const old = trades.find((t) => t.id === oldId);
  if (!old) return { ok: false, problem: problem('rules.notFound') };
  const editProblem = tradeEditProblem(trades, oldId);
  if (editProblem) return { ok: false, problem: editProblem };
  const rest = trades.filter((t) => t.id !== oldId);
  const edited = editedTradeOf(old, next);
  const addProblem = checkTradeAddCoded(rest, edited);
  if (addProblem) return { ok: false, problem: addProblem };
  if (usd && edited.fxRateMicro === undefined) return { ok: false, problem: { message: 'ต้องมีอัตราแลกเปลี่ยนของวันรายการ', code: 'store.fxRateRequired' } };
  try {
    return { ok: true, before: sideOf(trades, usd), after: sideOf([...rest, edited], usd) };
  } catch (e) {
    return { ok: false, problem: problemOfError(e, problem('rules.replayFallback')) };
  }
}

/** แถวของตาราง Transactions ที่ใช้ตัดสินว่าแก้ได้ไหม (ชนิดย่อยของ TxRow) */
export interface EditableRowRef {
  source: 'trade' | 'fx' | 'entry';
  sourceId: string;
  assetId: string | null;
  kind: string;
}

export type TransactionEditPlan =
  | { ok: true; usd: boolean; tradeId: string; assetId: string }
  | { ok: false; why: 'notTrade' | 'unsupported' }
  | { ok: false; why: 'rule'; problem: CodedProblem };

/**
 * แถวนี้แก้ได้ไหม · แก้ได้เฉพาะรายการลงทุน (ซื้อ/ขาย/ปันผล/ปันผลลงทุนต่อ) ที่กติกา R17 อนุญาต
 * แลกเงิน/โอน/ปรับยอดเงินสด = notTrade (ยังไม่มีการแก้ ให้ลบแล้วเพิ่มใหม่) · ปันผลลงทุนต่อของสินทรัพย์ USD ไม่มีฟอร์ม = unsupported
 */
export function planTransactionEdit(row: EditableRowRef, trades: readonly TradeRecord[], usdAssetIds: ReadonlySet<string>): TransactionEditPlan {
  if (row.source !== 'trade' || row.assetId === null) return { ok: false, why: 'notTrade' };
  const usd = usdAssetIds.has(row.assetId);
  if (usd && row.kind === 'reinvest') return { ok: false, why: 'unsupported' };
  const problemOf = tradeEditProblem(trades.filter((t) => t.assetId === row.assetId), row.sourceId);
  if (problemOf) return { ok: false, why: 'rule', problem: problemOf };
  return { ok: true, usd, tradeId: row.sourceId, assetId: row.assetId };
}
