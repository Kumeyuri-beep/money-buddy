import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { newId } from '../../../app/ids';
import { buildCashAdjustmentEntry } from '../../../domain/invest/cashAdjustment';
import { usdCashBalances } from '../../../domain/invest/usdIntegrity';
import type { InstrumentCurrency, InvestmentData } from '../../../domain/invest/types';
import type { Account, Entry } from '../../../domain/ledger/types';
import { isSupportedEntryDate, lengthWithin, MAX_MEMO_LENGTH } from '../../../domain/ledger/limits';
import { parseBahtToSatang } from '../../../domain/money/satang';
import { nextCreatedAt } from '../../../storage/repository';
import { useRepository } from '../../RepositoryContext';
import { investError } from '../investError';

interface Props {
  today: string;
  accounts: readonly Account[];
  entries: readonly Entry[];
  data: InvestmentData;
  onClose: () => void;
  /** บันทึกสำเร็จแล้ว: ผู้เรียกโหลดข้อมูลใหม่ ปิดฟอร์ม และแจ้งผล */
  onSaved: (text: string) => void;
}

/**
 * ปรับยอดเงินสดของพอร์ต (เงินเข้า/ออกจากภายนอกพอร์ต · R16/R20/R23): ฟอร์มนี้แค่ประกอบอินพุตแล้วเรียก repo.recordCashAdjustment
 * ซึ่งสร้าง Entry ผ่าน buildCashAdjustmentEntry (เงินสดพอร์ต ± จำนวน กับบัญชีพักฝั่งตรงข้าม · ไม่ใช่รายรับ/รายจ่าย) · ไม่มีสูตรเงินที่นี่
 */
export function CashAdjustForm({ today, accounts, entries, data, onClose, onSaved }: Props) {
  const repo = useRepository();
  const [currency, setCurrency] = useState<InstrumentCurrency>('USD');
  const [direction, setDirection] = useState<'deposit' | 'withdraw'>('deposit');
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  const options = useMemo(() => {
    if (currency === 'USD') return usdCashBalances(accounts, entries, data).map((c) => ({ id: c.accountId, name: c.name }));
    const bound = new Set(data.assets.map((a) => a.accountId));
    return accounts.filter((a) => a.type === 'asset' && a.currency === 'THB' && a.kind === 'investment' && !a.archived && !bound.has(a.id)).map((a) => ({ id: a.id, name: a.name }));
  }, [currency, accounts, entries, data]);
  const account = options.find((o) => o.id === accountId)?.id ?? options[0]?.id ?? '';

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !e.defaultPrevented && !(e.target instanceof HTMLSelectElement)) onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!isSupportedEntryDate(date)) return setError('Invalid date (YYYY-MM-DD, year 1900-2999)');
    if (date > today) return setError('Cannot record a future date');
    if (!lengthWithin(memo, 0, MAX_MEMO_LENGTH)) return setError(`Note must be at most ${MAX_MEMO_LENGTH} characters`);
    if (/^\s*[+-]/.test(amount)) return setError('Enter a positive amount; choose Deposit or Withdrawal for the direction');
    let minor: number;
    try {
      minor = parseBahtToSatang(amount.replace(/\$/g, '')); // ทศนิยม 2 ตำแหน่ง = เซนต์/สตางค์ (ตัวอ่านเดียวกับฟอร์มแลกเงิน)
    } catch {
      return setError('Invalid amount');
    }
    const input = { id: newId('cash-adj'), date, createdAt: nextCreatedAt(), cashAccountId: account, currency, direction, amountMinor: minor, memo };
    try {
      buildCashAdjustmentEntry(input); // ตรวจกติกาก่อนส่ง (จำนวน วันที่ บัญชี) · ฐานข้อมูลตรวจซ้ำ
    } catch (err) {
      return setError(investError(err));
    }
    setError('');
    setBusy(true);
    try {
      await repo.recordCashAdjustment(input);
      onSaved(direction === 'deposit' ? 'Cash deposit saved' : 'Cash withdrawal saved');
    } catch (err) {
      setError(investError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="solid card tx-panel" aria-labelledby="tx-cash-title">
      <h2 id="tx-cash-title" ref={heading} tabIndex={-1}>
        Cash deposit / withdrawal
      </h2>
      <p className="muted small">Adjusts the cash balance of your portfolio, for example money you moved to or from your broker outside this app. It is not counted as income or an expense.</p>
      <form onSubmit={(e) => void submit(e)} onKeyDown={onKey} className="settings-form" noValidate>
        <div className="field-row">
          <div className="field">
            <label htmlFor="tx-cash-dir">Type</label>
            <select id="tx-cash-dir" value={direction} onChange={(e) => setDirection(e.target.value as 'deposit' | 'withdraw')}>
              <option value="deposit">Deposit (money in)</option>
              <option value="withdraw">Withdrawal (money out)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="tx-cash-cur">Currency</label>
            <select id="tx-cash-cur" value={currency} onChange={(e) => setCurrency(e.target.value as InstrumentCurrency)}>
              <option value="USD">USD</option>
              <option value="THB">THB</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="tx-cash-date">Date</label>
            <input id="tx-cash-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="tx-cash-acct">{currency} cash account</label>
            <select id="tx-cash-acct" value={account} onChange={(e) => setAccountId(e.target.value)}>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            {options.length === 0 && (
              <p className="avg-err" role="alert">
                {currency === 'USD' ? 'Create a USD cash account first.' : 'No baht investment cash account yet. Tag a baht cash account as investment money in Accounts first.'}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="tx-cash-amount">Amount ({currency})</label>
            <input id="tx-cash-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? 'tx-cash-err' : undefined} />
          </div>
          <div className="field">
            <label htmlFor="tx-cash-memo">Note (optional)</label>
            <input id="tx-cash-memo" autoComplete="off" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
        </div>
        <div role="alert">
          {error && (
            <p id="tx-cash-err" className="avg-err">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-small" disabled={busy || account === ''}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </section>
  );
}
