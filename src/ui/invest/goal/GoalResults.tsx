import { InfoTip } from '../Tip';
import { useId } from 'react';
import { baht } from '../../../app/bahtFormat';
import { usd } from '../../../app/usdFormat';
import { bpsText } from '../dashboard/dashboardView';
import type { GoalKind, GoalCurrency } from '../../../domain/invest/goalProjection';
import { CHART, chartGeometry, wholeUnits, type GoalNeeds, type GoalOutcome } from './goalModel';

export const DISCLAIMER = 'Projection, not a promise: real returns go up and down.';

const money = (c: GoalCurrency, v: number): string => (c === 'THB' ? baht(v) : usd(v));
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const NEEDS: Record<GoalNeeds, string> = {
  rate: 'Needs rate: your goal was set in another currency and there is no exchange rate entered to convert it. Add a rate in Holdings, or switch back to that currency.',
  value: 'Needs data: a stock you hold has no price or exchange rate yet, so the current value is unknown. Cost is not used instead.',
  yield: 'Needs data: a passive income goal needs your dividend yield, which comes from dividends you recorded in the last 12 months and a current price. Nothing is guessed.',
};

/** "1 year 2 months" (เฉพาะข้อความ · เดือนเป็นจำนวนเต็ม) */
function span(months: number): string {
  const m = Math.abs(months);
  const y = (m - (m % 12)) / 12;
  const r = m % 12;
  const parts: string[] = [];
  if (y > 0) parts.push(`${y} year${y === 1 ? '' : 's'}`);
  if (r > 0) parts.push(`${r} month${r === 1 ? '' : 's'}`);
  return parts.length === 0 ? '0 months' : parts.join(' ');
}

interface Props {
  outcome: GoalOutcome | null;
  kind: GoalKind;
  currency: GoalCurrency;
  today: string;
  achieveBy: string;
  hasGoal: boolean;
}

function Chart({ outcome, kind, currency, today, achieveBy }: { outcome: Extract<GoalOutcome, { state: 'ok' }>; kind: GoalKind; currency: GoalCurrency; today: string; achieveBy: string }) {
  const id = useId();
  const g = chartGeometry(outcome, today);
  const { width, height, left, right, top, bottom } = CHART;
  const symbol = currency === 'THB' ? '฿' : '$';
  const targetLabel = kind === 'income' ? `Goal ${money(currency, outcome.targetMinor)}/month` : `Goal ${money(currency, outcome.targetMinor)}`;
  const label = `Projection, not a promise: projected ${kind === 'income' ? 'monthly passive income' : 'portfolio value'} over time against the goal of ${targetLabel}. ${
    outcome.year === null ? 'The goal is not reached within 100 years.' : `The goal is reached in ${outcome.year}.`
  }`;
  const deadlineText = `Target: ${MONTH_NAMES[Number(achieveBy.slice(5, 7)) - 1] ?? ''} ${achieveBy.slice(0, 4)}`;
  const line = g.line.map((p) => `${p.x},${p.y}`).join(' ');
  return (
    <svg className="iv-goal-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-t`} focusable="false">
      <title id={`${id}-t`}>{label}</title>
      {g.yTicks.map((t) => (
        <g key={t.y}>
          <line x1={left} x2={width - right} y1={t.y} y2={t.y} className="iv-goal-grid" />
          <text x={left - 8} y={t.y + 4} textAnchor="end" className="iv-goal-axis">
            {symbol}
            {wholeUnits(t.valueMinor)}
          </text>
        </g>
      ))}
      {g.xTicks.map((t) => (
        <text key={`${t.x}-${t.label}`} x={t.x} y={height - bottom + 20} textAnchor="middle" className="iv-goal-axis">
          {t.label}
        </text>
      ))}
      {g.area && <path d={g.area} className="iv-goal-area" />}
      {g.deadlineX !== null && (
        <g>
          <line x1={g.deadlineX} x2={g.deadlineX} y1={top} y2={height - bottom} className="iv-goal-deadline" />
          <text x={g.deadlineX + 4} y={top + 12} className="iv-goal-axis">
            {deadlineText}
          </text>
        </g>
      )}
      <line x1={left} x2={width - right} y1={g.targetY} y2={g.targetY} className="iv-goal-target" />
      <text x={width - right} y={g.targetY - 6} textAnchor="end" className="iv-goal-target-label">
        {targetLabel}
      </text>
      <polyline points={line} className="iv-goal-line" fill="none" />
      {g.reach && <circle cx={g.reach.x} cy={g.reach.y} r={5} className="iv-goal-reach" />}
    </svg>
  );
}

/** ผลประมาณการ: สถานะ + 3 การ์ด + กราฟ + ข้อความ "Projection, not a promise" (ติดทุกสถานะ) */
export function GoalResults({ outcome, kind, currency, today, achieveBy, hasGoal }: Props) {
  const id = useId();
  let body;
  if (!hasGoal || outcome === null) {
    body = <p className="iv-empty">Set a goal on the left and choose Save and calculate.</p>;
  } else if (outcome.state === 'needs') {
    body = (
      <p className="iv-goal-needs" role="status">
        {NEEDS[outcome.needs]}
      </p>
    );
  } else if (outcome.state === 'invalid') {
    body = (
      <p className="iv-goal-needs" role="status">
        {outcome.reason === 'too-large' ? 'These numbers are too large to project safely. Try a smaller target or return.' : 'Some saved values are out of range. Check the form and save again.'}
      </p>
    );
  } else {
    const reached = outcome.year !== null;
    const statusText = outcome.status === 'on-track' ? 'On track' : 'Behind';
    const slack = outcome.slackMonths;
    const goalSub =
      outcome.months === null
        ? 'Not reached within 100 years'
        : slack === null || slack === 0
          ? 'On the target date'
          : slack > 0
            ? `${span(slack)} before the target date`
            : `${span(slack)} after the target date`;
    const nowLabel = kind === 'income' ? 'Passive income now' : 'Value now';
    body = (
      <>
        <div className="iv-goal-status-row">
          <p className={`iv-goal-status ${outcome.status === 'on-track' ? 'is-pos' : 'is-neg'}`}>
            <span aria-hidden="true">{outcome.status === 'on-track' ? '✓ ' : '▼ '}</span>
            {statusText} · {reached ? `reached in ${outcome.year}` : 'not reached in 100 years'}
          </p>
          <InfoTip label="About these numbers" tip="Estimated with rule R28. A projection, not a promise." />
        </div>
        <div className="iv-goal-stats">
          <div className="iv-goal-stat">
            <p className="iv-goal-stat-label">{nowLabel}</p>
            <p className="iv-goal-stat-value num">
              {money(currency, outcome.nowMinor)}
              {kind === 'income' ? '/mo' : ''}
            </p>
            <p className="iv-sub">{outcome.progressBps === null ? 'No target set' : `${bpsText(outcome.progressBps)} of goal`}</p>
          </div>
          <div className="iv-goal-stat">
            <p className="iv-goal-stat-label">Goal reached</p>
            <p className="iv-goal-stat-value num">{reached ? outcome.year : '—'}</p>
            <p className="iv-sub">{goalSub}</p>
          </div>
          <div className="iv-goal-stat">
            <p className="iv-goal-stat-label">Portfolio needed</p>
            <p className="iv-goal-stat-value num">{outcome.neededMinor === null ? '—' : money(currency, outcome.neededMinor)}</p>
            <p className="iv-sub">{kind === 'income' ? "at today's yield" : 'to reach your target'}</p>
          </div>
        </div>
        <Chart outcome={outcome} kind={kind} currency={currency} today={today} achieveBy={achieveBy} />
      </>
    );
  }
  return (
    <section className="iv-card iv-goal-results" aria-labelledby={`${id}-title`}>
      <div className="iv-goal-head">
        <h3 id={`${id}-title`}>How far away is your target?</h3>
        <span className="iv-goal-badge">Projection</span>
      </div>
      <p className="iv-sub">Based on your contributions, expected return and today&apos;s dividend yield</p>
      {body}
      <p className="iv-goal-disclaimer">{DISCLAIMER}</p>
    </section>
  );
}
