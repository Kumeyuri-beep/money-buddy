import { useState } from 'react';
import { baht, signed } from '../../../app/bahtFormat';
import { fxRateText, usd, usdSigned } from '../../../app/usdFormat';
import { formatBps } from '../../../domain/invest/allocation';
import { CardUnavailable } from '../CardUnavailable';
import { barPercent, bpsText, profitSourceRows, THAI_MONTH_SHORT, type DashboardView, type DashCurrency, type DonutSlice } from './dashboardView';

/**
 * การ์ดของแท็บ "แดชบอร์ด" (แบบ A · Aurora Glass) · รับ view ที่คำนวณด้วยฟังก์ชันโดเมนมาแล้ว (ดู dashboardView.ts) ไม่มีสูตรเงินที่นี่
 * ข้อมูลไม่ครบ = "—" พร้อมเหตุผล (ห้ามเลขปลอม) · การ์ดสรุปเป็น glass-lite · ปุ่ม ฿/USD (currency) มีผลทุกการ์ดที่แสดงเงิน
 */

const money = (c: DashCurrency, v: number): string => (c === 'THB' ? baht(v) : usd(v));
const moneySigned = (c: DashCurrency, v: number): string => (c === 'THB' ? signed(v) : usdSigned(v));
const tone = (v: number): string => (v > 0 ? 'is-pos' : v < 0 ? 'is-neg' : '');

function Dash({ why }: { why?: string }) {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{why ?? 'ยังไม่มีข้อมูล'}</span>
    </>
  );
}

function EmptyAll() {
  return (
    <section className="solid card dash-card dash-empty" aria-labelledby="dash-empty-title">
      <h2 id="dash-empty-title">ยังไม่มีหุ้นในพอร์ต</h2>
      <p className="muted">เริ่มบันทึกหุ้นสหรัฐได้ที่แท็บ "รายการ" (แท็บหุ้นสหรัฐ) แดชบอร์ดจะแสดงมูลค่า กำไร ปันผล และสัดส่วนให้เมื่อมีข้อมูล</p>
    </section>
  );
}

function Empty() {
  return null;
}

/** แถวบน: 5 การ์ดตัวเลขหลัก */
function TopRow({ view, currency }: { view: DashboardView; currency: DashCurrency }) {
  const value = currency === 'THB' ? view.valueThb : view.valueUsd;
  const other = currency === 'THB' ? view.valueUsd : view.valueThb;
  const cost = currency === 'THB' ? view.costThb : view.costUsd;
  const profit = currency === 'THB' ? view.profit.thb : view.profit.usd;
  const profitPct = currency === 'THB' ? view.profitPctThb : view.profitPctUsd;
  const d = view.dividend;
  const net = currency === 'THB' ? d.netThb : d.netUsd;
  const gross = currency === 'THB' ? d.grossThb : d.grossUsd;
  const missingWhy = 'ยังไม่มีราคาหรืออัตราแลกเปลี่ยนของหุ้นที่ถืออยู่';
  return (
    <div className="dash-row dash-top">
      <section className="glass-lite card dash-card dash-hero" aria-labelledby="dash-value-title">
        <h2 id="dash-value-title">มูลค่าพอร์ต</h2>
        {view.empty ? (
          <Empty />
        ) : (
          <>
            <p className="dash-big num">{value !== null ? money(currency, value) : <Dash why={missingWhy} />}</p>
            <p className="muted small num">
              {currency === 'THB' ? 'USD' : 'บาท'}: {other !== null ? money(currency === 'THB' ? 'USD' : 'THB', other) : '—'}
              {view.fxText ? ` · อัตรา ${fxRateText(view.fxText.rateMicro)}${view.fxText.stale ? ` (เก่า ${view.fxText.days} วัน)` : ''}` : ''}
            </p>
            {value === null && <p className="muted small">ไม่ครบ: {missingWhy} (ไม่ใช้ต้นทุนแทน)</p>}
          </>
        )}
      </section>

      <section className="glass-lite card dash-card" aria-labelledby="dash-cost-title">
        <h2 id="dash-cost-title">เงินลงทุน</h2>
        {view.empty ? <Empty /> : <p className="dash-big num">{money(currency, cost)}</p>}
        {!view.empty && <p className="muted small">ต้นทุนของหุ้นที่ยังถืออยู่ (รวมค่าธรรมเนียม)</p>}
      </section>

      <section className="glass-lite card dash-card" aria-labelledby="dash-profit-title">
        <h2 id="dash-profit-title">กำไรรวม</h2>
        {view.empty ? (
          <Empty />
        ) : profit !== null ? (
          <>
            <p className={`dash-big num ${tone(profit.total)}`}>{moneySigned(currency, profit.total)}</p>
            <p className={`num small ${profitPct === null ? 'muted' : tone(profitPct)}`}>{profitPct === null ? <Dash why="ไม่มีต้นทุนที่ยังถืออยู่" /> : bpsText(profitPct, true)}</p>
            <p className="muted small">เทียบกับต้นทุนที่ยังถืออยู่ · ดูที่ "กำไรมาจากไหน" ด้านล่าง</p>
          </>
        ) : (
          <>
            <p className="dash-big num">
              <Dash why={missingWhy} />
            </p>
            <p className="muted small">ไม่ครบ: {missingWhy}</p>
          </>
        )}
      </section>

      <section className="glass-lite card dash-card" aria-labelledby="dash-irr-title">
        <h2 id="dash-irr-title">ผลตอบแทนต่อปี</h2>
        {view.empty ? (
          <Empty />
        ) : view.irr.kind === 'ok' ? (
          <>
            <p className={`dash-big num ${tone(view.irr.bps)}`}>{bpsText(view.irr.bps, true)}</p>
            <p className="muted small">คิดจากวันที่ซื้อ ขาย และรับปันผลจริง</p>
          </>
        ) : (
          <>
            <p className="dash-big num">
              <Dash />
            </p>
            <p className="muted small">
              {view.irr.reason === 'short'
                ? 'ใช้ได้เมื่อถือครบ 30 วัน'
                : view.irr.reason === 'missing'
                  ? 'ไม่ครบ: ยังไม่มีราคาหรืออัตราแลกเปลี่ยน'
                  : view.irr.reason === 'few-flows'
                    ? 'ต้องมีรายการอย่างน้อย 2 รายการ'
                    : view.irr.reason === 'no-sign'
                      ? 'ยังไม่มีทั้งเงินออกและเงินเข้า'
                      : 'คำนวณไม่ได้กับข้อมูลชุดนี้'}
            </p>
          </>
        )}
      </section>

      <section className="glass-lite card dash-card" aria-labelledby="dash-div-title">
        <h2 id="dash-div-title">รายได้ปันผลต่อปี</h2>
        {view.empty ? (
          <Empty />
        ) : (
          <>
            <p className="dash-big num">{money(currency, net)}</p>
            <p className="muted small num">
              หลังภาษี (12 เดือนล่าสุด) · ก่อนภาษี {money(currency, gross)}
              {d.yieldBps !== null ? ` · อัตราปันผล ${bpsText(d.yieldBps)}` : ' · อัตราปันผล —'}
            </p>
          </>
        )}
      </section>
    </div>
  );
}

const SLICE_CLASSES = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];

function Donut({ slices }: { slices: DonutSlice[] }) {
  // วงกลมความยาวเส้นรอบวง 10,000 หน่วย (pathLength) · แต่ละชิ้น = bps หน่วย (จำนวนเต็ม แสดงผลอย่างเดียว)
  let acc = 0;
  return (
    <svg className="dash-donut" viewBox="0 0 42 42" aria-hidden="true">
      <circle className="dash-donut-bg" cx="21" cy="21" r="15.9155" fill="none" strokeWidth="6" />
      {slices.map((s, i) => {
        const len = s.bps; // pathLength 10,000 หน่วย: 1 bps = 1 หน่วย (จำนวนเต็ม ไม่ใช่เงิน)
        const el = (
          <circle
            key={s.key}
            className={`dash-slice ${s.key === 'other' ? 'sother' : (SLICE_CLASSES[i % SLICE_CLASSES.length] ?? 's1')}`}
            cx="21"
            cy="21"
            r="15.9155"
            fill="none"
            strokeWidth="6"
            pathLength={10000}
            strokeDasharray={`${len} ${10000 - len}`}
            strokeDashoffset={-acc}
            transform="rotate(-90 21 21)"
          />
        );
        acc += len;
        return el;
      })}
    </svg>
  );
}

function AllocationCard({ view }: { view: DashboardView }) {
  const [mode, setMode] = useState<'stock' | 'currency'>('stock');
  const slices = mode === 'stock' ? view.stockSlices : view.currencySlices;
  return (
    <section className="solid card dash-card" aria-labelledby="dash-alloc-title">
      <h2 id="dash-alloc-title">สัดส่วนพอร์ต</h2>
      <div className="dash-seg" role="group" aria-label="แบ่งสัดส่วนตาม">
        <button type="button" className={`dash-seg-btn${mode === 'stock' ? ' is-active' : ''}`} aria-pressed={mode === 'stock'} onClick={() => setMode('stock')}>
          หุ้น
        </button>
        <button type="button" className={`dash-seg-btn${mode === 'currency' ? ' is-active' : ''}`} aria-pressed={mode === 'currency'} onClick={() => setMode('currency')}>
          สกุลเงิน
        </button>
      </div>
      {view.empty ? (
        <Empty />
      ) : slices === null || slices.length === 0 ? (
        <p className="muted small">แบ่งสัดส่วนไม่ได้: ข้อมูลไม่ครบ (ยังไม่มีราคาหรืออัตราแลกเปลี่ยน)</p>
      ) : (
        <div className="dash-alloc" aria-live="polite">
          <Donut slices={slices} />
          <ul className="dash-legend">
            {slices.map((s, i) => (
              <li key={s.key}>
                <span className={`dash-swatch ${s.key === 'other' ? 'sother' : (SLICE_CLASSES[i % SLICE_CLASSES.length] ?? 's1')}`} aria-hidden="true" />
                <span>{s.label}</span>
                <span className="num">{formatBps(s.bps)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function MonthlyDividendCard({ view, currency }: { view: DashboardView; currency: DashCurrency }) {
  const vals = view.monthly.map((m) => (currency === 'THB' ? m.grossThb : m.grossUsd));
  const max = vals.reduce((a, b) => (b > a ? b : a), 0);
  return (
    <section className="solid card dash-card" aria-labelledby="dash-month-title">
      <h2 id="dash-month-title">ปันผลรายเดือนปีนี้ (ก่อนภาษี)</h2>
      {view.empty ? (
        <Empty />
      ) : max === 0 ? (
        <p className="muted small">ปีนี้ยังไม่มีรายการปันผล</p>
      ) : (
        <ol className="dash-months">
          {view.monthly.map((m, i) => (
            <li key={m.month}>
              <span className="dash-mlabel">{THAI_MONTH_SHORT[i]}</span>
              <span className="dash-hbar" aria-hidden="true">
                <span className="dash-hbar-fill is-pos" style={{ width: `${barPercent(vals[i] ?? 0, max)}%` }} />
              </span>
              <span className="dash-mval num">{(vals[i] ?? 0) > 0 ? money(currency, vals[i] ?? 0) : '—'}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ProfitSourcesCard({ view, currency }: { view: DashboardView; currency: DashCurrency }) {
  const rows = profitSourceRows(view.profit, currency);
  const maxAbs = rows ? rows.reduce((a, r) => (r.value !== null && Math.abs(r.value) > a ? Math.abs(r.value) : a), 0) : 0;
  return (
    <section className="solid card dash-card" aria-labelledby="dash-src-title">
      <h2 id="dash-src-title">กำไรมาจากไหน</h2>
      {view.empty ? (
        <Empty />
      ) : rows === null ? (
        <p className="muted small">ไม่ครบ: ยังไม่มีราคาหรืออัตราแลกเปลี่ยนของหุ้นที่ถืออยู่ จึงแยกแหล่งกำไรไม่ได้ (ไม่ใช้ต้นทุนแทน)</p>
      ) : (
        <>
          <ul className="dash-sources">
            {rows.map((r) => (
              <li key={r.key}>
                <div className="dash-src-head">
                  <span>{r.label}</span>
                  <span className={`num ${r.value === null ? '' : tone(r.value)}`}>{r.value === null ? <Dash why="ไม่มีในมุมมองนี้" /> : moneySigned(currency, r.value)}</span>
                </div>
                <div className="dash-hbar" aria-hidden="true">
                  <span className={`dash-hbar-fill ${r.value !== null && r.value < 0 ? 'is-neg' : 'is-pos'}`} style={{ width: `${r.value === null ? 0 : barPercent(r.value, maxAbs)}%` }} />
                </div>
              </li>
            ))}
          </ul>
          {currency === 'USD' && <p className="muted small">ค่าเงินดูได้ในมุมมองบาท</p>}
        </>
      )}
    </section>
  );
}

function GoalCard({ onOpenRetirement }: { onOpenRetirement?: () => void }) {
  return (
    <section className="solid card dash-card" aria-labelledby="dash-goal-title">
      <h2 id="dash-goal-title">ความคืบหน้าเป้าหมาย</h2>
      <p className="muted">ยังไม่ได้ตั้งเป้าหมาย</p>
      {onOpenRetirement && (
        <button type="button" className="card-link" onClick={onOpenRetirement}>
          ตั้งเป้าในแผนเกษียณ
        </button>
      )}
    </section>
  );
}

export function DashboardBody({ view, currency, onOpenRetirement }: { view: DashboardView; currency: DashCurrency; onOpenRetirement?: () => void }) {
  if (view.empty) return <EmptyAll />;
  return (
    <>
      <TopRow view={view} currency={currency} />
      <div className="dash-row dash-mid">
        <CardUnavailable id="dash-chart" title="มูลค่าพอร์ตย้อนหลัง">
          กราฟมูลค่าตามเวลา ต้องมีราคาย้อนหลังอัตโนมัติ
        </CardUnavailable>
        <AllocationCard view={view} />
        <CardUnavailable id="dash-today" title="วันนี้ขึ้น/ลง">
          ยังไม่รองรับ
        </CardUnavailable>
      </div>
      <div className="dash-row dash-bottom">
        <MonthlyDividendCard view={view} currency={currency} />
        <ProfitSourcesCard view={view} currency={currency} />
        <GoalCard onOpenRetirement={onOpenRetirement} />
      </div>
    </>
  );
}
