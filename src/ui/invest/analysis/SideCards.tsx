import { baht } from '../../../app/bahtFormat';
import { thaiFullDate } from '../../../app/dates';
import { usd } from '../../../app/usdFormat';
import { formatBps } from '../../../domain/invest/allocation';
import { Dash } from './Dash';
import type { AnalysisModel } from './analysisModel';
import { percentBps } from './format';

const CURRENCY_LABEL: Record<string, string> = { stocks: 'หุ้นสหรัฐ (ดอลลาร์)', cash: 'เงินสด USD' };

/** การ์ดสัดส่วนสกุลเงิน: หุ้น USD กับเงินสด USD (มูลค่าแปลงเป็นบาทที่อัตราล่าสุดที่กรอก) · สินทรัพย์สกุลบาทยังไม่รวมในแท็บนี้ */
export function CurrencyCard({ model }: { model: AnalysisModel }) {
  return (
    <section className="glass-lite card an-card" aria-labelledby="an-cur-title">
      <h2 id="an-cur-title">สัดส่วนสกุลเงิน</h2>
      {!model.hasStocks ? (
        <p className="muted">ยังไม่มีหุ้นสหรัฐ จึงยังไม่มีสัดส่วนให้แสดง</p>
      ) : model.currencyShares === null ? (
        <p className="muted" role="status">
          ยังไม่แสดง: ต้องมีราคาหุ้นและอัตราแลกเปลี่ยนครบ (ระบบไม่ใช้ต้นทุนแทนมูลค่า)
        </p>
      ) : (
        <>
          <ul className="an-bars">
            {model.currencyShares.map((s) => (
              <li key={s.key}>
                <div className="an-bar-head">
                  <span>{CURRENCY_LABEL[s.key] ?? s.key}</span>
                  <span className="num">{formatBps(s.bps)}</span>
                </div>
                <div className="an-bar" aria-hidden="true">
                  <span style={{ width: `${s.bps / 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="muted small">นับเฉพาะสินทรัพย์สกุลดอลลาร์ · แปลงเป็นบาทที่อัตราล่าสุดที่กรอก · ใช้ดูสัดส่วนเท่านั้น</p>
        </>
      )}
    </section>
  );
}

/** การ์ดปันผลเทียบเงินลงทุน: ปันผล 12 เดือนย้อนหลัง (ก่อนภาษี) yield และ yield on cost (R25.1-R25.2) */
export function DividendCard({ model, currency }: { model: AnalysisModel; currency: 'THB' | 'USD' }) {
  const d = model.dividend;
  return (
    <section className="glass-lite card an-card" aria-labelledby="an-div-title">
      <h2 id="an-div-title">ปันผลเทียบเงินลงทุน</h2>
      {!model.hasStocks ? (
        <p className="muted">ยังไม่มีหุ้นสหรัฐ จึงยังไม่มีปันผลให้เทียบ</p>
      ) : (
        <>
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
              <dt>Yield (ปันผล ÷ มูลค่าตลาด)</dt>
              <dd className="num">{d.yieldBps === null ? <Dash why="ต้องมีราคาและอัตราแลกเปลี่ยน" /> : percentBps(d.yieldBps)}</dd>
            </div>
            <div>
              <dt>Yield on cost (ปันผล ÷ ต้นทุน)</dt>
              <dd className="num">{d.yieldOnCostBps === null ? <Dash why="ต้องมีราคาและอัตราแลกเปลี่ยน" /> : percentBps(d.yieldOnCostBps)}</dd>
            </div>
          </dl>
          <p className="muted small">
            ช่วงที่นับ: หลัง {thaiFullDate(d.fromExclusive)} ถึง {thaiFullDate(d.toInclusive)} · yield ต้องมีราคาและอัตราแลกเปลี่ยนของหุ้นที่ถืออยู่ ไม่มี = "—"
          </p>
        </>
      )}
    </section>
  );
}
