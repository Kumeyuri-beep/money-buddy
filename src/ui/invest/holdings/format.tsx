import type { ReactNode } from 'react';
import { baht, signed } from '../../../app/bahtFormat';
import { usd, usdSigned } from '../../../app/usdFormat';
import { formatUnits } from '../../../domain/invest/units';
import type { ColumnId, HoldingRow, HoldingsTotals, MissingKind, ProfitSourcesRow } from '../../../domain/invest/holdingsView';
import type { DisplayCurrency } from '../../../domain/invest/displayCurrency';
import { bpsText } from '../dashboard/dashboardView';

/** ตัวจัดรูปแบบของตาราง Holdings (แสดงผลอย่างเดียว · ตัวเลขทั้งหมดมาจาก src/domain/invest/holdingsView) */
export const money = (c: DisplayCurrency, v: number): string => (c === 'THB' ? baht(v) : usd(v));
export const moneySigned = (c: DisplayCurrency, v: number): string => (c === 'THB' ? signed(v) : usdSigned(v));
export const signClass = (v: number | null): string => (v === null || v === 0 ? '' : v > 0 ? 'is-pos' : 'is-neg');

export const COLUMN_LABEL: Record<ColumnId, string> = {
  shares: 'Shares', costBasis: 'Cost basis', currentValue: 'Current value', dividends: 'Dividends', dividendYield: 'Dividend yield', totalProfit: 'Total profit',
  weight: 'Weight', avgCost: 'Avg cost / share', lastPrice: 'Last price', unrealized: 'Unrealized profit',
  div12m: 'Dividends (12 months)', yieldCurrent: 'Yield', yieldOnCost: 'Yield on cost',
  srcUnrealized: 'Price (unrealized)', srcRealized: 'Price (realized)', srcOptions: 'Options', srcDividends: 'Dividends', srcFx: 'Currency', srcFees: 'Fees & tax', srcTotal: 'Total profit',
};

const missingText = (m: MissingKind | null): string => (m === 'rate' ? 'Needs rate' : m === 'price' ? 'No price' : '—');

/** ข้อมูลไม่มี: ขีด + ข้อความสำหรับโปรแกรมอ่านหน้าจอ */
export function NoData({ kind }: { kind: MissingKind | null }): ReactNode {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{kind === null ? 'No data' : missingText(kind)}</span>
    </>
  );
}

const flagged = (kind: MissingKind | null): ReactNode => (
  <span className="hd-flag">
    <span aria-hidden="true">—</span>
    <span className="hd-flag-text">{missingText(kind)}</span>
  </span>
);

function withPct(text: string, bps: number | null, cls: string): ReactNode {
  return (
    <span className={cls}>
      {text}
      {bps !== null && <span className="hd-sub"> {bpsText(bps, true)}</span>}
    </span>
  );
}

const srcCell = (c: DisplayCurrency, r: ProfitSourcesRow | null, pick: (s: ProfitSourcesRow) => number | null, kind: MissingKind | null): ReactNode => {
  if (r === null) return flagged(kind);
  const v = pick(r);
  return v === null ? <NoData kind={null} /> : <span className={signClass(v)}>{moneySigned(c, v)}</span>;
};

export function cellOf(col: ColumnId, r: HoldingRow, c: DisplayCurrency): ReactNode {
  switch (col) {
    case 'shares': return r.units > 0n ? formatUnits(r.units) : '0';
    case 'costBasis': return r.cost === null ? flagged(r.missing) : r.units > 0n ? money(c, r.cost) : <NoData kind={null} />;
    case 'currentValue': return r.units === 0n ? money(c, 0) : r.value === null ? flagged(r.missing) : money(c, r.value);
    case 'dividends': return r.dividends === null ? flagged(r.missing) : money(c, r.dividends);
    case 'dividendYield': return r.yieldBps === null ? <NoData kind={null} /> : bpsText(r.yieldBps);
    case 'totalProfit': return r.profit === null ? flagged(r.missing) : withPct(moneySigned(c, r.profit), r.profitBps, signClass(r.profit));
    case 'weight': return r.weightBps === null ? <NoData kind={null} /> : bpsText(r.weightBps);
    case 'avgCost': return r.costPerShare === null ? <NoData kind={null} /> : money(c, r.costPerShare);
    case 'lastPrice': return r.pricePerShare === null ? flagged(r.priceMicro === null ? 'price' : 'rate') : money(c, r.pricePerShare);
    case 'unrealized': return r.unrealized === null || r.units === 0n ? (r.units === 0n ? <NoData kind={null} /> : flagged(r.missing)) : withPct(moneySigned(c, r.unrealized), r.unrealizedBps, signClass(r.unrealized));
    case 'div12m': return r.dividends12m === null ? <NoData kind={null} /> : money(c, r.dividends12m);
    case 'yieldCurrent': return r.yieldBps === null ? <NoData kind={null} /> : bpsText(r.yieldBps);
    case 'yieldOnCost': return r.yieldOnCostBps === null ? <NoData kind={null} /> : bpsText(r.yieldOnCostBps);
    case 'srcUnrealized': return srcCell(c, r.sources, (s) => s.priceUnrealized, r.missing);
    case 'srcRealized': return srcCell(c, r.sources, (s) => s.priceRealized, r.missing);
    case 'srcOptions': return srcCell(c, r.sources, (s) => s.options, r.missing);
    case 'srcDividends': return srcCell(c, r.sources, (s) => s.dividendGross, r.missing);
    case 'srcFx': return srcCell(c, r.sources, (s) => s.fx, r.missing);
    case 'srcFees': return srcCell(c, r.sources, (s) => s.feesAndTax, r.missing);
    case 'srcTotal': return srcCell(c, r.sources, (s) => s.total, r.missing);
  }
}

export function totalCellOf(col: ColumnId, t: HoldingsTotals, c: DisplayCurrency): ReactNode {
  const src = (pick: (s: ProfitSourcesRow) => number | null): ReactNode => (t.sources === null ? flagged('price') : srcCell(c, t.sources, pick, null));
  switch (col) {
    case 'costBasis': return t.cost === null ? flagged('error') : money(c, t.cost);
    case 'currentValue': return t.value === null ? flagged('price') : money(c, t.value);
    case 'dividends': return t.dividends === null ? flagged('error') : money(c, t.dividends);
    case 'div12m': return <NoData kind={null} />;
    case 'totalProfit': return t.profit === null ? flagged('price') : withPct(moneySigned(c, t.profit), t.profitBps, signClass(t.profit));
    case 'unrealized': return t.unrealized === null ? flagged('price') : withPct(moneySigned(c, t.unrealized), t.unrealizedBps, signClass(t.unrealized));
    case 'srcUnrealized': return src((s) => s.priceUnrealized);
    case 'srcRealized': return src((s) => s.priceRealized);
    case 'srcOptions': return src((s) => s.options);
    case 'srcDividends': return src((s) => s.dividendGross);
    case 'srcFx': return src((s) => s.fx);
    case 'srcFees': return src((s) => s.feesAndTax);
    case 'srcTotal': return src((s) => s.total);
    default: return null;
  }
}
