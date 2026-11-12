import { useMemo, useRef, useState, type FormEvent } from 'react';
import {
  balanceSummary,
  buildTaxInput,
  confidenceBadge,
  DEDUCTION_LABELS,
  emptyTaxForm,
  TAX_DISCLAIMER,
  TAX_DISPLAY_NOTE,
  TAX_LIMITATIONS,
  TAX_UNSUPPORTED_NOTE,
  type TaxForm,
  type TaxFormError,
  type TaxFormResult,
  type TaxFormTextField,
} from '../app/taxForm';
import { TAX_CONFIG_2569 } from '../domain/tax/config';
import { formatWholeBaht } from '../domain/tax/display';
import type { SalaryTaxResult } from '../domain/tax/salaryTax';

const cfg = TAX_CONFIG_2569;

const FIELD_ID: Record<TaxFormTextField, string> = {
  annualSalary: 'tx-salary',
  withheldTax: 'tx-withheld',
  socialSecurityPaid: 'tx-ss',
  rmfPaid: 'tx-rmf',
  pensionInsurancePaid: 'tx-pension',
  thaiEsgPaid: 'tx-esg',
};

interface FieldProps {
  field: TaxFormTextField;
  label: string;
  hint?: string;
  placeholder?: string;
  value: string;
  errors: TaxFormError[];
  onChange: (v: string) => void;
}

function Field({ field, label, hint, placeholder, value, errors, onChange }: FieldProps) {
  const id = FIELD_ID[field];
  const error = errors.find((e) => e.field === field);
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label} (บาท)</label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && (
        <p id={`${id}-hint`} className="muted small">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="avg-err">
          {error.message}
        </p>
      )}
    </div>
  );
}


const pctText = (bps: number): string => {
  const whole = (bps - (bps % 100)) / 100;
  const frac = bps % 100;
  return frac === 0 ? `${whole}%` : `${whole}.${String(frac).padStart(2, '0')}%`;
};

export function TaxView() {
  const [form, setForm] = useState<TaxForm>(emptyTaxForm());
  const [submitted, setSubmitted] = useState<TaxFormResult | null>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);

  const set = (patch: Partial<TaxForm>) => setForm((f) => ({ ...f, ...patch }));
  const errors = useMemo<TaxFormError[]>(() => (submitted && !submitted.ok && !submitted.unsupported ? submitted.errors : []), [submitted]);
  const result: SalaryTaxResult | null = submitted && submitted.ok ? submitted.result : null;
  const unsupported = submitted !== null && !submitted.ok && submitted.unsupported === true;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const r = buildTaxInput(form);
    setSubmitted(r);
    if (r.ok) {
      window.requestAnimationFrame(() => resultRef.current?.focus());
    } else if (r.unsupported) {
      window.requestAnimationFrame(() => document.getElementById('tx-unsupported')?.focus());
    } else {
      const first = r.errors.find((x) => x.field !== 'general')?.field as TaxFormTextField | undefined;
      if (first) document.getElementById(FIELD_ID[first])?.focus();
      else document.getElementById('tx-general-err')?.focus();
    }
  };

  const reset = () => {
    setForm(emptyTaxForm());
    setSubmitted(null);
  };

  const unverifiedNotes = [cfg.socialSecurity].filter((x) => x.confidence === 'unverified' && x.note);

  return (
    <>
      <div className="page-header">
        <h2 className="page-title">คำนวณภาษีเงินได้ ปีภาษี {cfg.year}</h2>
        <p className="muted">ประมาณภาษีจากเงินเดือนของคุณ ใช้ตัวเลขที่กรอกเท่านั้น ไม่บันทึกข้อมูลใดๆ</p>
      </div>

      <div className="notice" role="note">
        <p>
          <strong>ประมาณการเท่านั้น ปีภาษี {cfg.year}</strong> {TAX_DISCLAIMER}
        </p>
        <p>ตัวเลขที่นี่ไม่ถูกบันทึกลงสมุดบัญชี และไม่เกี่ยวกับยอดเงินในกระเป๋าของคุณ</p>
      </div>

      <section className="solid card" aria-labelledby="tx-form-title">
        <h2 id="tx-form-title">ข้อมูลของคุณ (ทั้งปี {cfg.year})</h2>
        <form onSubmit={onSubmit} noValidate className="settings-form">
          <div className="field">
            <label className="check-row" htmlFor="tx-other">
              <input id="tx-other" type="checkbox" aria-describedby="tx-other-hint" checked={form.hasOtherIncome} onChange={(e) => set({ hasOtherIncome: e.target.checked })} />
              <span>ฉันมีเงินได้อื่นนอกจากเงินเดือน (เช่น ฟรีแลนซ์ ค่าเช่า ขายของ)</span>
            </label>
            <p id="tx-other-hint" className="muted small">เครื่องคิดนี้ยังไม่รองรับกรณีนี้ (ถ้าติ๊ก จะไม่แสดงตัวเลข)</p>
          </div>
          <div className="field-row">
            <Field field="annualSalary" label="เงินได้จากเงินเดือนทั้งปี (รวมโบนัส)" placeholder="เช่น 600,000" value={form.annualSalary} errors={errors} onChange={(v) => set({ annualSalary: v })} />
            <Field field="withheldTax" label="ภาษีที่ถูกหักไปแล้วทั้งปี" hint="ดูจากสลิปเงินเดือนหรือใบ 50 ทวิ (ใบแสดงภาษีที่นายจ้างหักไว้ให้) ไม่บังคับ" placeholder="ไม่บังคับ" value={form.withheldTax} errors={errors} onChange={(v) => set({ withheldTax: v })} />
          </div>
          <fieldset className="pf-fieldset">
            <legend>ค่าลดหย่อนที่ใช้ (ไม่บังคับ)</legend>
            <p className="muted small">ลดหย่อนส่วนตัว {formatWholeBaht(cfg.personalAllowance.satang)} และค่าใช้จ่ายร้อยละ 50 (ไม่เกิน {formatWholeBaht(cfg.employmentExpense.capSatang ?? 0)}) ใส่ให้อัตโนมัติ</p>
            <div className="field-row">
              <Field field="socialSecurityPaid" label="เงินสมทบประกันสังคมที่จ่ายทั้งปี" placeholder="ไม่บังคับ" value={form.socialSecurityPaid} errors={errors} onChange={(v) => set({ socialSecurityPaid: v })} />
              <Field field="rmfPaid" label="เงินที่ซื้อ RMF ในปี" placeholder="ไม่บังคับ" value={form.rmfPaid} errors={errors} onChange={(v) => set({ rmfPaid: v })} />
            </div>
            <div className="field-row">
              <Field field="pensionInsurancePaid" label="เบี้ยประกันชีวิตแบบบำนาญที่จ่ายในปี" placeholder="ไม่บังคับ" value={form.pensionInsurancePaid} errors={errors} onChange={(v) => set({ pensionInsurancePaid: v })} />
              <Field field="thaiEsgPaid" label="เงินที่ซื้อ Thai ESG/ThaiESGX ในปี" placeholder="ไม่บังคับ" value={form.thaiEsgPaid} errors={errors} onChange={(v) => set({ thaiEsgPaid: v })} />
            </div>
          </fieldset>
          {errors.some((x) => x.field === 'general') && (
            <p id="tx-general-err" className="avg-err" role="alert" tabIndex={-1}>
              {errors.find((x) => x.field === 'general')?.message}
            </p>
          )}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary btn-small btn-grow">
              คำนวณ
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={reset}>
              ล้างค่า
            </button>
          </div>
          <p className="muted small">{TAX_LIMITATIONS}</p>
        </form>
      </section>

      {unsupported && (
        <section className="solid card" aria-labelledby="tx-unsupported">
          <h2 id="tx-unsupported" tabIndex={-1}>
            ยังไม่รองรับ
          </h2>
          <p>{TAX_UNSUPPORTED_NOTE}</p>
        </section>
      )}

      {result && (
        <section className="solid card" aria-labelledby="tx-result-title">
          <h2 id="tx-result-title" ref={resultRef} tabIndex={-1}>
            ผลประมาณการ ปีภาษี {result.year}
          </h2>
          <div className="notice" role="note">
            <p>
              <strong>ตัวเลขประมาณการ ไม่ใช่ยอดจริง</strong>
            </p>
            <p>{TAX_DISCLAIMER}</p>
            <p>{TAX_DISPLAY_NOTE}</p>
            <p>{cfg.basisNotice}</p>
          </div>

          <dl className="avg-result">
            <div>
              <dt>เงินได้ทั้งปี (ประมาณการ)</dt>
              <dd className="num">{formatWholeBaht(result.income)}</dd>
            </div>
            <div>
              <dt>หักค่าใช้จ่าย (ประมาณการ)</dt>
              <dd className="num">{formatWholeBaht(result.expense)}</dd>
            </div>
            <div>
              <dt>หักค่าลดหย่อนรวม (ประมาณการ)</dt>
              <dd className="num">{formatWholeBaht(result.totalAllowances)}</dd>
            </div>
            <div>
              <dt>เงินได้สุทธิ (ประมาณการ)</dt>
              <dd className="num">{formatWholeBaht(result.netIncome)}</dd>
            </div>
            <div>
              <dt>ภาษีที่ประมาณได้</dt>
              <dd className="avg-new num">{formatWholeBaht(result.tax)}</dd>
            </div>
            <div>
              <dt>ภาษีที่ถูกหักไปแล้ว</dt>
              <dd className="num">{formatWholeBaht(result.withheld)}</dd>
            </div>
          </dl>
          <p>
            <strong>{balanceSummary(result.balanceKind, result.balance)}</strong>
          </p>

          {unverifiedNotes.map((n) => (
            <div key={n.source} className="notice" role="note">
              <p>
                <strong>เงินสมทบประกันสังคม · ยังไม่ยืนยัน:</strong> {n.note}
              </p>
            </div>
          ))}
          <h3>ค่าลดหย่อนแต่ละรายการ</h3>
          <div className="migrate-table-wrap" role="region" aria-label="ตารางค่าลดหย่อนแต่ละรายการ เลื่อนซ้ายขวาได้" tabIndex={0}>
            <table className="migrate-table">
              <caption className="sr-only">ค่าลดหย่อนแต่ละรายการ ที่คุณกรอก ที่ใช้ได้ และสิทธิที่ยังใช้ได้</caption>
              <thead>
                <tr>
                  <th scope="col">รายการ</th>
                  <th scope="col" className="num">ที่คุณกรอก</th>
                  <th scope="col" className="num">ใช้ได้ (ประมาณการ)</th>
                  <th scope="col" className="num">สิทธิที่ยังใช้ได้ (ข้อมูลประกอบ)</th>
                </tr>
              </thead>
              <tbody>
                {result.deductions.map((d) => {
                  const badge = confidenceBadge(d.confidence);
                  return (
                    <tr key={d.key}>
                      <th scope="row">
                        {DEDUCTION_LABELS[d.key]}
                        {badge && (
                          <span className={d.confidence === 'unverified' ? 'small' : 'muted small'}>
                            {' · '}
                            {d.confidence === 'unverified' ? <strong>{badge}</strong> : badge}
                          </span>
                        )}
                        {d.clamped && (
                          <span className="muted small">
                            <br />
                            {formatWholeBaht(d.requested) === formatWholeBaht(d.allowed) ? 'ขอเกินเพดานเล็กน้อย (ต่างกันไม่ถึง ฿1)' : `ขอ ${formatWholeBaht(d.requested)} ใช้ได้ ${formatWholeBaht(d.allowed)} (เกินเพดาน)`}
                          </span>
                        )}
                      </th>
                      <td className="num">{d.key === 'personal' ? 'ใส่ให้อัตโนมัติ' : formatWholeBaht(d.requested)}</td>
                      <td className="num">
                        {formatWholeBaht(d.allowed)}
                        
                      </td>
                      <td className="num">{d.remaining === null ? '–' : formatWholeBaht(d.remaining)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">"สิทธิที่ยังใช้ได้" คือเพดานที่ยังเหลือภายใต้เงื่อนไขที่แอปรู้ เป็นข้อเท็จจริงเพื่อดูประกอบ ไม่ใช่คำแนะนำ และแอปตรวจเงื่อนไขการถือครองไม่ได้ (ถ้าขายก่อนครบเงื่อนไข อาจต้องคืนสิทธิลดหย่อน)</p>

          <h3>ขั้นบันไดภาษี (ส่วนของเงินได้สุทธิในแต่ละขั้น)</h3>
          <div className="migrate-table-wrap" role="region" aria-label="ตารางขั้นบันไดภาษี เลื่อนซ้ายขวาได้" tabIndex={0}>
            <table className="migrate-table">
              <caption className="sr-only">ขั้นบันไดภาษีและส่วนของเงินได้สุทธิในแต่ละขั้น</caption>
              <thead>
                <tr>
                  <th scope="col">ช่วงเงินได้สุทธิ</th>
                  <th scope="col">อัตรา</th>
                  <th scope="col" className="num">ส่วนของคุณในขั้นนี้</th>
                </tr>
              </thead>
              <tbody>
                {result.brackets.map((b) => (
                  <tr key={b.fromSatang}>
                    <th scope="row">
                      {b.upToSatang === null ? `เกิน ${formatWholeBaht(b.fromSatang)}` : `${formatWholeBaht(b.fromSatang)} – ${formatWholeBaht(b.upToSatang)}`}
                    </th>
                    <td>{b.rateBps === 0 ? 'ยกเว้น' : pctText(b.rateBps)}</td>
                    <td className="num">{formatWholeBaht(b.amountInBracket)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">{TAX_LIMITATIONS}</p>
        </section>
      )}
    </>
  );
}
