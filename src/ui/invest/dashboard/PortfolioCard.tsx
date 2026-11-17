import { useId, useMemo, useState } from 'react';
import { baht, signed } from '../../../app/bahtFormat';
import { buildConcentration, buildDonutPieces, buildHoldingRows, type HoldingRow } from '../../../app/investPortfolioView';
import { usd, usdSigned } from '../../../app/usdFormat';
import { formatBps } from '../../../domain/invest/allocation';
import { TipButton } from '../Tip';
import { bpsText, type DashboardView, type DashCurrency } from './dashboardView';

/**
 * การ์ด Portfolio ใบเดียวของแดชบอร์ด /invest (ภาษาอังกฤษ): โดนัทมี % รอบวง + ตาราง Name / Value / Invested / Gain / Allocation
 * โหมด Holdings (ค่าเริ่มต้น) · Currency · Sector ยังไม่มีข้อมูล (ต้องใช้ข้อมูลอัตโนมัติ) จึงปิดไว้พร้อมคำอธิบาย
 * ตัวเลขทั้งหมดมาจาก src/app/investPortfolioView.ts และ view ของโดเมน · ชี้/โฟกัสชิ้นหรือแถวแล้วชิ้นพองออก ที่เหลือจางลง กลางวงแสดงรายการนั้น
 * ไม่มีข้อความใต้โดนัท
 */

type Mode = 'holdings' | 'currency';

export interface Row {
  key: string;
  name: string;
  sub: string;
  badge: string;
  value: number | null;
  invested: number | null;
  gain: number | null;
  gainBps: number | null;
  bps: number | null;
  /** ตัวเลขเงินของแถวนี้เป็นสกุลไหน (โหมด Currency แสดงมูลค่าเป็นบาทเสมอ) */
  unit: DashCurrency;
}

const SIZE = { w: 400, h: 360, cx: 200, cy: 180, r: 108, stroke: 50 };
const CIRC = 2 * Math.PI * SIZE.r;
const LABEL_MIN_BPS = 300;

const fmt = (unit: DashCurrency, v: number): string => (unit === 'THB' ? baht(v) : usd(v));
const fmtSigned = (unit: DashCurrency, v: number): string => (unit === 'THB' ? signed(v) : usdSigned(v));
const tone = (v: number): string => (v > 0 ? 'is-pos' : v < 0 ? 'is-neg' : '');

function holdingToRow(h: HoldingRow, unit: DashCurrency): Row {
  return { key: h.assetId, name: h.name, sub: h.ticker, badge: h.ticker, value: h.value, invested: h.invested, gain: h.gain, gainBps: h.gainBps, bps: h.bps, unit };
}

/** ข้อความอ่านของแถว (โปรแกรมอ่านหน้าจอ): ชื่อ มูลค่า ลงทุน กำไร สัดส่วน · ประกอบจากข้อความที่จัดรูปแล้ว ไม่มีการคำนวณ */
export function rowLabel(r: Row): string {
  const parts = [`${r.name} (${r.sub})`, r.value !== null ? `value ${fmt(r.unit, r.value)}` : 'value not available'];
  if (r.invested !== null) parts.push(`invested ${fmt(r.unit, r.invested)}`);
  if (r.gain !== null) parts.push(`gain ${fmtSigned(r.unit, r.gain)}${r.gainBps !== null ? ` (${bpsText(r.gainBps, true)})` : ''}`);
  parts.push(r.bps !== null ? `allocation ${formatBps(r.bps)}` : 'allocation not available');
  return parts.join(', ');
}

function colorClass(index: number): string {
  return index < 0 ? 'sother' : `s${(index % 7) + 1}`;
}

function Donut({ pieces, active, onActive, center }: { pieces: { key: string; label: string; bps: number }[]; active: string | null; onActive: (k: string | null) => void; center: { top: string; main: string; bottom?: string; tone?: string } }) {
  let acc = 0;
  const GAP = 2.5;
  const parts = pieces.map((p, i) => {
    const start = acc;
    acc += p.bps;
    const len = (p.bps / 10000) * CIRC;
    const mid = ((start + p.bps / 2) / 10000) * 2 * Math.PI;
    return { ...p, i, len, off: (start / 10000) * CIRC, mid };
  });
  return (
    <svg className="iv-donut" viewBox={`0 0 ${SIZE.w} ${SIZE.h}`} role="img" aria-label="Portfolio allocation chart. The table lists the same values." onMouseLeave={() => onActive(null)}>
      <g transform={`rotate(-90 ${SIZE.cx} ${SIZE.cy})`}>
        <circle className="iv-donut-bg" cx={SIZE.cx} cy={SIZE.cy} r={SIZE.r} fill="none" strokeWidth={SIZE.stroke} />
        {parts.map((p) => (
          <circle
            key={p.key}
            className={`iv-slice ${colorClass(p.key === 'other' ? -1 : p.i)}${active === p.key ? ' is-active' : active !== null ? ' is-dim' : ''}`}
            cx={SIZE.cx}
            cy={SIZE.cy}
            r={SIZE.r}
            fill="none"
            strokeWidth={SIZE.stroke}
            strokeDasharray={`${Math.max(p.len - (parts.length > 1 ? GAP : 0), 0.01)} ${CIRC}`}
            strokeDashoffset={-p.off}
            onMouseEnter={() => onActive(p.key)}
          />
        ))}
      </g>
      {parts.map((p) => {
        if (p.bps < LABEL_MIN_BPS && active !== p.key) return null;
        const lr = SIZE.r + SIZE.stroke / 2 + 14;
        const x = SIZE.cx + lr * Math.sin(p.mid);
        const y = SIZE.cy - lr * Math.cos(p.mid) + 4;
        return (
          <text key={`l-${p.key}`} className={`iv-donut-label${active === p.key ? ' is-active' : ''}`} x={x} y={y} textAnchor={Math.sin(p.mid) >= 0 ? 'start' : 'end'} aria-hidden="true">
            {formatBps(p.bps)}
          </text>
        );
      })}
      <g className="iv-donut-center" aria-hidden="true">
        <text x={SIZE.cx} y={SIZE.cy - 14} textAnchor="middle" className="iv-c-top">
          {center.top}
        </text>
        <text x={SIZE.cx} y={SIZE.cy + 14} textAnchor="middle" className="iv-c-main">
          {center.main}
        </text>
        {center.bottom && (
          <text x={SIZE.cx} y={SIZE.cy + 38} textAnchor="middle" className={`iv-c-bottom ${center.tone ?? ''}`}>
            {center.bottom}
          </text>
        )}
      </g>
    </svg>
  );
}

function WarningButton({ view }: { view: ReturnType<typeof buildConcentration> }) {
  const id = useId();
  const [dismissed, setDismissed] = useState(false);
  if (!view.warn || view.top === null) return null;
  return (
    <span className={`iv-warn${dismissed ? ' is-dismissed' : ''}`} onMouseLeave={() => setDismissed(false)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDismissed(false); }}>
      <button type="button" className="iv-warn-btn" aria-describedby={id} onKeyDown={(e) => e.key === 'Escape' && setDismissed(true)}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3.5l9.5 16.5h-19zM12 10v4.5M12 17.2v.1" />
        </svg>
        Warning
      </button>
      <span className="iv-pop" id={id} role="tooltip">
        <strong className="iv-pop-title">Your asset allocation</strong>
        <span className="iv-pop-p">
          {view.holdings} holdings. {view.top.ticker} alone is {formatBps(view.top.bps)} of the portfolio.
        </span>
        <span className="iv-pop-p">
          <strong>Concentration risk</strong> means too much money sits in one stock, sector or country. Bad news there hits the whole portfolio hard.
        </span>
        <strong className="iv-pop-sub">Largest portfolio weights</strong>
        <span className="iv-pop-list">
          {view.largest.map((e) => (
            <span key={e.assetId} className="iv-pop-item">
              <strong>
                {e.name} ({e.ticker})
              </strong>{' '}
              {formatBps(e.bps)}
            </span>
          ))}
        </span>
        <span className="iv-pop-foot">How this is calculated: direct holdings only, so stocks held inside funds are not counted yet. The warning appears when one stock is more than 20% of the portfolio. Not investment advice.</span>
      </span>
    </span>
  );
}

export function PortfolioCard({ view, currency }: { view: DashboardView; currency: DashCurrency }) {
  const [mode, setMode] = useState<Mode>('holdings');
  const [active, setActive] = useState<string | null>(null);

  const holdings = useMemo(() => buildHoldingRows(view.us, currency), [view.us, currency]);
  const concentration = useMemo(() => buildConcentration(holdings), [holdings]);
  const stockPieces = useMemo(() => buildDonutPieces(holdings), [holdings]);

  const currencyRows: Row[] | null = useMemo(() => {
    if (view.currencyParts === null || view.currencySlices === null) return null;
    const bpsOf = (k: string): number | null => view.currencySlices?.find((s) => s.key === k)?.bps ?? null;
    return [
      { key: 'USD', name: 'US Dollar (USD)', sub: 'Stocks and USD cash', badge: '$', value: view.currencyParts.usdThb, invested: null, gain: null, gainBps: null, bps: bpsOf('USD'), unit: 'THB' as const },
      { key: 'THB', name: 'Thai Baht (THB)', sub: 'Baht assets and cash', badge: '฿', value: view.currencyParts.thbThb, invested: null, gain: null, gainBps: null, bps: bpsOf('THB'), unit: 'THB' as const },
    ].filter((r) => r.bps !== null);
  }, [view.currencyParts, view.currencySlices]);

  const rows: Row[] = mode === 'holdings' ? holdings.map((h) => holdingToRow(h, currency)) : (currencyRows ?? []);
  const pieces = mode === 'holdings' ? stockPieces : rows.map((r) => ({ key: r.key, label: r.badge, bps: r.bps ?? 0 }));
  const pieceIndex = (key: string): number => (key === 'other' ? -1 : pieces.findIndex((p) => p.key === key));
  const colorOf = (key: string): string => {
    const i = pieceIndex(key);
    return i >= 0 ? colorClass(i) : 'sother';
  };

  const activeRow = active !== null ? rows.find((r) => r.key === active) : undefined;
  const activePiece = active !== null ? pieces.find((p) => p.key === active) : undefined;
  const total = currency === 'THB' ? view.valueThb : view.valueUsd;
  const center = activeRow
    ? {
        top: activeRow.name.length > 22 ? `${activeRow.name.slice(0, 21)}…` : activeRow.name,
        main: activeRow.value !== null ? fmt(activeRow.unit, activeRow.value) : '—',
        bottom: [activeRow.gain !== null ? fmtSigned(activeRow.unit, activeRow.gain) : null, activeRow.bps !== null ? formatBps(activeRow.bps) : null].filter(Boolean).join(' · '),
        tone: activeRow.gain !== null ? tone(activeRow.gain) : '',
      }
    : activePiece
      ? { top: 'Other', main: formatBps(activePiece.bps) }
      : { top: mode === 'holdings' ? `${holdings.length} ${holdings.length === 1 ? 'holding' : 'holdings'}` : `${rows.length} ${rows.length === 1 ? 'currency' : 'currencies'}`, main: mode === 'currency' && view.currencyParts ? baht(view.currencyParts.totalThb) : total !== null ? fmt(currency, total) : '—' };

  const empty = view.empty || holdings.length === 0;
  const modeBtn = (m: Mode, label: string) => (
    <button type="button" className={`iv-seg-btn${mode === m ? ' is-active' : ''}`} aria-pressed={mode === m} onClick={() => { setMode(m); setActive(null); }}>
      {label}
    </button>
  );

  return (
    <section className="iv-card iv-portfolio" aria-labelledby="iv-pf-title">
      <div className="iv-pf-head">
        <h2 id="iv-pf-title">Portfolio</h2>
        <WarningButton view={concentration} />
        <div className="iv-seg" role="group" aria-label="Group portfolio by">
          <TipButton className="iv-seg-btn" tip="Available after automatic data is enabled">
            Sector
          </TipButton>
          {modeBtn('holdings', 'Holdings')}
          {modeBtn('currency', 'Currency')}
        </div>
      </div>
      {empty ? (
        <p className="iv-empty">No holdings yet. Use + Add to record your first stock.</p>
      ) : mode === 'currency' && currencyRows === null ? (
        <p className="iv-empty">Currency split is incomplete: no price or exchange rate yet for a stock you hold.</p>
      ) : (
        <div className="iv-pf-body">
          <div className="iv-donut-wrap">{pieces.length > 0 ? <Donut pieces={pieces} active={active} onActive={setActive} center={center} /> : <p className="iv-empty">Allocation is incomplete: no price or exchange rate yet for a stock you hold.</p>}</div>
          <div className="iv-table-wrap">
            {mode === 'currency' && <p className="iv-note">Values shown in THB (฿)</p>}
            <table className="iv-table">
              <caption className="sr-only">{mode === 'holdings' ? 'Holdings' : 'Currencies, values in THB'} in this portfolio</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col" className="r">
                    Value / Invested
                  </th>
                  <th scope="col" className="r">
                    Gain<span className="sr-only"> (unrealized, compared with the cost of what you hold)</span>
                  </th>
                  <th scope="col" className="r">
                    Allocation ↓
                  </th>
                </tr>
              </thead>
              <tbody onMouseLeave={() => setActive(null)}>
                {rows.map((r) => (
                  <tr key={r.key} aria-label={rowLabel(r)} className={`iv-row-tr ${colorOf(r.key)}${active === r.key ? ' is-active' : ''}`} tabIndex={0} onMouseEnter={() => setActive(r.key)} onFocus={() => setActive(r.key)} onBlur={() => setActive(null)}>
                    <th scope="row">
                      <span className="iv-name">
                        <span className="iv-tick" aria-hidden="true">
                          {r.badge.slice(0, 4)}
                        </span>
                        <span>
                          <strong>{r.name}</strong>
                          <small>{r.sub}</small>
                        </span>
                      </span>
                    </th>
                    <td className="r num">
                      <strong>{r.value !== null ? fmt(r.unit, r.value) : <Missing />}</strong>
                      <small>{r.invested !== null ? fmt(r.unit, r.invested) : '—'}</small>
                    </td>
                    <td className="r num">
                      {r.gain !== null ? (
                        <>
                          <span className={tone(r.gain)}>{fmtSigned(r.unit, r.gain)}</span>
                          {r.gainBps !== null && (
                            <small className={tone(r.gainBps)}>
                              <span aria-hidden="true">{r.gainBps > 0 ? '▲ ' : r.gainBps < 0 ? '▼ ' : ''}</span>
                              {bpsText(r.gainBps, true)}
                            </small>
                          )}
                        </>
                      ) : (
                        <Missing />
                      )}
                    </td>
                    <td className="r num">{r.bps !== null ? formatBps(r.bps) : <Missing />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function Missing() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">Not available</span>
    </>
  );
}
