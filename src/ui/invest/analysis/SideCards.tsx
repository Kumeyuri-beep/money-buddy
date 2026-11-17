import { baht } from '../../../app/bahtFormat';
import { formatDateEn } from '../../../app/dateEn';
import { usd } from '../../../app/usdFormat';
import { formatBps } from '../../../domain/invest/allocation';
import { Dash } from './Dash';
import type { AnalysisModel } from './analysisModel';
import { percentBps } from './format';

/** การ์ดสัดส่วนสกุลเงิน USD เทียบบาท (นิยามเดียวกับแดชบอร์ด · USD แปลงเป็นบาทที่อัตราล่าสุดที่กรอก) */
export function CurrencyCard({ model }: { model: AnalysisModel }) {
  const cs = model.currencyShares;
  return (
    <section className="solid card an-card" aria-labelledby="an-cur-title">
      <h2 id="an-cur-title">Currency mix</h2>
      {cs.kind === 'none' ? (
        <p className="muted">No US stocks yet, so there is no mix to show.</p>
      ) : cs.kind === 'incomplete' ? (
        <p className="muted" role="status">
          Incomplete data or negative USD cash: stock prices and the exchange rate are both needed (cost is never used in place of value), so the mix is not shown.
        </p>
      ) : (
        <>
          <ul className="an-bars">
            {cs.shares.map((s) => (
              <li key={s.key}>
                <div className="an-bar-head">
                  <span>{s.key === 'USD' ? 'US dollar (USD)' : s.key === 'THB' ? 'Thai baht (THB)' : s.label}</span>
                  <span className="num">{formatBps(s.bps)}</span>
                </div>
                <div className="an-bar" aria-hidden="true">
                  <span style={{ width: `${s.bps / 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="muted small">Converted to THB at the latest exchange rate you entered. For the mix only.</p>
        </>
      )}
    </section>
  );
}

/** การ์ดปันผลเทียบเงินลงทุน: ปันผล 12 เดือนย้อนหลัง (ก่อนภาษี) เทียบมูลค่าตลาดและต้นทุน (R25.1-R25.2) */
export function DividendCard({ model, currency }: { model: AnalysisModel; currency: 'THB' | 'USD' }) {
  const d = model.dividend;
  return (
    <section className="solid card an-card" aria-labelledby="an-div-title">
      <h2 id="an-div-title">Dividends vs. invested money</h2>
      <dl className="avg-result">
        <div>
          <dt>Dividends (before tax), last 12 months</dt>
          <dd className="num">{currency === 'THB' ? baht(d.grossThb) : usd(d.grossUsd)}</dd>
        </div>
        <div>
          <dt>After withholding tax, last 12 months</dt>
          <dd className="num">{currency === 'THB' ? baht(d.netThb) : usd(d.netUsd)}</dd>
        </div>
        <div>
          <dt>Dividend yield on market value (%)</dt>
          <dd className="num">{d.yieldBps === null ? <Dash why="Needs a price and an exchange rate" /> : percentBps(d.yieldBps)}</dd>
        </div>
        <div>
          <dt>Dividend yield on cost (%)</dt>
          <dd className="num">{d.yieldOnCostBps === null ? <Dash why="Needs a price and an exchange rate" /> : percentBps(d.yieldOnCostBps)}</dd>
        </div>
      </dl>
      <p className="muted small">Counted after {formatDateEn(d.fromExclusive)} through {formatDateEn(d.toInclusive)} · Shows "—" when a price or rate is missing</p>
    </section>
  );
}
