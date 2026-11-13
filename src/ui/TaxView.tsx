import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  balanceSummary,
  buildTaxInput,
  confidenceBadge,
  DEDUCTION_LABELS,
  emptyTaxForm,
  TAX_DISCLAIMER,
  TAX_CONTINUING_NOTE,
  TAX_DISPLAY_NOTE,
  TAX_LIMITATIONS,
  TAX_PARTIAL_NOTE,
  TAX_UNSUPPORTED_NOTE,
  type TaxForm,
  type TaxFormError,
  type TaxFormResult,
  type TaxFormTextField,
} from '../app/taxForm';
import { TAX_CONFIG_2569 } from '../domain/tax/config';
import { formatWholeBaht } from '../domain/tax/display';
import { AUTO_DEDUCTION_KEYS, type SalaryTaxResult } from '../domain/tax/salaryTax';

const cfg = TAX_CONFIG_2569;

const FIELD_ID: Record<TaxFormTextField, string> = {
  annualSalary: 'tx-salary',
  withheldTax: 'tx-withheld',
  socialSecurityPaid: 'tx-ss',
  rmfPaid: 'tx-rmf',
  providentFundPaid: 'tx-pvd',
  pensionInsurancePaid: 'tx-pension',
  thaiEsgPaid: 'tx-esg',
  childrenCount: 'tx-children',
  extraChildrenCount: 'tx-children-extra',
  parentsCount: 'tx-parents',
  lifeInsurancePaid: 'tx-life',
  healthInsurancePaid: 'tx-health',
  parentsHealthPaid: 'tx-parents-health',
  mortgageInterestPaid: 'tx-mortgage',
  donationPaid: 'tx-donation',
  livingChildrenCount: 'tx-living',
  adoptedChildrenCount: 'tx-adopted',
  disabledRelativesCount: 'tx-disabled-rel',
  disabledOtherCount: 'tx-disabled-other',
  prenatalPaid1: 'tx-prenatal-1',
  prenatalPaid2: 'tx-prenatal-2',
  spouseLifeInsurancePaid: 'tx-spouse-life',
};

interface FieldProps {
  field: TaxFormTextField;
  label: string;
  /** หน่วยท้ายป้าย: บาท (ค่าเริ่มต้น) หรือ คน */
  unit?: 'บาท' | 'คน';
  hint?: string;
  placeholder?: string;
  value: string;
  errors: TaxFormError[];
  onChange: (v: string) => void;
}

function Field({ field, label, unit = 'บาท', hint, placeholder, value, errors, onChange }: FieldProps) {
  const id = FIELD_ID[field];
  const error = errors.find((e) => e.field === field);
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} ({unit})
      </label>
      <input
        id={id}
        type="text"
        inputMode={unit === 'คน' ? 'numeric' : 'decimal'}
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

/** ช่องให้หน้าอื่นเสียบส่วน "ดึงยอดซื้อจากพอร์ต" เข้ามา (ไม่ผูกกับฐานข้อมูลในหน้านี้เอง จึงทดสอบแบบไม่ต้องมี repository ได้) */
export interface TaxViewProps {
  portfolio?: (fill: (patch: { rmfPaid?: string; thaiEsgPaid?: string }) => void, current: { rmfPaid: string; thaiEsgPaid: string }) => ReactNode;
}

export function TaxView({ portfolio }: TaxViewProps = {}) {
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
          <p className="muted small">
            ค่าลดหย่อนทุกช่องไม่บังคับ · ลดหย่อนส่วนตัว {formatWholeBaht(cfg.personalAllowance.satang)} และค่าใช้จ่ายร้อยละ 50 (ไม่เกิน {formatWholeBaht(cfg.employmentExpense.capSatang ?? 0)}) ใส่ให้อัตโนมัติ
          </p>
          <fieldset className="pf-fieldset">
            <legend>คู่สมรสและบุตร</legend>
            <div className="field">
              <label className="check-row" htmlFor="tx-spouse">
                <input id="tx-spouse" type="checkbox" checked={form.spouseNoIncome} onChange={(e) => set({ spouseNoIncome: e.target.checked })} />
                <span>คู่สมรสไม่มีเงินได้</span>
              </label>
            </div>
            <div className="field-row">
              <Field field="spouseLifeInsurancePaid" label="เบี้ยประกันชีวิตคู่สมรสที่จ่ายในปี" hint="ใช้ได้เมื่อติ๊ก คู่สมรสไม่มีเงินได้ ไม่เกิน 10,000 บาท" placeholder="ไม่บังคับ" value={form.spouseLifeInsurancePaid} errors={errors} onChange={(v2) => set({ spouseLifeInsurancePaid: v2 })} />
            </div>
            <div className="field-row">
              <Field field="childrenCount" label="จำนวนบุตร (ลูกของคุณเอง)" unit="คน" placeholder="0" value={form.childrenCount} errors={errors} onChange={(v2) => set({ childrenCount: v2 })} />
              <Field
                field="extraChildrenCount"
                label="บุตรคนที่ 2 ขึ้นไป ที่เกิดปี 2561 เป็นต้นมา"
                unit="คน"
                hint="ได้คนละ 60,000 บาท (นับเฉพาะคนที่ 2 เป็นต้นไป)"
                placeholder="0"
                value={form.extraChildrenCount}
                errors={errors}
                onChange={(v2) => set({ extraChildrenCount: v2 })}
              />
            </div>
            <div className="field-row">
              <Field field="livingChildrenCount" label="บุตรที่ยังมีชีวิตทั้งหมด (รวมคนที่ไม่ได้ลดหย่อน)" unit="คน" hint="ใช้นับเพดานบุตรบุญธรรม 3 คน ถ้าเว้นว่างจะใช้จำนวนบุตรด้านบน" placeholder="เว้นว่างได้" value={form.livingChildrenCount} errors={errors} onChange={(v2) => set({ livingChildrenCount: v2 })} />
              <Field field="adoptedChildrenCount" label="จำนวนบุตรบุญธรรม" unit="คน" hint="รวมกับบุตรตามกฎหมายหักได้ไม่เกิน 3 คน" placeholder="0" value={form.adoptedChildrenCount} errors={errors} onChange={(v2) => set({ adoptedChildrenCount: v2 })} />
            </div>
            <div className="field-row">
              <Field field="prenatalPaid1" label="ค่าฝากครรภ์และคลอดบุตร ครรภ์ที่ 1" hint="จ่ายจริงไม่เกิน 60,000 บาทต่อครรภ์" placeholder="ไม่บังคับ" value={form.prenatalPaid1} errors={errors} onChange={(v2) => set({ prenatalPaid1: v2 })} />
              <Field field="prenatalPaid2" label="ค่าฝากครรภ์และคลอดบุตร ครรภ์ที่ 2" hint="ใช้เมื่อมีสองครรภ์ในปีเดียวกัน" placeholder="ไม่บังคับ" value={form.prenatalPaid2} errors={errors} onChange={(v2) => set({ prenatalPaid2: v2 })} />
            </div>
          </fieldset>
          <fieldset className="pf-fieldset">
            <legend>บิดามารดา</legend>
            <div className="field-row">
              <Field field="parentsCount" label="จำนวนบิดามารดาที่เลี้ยงดู" unit="คน" hint="อายุ 60 ปีขึ้นไป รายได้ไม่เกิน 30,000 บาทต่อปี รวมของคู่สมรสได้ไม่เกิน 4 คน" placeholder="0" value={form.parentsCount} errors={errors} onChange={(v2) => set({ parentsCount: v2 })} />
              <Field field="parentsHealthPaid" label="เบี้ยประกันสุขภาพบิดามารดาที่จ่ายในปี" hint="ไม่เกิน 15,000 บาท" placeholder="ไม่บังคับ" value={form.parentsHealthPaid} errors={errors} onChange={(v2) => set({ parentsHealthPaid: v2 })} />
            </div>
          </fieldset>
          <fieldset className="pf-fieldset">
            <legend>คนพิการหรือทุพพลภาพที่คุณเลี้ยงดู</legend>
            <div className="field-row">
              <Field field="disabledRelativesCount" label="คนพิการในครอบครัว" unit="คน" hint="พ่อแม่ คู่สมรส ลูก หรือพ่อแม่ของคู่สมรส (มีบัตรคนพิการ รายได้ไม่เกิน 30,000 บาทต่อปี)" placeholder="0" value={form.disabledRelativesCount} errors={errors} onChange={(v2) => set({ disabledRelativesCount: v2 })} />
              <Field field="disabledOtherCount" label="คนพิการที่ไม่ใช่คนในครอบครัวข้างต้น" unit="คน" hint="ได้ไม่เกิน 1 คน" placeholder="0" value={form.disabledOtherCount} errors={errors} onChange={(v2) => set({ disabledOtherCount: v2 })} />
            </div>
          </fieldset>
          <fieldset className="pf-fieldset">
            <legend>ประกัน บ้าน และบริจาค</legend>
            <div className="field-row">
              <Field field="socialSecurityPaid" label="เงินสมทบประกันสังคมที่จ่ายทั้งปี" hint="กรอกยอดที่จ่ายจริงตามสลิปเงินเดือน" placeholder="ไม่บังคับ" value={form.socialSecurityPaid} errors={errors} onChange={(v) => set({ socialSecurityPaid: v })} />
              <Field field="lifeInsurancePaid" label="เบี้ยประกันชีวิตที่จ่ายในปี" hint="กรมธรรม์อายุ 10 ปีขึ้นไป" placeholder="ไม่บังคับ" value={form.lifeInsurancePaid} errors={errors} onChange={(v) => set({ lifeInsurancePaid: v })} />
            </div>
            <div className="field-row">
              <Field field="healthInsurancePaid" label="เบี้ยประกันสุขภาพที่จ่ายในปี" placeholder="ไม่บังคับ" value={form.healthInsurancePaid} errors={errors} onChange={(v) => set({ healthInsurancePaid: v })} />
              <Field field="mortgageInterestPaid" label="ดอกเบี้ยเงินกู้ที่อยู่อาศัยที่จ่ายในปี" placeholder="ไม่บังคับ" value={form.mortgageInterestPaid} errors={errors} onChange={(v) => set({ mortgageInterestPaid: v })} />
            </div>
            <div className="field-row">
              <Field field="donationPaid" label="เงินบริจาคทั่วไปที่จ่ายในปี" hint="ไม่รวมบริจาคแบบ e-Donation ที่ได้ 2 เท่า (ยังไม่รองรับ)" placeholder="ไม่บังคับ" value={form.donationPaid} errors={errors} onChange={(v) => set({ donationPaid: v })} />
            </div>
          </fieldset>
          <fieldset className="pf-fieldset">
            <legend>กองทุนเพื่อการเกษียณและ Thai ESG</legend>
            {portfolio?.((patch) => set(patch), { rmfPaid: form.rmfPaid, thaiEsgPaid: form.thaiEsgPaid })}
            <div className="field-row">
              <Field field="providentFundPaid" label="เงินสะสมกองทุนสำรองเลี้ยงชีพที่จ่ายในปี" hint="ส่วนของลูกจ้างเท่านั้น (ไม่รวมส่วนนายจ้าง) · เพดานดูในตารางผลลัพธ์" placeholder="ไม่บังคับ" value={form.providentFundPaid} errors={errors} onChange={(v) => set({ providentFundPaid: v })} />
            </div>
            <div className="field-row">
              <Field field="rmfPaid" label="เงินที่ซื้อ RMF ในปี (กองทุนรวมเพื่อการเลี้ยงชีพ)" placeholder="ไม่บังคับ" value={form.rmfPaid} errors={errors} onChange={(v) => set({ rmfPaid: v })} />
              <Field field="pensionInsurancePaid" label="เบี้ยประกันชีวิตแบบบำนาญที่จ่ายในปี" placeholder="ไม่บังคับ" value={form.pensionInsurancePaid} errors={errors} onChange={(v) => set({ pensionInsurancePaid: v })} />
            </div>
            <div className="field-row">
              <Field field="thaiEsgPaid" label="เงินที่ซื้อ Thai ESG/ThaiESGX ในปี" placeholder="ไม่บังคับ" value={form.thaiEsgPaid} errors={errors} onChange={(v) => set({ thaiEsgPaid: v })} />
            </div>
          </fieldset>
          {errors.some((x) => x.field === 'general') && (
            <p id="tx-general-err" className="avg-err" role="alert" tabIndex={-1}>
              {errors.find((x) => x.field === 'general')?.message}
            </p>
          )}
          {errors.length > 0 && !errors.some((x) => x.field === 'general') && (
            <p id="tx-summary-err" className="avg-err" role="alert">
              กรอกไม่ถูกต้อง {errors.length} ช่อง (ดูข้อความสีแดงใต้แต่ละช่อง) หน้าจอพาไปที่ช่องแรกให้แล้ว
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
          <div className="migrate-table-wrap" role="region" aria-label="ตารางค่าลดหย่อนแต่ละรายการ" tabIndex={0}>
            <table className="migrate-table tax-stack" role="table">
              <caption className="sr-only">ค่าลดหย่อนแต่ละรายการ ที่คุณกรอก ที่ใช้ได้ และสิทธิที่ยังใช้ได้</caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">รายการ</th>
                  <th role="columnheader" scope="col" className="num">ที่คุณกรอก</th>
                  <th role="columnheader" scope="col" className="num">ใช้ได้ (ประมาณการ)</th>
                  <th role="columnheader" scope="col" className="num">สิทธิที่ยังใช้ได้ (ข้อมูลประกอบ)</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {result.deductions.map((d) => {
                  const badge = confidenceBadge(d.confidence, d.basis);
                  return (
                    <tr key={d.key} role="row">
                      <th role="rowheader" scope="row">
                        {DEDUCTION_LABELS[d.key]}
                        {badge && (
                          <span className={d.confidence === 'unverified' ? 'small' : 'muted small'}>
                            {d.confidence !== 'unverified' && d.basis === 'continuing' ? (
                              <>
                                <br />
                                {badge}
                              </>
                            ) : (
                              <>
                                {' · '}
                                {d.confidence === 'unverified' ? <strong>{badge}</strong> : badge}
                              </>
                            )}
                          </span>
                        )}
                        {d.providentSplit && d.allowed > 0 && (
                          <span className="muted small">
                            <br />
                            หักลดหย่อน {formatWholeBaht(d.providentSplit.deduction)} + ส่วนที่ไม่ต้องนำมาคิดภาษี {formatWholeBaht(d.providentSplit.exempt)}
                          </span>
                        )}
                        {d.movedToLife !== undefined && d.movedToLife > 0 && (
                          <span className="muted small">
                            <br />
                            เบี้ยที่กรอกทั้งหมด {formatWholeBaht(d.requested + d.movedToLife)} · แบ่ง {formatWholeBaht(d.movedToLife)} ไปช่องประกันชีวิต (แถวถัดไป) แถวนี้นับเฉพาะส่วนที่เหลือ
                          </span>
                        )}
                        {d.key === 'pensionToLife' && (
                          <span className="muted small">
                            <br />
                            เบี้ยบำนาญเติมช่องประกันชีวิตก่อน เมื่อประกันชีวิตและสุขภาพรวมกันยังไม่เต็ม 100,000 ส่วนที่เหลือจึงนับเข้ากลุ่มเกษียณ
                          </span>
                        )}
                        {d.clamped && (
                          <span className="muted small">
                            <br />
                            {formatWholeBaht(d.requested) === formatWholeBaht(d.allowed) ? 'ขอเกินเพดานเล็กน้อย (ต่างกันไม่ถึง ฿1)' : `ขอ ${formatWholeBaht(d.requested)} ใช้ได้ ${formatWholeBaht(d.allowed)} (เกินเพดาน)`}
                          </span>
                        )}
                      </th>
                      <td className="num" role="cell" data-label="ที่คุณกรอก">
                        {AUTO_DEDUCTION_KEYS.includes(d.key) ? 'คำนวณจากที่ระบุ' : d.key === 'pensionToLife' ? 'คำนวณให้อัตโนมัติ' : formatWholeBaht(d.requested)}
                      </td>
                      <td className="num" role="cell" data-label="ใช้ได้ (ประมาณการ)">
                        {formatWholeBaht(d.allowed)}
                      </td>
                      <td className="num" role="cell" data-label="สิทธิที่ยังใช้ได้ (ข้อมูลประกอบ)">
                        {d.remaining === null ? '–' : formatWholeBaht(d.remaining)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">{TAX_PARTIAL_NOTE}</p>
          <p className="muted small">รายการที่ติดป้าย "เกณฑ์ที่ใช้ต่อเนื่อง" อ้างอิงเอกสารกรมสรรพากรของปีภาษีก่อนหน้า (2553/2560/2565) ตรวจเท่าที่ค้นได้ ยังไม่ได้ตรวจประกาศครบทุกฉบับของปี 2569</p>
          <details className="muted small">
            <summary>ที่มาของป้าย "เกณฑ์ที่ใช้ต่อเนื่อง"</summary>
            <p>{TAX_CONTINUING_NOTE}</p>
          </details>
          <p className="muted small">"สิทธิที่ยังใช้ได้" คือเพดานที่ยังเหลือภายใต้เงื่อนไขที่แอปรู้ เป็นข้อเท็จจริงเพื่อดูประกอบ ไม่ใช่คำแนะนำ · ประกันชีวิตกับประกันสุขภาพ (และ RMF กับประกันบำนาญ) ใช้เพดานรวมร่วมกัน สิทธิที่เหลือของสองแถวนั้นจึงบวกกันไม่ได้ และแอปตรวจเงื่อนไขการถือครองไม่ได้ (ถ้าขายก่อนครบเงื่อนไข อาจต้องคืนสิทธิลดหย่อน)</p>

          <h3>ขั้นบันไดภาษี (ส่วนของเงินได้สุทธิในแต่ละขั้น)</h3>
          <div className="migrate-table-wrap" role="region" aria-label="ตารางขั้นบันไดภาษี" tabIndex={0}>
            <table className="migrate-table tax-stack" role="table">
              <caption className="sr-only">ขั้นบันไดภาษีและส่วนของเงินได้สุทธิในแต่ละขั้น</caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">ช่วงเงินได้สุทธิ</th>
                  <th role="columnheader" scope="col">อัตรา</th>
                  <th role="columnheader" scope="col" className="num">ส่วนของคุณในขั้นนี้</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {result.brackets.map((b) => (
                  <tr key={b.fromSatang} role="row">
                    <th role="rowheader" scope="row">
                      {b.upToSatang === null ? `เกิน ${formatWholeBaht(b.fromSatang)}` : `${formatWholeBaht(b.fromSatang)} – ${formatWholeBaht(b.upToSatang)}`}
                    </th>
                    <td role="cell" data-label="อัตรา">{b.rateBps === 0 ? 'ยกเว้น' : pctText(b.rateBps)}</td>
                    <td className="num" role="cell" data-label="ส่วนของคุณในขั้นนี้">
                      {formatWholeBaht(b.amountInBracket)}
                    </td>
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
