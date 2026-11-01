import { useEffect, useRef, useState, type FormEvent } from 'react';
import { localIsoDate } from '../app/dates';
import { buildEntry, counterOptions, entryToForm, walletOptions, type FormKind } from '../app/entryForm';
import { newId } from '../app/ids';
import type { Account, Entry } from '../domain/ledger/types';
import { db } from '../storage/instance';
import { appendEntry, updateEntry } from '../storage/repository';

interface Props {
  accounts: Account[];
  /** มีค่า = โหมดแก้ไขรายการนี้ */
  editing?: Entry;
  onClose: () => void;
  /** before มีค่าเมื่อเป็นการแก้ไข (ใช้ทำปุ่มเลิกทำ) */
  onSaved: (entry: Entry, before?: Entry) => void;
}

const KINDS: { value: FormKind; label: string }[] = [
  { value: 'expense', label: 'รายจ่าย' },
  { value: 'income', label: 'รายรับ' },
  { value: 'transfer', label: 'โอนเงิน' },
];

/** ฟอร์มบันทึกรายการ แสดงเป็น dialog ของเบราว์เซอร์ (กด Esc ปิดได้ และโฟกัสอยู่ในฟอร์ม) */
export function AddEntryDialog({ accounts, editing, onClose, onSaved }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const wallets = walletOptions(accounts);
  const [initial] = useState(() => (editing ? entryToForm(accounts, editing) : null));

  const [kind, setKind] = useState<FormKind>(initial?.kind ?? 'expense');
  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [walletId, setWalletId] = useState(initial?.walletId ?? wallets[0]?.id ?? '');
  const [chosenCounter, setChosenCounter] = useState(initial?.counterId ?? '');
  const [date, setDate] = useState(() => initial?.date ?? localIsoDate());
  const [memo, setMemo] = useState(initial?.memo ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ตัวเลือกช่องที่สองเปลี่ยนตามประเภท ถ้าค่าที่เลือกไว้ใช้ไม่ได้แล้ว ใช้ตัวแรกแทน
  const counters = counterOptions(accounts, kind, walletId);
  const counterId = counters.some((a) => a.id === chosenCounter) ? chosenCounter : (counters[0]?.id ?? '');

  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    // showModal ย้ายโฟกัสไปที่ช่องแรกเอง จึงต้องสั่งโฟกัสช่องจำนวนเงินหลังเปิด
    amountRef.current?.focus();
  }, []);

  const clearError = () => setError(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const form = { kind, date, amount, walletId, counterId, memo };
      if (editing) {
        // คงแหล่งที่มาเดิม (เช่น สแกนสลิป) และกลุ่มเดิมไว้
        const input = { ...buildEntry(accounts, form, editing.id), source: editing.source, groupId: editing.groupId };
        const { before, after } = await updateEntry(db, editing.id, input);
        onSaved(after, before);
      } else {
        const entry = await appendEntry(db, buildEntry(accounts, form, newId('e')));
        onSaved(entry);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const walletLabel = kind === 'income' ? 'เข้ากระเป๋า' : kind === 'transfer' ? 'จากกระเป๋า' : 'จ่ายจากกระเป๋า';
  const counterLabel = kind === 'transfer' ? 'ไปกระเป๋า' : 'หมวด';

  return (
    <dialog
      ref={dialogRef}
      className="entry-dialog"
      aria-labelledby="entry-dialog-title"
      onClose={onClose}
      onCancel={onClose}
    >
      <form onSubmit={submit} className="entry-form">
        <h2 id="entry-dialog-title">{editing ? 'แก้ไขรายการ' : 'บันทึกรายการ'}</h2>

        <fieldset className="seg">
          <legend className="sr-only">ประเภทรายการ</legend>
          {KINDS.map((k) => (
            <label key={k.value} className={`seg-item seg-${k.value}`}>
              <input
                type="radio"
                name="kind"
                value={k.value}
                checked={kind === k.value}
                onChange={() => {
                  setKind(k.value);
                  clearError();
                }}
              />
              <span>{k.label}</span>
            </label>
          ))}
        </fieldset>

        <div className="field">
          <label htmlFor="entry-amount">จำนวนเงิน (บาท)</label>
          <input
            id="entry-amount"
            className="amount-input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            ref={amountRef}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              clearError();
            }}
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="entry-wallet">{walletLabel}</label>
            <select
              id="entry-wallet"
              value={walletId}
              onChange={(e) => {
                setWalletId(e.target.value);
                clearError();
              }}
            >
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="entry-counter">{counterLabel}</label>
            <select
              id="entry-counter"
              value={counterId}
              onChange={(e) => {
                setChosenCounter(e.target.value);
                clearError();
              }}
            >
              {counters.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="entry-date">วันที่</label>
            <input
              id="entry-date"
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                clearError();
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="entry-memo">บันทึกช่วยจำ (ไม่ใส่ก็ได้)</label>
            <input
              id="entry-memo"
              type="text"
              placeholder="เช่น กาแฟหน้าออฟฟิศ"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
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
            {editing ? 'บันทึกการแก้ไข' : 'บันทึก'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
