import { useState, type CSSProperties, type ReactNode } from 'react';
import { formatBps } from '../../../domain/invest/allocation';
import { UNCATEGORIZED_ID, type CategoryTableRow } from '../../../domain/invest/categoriesView';
import type { DisplayCurrency } from '../../../domain/invest/displayCurrency';
import { bpsText } from '../dashboard/dashboardView';
import { money, moneySigned, signClass } from '../holdings/format';
import '../dashboard/dashboard.css';

/** ตาราง + โดนัทสรุปต่อหมวด (แบบร่าง 25) · แสดงผลอย่างเดียว ตัวเลขทั้งหมดมาจาก buildCategoryTable (domain) */

const SIZE = { w: 400, h: 360, cx: 200, cy: 180, r: 108, stroke: 50 };
const CIRC = 2 * Math.PI * SIZE.r;
const LABEL_MIN_BPS = 300;
const sliceClass = (r: CategoryTableRow, i: number): string => (r.id === UNCATEGORIZED_ID ? 'sother' : `s${(i % 7) + 1}`);

const STATUS_TEXT = (r: CategoryTableRow): string =>
  r.status === 'none' || r.diffBps === null ? '—' : r.status === 'on' ? 'on target' : `${r.status === 'over' ? 'over' : 'under'} by ${bpsText(Math.abs(r.diffBps))}`;

/** "—" ที่มีข้อความสำหรับโปรแกรมอ่านหน้าจอเสมอ */
const dash = (reason: string): ReactNode => (
  <>
    <span aria-hidden="true">—</span>
    <span className="sr-only">{reason}</span>
  </>
);

const flag = (text: string): ReactNode => (
  <span className="hd-flag">
    <span aria-hidden="true">—</span>
    <span className="hd-flag-text">{text}</span>
  </span>
);

function Donut({ rows, active, onActive, total, currency }: { rows: readonly CategoryTableRow[]; active: string | null; onActive: (id: string | null) => void; total: number | null; currency: DisplayCurrency }) {
  const pieces = rows.map((r, i) => ({ r, i })).filter((p) => (p.r.weightBps ?? 0) > 0);
  let acc = 0;
  const GAP = 2.5;
  const parts = pieces.map((p) => {
    const bps = p.r.weightBps as number;
    const start = acc;
    acc += bps;
    return { ...p, bps, len: (bps / 10000) * CIRC, off: (start / 10000) * CIRC, mid: ((start + bps / 2) / 10000) * 2 * Math.PI };
  });
  const named = rows.filter((r) => r.id !== UNCATEGORIZED_ID).length;
  return (
    <svg className="iv-donut cg-donut" viewBox={`0 0 ${SIZE.w} ${SIZE.h}`} role="img" aria-label="Allocation by category chart. The table lists the same values." onMouseLeave={() => onActive(null)}>
      <g transform={`rotate(-90 ${SIZE.cx} ${SIZE.cy})`}>
        <circle className="iv-donut-bg" cx={SIZE.cx} cy={SIZE.cy} r={SIZE.r} fill="none" strokeWidth={SIZE.stroke} />
        {parts.map((p) => (
          <circle
            key={p.r.id}
            className={`iv-slice ${sliceClass(p.r, p.i)}${active === p.r.id ? ' is-active' : active !== null ? ' is-dim' : ''}`}
            cx={SIZE.cx}
            cy={SIZE.cy}
            r={SIZE.r}
            fill="none"
            strokeWidth={SIZE.stroke}
            strokeDasharray={`${Math.max(p.len - (parts.length > 1 ? GAP : 0), 0.01)} ${CIRC}`}
            strokeDashoffset={-p.off}
            onMouseEnter={() => onActive(p.r.id)}
          >
            <title>{`${p.r.name} ${formatBps(p.bps)}`}</title>
          </circle>
        ))}
      </g>
      {parts.map((p) => {
        if (p.bps < LABEL_MIN_BPS && active !== p.r.id) return null;
        const lr = SIZE.r + SIZE.stroke / 2 + 14;
        return (
          <text key={`l-${p.r.id}`} className={`iv-donut-label${active === p.r.id ? ' is-active' : ''}`} x={SIZE.cx + lr * Math.sin(p.mid)} y={SIZE.cy - lr * Math.cos(p.mid) + 4} textAnchor={Math.sin(p.mid) >= 0 ? 'start' : 'end'} aria-hidden="true">
            {formatBps(p.bps)}
          </text>
        );
      })}
      <g className="iv-donut-center" aria-hidden="true">
        <text x={SIZE.cx} y={SIZE.cy - 14} textAnchor="middle" className="iv-c-top">
          {named} {named === 1 ? 'category' : 'categories'}
        </text>
        <text x={SIZE.cx} y={SIZE.cy + 14} textAnchor="middle" className="iv-c-main">
          {total === null ? '—' : money(currency, total)}
        </text>
      </g>
    </svg>
  );
}

export function CategorySummary({ rows, currency, total }: { rows: readonly CategoryTableRow[]; currency: DisplayCurrency; total: number | null }) {
  const [active, setActive] = useState<string | null>(null);
  const hasWeights = rows.some((r) => (r.weightBps ?? 0) > 0);
  return (
    <div className="cg-body">
      <section className="glass-lite card cg-donut-card" aria-label="Portfolio by category">
        <h3 className="cg-card-title">Portfolio</h3>
        <div className="iv-donut-wrap">
          {hasWeights ? <Donut rows={rows} active={active} onActive={setActive} total={total} currency={currency} /> : <p className="iv-empty">Allocation is not available yet: no price or exchange rate for a stock you hold.</p>}
        </div>
      </section>
      <section className="glass-lite card cg-table-card" aria-label="Categories table">
        <div className="migrate-table-wrap cg-wrap" role="region" aria-label="Categories table, scrollable horizontally" tabIndex={0}>
          <table className="migrate-table cg-table">
            <caption className="sr-only">Categories in {currency}: value, invested, gain, allocation and difference from target</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col" className="num">Value / Invested</th>
                <th scope="col" className="num">Gain</th>
                <th scope="col" className="num">Allocation</th>
                <th scope="col" className="cg-vs">vs. target</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.id}
                  className={`cg-row ${sliceClass(r, i)}${active === r.id ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(r.id)}
                  onMouseLeave={() => setActive(null)}
                >
                  <th scope="row">
                    <span className="cg-name">{r.name}</span>
                    <span className="cg-sub">
                      {r.count} {r.count === 1 ? 'item' : 'items'}
                    </span>
                  </th>
                  <td className="num">
                    <span className="cg-strong">{r.value === null ? flag('No price') : money(currency, r.value)}</span>
                    <span className="cg-sub">{r.cost === null ? dash('No cost (a price or rate is missing)') : money(currency, r.cost)}</span>
                  </td>
                  <td className="num">
                    {r.unrealized === null ? (
                      dash('No gain (a price is missing)')
                    ) : (
                      <>
                        <span className={signClass(r.unrealized)}>{moneySigned(currency, r.unrealized)}</span>
                        {r.unrealizedBps !== null && <span className={`cg-sub ${signClass(r.unrealized)}`}>{bpsText(r.unrealizedBps, true)}</span>}
                      </>
                    )}
                  </td>
                  <td className="num">
                    <span className="cg-strong">{r.weightBps === null ? dash('No allocation (a price is missing)') : bpsText(r.weightBps)}</span>
                    <span className="cg-sub">{r.targetBps === null ? 'no target' : `target ${bpsText(r.targetBps)}`}</span>
                  </td>
                  <td className="cg-vs">
                    <span className="cg-track" aria-hidden="true">
                      <span className="cg-fill" style={{ '--w': r.barBps ?? 0 } as CSSProperties} />
                      {r.markBps !== null && <span className="cg-mark" style={{ '--w': r.markBps } as CSSProperties} />}
                    </span>
                    <span className={`cg-status is-${r.status}`}>{r.status === 'none' || r.diffBps === null ? dash(r.targetBps === null ? 'No target set' : 'No allocation to compare') : STATUS_TEXT(r)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
