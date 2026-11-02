import { periodTotals } from '../domain/ledger/balance';
import {
  cashBalance,
  completedMonthExpenses,
  incomeChannels,
  monthOverMonth,
  netWorthDelta,
  netWorthMonthlySeries,
  runwayTenths,
  savingsRate,
} from '../domain/ledger/overview';
import type { NetWorthPoint } from '../domain/ledger/overview';
import type { Account, Entry } from '../domain/ledger/types';

/** เป้าเริ่มต้น (ยังไม่ให้ผู้ใช้แก้) 20% = 2000 bps, 6 เดือน = 60 */
export const DEFAULT_TARGETS = { savingsRateBps: 2000, runwayTenths: 60 } as const;

/** การ์ดสรุป 8 ใบ (กระจกแท้ครบโควตาพอดี) เรียงตามแถวบนไปล่าง */
export const SUMMARY_CARD_IDS = [
  'netWorth',
  'income',
  'outgoing',
  'surplus',
  'safeToSpend',
  'savingsRate',
  'vsLastMonth',
  'runway',
] as const;

/** ค่าที่ต้องตั้งค่าก่อน ("ตั้งค่า… →") หรือรอข้อมูลสะสม ("รอข้อมูลเดือนหน้า") */
export type CardState<T> = ({ kind: 'value' } & T) | { kind: 'needs-setup' } | { kind: 'waiting-data' };

export interface Overview {
  month: string;
  netWorth: CardState<{ value: number; deltaVsPrevMonth: number | null; series: NetWorthPoint[] }>;
  income: CardState<{ total: number; channels: number; topWalletId: string | null }>;
  outgoing: CardState<{ total: number }>;
  surplus: CardState<{ net: number }>;
  safeToSpend: CardState<Record<string, never>>;
  savingsRate: CardState<{ bps: number; targetBps: number }>;
  vsLastMonth: CardState<{ bps: number }>;
  runway: CardState<{ tenths: number; targetTenths: number }>;
}

/** ประกอบการ์ดสรุปของเดือนที่ `today` (YYYY-MM-DD) อยู่ ไม่มีสูตรเงินของตัวเอง เรียก domain เท่านั้น */
export function buildOverview(accounts: readonly Account[], entries: readonly Entry[], today: string): Overview {
  const month = today.slice(0, 7);
  const totals = periodTotals(accounts, entries, { from: `${month}-01`, to: today }, 'THB');
  const channels = incomeChannels(accounts, entries, month, today);

  const series = netWorthMonthlySeries(accounts, entries, today);
  const last = series[series.length - 1];

  const rate = savingsRate(totals.income, totals.net);
  const mom = monthOverMonth(accounts, entries, today);
  const runway = runwayTenths(cashBalance(accounts, entries, today), completedMonthExpenses(accounts, entries, today));

  return {
    month,
    netWorth:
      last === undefined
        ? { kind: 'waiting-data' }
        : {
            kind: 'value',
            value: last.value,
            deltaVsPrevMonth: netWorthDelta(series),
            series,
          },
    income: { kind: 'value', total: totals.income, channels: channels.count, topWalletId: channels.topWalletId },
    outgoing: { kind: 'value', total: totals.expense },
    surplus: { kind: 'value', net: totals.net },
    // R15: ต้องมีวันรับเงินเดือน/บิล/เงินสำรองก่อน ยังไม่คำนวณในรอบ A
    safeToSpend: { kind: 'needs-setup' },
    savingsRate:
      rate === null ? { kind: 'waiting-data' } : { kind: 'value', bps: rate, targetBps: DEFAULT_TARGETS.savingsRateBps },
    vsLastMonth: mom === null ? { kind: 'waiting-data' } : { kind: 'value', bps: mom },
    runway:
      runway === null
        ? { kind: 'waiting-data' }
        : { kind: 'value', tenths: runway, targetTenths: DEFAULT_TARGETS.runwayTenths },
  };
}
