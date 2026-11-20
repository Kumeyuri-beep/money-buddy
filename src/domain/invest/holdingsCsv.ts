/**
 * ส่งออก CSV ของตาราง Holdings (แบบร่าง 20 · ปุ่ม Export) · ฟังก์ชันล้วน ไม่แตะ DOM
 * ใช้ตัวสร้างของ Report ร่วมกัน: csvText (กัน CSV/formula injection) และ minorToDecimal/bpsToDecimal (หน่วยย่อย → ทศนิยมโดยไม่ผ่าน float · R1/R26)
 * ส่งออกเฉพาะที่เห็นในตาราง: แท็บปัจจุบัน แถวที่กรองแล้ว + แถวรวม · ค่า null (ไม่มีราคา/เรต) = ช่องว่าง ไม่ใช่ 0 (R20.7) · ไม่ส่งข้อมูลออกนอกเครื่อง
 */

import { bpsToDecimal, csvText, minorToDecimal } from './reportRows';
import type { DisplayCurrency } from './displayCurrency';
import { columnsFor, type ColumnId, type HoldingRow, type HoldingsTab, type HoldingsTotals, type ProfitSourcesRow } from './holdingsView';
import { formatUnits } from './units';

type Unit = 'units' | 'money' | 'bps';
/** ชนิดของแต่ละคอลัมน์ (บอกวิธีแปลงเป็นข้อความ) */
const UNIT: Record<ColumnId, Unit> = {
  shares: 'units', costBasis: 'money', currentValue: 'money', dividends: 'money', dividendYield: 'bps', totalProfit: 'money',
  weight: 'bps', avgCost: 'money', lastPrice: 'money', unrealized: 'money', div12m: 'money', yieldCurrent: 'bps', yieldOnCost: 'bps',
  srcUnrealized: 'money', srcRealized: 'money', srcOptions: 'money', srcDividends: 'money', srcFx: 'money', srcFees: 'money', srcTotal: 'money',
};

const src = (s: ProfitSourcesRow | null, pick: (s: ProfitSourcesRow) => number | null): number | null => (s === null ? null : pick(s));

function rowValue(col: ColumnId, r: HoldingRow): number | bigint | null {
  switch (col) {
    case 'shares': return r.units;
    case 'costBasis': return r.cost;
    case 'currentValue': return r.value;
    case 'dividends': return r.dividends;
    case 'dividendYield': return r.yieldBps;
    case 'totalProfit': return r.profit;
    case 'weight': return r.weightBps;
    case 'avgCost': return r.costPerShare;
    case 'lastPrice': return r.pricePerShare;
    case 'unrealized': return r.unrealized;
    case 'div12m': return r.dividends12m;
    case 'yieldCurrent': return r.yieldBps;
    case 'yieldOnCost': return r.yieldOnCostBps;
    case 'srcUnrealized': return src(r.sources, (s) => s.priceUnrealized);
    case 'srcRealized': return src(r.sources, (s) => s.priceRealized);
    case 'srcOptions': return src(r.sources, (s) => s.options);
    case 'srcDividends': return src(r.sources, (s) => s.dividendGross);
    case 'srcFx': return src(r.sources, (s) => s.fx);
    case 'srcFees': return src(r.sources, (s) => s.feesAndTax);
    case 'srcTotal': return src(r.sources, (s) => s.total);
  }
}

/** แถวรวม: มีเฉพาะคอลัมน์ที่ตารางรวมให้ (ตรงกับ totalCellOf ในหน้าจอ) · อื่นๆ ว่าง */
function totalValue(col: ColumnId, t: HoldingsTotals): number | null {
  switch (col) {
    case 'costBasis': return t.cost;
    case 'currentValue': return t.value;
    case 'dividends': return t.dividends;
    case 'totalProfit': return t.profit;
    case 'unrealized': return t.unrealized;
    case 'srcUnrealized': return src(t.sources, (s) => s.priceUnrealized);
    case 'srcRealized': return src(t.sources, (s) => s.priceRealized);
    case 'srcOptions': return src(t.sources, (s) => s.options);
    case 'srcDividends': return src(t.sources, (s) => s.dividendGross);
    case 'srcFx': return src(t.sources, (s) => s.fx);
    case 'srcFees': return src(t.sources, (s) => s.feesAndTax);
    case 'srcTotal': return src(t.sources, (s) => s.total);
    default: return null;
  }
}

function text(unit: Unit, v: number | bigint | null): string {
  if (v === null) return '';
  if (unit === 'units') return formatUnits(v as bigint);
  return unit === 'bps' ? bpsToDecimal(v as number) : minorToDecimal(v as number);
}

const NOTE: Record<NonNullable<HoldingRow['missing']>, string> = { price: 'No price', rate: 'Needs rate', error: "Couldn't load" };
const noteOf = (r: HoldingRow): string => [r.sold ? 'Sold' : '', r.missing === null ? '' : NOTE[r.missing]].filter((x) => x !== '').join('; ');

/** ที่มาของคอลัมน์ % ที่ตามหลังคอลัมน์กำไร (หน้าจอแสดงเป็นบรรทัดเล็กใต้ตัวเลข) */
const PCT_AFTER: Partial<Record<ColumnId, { label: string; row: (r: HoldingRow) => number | null; total: (t: HoldingsTotals) => number | null }>> = {
  totalProfit: { label: 'Total profit (%)', row: (r) => r.profitBps, total: (t) => t.profitBps },
  unrealized: { label: 'Unrealized profit (%)', row: (r) => r.unrealizedBps, total: (t) => t.unrealizedBps },
};

export interface HoldingsCsvInput {
  rows: readonly HoldingRow[];
  tab: HoldingsTab;
  currency: DisplayCurrency;
  totals: HoldingsTotals;
  /** ป้ายหัวคอลัมน์ (ใช้ชุดเดียวกับหัวตารางบนหน้าจอ) */
  labelOf: (col: ColumnId) => string;
}

/** CSV (BOM UTF-8 ให้ Excel เปิดได้ · ขึ้นบรรทัดใหม่ CRLF) แถวแรกบอกสกุล · % เป็นทศนิยม 2 ตำแหน่ง (เช่น 31.66) */
export function buildHoldingsCsv(input: HoldingsCsvInput): string {
  const cols = columnsFor(input.tab);
  const heads: string[] = ['Ticker', 'Name'];
  for (const c of cols) {
    const unit = UNIT[c];
    heads.push(unit === 'bps' ? `${input.labelOf(c)} (%)` : `${input.labelOf(c)} (${unit === 'money' ? input.currency : 'shares'})`.replace(' (shares)', ''));
    const p = PCT_AFTER[c];
    if (p) heads.push(p.label);
  }
  heads.push('Note');
  const line = (cells: string[]): string => cells.join(',');
  const lines = [line([csvText('Currency'), csvText(input.currency)]), line(heads.map(csvText))];
  for (const r of input.rows) {
    const cells = [csvText(r.ticker), csvText(r.name)];
    for (const c of cols) {
      cells.push(text(UNIT[c], rowValue(c, r)));
      const p = PCT_AFTER[c];
      if (p) cells.push(text('bps', p.row(r)));
    }
    cells.push(csvText(noteOf(r)));
    lines.push(line(cells));
  }
  const total = [csvText('Total'), csvText(`${input.totals.count} ${input.totals.count === 1 ? 'holding' : 'holdings'}`)];
  for (const c of cols) {
    total.push(text(UNIT[c], totalValue(c, input.totals)));
    const p = PCT_AFTER[c];
    if (p) total.push(text('bps', p.total(input.totals)));
  }
  total.push(csvText(input.totals.complete ? '' : 'Incomplete: some holdings have no price or rate'));
  lines.push(line(total));
  return `﻿${lines.join('\r\n')}\r\n`;
}

export const holdingsCsvFilename = (currency: DisplayCurrency, tab: HoldingsTab, asOf: string): string => `holdings-${tab}-${currency}-${asOf}.csv`;
