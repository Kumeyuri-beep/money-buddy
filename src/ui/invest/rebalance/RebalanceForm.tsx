import { useEffect, useId, useState, type FormEvent } from 'react';
import type { RebalanceMode } from '../../../domain/invest/rebalance';
import { AMOUNT_PROBLEM_TEXT, type AmountProblem, type RebalanceSettings } from '../../../domain/invest/rebalanceView';

interface Props {
  mode: RebalanceMode;
  amount: string;
  settings: RebalanceSettings;
  amountProblem: AmountProblem | null;
  minOrderProblem: AmountProblem | null;
  onMode: (m: RebalanceMode) => void;
  onAmount: (v: string) => void;
  onSettings: (p: Partial<RebalanceSettings>) => void;
  onSubmit: () => void;
}

/** ฟอร์มของหน้า Rebalancing (อังกฤษ): Deposit / Withdrawal · ยอด · Set up (Allow sales · เศษหุ้น · ยอดสั่งขั้นต่ำ) · See result */
export function RebalanceForm({ mode, amount, settings, amountProblem, minOrderProblem, onMode, onAmount, onSettings, onSubmit }: Props) {
  const id = useId();
  const [setupOpen, setSetupOpen] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  const label = mode === 'deposit' ? 'Deposit amount' : 'Withdrawal amount';
  // ข้อผิดพลาดของยอดขั้นต่ำต้องมองเห็นเสมอ: เปิด Set up ให้เองเมื่อเกิด error (ผู้ใช้ปิดทีหลังได้)
  useEffect(() => {
    if (minOrderProblem !== null) setSetupOpen(true);
  }, [minOrderProblem]);
  const setupVisible = setupOpen;
  return (
    <form className="iv-card rb-form" onSubmit={submit} noValidate aria-label="Rebalancing inputs">
      <div className="rb-controls">
        <div className="iv-seg rb-mode" role="group" aria-label="Deposit or withdrawal">
          <button type="button" className={`iv-seg-btn${mode === 'deposit' ? ' is-active' : ''}`} aria-pressed={mode === 'deposit'} onClick={() => onMode('deposit')}>
            Deposit / Rebalance
          </button>
          <button type="button" className={`iv-seg-btn${mode === 'withdraw' ? ' is-active' : ''}`} aria-pressed={mode === 'withdraw'} onClick={() => onMode('withdraw')}>
            Withdrawal
          </button>
        </div>
        <div className="iv-field rb-amount">
          <label htmlFor={`${id}-amount`}>{label} (USD)</label>
          <div className="rb-money">
            <span aria-hidden="true">$</span>
            <input
              id={`${id}-amount`}
              inputMode="decimal"
              autoComplete="off"
              placeholder={mode === 'deposit' ? '0.00' : 'Amount to withdraw'}
              value={amount}
              onChange={(e) => onAmount(e.target.value)}
              aria-invalid={amountProblem !== null ? true : undefined}
              aria-describedby={amountProblem !== null ? `${id}-amount-err` : undefined}
            />
          </div>
          {amountProblem !== null && (
            <span id={`${id}-amount-err`} className="rb-err" role="alert">
              {AMOUNT_PROBLEM_TEXT[amountProblem]}
            </span>
          )}
        </div>
        <button type="button" className="iv-btn rb-setup-btn" aria-expanded={setupVisible} aria-controls={`${id}-setup`} onClick={() => setSetupOpen(!setupVisible)}>
          Set up <span aria-hidden="true">{setupVisible ? '▴' : '▾'}</span>
        </button>
        <button type="submit" className="iv-btn rb-submit">
          See result
        </button>
      </div>
      {setupVisible && (
        <div id={`${id}-setup`} className="rb-setup" role="group" aria-label="Set up">
          <label className="rb-check">
            <input type="checkbox" checked={settings.allowSales} onChange={(e) => onSettings({ allowSales: e.target.checked })} />
            <span>
              Allow sales
              <span className="rb-hint">Sell holdings above their target to fund the buys. Off by default.</span>
            </span>
          </label>
          <label className="rb-check">
            <input type="checkbox" checked={settings.fractional} onChange={(e) => onSettings({ fractional: e.target.checked })} />
            <span>
              Fractional shares
              <span className="rb-hint">On: shares to 3 decimals. Off: whole shares only.</span>
            </span>
          </label>
          <div className="iv-field rb-min">
            <label htmlFor={`${id}-min`}>Minimum order amount (USD)</label>
            <div className="rb-money">
              <span aria-hidden="true">$</span>
              <input
                id={`${id}-min`}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={settings.minOrder}
                onChange={(e) => onSettings({ minOrder: e.target.value })}
                aria-invalid={minOrderProblem !== null ? true : undefined}
                aria-describedby={minOrderProblem !== null ? `${id}-min-err` : undefined}
              />
            </div>
            {minOrderProblem !== null && (
              <span id={`${id}-min-err`} className="rb-err" role="alert">
                {AMOUNT_PROBLEM_TEXT[minOrderProblem]}
              </span>
            )}
            <span className="rb-hint">Buy lines below this amount are skipped. Sell lines are never skipped.</span>
          </div>
        </div>
      )}
    </form>
  );
}
