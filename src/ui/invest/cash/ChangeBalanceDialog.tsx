import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { newId } from '../../../app/ids';
import { isValidIsoDate } from '../../../domain/ledger/entry';
import { MAX_NAME_LENGTH } from '../../../domain/ledger/limits';
import { parseCashMinor, planCashChange, type CashAccountBalance, type CashChangeMode } from '../../../domain/invest/cashView';
import { restoreFocus } from '../../focus';
import { investError, investProblem } from '../investError';
import { useRepository } from '../../RepositoryContext';
import { minorText } from './cashFormat';

const MODES: { id: CashChangeMode; label: string }[] = [
  { id: 'deposit', label: 'Deposit' },
  { id: 'withdraw', label: 'Withdraw' },
  { id: 'set', label: 'Set balance to' },
];

interface Props {
  accounts: readonly CashAccountBalance[];
  /** บัญชีที่เลือกตั้งต้น */
  initialAccountId: string;
  today: string;
  onClose: () => void;
  /** บันทึกสำเร็จ (ผู้เรียกโหลดข้อมูลใหม่และแจ้งสมุด) */
  onSaved: (text: string) => void;
}

/** ปุ่ม Change balance: ฝาก/ถอน/ตั้งยอดใหม่ ลงสมุดผ่าน repo.recordCashAdjustment (Entry 2 บรรทัด ไม่ใช่รายรับ/รายจ่าย · R16/R23) · ส่วนต่างคำนวณใน domain/invest/cashView */
export function ChangeBalanceDialog({ accounts, initialAccountId, today, onClose, onSaved }: Props) {
  const repo = useRepository();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const modeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [accountId, setAccountId] = useState(accounts.some((a) => a.accountId === initialAccountId) ? initialAccountId : (accounts[0]?.accountId ?? ''));
  const [mode, setMode] = useState<CashChangeMode>('deposit');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [memo, setMemo] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    // เก็บปุ่มที่เปิดไว้ใน ref: StrictMode (dev) รัน effect ซ้ำ รอบสองจะเห็นโฟกัสอยู่ใน dialog แล้ว ไม่ใช่ปุ่มเดิม
    if (openerRef.current === null && document.activeElement instanceof HTMLElement) openerRef.current = document.activeElement;
    if (dialog && !dialog.open) dialog.showModal();
    modeRef.current?.focus();
    return () => restoreFocus(openerRef.current);
  }, []);

  const account = accounts.find((a) => a.accountId === accountId);
  // ตัวอย่างผล (แสดงเฉพาะที่ domain คำนวณได้ · ไม่คำนวณเงินใน component)
  const preview = useMemo(() => {
    if (!account || amount.trim() === '') return '';
    const r = planCashChange({ mode, text: amount, currentMinor: account.minor });
    if (!r.ok) return '';
    if (r.plan.kind === 'none') return 'No change: the balance already matches.';
    const verb = r.plan.direction === 'deposit' ? 'Deposit' : 'Withdraw';
    const target = mode === 'set' ? parseCashMinor(amount) : null;
    return `${verb} ${minorText(account.currency, r.plan.amountMinor)}${target === null ? '' : ` (balance becomes ${minorText(account.currency, target)})`}`;
  }, [account, amount, mode]);

  const touch = () => {
    setError('');
    setInfo('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    touch();
    if (!account) {
      setError('Choose a cash account.');
      return;
    }
    if (!isValidIsoDate(date)) {
      setError('Enter a valid date.');
      return;
    }
    const r = planCashChange({ mode, text: amount, currentMinor: account.minor });
    if (!r.ok) {
      setError(investProblem(r.problem));
      return;
    }
    if (r.plan.kind === 'none') {
      setInfo(`The balance is already ${minorText(account.currency, account.minor)}, so nothing was saved.`);
      return;
    }
    setSaving(true);
    try {
      await repo.recordCashAdjustment({
        id: newId('cash'),
        date,
        createdAt: new Date().toISOString(),
        cashAccountId: account.accountId,
        currency: account.currency,
        direction: r.plan.direction,
        amountMinor: r.plan.amountMinor,
        memo,
      });
      onSaved(`${r.plan.direction === 'deposit' ? 'Deposited' : 'Withdrew'} ${minorText(account.currency, r.plan.amountMinor)} · ${account.name}`);
    } catch (err) {
      setError(investError(err, 'Could not save the change. A withdrawal cannot be larger than the current balance.'));
      setSaving(false);
    }
  };

  return (
    <dialog ref={dialogRef} className="entry-dialog cs-dialog" aria-labelledby={`${id}-title`} lang="en" onClose={onClose} onCancel={onClose}>
      <form className="entry-form" onSubmit={(e) => void submit(e)} noValidate>
        <h2 id={`${id}-title`}>Change balance</h2>
        <p className="muted small">Recorded in your ledger as money moving in or out of the portfolio. It is not income or spending.</p>

        <div className="iv-field">
          <label htmlFor={`${id}-acct`}>Cash account</label>
          <select
            id={`${id}-acct`}
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              touch();
            }}
          >
            {accounts.map((a) => (
              <option key={a.accountId} value={a.accountId}>
                {a.name} · {a.currency} · {minorText(a.currency, a.minor)}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="cs-modes">
          <legend>Change</legend>
          {MODES.map((m, i) => (
            <button
              key={m.id}
              ref={i === 0 ? modeRef : undefined}
              type="button"
              className="cs-mode"
              aria-pressed={mode === m.id}
              onClick={() => {
                setMode(m.id);
                touch();
              }}
            >
              {m.label}
            </button>
          ))}
        </fieldset>

        <div className="iv-field">
          <label htmlFor={`${id}-amt`}>{mode === 'set' ? `New balance (${account?.currency ?? ''})` : `Amount (${account?.currency ?? ''})`}</label>
          <input
            id={`${id}-amt`}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              touch();
            }}
            aria-describedby={error ? `${id}-err` : undefined}
          />
        </div>
        <div className="iv-field">
          <label htmlFor={`${id}-date`}>Date</label>
          <input
            id={`${id}-date`}
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              touch();
            }}
          />
        </div>
        <div className="iv-field">
          <label htmlFor={`${id}-memo`}>Note (optional)</label>
          <input id={`${id}-memo`} type="text" maxLength={MAX_NAME_LENGTH} autoComplete="off" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </div>

        <p className="cs-preview" role="status">
          {preview || 'Enter an amount to see what will be recorded.'}
        </p>
        {info !== '' && (
          <p className="muted" role="status">
            {info}
          </p>
        )}
        {error !== '' && (
          <p id={`${id}-err`} className="cs-err" role="alert">
            {error}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
