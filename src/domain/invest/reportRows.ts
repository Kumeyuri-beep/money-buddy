/**
 * แถวของตารางรายงาน (หน้า Analytics → Report) และการส่งออก CSV (กฎ R26 สกุลที่แสดง · R27 % รวม)
 * ฟังก์ชันล้วน ไม่แตะ DOM/เครือข่าย · การส่งออกอยู่ในเครื่องเท่านั้น (ไม่ส่งข้อมูลออกนอกเครื่อง)
 *   - ค่าเงินในไฟล์เป็นทศนิยม 2 ตำแหน่งจากจำนวนเต็มหน่วยย่อย (ไม่ผ่าน float) · % = bps ÷ 100 ทศนิยม 2 ตำแหน่ง
 *   - ค่าที่คำนวณไม่ได้ = ช่องว่าง (ไม่ใช่ 0)
 *   - ข้อความที่ขึ้นต้นด้วย = + - @ (หรือ tab/CR) ถูกนำหน้าด้วย ' เพื่อกัน CSV/formula injection · ตัวเลขที่เราสร้างเองเป็นเลขล้วน ไม่ผ่านการ escape
 */

import { safeAdd } from '../money/safe';
import type { Cell, ReportColumn, ReportCurrency, ReportTable } from './reportSeries';

export type RowUnit = 'money' | 'bps' | 'count' | 'market';
export type RowGroup = 'value' | 'profit' | 'turnover' | 'trades' | 'market';

export interface ReportRowDef {
  id: string;
  label: string;
  hint: string;
  group: RowGroup;
  unit: RowUnit;
  /** แถวเงินที่มีเครื่องหมาย +/− (กำไร ผลต่าง ค่าใช้จ่าย) */
  signed: boolean;
  /** ค่าของแถวในงวดหนึ่ง · null = คำนวณไม่ได้ (ไม่ใช่ 0) · ไม่มีข้อมูลตลาด = null เสมอ */
  pick: (c: ReportColumn) => Cell;
}


export const GROUP_LABELS: Record<RowGroup, string> = {
  value: 'Portfolio value',
  profit: 'Total profit',
  turnover: 'Turnover',
  trades: 'Total trades',
  market: 'S&P 500 Market Performance',
};

export const REPORT_ROWS: readonly ReportRowDef[] = [
  { id: 'begin', label: 'At the beginning', hint: 'Market value at the start of the period.', group: 'value', unit: 'money', signed: false, pick: (c) => c.begin },
  { id: 'end', label: 'At the end', hint: 'Market value at the end of the period.', group: 'value', unit: 'money', signed: false, pick: (c) => c.end },
  { id: 'change', label: 'Change', hint: 'End value minus start value. Includes money you added or took out.', group: 'value', unit: 'money', signed: true, pick: (c) => c.change },
  { id: 'profit', label: 'Total profit', hint: 'Price change + realized + dividends + currency + fees + taxes.', group: 'profit', unit: 'money', signed: true, pick: (c) => c.profit },
  { id: 'profitPct', label: 'Total profit, %', hint: 'Monthly Modified Dietz return. Quarters, years and Total chain the months together.', group: 'profit', unit: 'bps', signed: true, pick: (c) => c.profitBps },
  { id: 'price', label: 'Price change', hint: 'Change in value of what you hold.', group: 'profit', unit: 'money', signed: true, pick: (c) => c.price },
  { id: 'realized', label: 'Realized from sales', hint: 'Profit or loss from shares you sold.', group: 'profit', unit: 'money', signed: true, pick: (c) => c.realized },
  { id: 'dividends', label: 'Dividends', hint: 'Dividends received, before tax.', group: 'profit', unit: 'money', signed: true, pick: (c) => c.dividends },
  { id: 'fx', label: 'Currency (FX)', hint: 'Gain or loss from the baht / dollar rate. Shown in THB view only.', group: 'profit', unit: 'money', signed: true, pick: (c) => c.fx },
  { id: 'fees', label: 'Fees', hint: 'Broker commissions and other fees.', group: 'profit', unit: 'money', signed: true, pick: (c) => c.fees },
  { id: 'taxes', label: 'Taxes', hint: 'Withholding tax taken from dividends.', group: 'profit', unit: 'money', signed: true, pick: (c) => c.taxes },
  { id: 'turnover', label: 'Turnover', hint: 'Purchases + sales: how much money moved through the portfolio.', group: 'turnover', unit: 'money', signed: false, pick: (c) => safeAdd(c.purchases, c.sales) },
  { id: 'purchases', label: 'Total purchases', hint: 'Total amount spent buying (including fees).', group: 'turnover', unit: 'money', signed: false, pick: (c) => c.purchases },
  { id: 'sales', label: 'Total sales', hint: 'Total amount received from selling (after fees).', group: 'turnover', unit: 'money', signed: false, pick: (c) => c.sales },
  { id: 'trades', label: 'Total trades', hint: 'Number of buy and sell transactions.', group: 'trades', unit: 'count', signed: false, pick: (c) => c.buys + c.sells },
  { id: 'buys', label: 'Buy trades', hint: 'Number of buy transactions.', group: 'trades', unit: 'count', signed: false, pick: (c) => c.buys },
  { id: 'sells', label: 'Sell trades', hint: 'Number of sell transactions.', group: 'trades', unit: 'count', signed: false, pick: (c) => c.sells },
  { id: 'spx', label: 'S&P 500 Market Performance', hint: 'What the same deposits would have earned in the S&P 500. Needs index prices.', group: 'market', unit: 'market', signed: true, pick: () => null },
  { id: 'spxPct', label: 'S&P 500 Market Performance, %', hint: 'S&P 500 return for each month. Needs index prices.', group: 'market', unit: 'market', signed: true, pick: () => null },
];

// ───────────────────────── รูปแบบข้อความ (จำนวนเต็มล้วน) ─────────────────────────

/** หน่วยย่อย → "1234.56" / "-0.05" (ไม่ผ่าน float) */
export function minorToDecimal(minor: number): string {
  if (!Number.isSafeInteger(minor)) throw new RangeError(`จำนวนเงินต้องเป็นจำนวนเต็มปลอดภัย (ได้รับ ${String(minor)})`);
  const abs = Math.abs(minor);
  return `${minor < 0 ? '-' : ''}${(abs - (abs % 100)) / 100}.${String(abs % 100).padStart(2, '0')}`;
}

/** bps → "10.69" / "-0.38" */
export const bpsToDecimal = minorToDecimal;

/** กัน CSV/formula injection ในข้อความ: ขึ้นต้น = + - @ tab CR → นำหน้าด้วย ' แล้วครอบเครื่องหมายคำพูดตามมาตรฐาน CSV */
export function csvText(text: string): string {
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function csvCell(row: ReportRowDef, v: Cell): string {
  if (v === null) return '';
  if (row.unit === 'money' || row.unit === 'bps') return minorToDecimal(v);
  return String(v);
}

/** ป้ายคอลัมน์ในไฟล์ */
export const csvColumnLabel = (key: string): string => (key === 'total' ? 'Total' : key);

function csvRowLabel(row: ReportRowDef, currency: ReportCurrency): string {
  if (row.unit === 'bps' || row.label.endsWith(', %')) return `${row.label.replace(/, %$/, '')} (%)`;
  if (row.unit === 'money' || row.unit === 'market') return `${row.label} (${currency})`;
  return row.label;
}

/**
 * CSV ของตาราง (BOM UTF-8 ให้ Excel เปิดได้ · ขึ้นบรรทัดใหม่ CRLF) · แถวแรกบอกสกุล
 * แถวที่ไม่มีข้อมูล (S&P 500) ปล่อยว่าง
 */
export function buildReportCsv(table: ReportTable): string {
  const cols = [...table.columns, ...(table.total ? [table.total] : [])];
  const lines: string[] = [];
  lines.push([csvText('Currency'), csvText(table.currency)].join(','));
  lines.push([csvText('Metric'), ...cols.map((c) => csvText(csvColumnLabel(c.key)))].join(','));
  for (const row of REPORT_ROWS) lines.push([csvText(csvRowLabel(row, table.currency)), ...cols.map((c) => csvCell(row, row.pick(c)))].join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

export const reportCsvFilename = (currency: ReportCurrency, asOf: string): string => `portfolio-report-${currency}-${asOf}.csv`;
