import { useRef, useState, type KeyboardEvent } from 'react';
import { usdPrice } from '../../../app/usdFormat';
import { formatBps } from '../../../domain/invest/allocation';
import { formatUnits } from '../../../domain/invest/units';
import { Dash } from './Dash';
import { MoneyCell } from './MoneyCell';
import type { AnalysisModel } from './analysisModel';

type Sub = 'general' | 'dividend' | 'profit';
const SUBS: { id: Sub; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'dividend', label: 'Dividends' },
  { id: 'profit', label: 'Profit' },
];

const NEED = 'No price or exchange rate yet';

function Name({ ticker, name, colorIndex }: { ticker: string; name: string; colorIndex: number }) {
  return (
    <th scope="row">
      <span className="an-swatch" style={{ background: `var(--chart-slice${colorIndex + 1})` }} aria-hidden="true" />
      <span className="an-name">
        <strong>{ticker || name}</strong>
        {ticker !== '' && <span className="muted small"> {name}</span>}
      </span>
    </th>
  );
}

/** ตารางหุ้นที่ถือ (แท็บย่อย ทั่วไป / ปันผล / กำไร) · ตัวเลขทั้งหมดมาจากโมเดล (domain) · ตารางกว้างเลื่อนในกรอบของตัวเอง */
export function HoldingsCard({ model, currency }: { model: AnalysisModel; currency: 'THB' | 'USD' }) {
  const [sub, setSub] = useState<Sub>('general');
  const refs = useRef<Record<Sub, HTMLButtonElement | null>>({ general: null, dividend: null, profit: null });
  const { us, rows } = model;
  const complete = us.totals.complete;

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % SUBS.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + SUBS.length) % SUBS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = SUBS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = SUBS[next]!.id;
    setSub(id);
    refs.current[id]?.focus();
  };

  if (!model.hasStocks) {
    return (
      <section className="solid card an-card" aria-labelledby="an-hold-title">
        <h2 id="an-hold-title">Holdings</h2>
        <p className="muted">No US stocks yet. Add a stock and record a purchase under Portfolio → Holdings.</p>
      </section>
    );
  }
  const anyShare = rows.some((r) => r.shareBps !== null);
  const shareTotal = rows.reduce((n, r) => n + (r.shareBps ?? 0), 0); // ผลรวมสัดส่วนจริง (ครบ 10,000 เมื่อทุกหุ้นมีมูลค่า)
  const anyValue = rows.some((r) => r.row.valueThb !== null);
  const anyGain = rows.some((r) => r.row.unrealizedThb !== null);
  const holding = rows.some((r) => r.row.units > 0n);
  const unit = currency === 'THB' ? 'THB' : 'USD';

  return (
    <section className="solid card an-card" aria-labelledby="an-hold-title">
      <div className="an-card-head">
        <h2 id="an-hold-title">Holdings</h2>
        <div className="pf-tabs an-subtabs" role="tablist" aria-label="Holdings table view">
          {SUBS.map((s, i) => (
            <button
              key={s.id}
              ref={(el) => {
                refs.current[s.id] = el;
              }}
              type="button"
              role="tab"
              id={`an-sub-${s.id}`}
              aria-selected={sub === s.id}
              aria-controls="an-sub-panel"
              tabIndex={sub === s.id ? 0 : -1}
              className={`pf-tab${sub === s.id ? ' is-active' : ''}`}
              onClick={() => setSub(s.id)}
              onKeyDown={(e) => onKey(e, i)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {!complete && (
        <p className="muted small" role="status">
          ⚠ Incomplete: some stocks have no price or exchange rate. Cost is never used in place of value. Enter them under Portfolio → Holdings.
        </p>
      )}
      <div id="an-sub-panel" role="tabpanel" aria-labelledby={`an-sub-${sub}`}>
        <div className="migrate-table-wrap" role="region" aria-label="Holdings table, scrolls horizontally" tabIndex={0}>
          {sub === 'general' && (
            <table className="migrate-table an-table">
              <caption className="sr-only">Holdings with weight, shares, average cost, last price, value and unrealized gain</caption>
              <thead>
                <tr>
                  <th scope="col">Stock</th>
                  <th scope="col" className="num">Weight</th>
                  <th scope="col" className="num">Shares</th>
                  <th scope="col" className="num">Avg. cost (USD)</th>
                  <th scope="col" className="num">Last price (USD)</th>
                  <th scope="col" className="num">Value ({unit})</th>
                  <th scope="col" className="num">Unrealized gain (THB)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ row: r, shareBps, colorIndex }) => (
                  <tr key={r.assetId}>
                    <Name ticker={r.ticker} name={r.name} colorIndex={colorIndex} />
                    <td className="num">{shareBps === null ? <Dash why={NEED} /> : formatBps(shareBps)}</td>
                    <td className="num">{formatUnits(r.units)}</td>
                    <td className="num">{r.avgCostMicro === null ? <Dash /> : usdPrice(r.avgCostMicro)}</td>
                    <td className="num">
                      {r.price ? usdPrice(r.price.priceMicro) : <Dash why="No price yet" />}
                      {r.price?.stale && <span className="muted small"> · {r.price.days} days old</span>}
                    </td>
                    <td className="num">
                      <MoneyCell thb={r.valueThb} usdCents={r.valueUsd} currency={currency} why={NEED} />
                    </td>
                    <td className="num">
                      <MoneyCell thb={r.unrealizedThb} currency="THB" signedValue why={NEED} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total{complete ? '' : ' (incomplete)'}</th>
                  <td className="num">{anyShare ? formatBps(shareTotal) : <Dash why={NEED} />}</td>
                  <td className="num"><Dash /></td>
                  <td className="num"><Dash /></td>
                  <td className="num"><Dash /></td>
                  <td className="num">
                    {holding && !anyValue ? <Dash why={NEED} /> : <MoneyCell thb={us.totals.valueThb} usdCents={us.totals.valueUsd} currency={currency} />}
                  </td>
                  <td className="num">
                    {holding && !anyGain ? <Dash why={NEED} /> : <MoneyCell thb={us.totals.unrealizedThb} currency="THB" signedValue />}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
          {sub === 'dividend' && (
            <table className="migrate-table an-table">
              <caption className="sr-only">Cumulative dividends after withholding tax, per stock</caption>
              <thead>
                <tr>
                  <th scope="col">Stock</th>
                  <th scope="col" className="num">Cumulative net dividends ({unit})</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ row: r, colorIndex }) => (
                  <tr key={r.assetId}>
                    <Name ticker={r.ticker} name={r.name} colorIndex={colorIndex} />
                    <td className="num"><MoneyCell thb={r.needsRate ? null : r.dividendNetThb} usdCents={r.needsRate ? null : r.dividendNetUsd} currency={currency} why="Needs rate" /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total{complete ? '' : ' (incomplete)'}</th>
                  <td className="num"><MoneyCell thb={us.totals.dividendNetThb} usdCents={model.dividendNetUsdTotal} currency={currency} /></td>
                </tr>
              </tfoot>
            </table>
          )}
          {sub === 'profit' && (
            <table className="migrate-table an-table">
              <caption className="sr-only">Profit per stock in THB, split into price gain and currency effect, plus realized gain</caption>
              <thead>
                <tr>
                  <th scope="col">Stock</th>
                  <th scope="col" className="num">Unrealized gain (THB)</th>
                  <th scope="col" className="num">Price gain</th>
                  <th scope="col" className="num">Currency effect</th>
                  <th scope="col" className="num">Realized (THB)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ row: r, colorIndex }) => (
                  <tr key={r.assetId}>
                    <Name ticker={r.ticker} name={r.name} colorIndex={colorIndex} />
                    <td className="num"><MoneyCell thb={r.unrealizedThb} currency="THB" signedValue why={NEED} /></td>
                    <td className="num"><MoneyCell thb={r.priceGainThb} currency="THB" signedValue why={NEED} /></td>
                    <td className="num"><MoneyCell thb={r.fxGainThb} currency="THB" signedValue why={NEED} /></td>
                    <td className="num"><MoneyCell thb={r.needsRate ? null : r.realizedGainThb} currency="THB" signedValue why="Needs rate" /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total{complete ? '' : ' (incomplete)'}</th>
                  <td className="num">{holding && !anyGain ? <Dash why={NEED} /> : <MoneyCell thb={us.totals.unrealizedThb} currency="THB" signedValue />}</td>
                  <td className="num">{holding && !anyGain ? <Dash why={NEED} /> : <MoneyCell thb={us.totals.priceGainThb} currency="THB" signedValue />}</td>
                  <td className="num">{holding && !anyGain ? <Dash why={NEED} /> : <MoneyCell thb={us.totals.fxGainThb} currency="THB" signedValue />}</td>
                  <td className="num"><MoneyCell thb={us.totals.realizedGainThb} currency="THB" signedValue /></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
        {sub === 'general' && currency === 'USD' && <p className="muted small">Unrealized gain is shown in THB only. Switch to ฿ to see price gain and currency effect.</p>}
        <p className="muted small">{sub === 'dividend' ? 'Cumulative net dividends = after withholding tax' : 'Values are converted to THB at the latest exchange rate you entered. Average cost and price are in dollars per share.'}</p>
      </div>
    </section>
  );
}
