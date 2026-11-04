import { friendlyError } from '../app/errorText';
import { useState, type FormEvent } from 'react';
import { settingsFromForm, settingsToForm, type SettingsForm } from '../app/billForm';
import { billRows, type BillRow } from '../app/billsView';
import { thaiDayLabel } from '../app/dates';
import type { FinanceSettings } from '../domain/bills/settings';
import type { Bill } from '../domain/bills/types';
import { formatBaht, satang } from '../domain/money/satang';

export interface SnapshotInfo {
  takenAt: string | undefined;
  accounts: number;
  entries: number;
}

interface Props {
  bills: Bill[];
  settings: FinanceSettings;
  /** สำเนาก่อนอัปเกรด (null = ไม่มี) */
  snapshot: SnapshotInfo | null;
  today: string;
  onAdd: () => void;
  onEdit: (bill: Bill) => void;
  onDelete: (bill: Bill) => void;
  onPay: (row: BillRow) => void;
  onSaveSettings: (settings: FinanceSettings) => Promise<void>;
  onClearSnapshot: () => void;
}

const STATUS_TEXT: Record<BillRow['status'], string> = {
  overdue: 'เลยกำหนด',
  due: 'ยังไม่จ่าย',
  paid: 'จ่ายแล้ว',
  invalid: 'ข้อมูลผิด',
};

/** หน้า "บิลและเป้า": บิลประจำ, วันเงินเดือน, เป้าออม, เป้างบ และสำเนาก่อนอัปเกรด */
export function BillsView({ bills, settings, snapshot, today, onAdd, onEdit, onDelete, onPay, onSaveSettings, onClearSnapshot }: Props) {
  const rows = billRows(bills, today);
  const [form, setForm] = useState<SettingsForm>(() => settingsToForm(settings));
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);

  const set = (patch: Partial<SettingsForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setError(null);
    setSavedNote(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await onSaveSettings(settingsFromForm(form));
      setSavedNote(true);
    } catch (e) {
      setError(friendlyError(e));
    }
  };

  const invalidCount = rows.filter((r) => r.status === 'invalid').length;

  return (
    <>
      <div className="page-header">
        <h2 className="page-title">บิลและเป้า</h2>
        <p className="muted">บิลประจำ วันเงินเดือน เป้าออม และเป้างบรายเดือน</p>
      </div>

      <section className="glass-lite card" aria-labelledby="settings-title">
        <h2 id="settings-title">ตั้งค่ารายเดือน</h2>
        <form onSubmit={submit} className="settings-form">
          <div className="field-row">
            <div className="field">
              <label htmlFor="set-payday">วันเงินเดือนเข้า (1-31)</label>
              <input
                id="set-payday"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={form.payDay}
                onChange={(e) => set({ payDay: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="set-goal">เป้าออมต่อเดือน (บาท)</label>
              <input
                id="set-goal"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={form.monthlySavingsGoal}
                onChange={(e) => set({ monthlySavingsGoal: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="set-budget">เป้างบรายจ่ายต่อเดือน (บาท)</label>
              <input
                id="set-budget"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={form.monthlyBudget}
                onChange={(e) => set({ monthlyBudget: e.target.value })}
              />
            </div>
          </div>
          <p className="muted small">ปล่อยว่าง = ยังไม่ตั้ง ค่าเหล่านี้ยังไม่แสดงในหน้าภาพรวม (กำลังพัฒนา)</p>
          <div className="dialog-actions">
            {error && (
              <p role="alert" className="form-error settings-msg">
                {error}
              </p>
            )}
            {savedNote && !error && (
              <p role="status" className="muted settings-msg">
                บันทึกแล้ว
              </p>
            )}
            <button type="submit" className="btn btn-primary">
              บันทึกค่าตั้งค่า
            </button>
          </div>
        </form>
      </section>

      <section className="solid card ledger-list" aria-labelledby="bills-title">
        <div className="bills-head">
          <h2 id="bills-title">บิลประจำ</h2>
          <button className="btn btn-primary btn-small" onClick={onAdd}>
            เพิ่มบิล
          </button>
        </div>
        {invalidCount > 0 && (
          <p role="alert" className="form-error">
            มีบิล {invalidCount} ใบข้อมูลผิด จึงยังคำนวณเงินที่ใช้ได้ไม่ครบ แก้ไขหรือลบบิลที่มีป้าย "ข้อมูลผิด"
          </p>
        )}
        {rows.length === 0 ? (
          <div className="empty">
            <p className="muted">ยังไม่มีบิลประจำ เพิ่มบิลเช่น ค่าเน็ต ค่าไฟ ค่าเช่า เพื่อให้รู้ว่าเงินส่วนไหนต้องกันไว้จ่าย</p>
          </div>
        ) : (
          <ul className="bill-list">
            {rows.map((row) => (
              <li className="tx bill-row" key={row.bill.id}>
                <div className="tx-main">
                  <div>{row.bill.name}</div>
                  <div className="muted small">
                    ทุกวันที่ {row.bill.dueDay}
                    {row.dueDate && row.status !== 'paid' ? ` · รอบนี้ครบกำหนด ${thaiDayLabel(row.dueDate)}` : ''}
                    {row.problem ? ` · ${row.problem}` : ''}
                  </div>
                </div>
                <div className="bill-figures">
                  <span className="num bill-amount">
                    {Number.isSafeInteger(row.bill.amount) && row.bill.amount > 0 ? formatBaht(satang(row.bill.amount)) : '-'}
                  </span>
                  <span className={`bill-status bill-${row.status}`}>{STATUS_TEXT[row.status]}</span>
                </div>
                <div className="tx-actions">
                  {(row.status === 'due' || row.status === 'overdue') && (
                    <button className="btn btn-small" aria-label={`จ่ายบิล ${row.bill.name}`} onClick={() => onPay(row)}>
                      จ่ายบิล
                    </button>
                  )}
                  <button className="btn btn-ghost btn-small" aria-label={`แก้ไข ${row.bill.name}`} onClick={() => onEdit(row.bill)}>
                    แก้ไข
                  </button>
                  <button className="btn btn-ghost btn-small btn-danger" aria-label={`ลบ ${row.bill.name}`} onClick={() => onDelete(row.bill)}>
                    ลบ
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {snapshot && (
        <section className="solid card" aria-labelledby="snapshot-title">
          <h2 id="snapshot-title">สำเนาข้อมูลก่อนอัปเกรด</h2>
          <p>
            ก่อนปรับปรุงระบบเก็บข้อมูล แอปคัดลอกบัญชี {snapshot.accounts} รายการและรายการเงิน {snapshot.entries} รายการไว้เป็นสำเนา
            {snapshot.takenAt ? ` (ทำเมื่อ ${thaiDayLabel(snapshot.takenAt.slice(0, 10))})` : ''} เผื่อข้อมูลเสียหายระหว่างปรับปรุง
          </p>
          <ul className="muted small snapshot-notes">
            <li>สำเนานี้เก็บในเครื่องนี้เท่านั้น ไม่ถูกส่งออกไปที่ไหน</li>
            <li>ไม่อยู่ในไฟล์ "สำรองข้อมูล"</li>
            <li>รายการที่คุณลบหลังจากนั้นยังอยู่ในสำเนานี้</li>
            <li>ลบสำเนาได้โดยไม่กระทบข้อมูลที่ใช้งานอยู่ และ "ล้างข้อมูลและเริ่มใหม่" จะลบสำเนานี้ด้วย</li>
          </ul>
          <button className="btn btn-danger" onClick={onClearSnapshot}>
            ลบสำเนาก่อนอัปเกรด
          </button>
        </section>
      )}
    </>
  );
}
