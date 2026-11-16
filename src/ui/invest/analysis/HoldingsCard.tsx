import { useRef, useState, type KeyboardEvent } from 'react';
import { signed } from '../../../app/bahtFormat';
import { usd, usdPrice } from '../../../app/usdFormat';
import { formatBps } from '../../../domain/invest/allocation';
import type { ProfitResult } from '../../../domain/invest/metrics';
import { formatUnits } from '../../../domain/invest/units';
import { Dash } from './Dash';
import { MoneyCell } from './MoneyCell';
import type { AnalysisModel } from './analysisModel';
import { toneOf } from './format';

type Sub = 'general' | 'dividend' | 'profit';
const SUBS: { id: Sub; label: string }[] = [
  { id: 'general', label: 'ทั่วไป' },
  { id: 'dividend', label: 'ปันผล' },
  { id: 'profit', label: 'กำไร' },
];

const NEED = 'ยังไม่มีราคาหรืออัตราแลกเปลี่ยน';

function Name({ ticker, name, colorIndex }: { ticker: string; name: string; colorIndex: number }) {
  return (
    <th scope="row">
      <span className="an-swatch" style={{ background: `var(--chart-slice${colorIndex + 1})` }} aria-hidden="true" />
      <span className="an-name">
        <strong>{ticker || name}</strong>
        {ticker !== '' && <span className="muted small"> {name}</span>}
      </span>
    </th>
  );
}

/** ตารางหุ้นที่ถือ (แท็บย่อย ทั่วไป / ปันผล / กำไร) · ตัวเลขทั้งหมดมาจากโมเดล (domain) · ตารางกว้างเลื่อนในกรอบของตัวเอง */
export function HoldingsCard({ model, currency }: { model: AnalysisModel; currency: 'THB' | 'USD' }) {
  const [sub, setSub] = useState<Sub>('general');
  const refs = useRef<Record<Sub, HTMLButtonElement | null>>({ general: null, dividend: null, profit: null });
  const { us, rows } = model;
  const complete = us.totals.complete;

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % SUBS.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + SUBS.length) % SUBS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = SUBS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = SUBS[next]!.id;
    setSub(id);
    refs.current[id]?.focus();
  };

  if (!model.hasStocks) {
    return (
      <section className="solid card an-card" aria-labelledby="an-hold-title">
        <h2 id="an-hold-title">หุ้นที่ถือ</h2>
        <p className="muted">ยังไม่มีหุ้นสหรัฐ เพิ่มหุ้นและบันทึกการซื้อได้ที่แท็บ "รายการ"</p>
      </section>
    );
  }
  const anyShare = rows.some((r) => r.shareBps !== null);
  const shareTotal = rows.reduce((n, r) => n + (r.shareBps ?? 0), 0); // ผลรวมสัดส่วนจริง (ครบ 10,000 เมื่อทุกหุ้นมีมูลค่า)
  const anyValue = rows.some((r) => r.row.valueThb !== null);
  const anyGain = rows.some((r) => r.row.unrealizedThb !== null);
  const holding = rows.some((r) => r.row.units > 0n);
  const unit = currency === 'THB' ? 'บาท' : 'USD';

  return (
    <section className="solid card an-card" aria-labelledby="an-hold-title">
      <div className="an-card-head">
        <h2 id="an-hold-title">หุ้นที่ถือ</h2>
        <div className="pf-tabs an-subtabs" role="tablist" aria-label="มุมมองตารางหุ้นที่ถือ">
          {SUBS.map((s, i) => (
            <button
              key={s.id}
              ref={(el) => {
                refs.current[s.id] = el;
              }}
              type="button"
              role="tab"
              id={`an-sub-${s.id}`}
              aria-selected={sub === s.id}
              aria-controls="an-sub-panel"
              tabIndex={sub === s.id ? 0 : -1}
              className={`pf-tab${sub === s.id ? ' is-active' : ''}`}
              onClick={() => setSub(s.id)}
              onKeyDown={(e) => onKey(e, i)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {!complete && (
        <p className="muted small" role="status">
          ⚠ ไม่ครบ: มีหุ้นที่ยังไม่มีราคาหรืออัตราแลกเปลี่ยน ระบบไม่ใช้ต้นทุนแทนมูลค่า กรอกได้ที่แท็บ "รายการ"
        </p>
      )}
      <div id="an-sub-panel" role="tabpanel" aria-labelledby={`an-sub-${sub}`}>
        <div className="migrate-table-wrap" role="region" aria-label="ตารางหุ้นที่ถือ เลื่อนซ้ายขวาได้" tabIndex={0}>
          {sub === 'general' && (
            <table className="migrate-table an-table">
              <caption className="sr-only">หุ้นที่ถือ สัดส่วน จำนวน ต้นทุนเฉลี่ย ราคาล่าสุด มูลค่า และกำไรยังไม่ขาย</caption>
              <thead>
                <tr>
                  <th scope="col">หุ้น</th>
                  <th scope="col" className="num">สัดส่วน</th>
                  <th scope="col" className="num">จำนวนหุ้น</th>
                  <th scope="col" className="num">ต้นทุนเฉลี่ย (USD)</th>
                  <th scope="col" className="num">ราคาล่าสุด (USD)</th>
                  <th scope="col" className="num">มูลค่า ({unit})</th>
                  <th scope="col" className="num">กำไรยังไม่ขาย (บาท)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ row: r, shareBps, colorIndex }) => (
                  <tr key={r.assetId}>
                    <Name ticker={r.ticker} name={r.name} colorIndex={colorIndex} />
                    <td className="num">{shareBps === null ? <Dash why={NEED} /> : formatBps(shareBps)}</td>
                    <td className="num">{formatUnits(r.units)}</td>
                    <td className="num">{r.avgCostMicro === null ? <Dash /> : usdPrice(r.avgCostMicro)}</td>
                    <td className="num">
                      {r.price ? usdPrice(r.price.priceMicro) : <Dash why="ยังไม่มีราคา" />}
                      {r.price?.stale && <span className="muted small"> · เก่า {r.price.days} วัน</span>}
                    </td>
                    <td className="num">
                      <MoneyCell thb={r.valueThb} usdCents={r.valueUsd} currency={currency} why={NEED} />
                    </td>
                    <td className="num">
                      <MoneyCell thb={r.unrealizedThb} currency="THB" signedValue why={NEED} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">รวม{complete ? '' : ' (ไม่ครบ)'}</th>
                  <td className="num">{anyShare ? formatBps(shareTotal) : <Dash why={NEED} />}</td>
                  <td className="num"><Dash /></td>
                  <td className="num"><Dash /></td>
                  <td className="num"><Dash /></td>
                  <td className="num">
                    {holding && !anyValue ? <Dash why={NEED} /> : <MoneyCell thb={us.totals.valueThb} usdCents={us.totals.valueUsd} currency={currency} />}
                  </td>
                  <td className="num">
                    {holding && !anyGain ? <Dash why={NEED} /> : <MoneyCell thb={us.totals.unrealizedThb} currency="THB" signedValue />}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
          {sub === 'dividend' && (
            <table className="migrate-table an-table">
              <caption className="sr-only">ปันผลสะสมสุทธิหลังหักภาษีของแต่ละหุ้น</caption>
              <thead>
                <tr>
                  <th scope="col">หุ้น</th>
                  <th scope="col" className="num">ปันผลสะสมสุทธิหลังหักภาษี ({unit})</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ row: r, colorIndex }) => (
                  <tr key={r.assetId}>
                    <Name ticker={r.ticker} name={r.name} colorIndex={colorIndex} />
                    <td className="num"><MoneyCell thb={r.dividendNetThb} usdCents={r.dividendNetUsd} currency={currency} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">รวม</th>
                  <td className="num"><MoneyCell thb={us.totals.dividendNetThb} usdCents={model.dividendNetUsdTotal} currency={currency} /></td>
                </tr>
              </tfoot>
            </table>
          )}
          {sub === 'profit' && (
            <table className="migrate-table an-table">
              <caption className="sr-only">กำไรของแต่ละหุ้นเป็นบาท แยกส่วนจากราคาหุ้นและจากค่าเงิน และกำไรที่ขายแล้ว</caption>
              <thead>
                <tr>
                  <th scope="col">หุ้น</th>
                  <th scope="col" className="num">กำไรยังไม่ขาย (บาท)</th>
                  <th scope="col" className="num">จากราคาหุ้น</th>
                  <th scope="col" className="num">จากค่าเงิน</th>
                  <th scope="col" className="num">ขายแล้ว (บาท)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ row: r, colorIndex }) => (
                  <tr key={r.assetId}>
                    <Name ticker={r.ticker} name={r.name} colorIndex={colorIndex} />
                    <td className="num"><MoneyCell thb={r.unrealizedThb} currency="THB" signedValue why={NEED} /></td>
                    <td className="num"><MoneyCell thb={r.priceGainThb} currency="THB" signedValue why={NEED} /></td>
                    <td className="num"><MoneyCell thb={r.fxGainThb} currency="THB" signedValue why={NEED} /></td>
                    <td className="num"><MoneyCell thb={r.realizedGainThb} currency="THB" signedValue /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">รวม{complete ? '' : ' (ไม่ครบ)'}</th>
                  <td className="num">{holding && !anyGain ? <Dash why={NEED} /> : <MoneyCell thb={us.totals.unrealizedThb} currency="THB" signedValue />}</td>
                  <td className="num">{holding && !anyGain ? <Dash why={NEED} /> : <MoneyCell thb={us.totals.priceGainThb} currency="THB" signedValue />}</td>
                  <td className="num">{holding && !anyGain ? <Dash why={NEED} /> : <MoneyCell thb={us.totals.fxGainThb} currency="THB" signedValue />}</td>
                  <td className="num"><MoneyCell thb={us.totals.realizedGainThb} currency="THB" signedValue /></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
        {sub === 'general' && currency === 'USD' && <p className="muted small">กำไรยังไม่ขายแสดงเป็นบาทเท่านั้น สลับเป็น ฿ เพื่อดูส่วนต่างราคาและค่าเงิน</p>}
        {sub === 'profit' && <ProfitSources profit={model.profit} currency={currency} />}
        <p className="muted small">{sub === 'dividend' ? 'ปันผลสะสมสุทธิ = หลังหักภาษี ณ ที่จ่าย' : 'มูลค่าแปลงเป็นบาทที่อัตราล่าสุดที่กรอก ส่วนต้นทุนเฉลี่ยและราคาเป็นดอลลาร์ต่อหุ้น'}</p>
      </div>
    </section>
  );
}

export function ProfitSources({ profit, currency }: { profit: ProfitResult; currency: 'THB' | 'USD' }) {
  const src = currency === 'THB' ? profit.thb : profit.usd;
  if (src === null) {
    return (
      <div className="an-sources" role="status">
        <h3>กำไรรวมแยกตามแหล่ง</h3>
        <p className="muted small">ยังไม่แสดง: ต้องมีราคาของหุ้นที่ถืออยู่{currency === 'THB' ? 'และอัตราแลกเปลี่ยน' : ''}ครบ</p>
      </div>
    );
  }
  const fmt = (n: number) => (currency === 'THB' ? signed(n) : n > 0 ? `+${usd(n)}` : usd(n));
  const items: [string, number][] = [
    ['ส่วนต่างราคาที่ยังไม่ขาย', src.priceUnrealized],
    ['ขายแล้ว', src.priceRealized],
    ['ปันผล (ก่อนภาษี)', src.dividendGross],
  ];
  if (currency === 'THB' && profit.thb !== null) items.push(['ค่าเงิน', profit.thb.fx]);
  items.push(['ค่าธรรมเนียมและภาษีที่ถูกหัก', src.feesAndTax]);
  return (
    <div className="an-sources">
      <h3>กำไรรวมแยกตามแหล่ง ({currency === 'THB' ? 'บาท' : 'USD'})</h3>
      <dl className="avg-result">
        {items.map(([label, v]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={`num an-${toneOf(v)}`}>{fmt(v)}</dd>
          </div>
        ))}
        <div>
          <dt>กำไรรวม</dt>
          <dd className={`num an-${toneOf(src.total)}`}>{fmt(src.total)}</dd>
        </div>
      </dl>
    </div>
  );
}
