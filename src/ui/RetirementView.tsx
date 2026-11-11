import { useMemo, useRef, useState, type FormEvent } from 'react';
import { buildRetirementInput, emptyRetirementForm, RETIREMENT_DISCLAIMER, RETIREMENT_LIMITATIONS, RETIREMENT_ON_TRACK_NOTE, RETIREMENT_REAL_RETURN_WARNING, type RetirementForm, type RetirementFormError, type RetirementFormField, type RetirementFormResult } from '../app/retirementForm';
import { formatBaht, satang } from '../domain/money/satang';

const baht = (n: number): string => formatBaht(satang(n));
/** bps → ข้อความ % ด้วยจำนวนเต็ม (355 → "3.55%") */
const bpsText = (bps: number): string => {
  const whole = (bps - (bps % 100)) / 100;
  const frac = bps % 100;
  return frac === 0 ? `${whole}%` : `${whole}.${String(frac).padStart(2, '0')}%`;
};

interface FieldProps {
  id: string;
  field: RetirementFormField;
  label: string;
  hint?: string;
  placeholder?: string;
  unit?: string;
  value: string;
  errors: RetirementFormError[];
  onChange: (v: string) => void;
}

function Field({ id, field, label, hint, placeholder, unit, value, errors, onChange }: FieldProps) {
  const error = errors.find((e) => e.field === field);
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {unit ? ` (${unit})` : ''}
      </label>
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

const FIELD_ID: Record<RetirementFormField, string> = {
  currentAge: 'rt-age',
  retireAge: 'rt-retire',
  lifeExpectancy: 'rt-life',
  monthlyExpense: 'rt-expense',
  inflation: 'rt-infl',
  returnBefore: 'rt-rb',
  returnAfter: 'rt-ra',
  currentSavings: 'rt-savings',
};

/**
 * เครื่องคิดเลขเป้าเกษียณ (เฟส 1) · ตัวเลขเป็น "ประมาณการ" ไม่ใช่ยอดในสมุดบัญชี ไม่บันทึกอะไร ไม่แตะฐานข้อมูล
 * คำนวณด้วย domain/retirement เท่านั้น (ห้ามมีสูตรเงินในคอมโพเนนต์)
 */
export function RetirementView() {
  const [form, setForm] = useState<RetirementForm>(emptyRetirementForm());
  const [submitted, setSubmitted] = useState<RetirementFormResult | null>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const set = (patch: Partial<RetirementForm>) => setForm((f) => ({ ...f, ...patch }));

  const errors = useMemo(() => (submitted && !submitted.ok ? submitted.errors : []), [submitted]);
  const result = submitted && submitted.ok ? submitted : null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const r = buildRetirementInput(form);
    setSubmitted(r);
    if (r.ok) {
      window.requestAnimationFrame(() => resultRef.current?.focus());
    } else {
      const first = r.errors[0]?.field;
      if (first) document.getElementById(FIELD_ID[first])?.focus();
    }
  };

  const reset = () => {
    setForm(emptyRetirementForm());
    setSubmitted(null);
  };

  return (
    <>
      <div className="page-header">
        <h2 className="page-title">วางแผนเกษียณ</h2>
        <p className="muted">ประมาณว่าต้องมีเงินเท่าไรตอนเกษียณ และต้องเก็บเดือนละเท่าไร</p>
      </div>

      <div className="notice" role="note">
        <p>
          <strong>เครื่องมือนี้ให้ตัวเลขประมาณการ</strong> {RETIREMENT_DISCLAIMER}
        </p>
        <p>ตัวเลขที่นี่ไม่ถูกบันทึกลงสมุดบัญชี และไม่เกี่ยวกับยอดเงินในกระเป๋าของคุณ</p>
      </div>

      <section className="solid card" aria-labelledby="rt-form-title">
        <h2 id="rt-form-title">สมมติฐานของคุณ</h2>
        <form onSubmit={onSubmit} noValidate className="settings-form">
          <div className="field-row">
            <Field id="rt-age" field="currentAge" label="อายุตอนนี้" unit="ปี" placeholder="เช่น 35" value={form.currentAge} errors={errors} onChange={(v) => set({ currentAge: v })} />
            <Field id="rt-retire" field="retireAge" label="อายุที่จะเกษียณ" unit="ปี" value={form.retireAge} errors={errors} onChange={(v) => set({ retireAge: v })} />
            <Field id="rt-life" field="lifeExpectancy" label="อายุที่คาดว่าจะอยู่ถึง" unit="ปี" placeholder="เช่น 85" hint="ยิ่งอยู่นาน ยิ่งต้องมีเงินมาก" value={form.lifeExpectancy} errors={errors} onChange={(v) => set({ lifeExpectancy: v })} />
          </div>
          <div className="field-row">
            <Field id="rt-expense" field="monthlyExpense" label="ค่าใช้จ่ายต่อเดือนที่ต้องการตอนเกษียณ" unit="บาท ราคาวันนี้" placeholder="เช่น 30,000" hint="คิดเป็นราคาวันนี้ ระบบจะปรับตามเงินเฟ้อให้เอง" value={form.monthlyExpense} errors={errors} onChange={(v) => set({ monthlyExpense: v })} />
            <Field id="rt-infl" field="inflation" label="เงินเฟ้อ" unit="% ต่อปี" value={form.inflation} errors={errors} onChange={(v) => set({ inflation: v })} />
          </div>
          <div className="field-row">
            <Field id="rt-rb" field="returnBefore" label="ผลตอบแทนที่คาดก่อนเกษียณ" unit="% ต่อปี" placeholder="เช่น 5" hint="ช่วงที่กำลังเก็บเงิน" value={form.returnBefore} errors={errors} onChange={(v) => set({ returnBefore: v })} />
            <Field id="rt-ra" field="returnAfter" label="ผลตอบแทนที่คาดหลังเกษียณ" unit="% ต่อปี" placeholder="เช่น 3" hint="ช่วงที่ใช้เงินแล้ว มักตั้งต่ำกว่า" value={form.returnAfter} errors={errors} onChange={(v) => set({ returnAfter: v })} />
          </div>
          <Field id="rt-savings" field="currentSavings" label="เงินที่เก็บไว้สำหรับเกษียณแล้ว (ถ้ามี)" unit="บาท" placeholder="ไม่บังคับ" hint="ใส่เพื่อดูว่าที่เก็บไว้พอแค่ไหน ปล่อยว่าง = เริ่มจาก 0" value={form.currentSavings} errors={errors} onChange={(v) => set({ currentSavings: v })} />
          <div className="form-actions">
            <button type="button" className="btn btn-ghost btn-small" onClick={reset}>
              ล้างค่า
            </button>
            <button type="submit" className="btn btn-primary btn-small">
              คำนวณ
            </button>
          </div>
        </form>
      </section>

      {result && (
        <section className="glass-lite card" aria-labelledby="rt-result-title">
          <h2 id="rt-result-title" ref={resultRef} tabIndex={-1}>
            ผลประมาณการ
          </h2>
          <p className="small" role="note">
            {RETIREMENT_DISCLAIMER}
          </p>
          {result.result.realReturnNegativeAfter && (
            <p className="small" role="note">
              ⚠ {RETIREMENT_REAL_RETURN_WARNING}
            </p>
          )}
          <p className="muted small">
            สมมติฐานที่ใช้: อายุตอนนี้ {result.input.currentAge} ปี · เกษียณที่ {result.input.retireAge} ปี · อยู่ถึง {result.input.lifeExpectancy} ปี · ค่าใช้จ่าย {baht(result.input.monthlyExpense)} ต่อเดือน (ราคาวันนี้) ·
            เงินเฟ้อ {bpsText(result.input.inflationBps)} · ผลตอบแทนก่อนเกษียณ {bpsText(result.input.returnBeforeBps)} · หลังเกษียณ {bpsText(result.input.returnAfterBps)} ต่อปี
            {result.input.currentSavings !== undefined && result.input.currentSavings > 0 ? ` · เงินที่เก็บไว้แล้ว ${baht(result.input.currentSavings)}` : ''}
          </p>
          <dl className="avg-result">
            <div>
              <dt>ต้องเก็บเดือนละ (ประมาณการ)</dt>
              <dd className="num">{result.result.monthlySaving === 0 ? RETIREMENT_ON_TRACK_NOTE : baht(result.result.monthlySaving)}</dd>
            </div>
            <div>
              <dt>เงินที่ควรมี ณ วันเกษียณ (ประมาณการ)</dt>
              <dd className="num">{baht(result.result.requiredAtRetirement)}</dd>
            </div>
            <div>
              <dt>เทียบเป็นมูลค่าวันนี้ (ประมาณการ)</dt>
              <dd className="num">{baht(result.result.requiredInTodayMoney)}</dd>
            </div>
            <div>
              <dt>ค่าใช้จ่ายต่อเดือน ณ วันเกษียณ (ประมาณการ)</dt>
              <dd className="num">{baht(result.result.monthlyExpenseAtRetirement)}</dd>
            </div>
            {result.input.currentSavings !== undefined && result.input.currentSavings > 0 && (
              <>
                <div>
                  <dt>เงินที่เก็บไว้แล้วจะโตเป็น (ประมาณการ)</dt>
                  <dd className="num">{baht(result.result.currentSavingsAtRetirement)}</dd>
                </div>
                <div>
                  <dt>ส่วนที่ยังขาด (ประมาณการ)</dt>
                  <dd className="num">{baht(result.result.shortfall)}</dd>
                </div>
              </>
            )}
          </dl>
          <p className="muted small">
            อีก {result.result.yearsToRetire} ปีถึงเกษียณ แล้วใช้เงินต่ออีก {result.result.retirementYears} ปี · คิดดอกเบี้ยทบต้นรายเดือน (อัตราต่อปี ÷ 12) ถอนเงินต้นเดือน ปรับตามเงินเฟ้อปีละครั้ง
          </p>
          <p className="muted small">{RETIREMENT_LIMITATIONS}</p>
          <details>
            <summary>วิธีคิดแบบสั้น</summary>
            <ol className="muted small">
              <li>ค่าใช้จ่ายวันนี้ x (1 + เงินเฟ้อ) ยกกำลังจำนวนปีถึงเกษียณ = ค่าใช้จ่ายต่อเดือนตอนเกษียณ</li>
              <li>เงินที่ต้องมี = ผลรวมของเงินที่จะถอนทุกเดือนจนถึงอายุที่คาดว่าจะอยู่ ลดค่าด้วยผลตอบแทนหลังเกษียณ</li>
              <li>ต้องเก็บต่อเดือน = ส่วนที่ยังขาดหลังหักเงินที่เก็บไว้แล้ว (ที่โตด้วยผลตอบแทนก่อนเกษียณ) หารด้วยตัวคูณการออมรายเดือน</li>
            </ol>
          </details>
        </section>
      )}
    </>
  );
}
