import { useMemo, useState } from 'react';
import { computeAveraging, type AveragingForm } from '../app/averaging';
import { formatBaht, satang } from '../domain/money/satang';

const EMPTY: AveragingForm = { holdUnits: '', holdCost: '', buyAmount: '', price: '', fee: '' };

/** หน้า "ถัวเฉลี่ยต้นทุน": เครื่องคิดเลขล้วน ไม่บันทึกอะไร ผู้ใช้กรอกราคาเอง (ไม่ดึงราคาจากเว็บ) */
export function AveragingView() {
  const [form, setForm] = useState<AveragingForm>(EMPTY);
  const set = (patch: Partial<AveragingForm>) => setForm((f) => ({ ...f, ...patch }));
  const touched = Object.values(form).some((v) => v.trim() !== '');
  const result = useMemo(() => (touched ? computeAveraging(form) : null), [form, touched]);

  return (
    <>
      <div className="page-header">
        <h2 className="page-title">ถัวเฉลี่ยต้นทุน</h2>
        <p className="muted">คำนวณต้นทุนเฉลี่ยใหม่เมื่อซื้อเพิ่ม · ไม่บันทึกข้อมูลใดๆ · ราคาเป็นตัวเลขที่คุณกรอกเอง</p>
      </div>

      <section className="glass-lite card" aria-labelledby="avg-title">
        <h2 id="avg-title">ที่ถืออยู่ตอนนี้ (ถ้ามี)</h2>
        <div className="field-row">
          <div className="field">
            <label htmlFor="avg-units">จำนวนหน่วยที่ถือ</label>
            <input
              id="avg-units"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={form.holdUnits}
              onChange={(e) => set({ holdUnits: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="avg-cost">ต้นทุนรวมที่จ่ายมาแล้ว (บาท)</label>
            <input
              id="avg-cost"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={form.holdCost}
              onChange={(e) => set({ holdCost: e.target.value })}
            />
          </div>
        </div>

        <h2 className="avg-sub">ซื้อเพิ่ม</h2>
        <div className="field-row">
          <div className="field">
            <label htmlFor="avg-amount">เงินที่จะซื้อ (บาท)</label>
            <input
              id="avg-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="1,000.00"
              value={form.buyAmount}
              onChange={(e) => set({ buyAmount: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="avg-price">ราคาต่อหน่วย (บาท)</label>
            <input
              id="avg-price"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="12.3456"
              value={form.price}
              onChange={(e) => set({ price: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="avg-fee">ค่าธรรมเนียม (บาท)</label>
            <input
              id="avg-fee"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={form.fee}
              onChange={(e) => set({ fee: e.target.value })}
            />
          </div>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setForm(EMPTY)} disabled={!touched}>
            ล้างค่า
          </button>
        </div>
      </section>

      <section className="solid card" aria-labelledby="avg-result-title" aria-live="polite">
        <h2 id="avg-result-title">ผลลัพธ์</h2>
        {result === null ? (
          <p className="muted">กรอกเงินที่จะซื้อและราคาต่อหน่วยเพื่อดูผล</p>
        ) : !result.ok ? (
          <ul className="form-error" role="alert">
            {result.errors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : (
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
        )}
        <p className="muted small">
          เครื่องคิดเลขช่วยคำนวณเท่านั้น ไม่ใช่คำแนะนำการลงทุน · ค่าธรรมเนียมซื้อนับรวมในต้นทุน ราคาเฉลี่ยอาจต่างจากแอปโบรกเกอร์เล็กน้อยจากการปัดเศษ
        </p>
      </section>
    </>
  );
}
