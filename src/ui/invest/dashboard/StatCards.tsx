import { useState } from 'react';
import { baht, signed } from '../../../app/bahtFormat';
import { usd, usdSigned } from '../../../app/usdFormat';
import { InfoTip } from '../Tip';
import { bpsText, type DashboardView, type DashCurrency } from './dashboardView';

/**
 * 4 การ์ดตัวเลขหลักของแดชบอร์ด /invest (ภาษาอังกฤษ): Value · Total profit · IRR · Passive income
 * รับ view ที่คำนวณด้วยฟังก์ชันโดเมนแล้ว (R17/R20/R24/R25) ไม่มีสูตรเงินที่นี่ · ข้อมูลไม่ครบ = "—" พร้อมเหตุผล ห้ามเลขปลอม
 * บรรทัด "Today" ซ่อนไว้จนกว่าจะมีราคารายวัน (ข้อมูลอัตโนมัติ)
 */

const HIDE_KEY = 'mb-invest-hide-values';
const money = (c: DashCurrency, v: number): string => (c === 'THB' ? baht(v) : usd(v));
const moneySigned = (c: DashCurrency, v: number): string => (c === 'THB' ? signed(v) : usdSigned(v));
const tone = (v: number): string => (v > 0 ? 'is-pos' : v < 0 ? 'is-neg' : '');
const arrow = (v: number): string => (v > 0 ? '▲ ' : v < 0 ? '▼ ' : '');
const MISSING = 'No price or exchange rate yet for a stock you hold';

function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return false;
  }
}
function writeHidden(v: boolean): void {
  try {
    localStorage.setItem(HIDE_KEY, v ? '1' : '0');
  } catch {
    /* เก็บค่าไม่ได้ก็ใช้ต่อได้ (private window) */
  }
}

function Dash({ why }: { why?: string }) {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{why ?? 'No data yet'}</span>
    </>
  );
}

function Title({ id, icon, children, tip, label }: { id: string; icon: string; children: string; tip: string; label: string }) {
  return (
    <div className="iv-card-title">
      <span className="iv-chip-icon" aria-hidden="true">
        {icon}
      </span>
      <h2 id={id}>{children}</h2>
      <InfoTip label={label} tip={tip} />
    </div>
  );
}

export function StatCards({ view, currency, onOpenRetirement }: { view: DashboardView; currency: DashCurrency; onOpenRetirement?: () => void }) {
  const [hidden, setHidden] = useState(readHidden);
  const toggle = () => {
    const next = !hidden;
    setHidden(next);
    writeHidden(next);
  };
  const value = currency === 'THB' ? view.valueThb : view.valueUsd;
  const cost = currency === 'THB' ? view.costThb : view.costUsd;
  const profit = currency === 'THB' ? view.profit.thb : view.profit.usd;
  const profitPct = currency === 'THB' ? view.profitPctThb : view.profitPctUsd;
  const d = view.dividend;
  const gross = currency === 'THB' ? d.grossThb : d.grossUsd;
  const mask = <span aria-label="Hidden">••••••</span>;

  return (
    <div className="iv-row iv-stats">
      <section className="iv-card iv-card-hero" aria-labelledby="iv-value-title">
        <div className="iv-card-top">
          <Title id="iv-value-title" icon="▭" label="About Value" tip="Market value of the stocks you hold now, from the latest prices and exchange rate you entered.">
            Value
          </Title>
          {onOpenRetirement && (
            <button type="button" className="iv-chip" onClick={onOpenRetirement}>
              <span aria-hidden="true">✧ </span>Worth in 10 years?
            </button>
          )}
        </div>
        {view.empty ? (
          <p className="iv-big">
            <Dash why="No holdings yet" />
          </p>
        ) : (
          <>
            <p className="iv-big iv-gold num">
              {hidden ? mask : value !== null ? money(currency, value) : <Dash why={MISSING} />}
              <button type="button" className="iv-eye" aria-pressed={hidden} aria-label={hidden ? 'Show amounts' : 'Hide amounts'} onClick={toggle}>
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" />
                  {hidden && <path d="M4 4l16 16" />}
                </svg>
              </button>
            </p>
            <p className="iv-sub num">{hidden ? mask : `${money(currency, cost)} invested`}</p>
            {value === null && !hidden && <p className="iv-sub">Incomplete: {MISSING}. Cost is not used instead.</p>}
          </>
        )}
      </section>

      <section className="iv-card" aria-labelledby="iv-profit-title">
        <Title id="iv-profit-title" icon="↗" label="About Total profit" tip="Price gains (sold and unsold) + dividends before tax + currency effect − fees and tax. The percentage is compared with the cost of what you still hold.">
          Total profit
        </Title>
        {view.empty ? (
          <p className="iv-big">
            <Dash why="No holdings yet" />
          </p>
        ) : profit !== null ? (
          <>
            <p className="iv-big num">
              <span className={tone(profit.total)}>{moneySigned(currency, profit.total)}</span>
              {profitPct !== null ? (
                <span className={`iv-pct ${tone(profitPct)}`}>
                  <span className="sr-only">Profit percentage </span>
                  <span aria-hidden="true">{arrow(profitPct)}</span>
                  {bpsText(profitPct, true)}
                </span>
              ) : (
                <span className="iv-pct muted">
                  <Dash why="No cost basis for current holdings" />
                </span>
              )}
            </p>
            <p className="iv-sub">Compared with the cost of what you still hold</p>
          </>
        ) : (
          <>
            <p className="iv-big">
              <Dash why={MISSING} />
            </p>
            <p className="iv-sub">Incomplete: {MISSING}</p>
          </>
        )}
      </section>

      <section className="iv-card" aria-labelledby="iv-irr-title">
        <Title id="iv-irr-title" icon="◷" label="About IRR" tip="Yearly return weighted by when you actually bought, sold and received dividends. Shown once you have held for at least 30 days.">
          IRR
        </Title>
        {view.empty ? (
          <p className="iv-big">
            <Dash why="No holdings yet" />
          </p>
        ) : view.irr.kind === 'ok' ? (
          <>
            <p className={`iv-big num ${tone(view.irr.bps)}`}>{bpsText(view.irr.bps)}</p>
            <p className="iv-sub">Money-weighted · from your real buy, sell and dividend dates</p>
          </>
        ) : (
          <>
            <p className="iv-big">
              <Dash />
            </p>
            <p className="iv-sub">
              {view.irr.reason === 'short'
                ? 'Available after 30 days of holding'
                : view.irr.reason === 'missing'
                  ? 'Incomplete: no price or exchange rate yet'
                  : view.irr.reason === 'few-flows'
                    ? 'Needs at least 2 transactions'
                    : view.irr.reason === 'no-sign'
                      ? 'Needs both money out and money in'
                      : 'Cannot be calculated for this data'}
            </p>
          </>
        )}
      </section>

      <section className="iv-card" aria-labelledby="iv-income-title">
        <Title id="iv-income-title" icon="◎" label="About Passive income" tip="Dividends received in the last 12 months, before tax. Yield is that amount divided by the current value of your holdings.">
          Passive income
        </Title>
        {view.empty ? (
          <p className="iv-big">
            <Dash why="No holdings yet" />
          </p>
        ) : (
          <>
            <p className="iv-big num">
              {d.yieldBps !== null ? bpsText(d.yieldBps) : <Dash why="No price or exchange rate yet" />}
              {d.yieldOnCostBps !== null && (
                <span className="iv-pct is-pos">
                  <span className="sr-only">Yield on cost </span>
                  <span aria-hidden="true">▲ </span>
                  {bpsText(d.yieldOnCostBps)}
                </span>
              )}
            </p>
            <p className="iv-sub num">
              {money(currency, gross)} annually (before tax)
              {d.yieldOnCostBps !== null ? ' · green = yield on cost' : ''}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
