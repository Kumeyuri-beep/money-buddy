import type { ReactNode } from 'react';
import { buildOverview } from '../../app/overview';
import type { Overview } from '../../app/overview';
import {
  formatMonthsTenths,
  formatPercentBps,
  formatSignedBaht,
  formatSignedPercentBps,
  meterPercent,
  sparklinePoints,
} from '../../app/overviewFormat';
import { formatBaht, satang } from '../../domain/money/satang';
import type { Account, Entry } from '../../domain/ledger/types';

const WAITING_TEXT = 'รอข้อมูลเดือนหน้า';

interface SummaryCardsProps {
  accounts: readonly Account[];
  entries: readonly Entry[];
  /** YYYY-MM-DD ตามเวลาเครื่อง */
  today: string;
  /** ไปหน้ารายรับ-รายจ่าย (มีเฉพาะการ์ดที่มีหน้าปลายทางจริง) */
  onOpenLedger: () => void;
}

/** กระจกแท้ (.glass) ถูกใช้ที่นี่ที่เดียว: การ์ดสรุป 8 ใบ ห้ามเพิ่มที่อื่น (เทสต์ตรวจ) */
function Card({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  return (
    <article className="glass card summary-card" aria-label={title}>
      <div className="summary-label">
        {title} · {label}
      </div>
      {children}
    </article>
  );
}

function Link({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="card-link" onClick={onClick}>
      {children}
    </button>
  );
}

function Waiting({ reason, headline = WAITING_TEXT }: { reason: string; headline?: string }) {
  return (
    <>
      <div className="summary-empty">{headline}</div>
      <p className="muted small summary-sub">{reason}</p>
    </>
  );
}

function Meter({ percent, label }: { percent: number; label: string }) {
  return (
    <div className="meter" role="img" aria-label={label}>
      <div className="meter-fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

function Sparkline({ values }: { values: readonly number[] }) {
  const w = 120;
  const h = 32;
  const pts = sparklinePoints(values, w, h);
  if (pts.length === 0) return null;
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function NetWorthCard({ state }: { state: Overview['netWorth'] }) {
  return (
    <Card label="NET WORTH" title="ความมั่งคั่งสุทธิ">
      {state.kind !== 'value' ? (
        <Waiting headline="ยังไม่มีรายการ" reason="ต้องมีรายการอย่างน้อยหนึ่งรายการ" />
      ) : (
        <>
          <div className="summary-value">{formatBaht(satang(state.value))}</div>
          <Sparkline values={state.series.map((p) => p.value)} />
          <p className="muted small summary-sub">
            {state.deltaVsPrevMonth === null
              ? 'เทียบเดือนก่อน: รอข้อมูลเดือนหน้า'
              : `เทียบเดือนก่อน ${state.deltaVsPrevMonth > 0 ? '▲' : state.deltaVsPrevMonth < 0 ? '▼' : '＝'} ${formatSignedBaht(satang(state.deltaVsPrevMonth))}`}
          </p>
        </>
      )}
    </Card>
  );
}

function IncomeCard({
  state,
  walletName,
  onOpenLedger,
}: {
  state: Overview['income'];
  walletName: string | null;
  onOpenLedger: () => void;
}) {
  return (
    <Card label="INCOME" title="รายรับเดือนนี้">
      {state.kind !== 'value' ? (
        <Waiting headline="ยังไม่มีรายการ" reason="ยังไม่มีรายรับ" />
      ) : (
        <>
          <div className="summary-value value-income">{formatBaht(satang(state.total))}</div>
          <p className="muted small summary-sub">
            {state.channels === 0
              ? 'ยังไม่มีรายรับเดือนนี้'
              : `${state.channels} ช่องทาง${walletName ? ` · เข้า ${walletName} มากสุด` : ''}`}
          </p>
          <Link onClick={onOpenLedger}>ดูรายรับ-รายจ่าย →</Link>
        </>
      )}
    </Card>
  );
}

function OutgoingCard({ state, onOpenLedger }: { state: Overview['outgoing']; onOpenLedger: () => void }) {
  return (
    <Card label="OUTGOING" title="รายจ่ายเดือนนี้">
      {state.kind !== 'value' ? (
        <Waiting headline="ยังไม่มีรายการ" reason="ยังไม่มีรายจ่าย" />
      ) : (
        <>
          <div className="summary-value value-expense">{formatBaht(satang(state.total))}</div>
          <p className="muted small summary-sub">แยกบิล / ใช้จ่าย: ตั้งค่า… (เร็วๆ นี้)</p>
          <Link onClick={onOpenLedger}>ดูรายการ →</Link>
        </>
      )}
    </Card>
  );
}

function SurplusCard({ state, onOpenLedger }: { state: Overview['surplus']; onOpenLedger: () => void }) {
  return (
    <Card label="SURPLUS" title="คงเหลือสุทธิเดือนนี้">
      {state.kind !== 'value' ? (
        <Waiting headline="ยังไม่มีรายการ" reason="ยังไม่มีรายการ" />
      ) : (
        <>
          <div className={`summary-value ${state.net > 0 ? 'value-income' : state.net < 0 ? 'value-warn' : ''}`}>
            {formatSignedBaht(satang(state.net))}
          </div>
          <p className="muted small summary-sub">
            {state.net > 0 ? 'เหลือเก็บ' : state.net < 0 ? '⚠ ใช้เกินรายรับ' : 'รายรับเท่ารายจ่าย'} · รายรับ − รายจ่าย
          </p>
          <Link onClick={onOpenLedger}>ดูรายการ →</Link>
        </>
      )}
    </Card>
  );
}

function SafeToSpendCard({ state }: { state: Overview['safeToSpend'] }) {
  return (
    <Card label="SAFE-TO-SPEND" title="ใช้ได้ต่อวันอย่างปลอดภัย">
      {state.kind === 'needs-setup' ? (
        <>
          <div className="summary-empty">ใช้ได้เมื่อมีฟีเจอร์บิลและเป้าออม</div>
        </>
      ) : (
        <Waiting headline="ยังคำนวณไม่ได้" reason="ต้องมีข้อมูลบิลและเป้าออม" />
      )}
    </Card>
  );
}

function SavingsRateCard({ state }: { state: Overview['savingsRate'] }) {
  return (
    <Card label="SAVINGS RATE" title="อัตราการออม">
      {state.kind !== 'value' ? (
        <Waiting reason="ต้องมีรายรับในเดือนนี้" />
      ) : (
        <>
          <div className="summary-value">{formatPercentBps(state.bps)}</div>
          <Meter
            percent={meterPercent(state.bps, state.targetBps)}
            label={`อัตราการออม ${formatPercentBps(state.bps)} จากเป้า ${formatPercentBps(state.targetBps)}`}
          />
          <p className="muted small summary-sub">
            เป้าเริ่มต้น {formatPercentBps(state.targetBps)} · {state.bps >= state.targetBps ? '✓ ถึงเป้า' : 'ยังไม่ถึงเป้า'}
          </p>
        </>
      )}
    </Card>
  );
}

function VsLastMonthCard({ state }: { state: Overview['vsLastMonth'] }) {
  return (
    <Card label="VS LAST MONTH" title="เทียบเดือนก่อน">
      {state.kind !== 'value' ? (
        <Waiting reason="เดือนก่อนยังไม่มีรายจ่ายให้เทียบ" />
      ) : (
        <>
          <div className={`summary-value ${state.bps > 0 ? 'value-warn' : ''}`}>
            {state.bps > 0 ? '▲ ' : state.bps < 0 ? '▼ ' : ''}
            {formatSignedPercentBps(state.bps)}
          </div>
          <p className="muted small summary-sub">
            รายจ่าย{state.bps > 0 ? 'มากขึ้น' : state.bps < 0 ? 'น้อยลง' : 'เท่าเดิม'} · เทียบช่วงเดียวกันเดือนก่อน
          </p>
        </>
      )}
    </Card>
  );
}

function RunwayCard({ state }: { state: Overview['runway'] }) {
  return (
    <Card label="RUNWAY" title="เงินสดใช้ได้อีก">
      {state.kind !== 'value' ? (
        <Waiting reason="ต้องมีเดือนที่ครบและมีรายจ่ายอย่างน้อย 1 เดือน" />
      ) : (
        <>
          <div className="summary-value">{formatMonthsTenths(state.tenths)}</div>
          <Meter
            percent={meterPercent(state.tenths, state.targetTenths)}
            label={`เงินสดใช้ได้ ${formatMonthsTenths(state.tenths)} จากเป้า ${formatMonthsTenths(state.targetTenths)}`}
          />
          <p className="muted small summary-sub">
            เป้าเริ่มต้น {formatMonthsTenths(state.targetTenths)} · {state.tenths >= state.targetTenths ? '✓ ถึงเป้า' : 'ยังไม่ถึงเป้า'}
          </p>
        </>
      )}
    </Card>
  );
}

export function SummaryCards({ accounts, entries, today, onOpenLedger }: SummaryCardsProps) {
  // ถ้าข้อมูลเกินช่วงปลอดภัย (backlog: ยอดใหญ่) ไม่ปล่อยให้หน้าพัง
  let o: Overview;
  try {
    o = buildOverview(accounts, entries, today);
  } catch {
    return (
      <p className="form-error" role="alert">
        คำนวณสรุปภาพรวมไม่ได้ เพราะยอดเงินสูงเกินช่วงที่รองรับ
      </p>
    );
  }
  const topWalletId = o.income.kind === 'value' ? o.income.topWalletId : null;
  const walletName = accounts.find((a) => a.id === topWalletId)?.name ?? null;

  return (
    <section className="summary-grid" aria-label="สรุปภาพรวมเดือนนี้">
      <NetWorthCard state={o.netWorth} />
      <IncomeCard state={o.income} walletName={walletName} onOpenLedger={onOpenLedger} />
      <OutgoingCard state={o.outgoing} onOpenLedger={onOpenLedger} />
      <SurplusCard state={o.surplus} onOpenLedger={onOpenLedger} />
      <SafeToSpendCard state={o.safeToSpend} />
      <SavingsRateCard state={o.savingsRate} />
      <VsLastMonthCard state={o.vsLastMonth} />
      <RunwayCard state={o.runway} />
    </section>
  );
}
