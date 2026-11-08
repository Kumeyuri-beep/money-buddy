import { friendlyError } from '../app/errorText';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { BillRow } from '../app/billsView';
import { thaiDayLabel, thaiMonthKeyLabel } from '../app/dates';
import { walletOptions } from '../app/entryForm';
import { newId } from '../app/ids';
import type { Account } from '../domain/ledger/types';
import { formatBaht, satang } from '../domain/money/satang';
import type { PayBillResult } from '../storage/repository';
import { useRepository } from './RepositoryContext';

interface Props {
  row: BillRow;
  accounts: Account[];
  today: string;
  onClose: () => void;
  onPaid: (row: BillRow, result: PayBillResult) => void;
}

/** ยืนยันจ่ายบิล: แสดงรอบและยอดที่จะบันทึก ต้องเลือกกระเป๋าและหมวดเองถ้าบิลยังไม่ระบุ (ไม่เลือกให้เงียบๆ) */
export function PayBillDialog({ row, accounts, today, onClose, onPaid }: Props) {
  const repo = useRepository();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const walletRef = useRef<HTMLSelectElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const { bill, cycle } = row;
  const wallets = walletOptions(accounts);
  const categories = accounts.filter((a) => a.type === 'expense' && a.currency === 'THB' && !a.archived);
  const [walletId, setWalletId] = useState(wallets.some((w) => w.id === bill.walletId) ? (bill.walletId ?? '') : '');
  const [categoryId, setCategoryId] = useState(categories.some((c) => c.id === bill.categoryId) ? (bill.categoryId ?? '') : '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    // คืนโฟกัสให้ปุ่มที่เปิด dialog เมื่อปิด (dialog ถูกถอดออกจากหน้า เบราว์เซอร์ไม่คืนให้เอง)
    return () => opener?.focus();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (walletId === '') {
      setError('เลือกกระเป๋าที่จะจ่าย');
      walletRef.current?.focus();
      return;
    }
    if (categoryId === '') {
      setError('เลือกหมวดรายจ่าย');
      categoryRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const result = await repo.payBill(bill.id, { today, entryId: newId('e'), walletId, categoryId, ...(cycle ? { expectedCycle: cycle } : {}) });
      onPaid(row, result);
    } catch (e) {
      setError(friendlyError(e));
      setSaving(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="entry-dialog"
      aria-labelledby="pay-dialog-title"
      onClose={onClose}
      onCancel={onClose}
    >
      <form onSubmit={submit} className="entry-form">
        <h2 id="pay-dialog-title">จ่ายบิล: {bill.name}</h2>
        <p>
          บันทึกเป็นรายจ่าย <strong className="num">{formatBaht(satang(bill.amount))}</strong> ของรอบ{' '}
          <strong>{cycle ? thaiMonthKeyLabel(cycle) : ''}</strong> วันที่ {thaiDayLabel(today)}
        </p>
        {row.status === 'overdue' && row.dueDate && (
          <p className="slip-warn">บิลนี้เลยกำหนด (ครบกำหนด {thaiDayLabel(row.dueDate)})</p>
        )}

        <div className="field-row">
          <div className="field">
            <label htmlFor="pay-wallet">จ่ายจากกระเป๋า</label>
            <select
              id="pay-wallet"
              ref={walletRef}
              aria-describedby={error !== null && walletId === '' ? 'pay-error' : undefined}
              value={walletId}
              aria-invalid={(error !== null && walletId === '') || undefined}
              onChange={(e) => {
                setWalletId(e.target.value);
                setError(null);
              }}
            >
              {walletId === '' && <option value="">เลือกกระเป๋า</option>}
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pay-category">หมวด</label>
            <select
              id="pay-category"
              ref={categoryRef}
              aria-describedby={error !== null && categoryId === '' ? 'pay-error' : undefined}
              value={categoryId}
              aria-invalid={(error !== null && categoryId === '') || undefined}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setError(null);
              }}
            >
              {categoryId === '' && <option value="">เลือกหมวด</option>}
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <p id="pay-error" role="alert" className="form-error">
            {error}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            ยกเลิก
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            จ่ายบิล
          </button>
        </div>
      </form>
    </dialog>
  );
}
