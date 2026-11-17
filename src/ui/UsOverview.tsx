import { useEffect, useMemo, useState } from 'react';
import { baht, signed } from '../app/bahtFormat';
import { friendlyError } from '../app/errorText';
import { fxRateText, usd } from '../app/usdFormat';
import { buildUsPortfolio } from '../app/usPortfolio';
import { formatBps } from '../domain/invest/allocation';
import { emptyInvestments, type InvestmentData } from '../domain/invest/types';
import type { Account, Entry } from '../domain/ledger/types';
import { useRepository } from './RepositoryContext';

function Dash() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">No data</span>
    </>
  );
}

/**
 * ภาพรวมพอร์ตหุ้นสหรัฐ (A3-2 · แท็บ "ภาพรวมพอร์ต"): มูลค่ารวมบาท/USD ต้นทุนบาท กำไรยังไม่ขาย การ์ด "Where the gain comes from" และสัดส่วน
 * แสดงเมื่อมีข้อมูล USD เท่านั้น (ไม่มี = ไม่แสดงอะไร ภาพรวมเดิมไม่เปลี่ยน) · ไม่มีราคา/อัตรา = "—" ไม่ใช้ต้นทุนแทน (R20.7)
 */
export function UsOverview({ today, accounts, entries, investments }: { today: string; accounts: readonly Account[]; entries: readonly Entry[]; investments?: InvestmentData | null }) {
  const repo = useRepository();
  const [own, setData] = useState<InvestmentData | null>(null);
  const [error, setError] = useState('');
  const data = investments !== undefined ? investments : own;
  useEffect(() => {
    if (investments !== undefined) return; // ผู้เรียกส่งข้อมูลมาให้แล้ว ไม่ต้องโหลดซ้ำ
    let cancelled = false;
    repo
      .loadInvestments()
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(friendlyError(e)));
    return () => {
      cancelled = true;
    };
  }, [repo, investments]);
  const view = useMemo(() => buildUsPortfolio(accounts, entries, data ?? emptyInvestments(), today), [accounts, entries, data, today]);

  if (error !== '') {
    return (
      <p className="form-error" role="alert">
        Could not load US stock data: {error}
      </p>
    );
  }
  if (data === null || !view.hasUsd) return null;
  const t = view.totals;
  const holding = view.rows.some((r) => r.units > 0n);
  const hasValue = view.rows.some((r) => r.valueThb !== null);
  const hasValueUsd = view.rows.some((r) => r.valueUsd !== null);
  const whyReady = view.rows.some((r) => r.priceGainThb !== null);

  return (
    <div className="us-overview">
      <section className="glass-lite card" aria-labelledby="uso-sum-title">
        <h2 id="uso-sum-title">US stock portfolio (USD)</h2>
        <dl className="avg-result">
          <div>
            <dt>Total value (THB){t.complete ? '' : ' · ⚠ incomplete'}</dt>
            <dd className="num">{!holding || hasValue ? baht(t.valueThb) : <Dash />}</dd>
          </div>
          <div>
            <dt>Total value (USD){t.complete ? '' : ' · ⚠ incomplete'}</dt>
            <dd className="num">{!holding || hasValueUsd ? usd(t.valueUsd) : <Dash />}</dd>
          </div>
          <div>
            <dt>Total cost basis (THB)</dt>
            <dd className="num">{baht(t.costThb)}</dd>
          </div>
          <div>
            <dt>Unrealized gain (THB){t.complete ? '' : ' · ⚠ incomplete'}</dt>
            <dd className="num">{!holding || whyReady ? signed(t.unrealizedThb) : <Dash />}</dd>
          </div>
          <div>
            <dt>USD cash</dt>
            <dd className="num">{usd(view.cashUsd)}</dd>
          </div>
        </dl>
        {!t.complete && (
          <p className="muted small" role="status">
            This value is incomplete: some stocks have no price or exchange rate yet (cost basis is not used as a substitute). Enter them in the "US stocks" tab.
          </p>
        )}
        {view.fx && (
          <p className="muted small">
            Converted to THB at the latest rate entered: {fxRateText(view.fx.rateMicro)}
            {view.fx.stale ? ` (${view.fx.days} days old)` : ''}
          </p>
        )}
      </section>

      <section className="glass-lite card" aria-labelledby="uso-why-title">
        <h2 id="uso-why-title">Where the gain comes from</h2>
        {holding && whyReady ? (
          <>
            <dl className="avg-result">
              <div>
                <dt>From stock price</dt>
                <dd className="num">{signed(t.priceGainThb)}</dd>
              </div>
              <div>
                <dt>From exchange rate</dt>
                <dd className="num">{signed(t.fxGainThb)}</dd>
              </div>
              <div>
                <dt>Total (unrealized gain)</dt>
                <dd className="num">{signed(t.unrealizedThb)}</dd>
              </div>
            </dl>
            {!t.complete && (
              <p className="muted small" role="status">
                ⚠ Incomplete: only stocks with both a price and an exchange rate are counted
              </p>
            )}
            <p className="muted small">From stock price = the USD gain converted to THB at the latest rate · From exchange rate = the difference caused by the baht strengthening or weakening against the dollar (for reference only, not a figure for tax filing)</p>
          </>
        ) : (
          <p className="muted">Cannot be split yet because there are no holdings with both a price and an exchange rate</p>
        )}
      </section>

      {view.allocation.length > 0 && (
        <section className="solid card" aria-labelledby="uso-alloc-title">
          <h2 id="uso-alloc-title">US stock allocation</h2>
          <ul className="bill-list">
            {view.allocation.map((s) => (
              <li key={s.key} className="tx bill-row">
                <div className="tx-main">
                  <strong>{s.key === 'other' ? 'Other' : (view.rows.find((r) => r.assetId === s.key)?.ticker ?? s.key)}</strong>
                </div>
                <div className="bill-figures">
                  <span className="num">{formatBps(s.bps)}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
