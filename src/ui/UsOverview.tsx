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
      <span className="sr-only">ยังไม่มีข้อมูล</span>
    </>
  );
}

/**
 * ภาพรวมพอร์ตหุ้นสหรัฐ (A3-2 · แท็บ "ภาพรวมพอร์ต"): มูลค่ารวมบาท/USD ต้นทุนบาท กำไรยังไม่ขาย การ์ด "กำไรมาจากไหน" และสัดส่วน
 * แสดงเมื่อมีข้อมูล USD เท่านั้น (ไม่มี = ไม่แสดงอะไร ภาพรวมเดิมไม่เปลี่ยน) · ไม่มีราคา/อัตรา = "—" ไม่ใช้ต้นทุนแทน (R20.7)
 */
export function UsOverview({ today, accounts, entries }: { today: string; accounts: readonly Account[]; entries: readonly Entry[] }) {
  const repo = useRepository();
  const [data, setData] = useState<InvestmentData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    repo
      .loadInvestments()
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(friendlyError(e)));
    return () => {
      cancelled = true;
    };
  }, [repo]);
  const view = useMemo(() => buildUsPortfolio(accounts, entries, data ?? emptyInvestments(), today), [accounts, entries, data, today]);

  if (error !== '') {
    return (
      <p className="form-error" role="alert">
        โหลดข้อมูลหุ้นสหรัฐไม่สำเร็จ: {error}
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
        <h2 id="uso-sum-title">หุ้นสหรัฐ (ดอลลาร์)</h2>
        <dl className="avg-result">
          <div>
            <dt>มูลค่ารวม (บาท)</dt>
            <dd className="num">{!holding || hasValue ? baht(t.valueThb) : <Dash />}</dd>
          </div>
          <div>
            <dt>มูลค่ารวม (ดอลลาร์)</dt>
            <dd className="num">{!holding || hasValueUsd ? usd(t.valueUsd) : <Dash />}</dd>
          </div>
          <div>
            <dt>ต้นทุนรวม (บาท)</dt>
            <dd className="num">{baht(t.costThb)}</dd>
          </div>
          <div>
            <dt>กำไรยังไม่ขาย (บาท)</dt>
            <dd className="num">{!holding || whyReady ? signed(t.unrealizedThb) : <Dash />}</dd>
          </div>
          <div>
            <dt>เงินสด USD</dt>
            <dd className="num">{usd(view.cashUsd)}</dd>
          </div>
        </dl>
        {!t.complete && (
          <p className="muted small" role="status">
            มูลค่านี้ไม่ครบ: มีหุ้นที่ยังไม่มีราคาหรืออัตราแลกเปลี่ยน (ระบบไม่ใช้ต้นทุนแทน) กรอกได้ที่แท็บ "หุ้นสหรัฐ"
          </p>
        )}
        {view.fx && (
          <p className="muted small">
            แปลงเป็นบาทที่อัตราล่าสุดที่กรอก {fxRateText(view.fx.rateMicro)}
            {view.fx.stale ? ` (เก่า ${view.fx.days} วัน)` : ''}
          </p>
        )}
      </section>

      <section className="glass-lite card" aria-labelledby="uso-why-title">
        <h2 id="uso-why-title">กำไรมาจากไหน</h2>
        {holding && whyReady ? (
          <>
            <dl className="avg-result">
              <div>
                <dt>จากราคาหุ้น</dt>
                <dd className="num">{signed(t.priceGainThb)}</dd>
              </div>
              <div>
                <dt>จากค่าเงิน</dt>
                <dd className="num">{signed(t.fxGainThb)}</dd>
              </div>
              <div>
                <dt>รวม (กำไรยังไม่ขาย)</dt>
                <dd className="num">{signed(t.unrealizedThb)}</dd>
              </div>
            </dl>
            <p className="muted small">จากราคาหุ้น = กำไรเป็นดอลลาร์แปลงที่อัตราล่าสุด · จากค่าเงิน = ส่วนที่เหลือ (ค่าแสดงผล ไม่ใช่ฐานภาษี)</p>
          </>
        ) : (
          <p className="muted">ยังแยกไม่ได้ เพราะยังไม่มีหุ้นที่ถืออยู่พร้อมราคาและอัตราแลกเปลี่ยน</p>
        )}
      </section>

      {view.allocation.length > 0 && (
        <section className="solid card" aria-labelledby="uso-alloc-title">
          <h2 id="uso-alloc-title">สัดส่วนพอร์ตหุ้นสหรัฐ</h2>
          <ul className="bill-list">
            {view.allocation.map((s) => (
              <li key={s.key} className="tx bill-row">
                <div className="tx-main">
                  <strong>{s.key === 'other' ? 'อื่นๆ' : (view.rows.find((r) => r.assetId === s.key)?.ticker ?? s.key)}</strong>
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
