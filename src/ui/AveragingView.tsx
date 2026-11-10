import { useMemo, useRef, useState } from 'react';
import { computeAveraging, type AveragingError, type AveragingForm } from '../app/averaging';
import { formatBaht, satang } from '../domain/money/satang';

const EMPTY: AveragingForm = { holdUnits: '', holdCost: '', buyAmount: '', price: '', fee: '' };
type Field = keyof AveragingForm;

interface FieldProps {
  id: string;
  field: Field;
  label: string;
  placeholder: string;
  hint?: string;
  value: string;
  error: AveragingError | undefined;
  onChange: (value: string) => void;
  onBlur: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
}

function NumberField({ id, label, placeholder, hint, value, error, onChange, onBlur, inputRef }: FieldProps) {
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        ref={inputRef}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
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

/** หน้า "ถัวเฉลี่ยต้นทุน": เครื่องคิดเลขล้วน ไม่บันทึกอะไร ผู้ใช้กรอกราคาเอง (ไม่ดึงราคาจากเว็บ) */
export function AveragingView() {
  const [form, setForm] = useState<AveragingForm>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const firstRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<AveragingForm>) => setForm((f) => ({ ...f, ...patch }));
  const touch = (field: Field) => setTouched((t) => ({ ...t, [field]: true }));
  const anyInput = Object.values(form).some((v) => v.trim() !== '');
  const result = useMemo(() => (anyInput ? computeAveraging(form) : null), [form, anyInput]);

  // ข้อผิดพลาด "ยังไม่กรอก" แสดงหลังแตะช่องนั้นแล้วเท่านั้น · ข้อผิดพลาดรูปแบบแสดงทันที
  const errorOf = (field: Field): AveragingError | undefined => {
    if (result === null || result.ok) return undefined;
    return result.errors.find((e) => e.field === field && (!e.missing || touched[field] === true));
  };
  const reset = () => {
    setForm(EMPTY);
    setTouched({});
    firstRef.current?.focus();
  };
  const common = (field: Field) => ({
    field,
    value: form[field],
    error: errorOf(field),
    onChange: (value: string) => set({ [field]: value }),
    onBlur: () => touch(field),
  });

  return (
    <>
      <div className="page-header">
        <h2 className="page-title">ถัวเฉลี่ยต้นทุน</h2>
        <p className="muted">ซื้อเพิ่มแล้วราคาเฉลี่ยต่อหน่วยเปลี่ยนเป็นเท่าไร</p>
        <p className="muted small">เครื่องคิดเลขนี้ไม่บันทึกข้อมูล ราคาเป็นตัวเลขที่คุณกรอกเอง</p>
      </div>

      <section className="glass-lite card" aria-labelledby="avg-title">
        <h2 id="avg-title">ที่ถืออยู่ตอนนี้ (ถ้ามี)</h2>
        <div className="field-row">
          <NumberField id="avg-units" label="จำนวนหน่วย/หุ้นที่ถืออยู่" placeholder="0" inputRef={firstRef} {...common('holdUnits')} />
          <NumberField
            id="avg-cost"
            label="ต้นทุนรวมที่จ่ายมาแล้ว (บาท)"
            placeholder="0.00"
            hint="รวมค่าธรรมเนียมที่เคยจ่าย"
            {...common('holdCost')}
          />
        </div>

        <h2 className="avg-sub">ที่จะซื้อเพิ่ม</h2>
        <div className="field-row">
          <NumberField id="avg-amount" label="เงินที่จะซื้อ (บาท)" placeholder="1,000.00" {...common('buyAmount')} />
          <NumberField
            id="avg-price"
            label="ราคาต่อหน่วย (บาท)"
            placeholder="12.3456"
            hint="ทศนิยมได้สูงสุด 6 ตำแหน่ง"
            {...common('price')}
          />
          <NumberField id="avg-fee" label="ค่าธรรมเนียม (บาท)" placeholder="0.00" {...common('fee')} />
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost btn-small" onClick={reset} disabled={!anyInput}>
            ล้างค่า
          </button>
        </div>
      </section>

      <section className="solid card" aria-labelledby="avg-result-title">
        <h2 id="avg-result-title">ผลลัพธ์</h2>
        <div role="status">
          {result === null ? (
            <p className="muted">กรอกเงินที่จะซื้อและราคาต่อหน่วยเพื่อดูผล</p>
          ) : !result.ok ? (
            <p className="muted">ยังคำนวณไม่ได้ ตรวจช่องที่มีข้อความสีแดง</p>
          ) : (
            <>
              <p className="sr-only">{`ราคาเฉลี่ยใหม่ ${result.newAvgPrice} บาทต่อหน่วย`}</p>
              <dl className="avg-result">
                <div>
                  <dt>ได้หน่วยเพิ่ม</dt>
                  <dd className="num">{result.boughtUnits}</dd>
                </div>
                <div>
                  <dt>หน่วยรวมใหม่</dt>
                  <dd className="num">{result.newUnits}</dd>
                </div>
                <div>
                  <dt>เงินที่จ่ายครั้งนี้ (รวมค่าธรรมเนียม)</dt>
                  <dd className="num">{formatBaht(satang(result.totalPaid))}</dd>
                </div>
                <div>
                  <dt>ต้นทุนรวมใหม่</dt>
                  <dd className="num">{formatBaht(satang(result.newCost))}</dd>
                </div>
                {result.oldAvgPrice !== null && (
                  <div>
                    <dt>ราคาเฉลี่ยเดิมต่อหน่วย</dt>
                    <dd className="num">{result.oldAvgPrice} บาท</dd>
                  </div>
                )}
                <div>
                  <dt>ราคาเฉลี่ยใหม่ต่อหน่วย</dt>
                  <dd className="num avg-new">{result.newAvgPrice} บาท</dd>
                </div>
              </dl>
            </>
          )}
        </div>
        <p className="muted small">เครื่องคิดเลขช่วยคำนวณเท่านั้น ไม่ใช่คำแนะนำการลงทุน</p>
        <p className="muted small">ค่าธรรมเนียมซื้อนับรวมในต้นทุน ราคาเฉลี่ยอาจต่างจากแอปโบรกเกอร์เล็กน้อยจากการปัดเศษ</p>
      </section>
    </>
  );
}
