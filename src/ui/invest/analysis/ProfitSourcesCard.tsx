import { signed } from '../../../app/bahtFormat';
import { usd } from '../../../app/usdFormat';
import type { ProfitResult } from '../../../domain/invest/metrics';
import { barPercent, profitSourceRows, type SourceRow } from '../dashboard/dashboardView';
import { Dash } from './Dash';
import { toneOf } from './format';

/** ป้ายอังกฤษของ 6 แหล่งกำไร (ป้ายไทยใน dashboardView ไม่ถูกใช้ที่นี่) */
const LABELS: Record<SourceRow['key'], string> = {
  priceUnrealized: 'Price gain (unsold)',
  priceRealized: 'Price gain (sold)',
  options: 'Options',
  dividendGross: 'Dividends (before tax)',
  fx: 'Currency effect',
  feesAndTax: 'Fees and tax withheld',
};

/**
 * การ์ด "Where the profit comes from": 6 แหล่งกำไรของ R24 เป็นแถบแนวนอน · ใช้ computeProfitSources (ผ่านโมเดล) + profitSourceRows + barPercent
 * ไม่มีสูตรเงินในคอมโพเนนต์ · ไม่ครบข้อมูล (ไม่มีราคา/อัตรา) = บอกเหตุผล ไม่มีเลขปลอม (R20.7) · ค่าบวกมี "+" กำกับ ไม่พึ่งสีอย่างเดียว
 */
export function ProfitSourcesCard({ profit, currency }: { profit: ProfitResult; currency: 'THB' | 'USD' }) {
  const rows = profitSourceRows(profit, currency);
  const src = currency === 'THB' ? profit.thb : profit.usd;
  const fmt = (n: number) => (currency === 'THB' ? signed(n) : n > 0 ? `+${usd(n)}` : usd(n));
  return (
    <section className="solid card an-card" aria-labelledby="an-src-title">
      <h2 id="an-src-title">Where the profit comes from</h2>
      {rows === null || src === null ? (
        <p className="muted" role="status">
          Not shown yet: a price for every stock you hold{currency === 'THB' ? ' and an exchange rate' : ''} is needed.
        </p>
      ) : (
        <>
          <ul className="an-bars an-srcbars">
            {rows.map((r) => {
              const max = rows.reduce((m, x) => Math.max(m, Math.abs(x.value ?? 0)), 0);
              return (
                <li key={r.key}>
                  <div className="an-bar-head">
                    <span>{LABELS[r.key]}</span>
                    <span className={r.value === null ? 'num' : `num an-${toneOf(r.value)}`}>{r.value === null ? <Dash why="Not applicable in the USD view" /> : fmt(r.value)}</span>
                  </div>
                  <div className="an-bar" aria-hidden="true">
                    <span className={r.value !== null && r.value < 0 ? 'an-bar-neg' : undefined} style={{ width: `${r.value === null ? 0 : barPercent(r.value, max)}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
          <dl className="avg-result an-src-total">
            <div>
              <dt>Total profit ({currency === 'THB' ? 'THB' : 'USD'})</dt>
              <dd className={`num an-${toneOf(src.total)}`}>{fmt(src.total)}</dd>
            </div>
          </dl>
          <p className="muted small">The sources add up to total profit. Currency effect applies to the THB view only.</p>
        </>
      )}
    </section>
  );
}
