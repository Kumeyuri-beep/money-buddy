import { friendlyError } from '../app/errorText';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { restoreFocus } from './focus';
import { billFromForm, billToForm, type BillForm } from '../app/billForm';
import { newId } from '../app/ids';
import { walletOptions } from '../app/entryForm';
import type { Bill } from '../domain/bills/types';
import { MAX_NAME_LENGTH } from '../domain/ledger/limits';
import type { Account } from '../domain/ledger/types';
import { useRepository } from './RepositoryContext';

interface Props {
  accounts: Account[];
  /** มีค่า = โหมดแก้ไขบิลนี้ */
  editing?: Bill;
  /** วันนี้ ใช้ตั้ง startMonth ตอนเพิ่มบิลใหม่ */
  today: string;
  onClose: () => void;
  onSaved: (bill: Bill, before?: Bill) => void;
}

const EMPTY: BillForm = { name: '', amount: '', dueDay: '', walletId: '', categoryId: '' };

/** ฟอร์มเพิ่ม/แก้บิลประจำ (dialog ของเบราว์เซอร์ กด Esc ปิดได้) */
export function BillDialog({ accounts, editing, today, onClose, onSaved }: Props) {
  const repo = useRepository();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<BillForm>(() => (editing ? billToForm(editing) : EMPTY));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const wallets = walletOptions(accounts);
  const categories = accounts.filter((a) => a.type === 'expense' && a.currency === 'THB' && !a.archived);

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    nameRef.current?.focus();
    // คืนโฟกัสให้ปุ่มที่เปิด dialog เมื่อปิด
    return () => restoreFocus(opener);
  }, []);

  const set = (patch: Partial<BillForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        const next = billFromForm(form, editing.id);
        const saved = await repo.updateBill(next);
        onSaved(saved, editing);
      } else {
        const saved = await repo.addBill(billFromForm(form, newId('bill')), today);
        onSaved(saved);
      }
    } catch (e) {
      setError(friendlyError(e));
      setSaving(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="entry-dialog"
      aria-labelledby="bill-dialog-title"
      onClose={onClose}
      onCancel={onClose}
    >
      <form onSubmit={submit} className="entry-form">
        <h2 id="bill-dialog-title">{editing ? 'แก้ไขบิลประจำ' : 'เพิ่มบิลประจำ'}</h2>

        <div className="field">
          <label htmlFor="bill-name">ชื่อบิล</label>
          <input
            id="bill-name"
            type="text"
            maxLength={MAX_NAME_LENGTH}
            ref={nameRef}
            autoComplete="off"
            placeholder="เช่น ค่าอินเทอร์เน็ต"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="bill-amount">ยอดต่อเดือน (บาท)</label>
            <input
              id="bill-amount"
              className="amount-input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={form.amount}
              onChange={(e) => set({ amount: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="bill-day">ครบกำหนดวันที่ (1-31)</label>
            <input
              id="bill-day"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              aria-describedby="bill-day-hint"
              value={form.dueDay}
              onChange={(e) => set({ dueDay: e.target.value })}
            />
            <p id="bill-day-hint" className="muted small">
              เดือนที่สั้นกว่านั้นจะครบกำหนดวันสุดท้ายของเดือน
            </p>
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="bill-wallet">จ่ายจากกระเป๋า (ไม่ใส่ก็ได้)</label>
            <select id="bill-wallet" value={form.walletId} onChange={(e) => set({ walletId: e.target.value })}>
              <option value="">เลือกตอนจ่าย</option>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="bill-category">หมวด (ไม่ใส่ก็ได้)</label>
            <select id="bill-category" value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
              <option value="">เลือกตอนจ่าย</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            ยกเลิก
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            บันทึก
          </button>
        </div>
      </form>
    </dialog>
  );
}
