import { MONTHS_EN } from '../../../app/dateEn';
import { baht, signed } from '../../../app/bahtFormat';
import { usd, usdSigned } from '../../../app/usdFormat';
import type { ReportCurrency, ReportGrouping, ReportPeriod } from '../../../domain/invest/reportSeries';
import type { ReportRowDef } from '../../../domain/invest/reportRows';
import { signedPercentBps } from '../analysis/format';

/** ป้ายคอลัมน์: "Jan 2026" · "Q1 2026" · "2026" · "Total" */
export function columnLabel(key: string, grouping: ReportGrouping): string {
  if (key === 'total') return 'Total';
  if (grouping === 'monthly') return `${MONTHS_EN[Number(key.slice(5, 7)) - 1] ?? key.slice(5, 7)} ${key.slice(0, 4)}`;
  if (grouping === 'quarterly') return `${key.slice(5)} ${key.slice(0, 4)}`;
  return key;
}

/** ค่าในเซลล์ตามชนิดแถวและสกุล (ไม่มีสูตรเงิน: จัดรูปแบบจำนวนเต็มเท่านั้น) */
export function formatCell(row: ReportRowDef, v: number, currency: ReportCurrency): string {
  if (row.unit === 'bps') return signedPercentBps(v);
  if (row.unit === 'count') return String(v);
  if (currency === 'USD') return row.signed ? usdSigned(v) : usd(v);
  return row.signed ? signed(v) : baht(v);
}

export const GROUPINGS: readonly { id: ReportGrouping; label: string }[] = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'yearly', label: 'Yearly' },
];

export const PERIODS: readonly { id: ReportPeriod; label: string }[] = [
  { id: 'last1y', label: 'Last 12 months' },
  { id: 'last3y', label: 'Last 3 years' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'all', label: 'All time' },
];
