import { useState } from 'react';
import { baht } from '../../../app/bahtFormat';
import { usd } from '../../../app/usdFormat';
import { IncompleteTag } from '../MissingRateNotice';
import { InfoTip, TipAction, TipButton } from '../Tip';
import { barPercent, type DashboardView, type DashCurrency } from './dashboardView';

/**
 * การ์ดล่างของแดชบอร์ด /invest (PR 2 · ภาษาอังกฤษ): Top day gainers/losers · Recent and upcoming events · Future payments · My goal
 * ข้อมูลที่ยังไม่มี (ราคารายวัน ปฏิทินงบ/XD ปันผลล่วงหน้า) = การ์ดอยู่ที่เดิมพร้อม empty state ห้ามเลขปลอม
 * ตัวเลขเดียวที่แสดงจริงคือปันผลที่ได้รับจริงในปีนี้ (view.monthly จาก monthlyDividends · ก่อนภาษี · อัตราวันปันผล R20) ไม่มีสูตรเงินที่นี่
 */

const WAIT = 'Available after automatic data is enabled';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const money = (c: DashCurrency, v: number): string => (c === 'THB' ? baht(v) : usd(v));

function Empty({ children = WAIT }: { children?: string }) {
  return <p className="iv-empty iv-wait">{children}</p>;
}

type SortMode = 'percent' | 'value';

function Movers({ id, title, currency }: { id: string; title: string; currency: DashCurrency }) {
  const [sort, setSort] = useState<SortMode>('percent');
  const symbol = currency === 'THB' ? '฿' : '$';
  const tip = sort === 'percent' ? 'Sort by the asset price change as a percentage' : 'Sort by change in the value of assets in the portfolio';
  return (
    <section className="iv-card" aria-labelledby={`${id}-title`}>
      <div className="iv-card-top">
        <div className="iv-card-title">
          <h2 id={`${id}-title`}>{title}</h2>
          <InfoTip label={`About ${title}`} tip="The change in the asset price (intraday). If the stock exchange is closed now, the change for the previous working day is shown." />
        </div>
        <TipAction
          className="iv-sort"
          tip={tip}
          ariaLabel={sort === 'percent' ? '% sort: currently by percentage change. Switch to value change' : `${symbol} sort: currently by value change. Switch to percentage change`}
          onClick={() => setSort((s) => (s === 'percent' ? 'value' : 'percent'))}
        >
          <span aria-hidden="true">⇅ {sort === 'percent' ? '%' : symbol}</span>
        </TipAction>
      </div>
      <Empty />
    </section>
  );
}

function Events() {
  return (
    <section className="iv-card" aria-labelledby="iv-events-title">
      <div className="iv-card-top">
        <h2 id="iv-events-title">Recent and upcoming events</h2>
        <TipButton className="iv-link" tip={WAIT}>
          See all →
        </TipButton>
      </div>
      <Empty />
    </section>
  );
}

function FuturePayments({ view, currency }: { view: DashboardView; currency: DashCurrency }) {
  const values = view.monthly.map((m) => (currency === 'THB' ? m.grossThb : m.grossUsd));
  const max = values.reduce((a, b) => (b > a ? b : a), 0);
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <section className="iv-card" aria-labelledby="iv-future-title">
      <div className="iv-card-top">
        <div className="iv-card-title">
          <h2 id="iv-future-title">Future payments</h2>
          <InfoTip label="About Future payments" tip="Forecast of future payments based on your current holdings. All values are shown BEFORE tax. To change the tax for specific holdings, go to Portfolio → Holdings." />
        </div>
        <TipButton className="iv-link" tip={WAIT}>
          Calendar →
        </TipButton>
      </div>
      <div className="iv-future-sum">
        <p className="iv-kpi">
          <span>Next 12m</span>
          <strong>
            <span aria-hidden="true">—</span>
            <span className="sr-only">Forecast not available yet</span>
          </strong>
        </p>
        <p className="iv-kpi">
          <span>Received this year</span>
          <strong className="num">
            {money(currency, total)}
            {view.monthlyIncomplete && <IncompleteTag />}
          </strong>
        </p>
        {view.monthlyIncomplete && <p className="iv-sub">Chart incomplete: some dividends have no exchange rate and are not shown.</p>}
        <ul className="iv-legend" aria-label="Legend">
          <li>
            <span className="iv-dot iv-dot-received" aria-hidden="true" />
            Received
          </li>
          <li>
            <span className="iv-dot iv-dot-forecast" aria-hidden="true" />
            Forecast
          </li>
        </ul>
      </div>
      <div className="iv-bars" role="img" aria-label={total === 0 ? 'No dividends received this year yet' : `Dividends received by month this year, before tax. Total ${money(currency, total)}${view.monthlyIncomplete ? ' (incomplete: some dividends have no exchange rate)' : ''}`}>
        {view.monthly.map((m, i) => {
          const v = values[i] ?? 0;
          return (
            <div key={m.month} className="iv-bar-col">
              <span className="iv-bar-val num" aria-hidden="true">
                {v > 0 ? money(currency, v) : ''}
              </span>
              <span className="iv-bar-track">
                <span className="iv-bar" style={{ height: `${v > 0 ? Math.max(barPercent(v, max), 3) : 0}%` }} />
              </span>
              <span className="iv-bar-month" aria-hidden="true">
                {MONTHS[m.month - 1]}
              </span>
            </div>
          );
        })}
      </div>
      <ul className="sr-only" aria-label="Dividends received by month this year">
        {view.monthly.map((m, i) => (
          <li key={m.month}>
            {MONTHS[m.month - 1]}: {money(currency, values[i] ?? 0)}
          </li>
        ))}
      </ul>
      <p className="iv-wait-note">Forecast: {WAIT.toLowerCase()}. Received shows dividends you recorded, before tax.</p>
    </section>
  );
}

function Goal({ onOpenRetirement }: { onOpenRetirement?: () => void }) {
  return (
    <section className="iv-card iv-goal" aria-labelledby="iv-goal-title">
      <div className="iv-card-top">
        <div className="iv-card-title">
          <h2 id="iv-goal-title">My goal</h2>
        </div>
        <TipButton className="iv-link" tip="Coming soon">
          More →
        </TipButton>
      </div>
      <div className="iv-goal-body">
        <p className="iv-goal-q">How far away is your target?</p>
        <p className="iv-goal-p">Set a target for portfolio value or yearly dividend income, and we will show how long it may take based on past returns and your monthly deposits.</p>
        <svg className="iv-target" viewBox="0 0 120 120" width="120" height="120" aria-hidden="true" focusable="false">
          <circle cx="60" cy="60" r="50" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="8" />
          <circle cx="60" cy="60" r="32" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="8" />
          <circle cx="60" cy="60" r="12" fill="var(--gold)" />
          <path d="M60 60L100 20M100 20h-14M100 20v14" stroke="var(--text)" strokeWidth="4" strokeLinecap="round" fill="none" />
        </svg>
        {onOpenRetirement ? (
          <button type="button" className="iv-btn iv-btn-gold" onClick={onOpenRetirement}>
            Set a target
          </button>
        ) : (
          <TipButton className="iv-btn iv-btn-gold" tip="Open the retirement plan from the main menu">
            Set a target
          </TipButton>
        )}
      </div>
    </section>
  );
}

export function LowerCards({ view, currency, onOpenRetirement }: { view: DashboardView; currency: DashCurrency; onOpenRetirement?: () => void }) {
  return (
    <>
      <div className="iv-row iv-movers">
        <Movers id="iv-gainers" title="Top day gainers" currency={currency} />
        <Movers id="iv-losers" title="Top day losers" currency={currency} />
      </div>
      <Events />
      <FuturePayments view={view} currency={currency} />
      <Goal onOpenRetirement={onOpenRetirement} />
    </>
  );
}
