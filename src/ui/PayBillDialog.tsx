import { friendlyError } from '../app/errorText';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { restoreFocus } from './focus';
import type { BillRow } from '../app/billsView';
import { thaiDayLabel, thaiMonthKeyLabel } from '../app/dates';
import { walletOptions } from '../app/entryForm';
import { newId } from '../app/ids';
import type { Account } from '../domain/ledger/types';
import { PAY_CONFIRM_PERCENT, payAmountProblem, payDeviation, type PayDeviation } from '../domain/bills/payAmount';
import { formatBaht, parseBahtToSatang, satang, toBahtString } from '../domain/money/satang';
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
  // ยอดที่จ่ายจริง (R15): แก้ได้ ต่างจากยอดบิลเกิน 20% ต้องกดยืนยันอีกครั้งก่อนบันทึก
  const [amountText, setAmountText] = useState(toBahtString(satang(bill.amount)));
  const [askedFor, setAskedFor] = useState<number | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const warnRef = useRef<HTMLDivElement>(null);
  const askedAt = useRef(0);

  const parsedAmount = (): number | null => {
    try {
      const value = parseBahtToSatang(amountText);
      return payAmountProblem(value) === null ? value : null;
    } catch {
      return null;
    }
  };
  const amountNow = parsedAmount();
  const deviation: PayDeviation | null = amountNow === null ? null : payDeviation(bill.amount, amountNow);
  useEffect(() => {
    // แสดงกล่องเตือนแล้วย้ายโฟกัสไปที่กล่อง: กด Enter ซ้ำที่ช่องยอดจะไม่ผ่านขั้นยืนยันโดยไม่ได้อ่าน
    if (askedFor !== null) warnRef.current?.focus();
  }, [askedFor]);

  // ถามยืนยันแล้ว (askedFor = ยอดนี้) และยังเป็นยอดเดิม: กดส่งอีกครั้ง = ยืนยัน
  const askingConfirm = amountNow !== null && deviation?.needsConfirm === true && askedFor === amountNow;
  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    // คืนโฟกัสให้ปุ่มที่เปิด dialog เมื่อปิด (dialog ถูกถอดออกจากหน้า เบราว์เซอร์ไม่คืนให้เอง)
    return () => restoreFocus(opener);
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
    const amount = parsedAmount();
    if (amount === null) {
      setError('ใส่ยอดที่จ่ายเป็นตัวเลขมากกว่า 0 เช่น 599.00');
      amountRef.current?.focus();
      return;
    }
    const dev = payDeviation(bill.amount, amount);
    // ต้องผ่านการถามก่อน และต้องผ่านไปแล้วระยะหนึ่ง: กด Enter รัว (key repeat) ต้องไม่ข้ามกล่องเตือน
    if (dev.needsConfirm && (askedFor !== amount || Date.now() - askedAt.current < 600)) {
      if (askedFor === amount) return;
      askedAt.current = Date.now();
      // ต่างจากยอดบิลเกิน 20%: ยังไม่บันทึก ถามยืนยันก่อน
      setAskedFor(amount);
      setError(null);
      return;
    }
    setSaving(true);
    try {
      const result = await repo.payBill(bill.id, { today, entryId: newId('e'), walletId, categoryId, amount, ...(cycle ? { expectedCycle: cycle } : {}) });
      onPaid(row, result);
    } catch (e) {
      setAskedFor(null);
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
          บันทึกเป็นรายจ่ายของรอบ{' '}
          <strong>{cycle ? thaiMonthKeyLabel(cycle) : ''}</strong> วันที่ {thaiDayLabel(today)}
        </p>
        {row.status === 'overdue' && row.dueDate && (
          <p className="slip-warn">บิลนี้เลยกำหนด (ครบกำหนด {thaiDayLabel(row.dueDate)})</p>
        )}

        <div className="field">
          <label htmlFor="pay-amount">ยอดที่จ่ายจริง (บาท)</label>
          <input
            id="pay-amount"
            ref={amountRef}
            className="amount-input"
            inputMode="decimal"
            autoComplete="off"
            value={amountText}
            aria-describedby={error !== null && amountNow === null ? 'pay-amount-hint pay-error' : 'pay-amount-hint'}
            aria-invalid={amountNow === null || undefined}
            onChange={(e) => {
              setAmountText(e.target.value);
              setAskedFor(null);
              setError(null);
            }}
          />
          <p id="pay-amount-hint" className="muted small">
            {amountNow === null
              ? 'ใส่ยอดเป็นตัวเลขมากกว่า 0'
              : deviation?.direction === 'same'
                ? 'เท่ากับยอดบิล'
                : `${deviation?.direction === 'higher' ? 'สูงกว่า' : 'ต่ำกว่า'}ยอดบิล (${formatBaht(satang(bill.amount))}) ${(deviation?.percentTenths ?? 0) / 10}%${deviation?.needsConfirm ? ` · ต่างเกิน ${PAY_CONFIRM_PERCENT}% จะถามยืนยันอีกครั้งก่อนบันทึก` : ''}`}
          </p>
        </div>

        {askingConfirm && deviation && (
          <div role="alert" className="slip-warn" ref={warnRef} tabIndex={-1}>
            <strong>ยอดต่างจากยอดบิลเกิน {PAY_CONFIRM_PERCENT}%</strong>
            <p>
              จะบันทึกจ่าย <strong className="num">{formatBaht(satang(amountNow))}</strong> ทั้งที่ยอดบิลคือ{' '}
              <strong className="num">{formatBaht(satang(bill.amount))}</strong> ({deviation.direction === 'higher' ? 'สูงกว่า' : 'ต่ำกว่า'} {deviation.percentTenths / 10}%) ถ้าถูกต้อง กด "ยืนยันจ่ายยอดนี้" ถ้าพิมพ์ผิดให้แก้ยอดก่อน
            </p>
          </div>
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
            {askingConfirm ? 'ยืนยันจ่ายยอดนี้' : 'จ่ายบิล'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
