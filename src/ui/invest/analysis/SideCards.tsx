import { baht } from '../../../app/bahtFormat';
import { thaiFullDate } from '../../../app/dates';
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
      <h2 id="an-cur-title">สัดส่วนสกุลเงิน</h2>
      {cs.kind === 'none' ? (
        <p className="muted">ยังไม่มีหุ้นสหรัฐ จึงยังไม่มีสัดส่วนให้แสดง</p>
      ) : cs.kind === 'incomplete' ? (
        <p className="muted" role="status">
          ข้อมูลไม่ครบหรือเงินสด USD ติดลบ: ต้องมีราคาหุ้นและอัตราแลกเปลี่ยนครบ (ระบบไม่ใช้ต้นทุนแทนมูลค่า) จึงยังไม่แสดงสัดส่วน
        </p>
      ) : (
        <>
          <ul className="an-bars">
            {cs.shares.map((s) => (
              <li key={s.key}>
                <div className="an-bar-head">
                  <span>{s.label}</span>
                  <span className="num">{formatBps(s.bps)}</span>
                </div>
                <div className="an-bar" aria-hidden="true">
                  <span style={{ width: `${s.bps / 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="muted small">แปลงเป็นบาทที่อัตราล่าสุดที่กรอก ใช้ดูสัดส่วนเท่านั้น</p>
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
      <h2 id="an-div-title">ปันผลเทียบเงินลงทุน</h2>
      <dl className="avg-result">
        <div>
          <dt>ปันผล (ก่อนภาษี) 12 เดือน</dt>
          <dd className="num">{currency === 'THB' ? baht(d.grossThb) : usd(d.grossUsd)}</dd>
        </div>
        <div>
          <dt>หลังหักภาษี 12 เดือน</dt>
          <dd className="num">{currency === 'THB' ? baht(d.netThb) : usd(d.netUsd)}</dd>
        </div>
        <div>
          <dt>ปันผลต่อปี เทียบมูลค่าตลาด (%)</dt>
          <dd className="num">{d.yieldBps === null ? <Dash why="ต้องมีราคาและอัตราแลกเปลี่ยน" /> : percentBps(d.yieldBps)}</dd>
        </div>
        <div>
          <dt>ปันผลต่อปี เทียบต้นทุน (%)</dt>
          <dd className="num">{d.yieldOnCostBps === null ? <Dash why="ต้องมีราคาและอัตราแลกเปลี่ยน" /> : percentBps(d.yieldOnCostBps)}</dd>
        </div>
      </dl>
      <p className="muted small">นับหลัง {thaiFullDate(d.fromExclusive)} ถึง {thaiFullDate(d.toInclusive)} · ไม่มีราคาหรืออัตราจะแสดง "—"</p>
    </section>
  );
}
