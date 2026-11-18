import { useId, useState, type FormEvent } from 'react';
import type { GoalCurrency, GoalKind } from '../../../domain/invest/goalProjection';
import { InfoTip } from '../Tip';
import type { GoalDraft } from './goalDraft';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface Props {
  draft: GoalDraft;
  errors: Partial<Record<keyof GoalDraft, string>>;
  currency: GoalCurrency;
  saving: boolean;
  saveError: string;
  /** แนะนำค่าเงินเพิ่มต่อเดือนจากรายการซื้อจริง (ข้อความอธิบายใต้ช่อง) · null = ไม่มี */
  contributionHint: string | null;
  onChange: (patch: Partial<GoalDraft>) => void;
  onSubmit: () => void;
}

/** ฟอร์มตั้งเป้า (ภาษาอังกฤษ): Goal (Value / Passive income) · Achieve by · Contributions · Returns and inflation · Save and calculate */
export function GoalForm({ draft, errors, currency, saving, saveError, contributionHint, onChange, onSubmit }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const symbol = currency === 'THB' ? '฿' : '$';
  const kinds: { kind: GoalKind; label: string }[] = [
    { kind: 'value', label: 'Value' },
    { kind: 'income', label: 'Passive income' },
  ];
  // ช่องผลตอบแทนผิด/ว่างต้องมองเห็นเสมอ (ซ่อนไว้ในส่วนที่พับแล้วจะหาไม่เจอ)
  const returnsOpen = open || errors.returnPct !== undefined || errors.inflationPct !== undefined || draft.returnPct.trim() === '';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  const err = (key: keyof GoalDraft) =>
    errors[key] ? (
      <span id={`${id}-${key}-err`} className="iv-goal-err" role="alert">
        {errors[key]}
      </span>
    ) : null;
  const describedBy = (key: keyof GoalDraft, extra?: string): string | undefined => {
    const ids = [errors[key] ? `${id}-${key}-err` : '', extra ?? ''].filter(Boolean).join(' ');
    return ids === '' ? undefined : ids;
  };

  return (
    <form className="iv-card iv-goal-form" onSubmit={submit} noValidate aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="sr-only">
        Set your goal
      </h3>

      <fieldset className="iv-goal-kind">
        <legend>
          Goal
          <InfoTip label="About Goal" tip="Value is the market value of your stocks. Passive income is the dividends you could receive per month at today's yield." />
        </legend>
        <div className="iv-seg" role="group" aria-label="Goal type">
          {kinds.map((k) => (
            <button key={k.kind} type="button" className={`iv-seg-btn${draft.kind === k.kind ? ' is-active' : ''}`} aria-pressed={draft.kind === k.kind} onClick={() => onChange({ kind: k.kind })}>
              {k.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="iv-field">
        <label htmlFor={`${id}-target`}>{draft.kind === 'value' ? 'Target value' : 'Target passive income per month'}</label>
        <div className="iv-goal-money">
          <span aria-hidden="true">{symbol}</span>
          <input id={`${id}-target`} inputMode="decimal" autoComplete="off" value={draft.target} onChange={(e) => onChange({ target: e.target.value })} aria-invalid={errors.target ? true : undefined} aria-describedby={describedBy('target')} />
          <span className="iv-goal-unit" aria-hidden="true">
            {draft.kind === 'income' ? 'per month · ' : ''}
            {currency}
          </span>
        </div>
        {err('target')}
      </div>

      <fieldset className="iv-goal-by">
        <legend>
          Achieve by
          <InfoTip label="About Achieve by" tip="The month you want to reach the target. We compare it with when the projection reaches it." />
        </legend>
        <div className="iv-goal-by-row">
          <div className="iv-field">
            <label htmlFor={`${id}-month`}>Month</label>
            <select id={`${id}-month`} value={draft.month} onChange={(e) => onChange({ month: e.target.value })}>
              {MONTHS.map((m, i) => (
                <option key={m} value={String(i + 1)}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="iv-field">
            <label htmlFor={`${id}-year`}>Year</label>
            <input id={`${id}-year`} inputMode="numeric" autoComplete="off" value={draft.year} onChange={(e) => onChange({ year: e.target.value })} aria-invalid={errors.year ? true : undefined} aria-describedby={describedBy('year')} />
          </div>
        </div>
        {err('year')}
      </fieldset>

      <div className="iv-field">
        <label htmlFor={`${id}-contrib`}>
          Contributions per month
          <InfoTip label="About Contributions" tip="Money you plan to add to the portfolio each month. We suggest the average of your real purchases in the last 12 months; you can change it." />
        </label>
        <div className="iv-goal-money">
          <span aria-hidden="true">{symbol}</span>
          <input id={`${id}-contrib`} inputMode="decimal" autoComplete="off" value={draft.contribution} onChange={(e) => onChange({ contribution: e.target.value })} aria-invalid={errors.contribution ? true : undefined} aria-describedby={describedBy('contribution', contributionHint ? `${id}-contrib-hint` : undefined)} />
          <span className="iv-goal-unit" aria-hidden="true">
            per month
          </span>
        </div>
        {contributionHint && (
          <span id={`${id}-contrib-hint`} className="iv-goal-hint">
            {contributionHint}
          </span>
        )}
        {err('contribution')}
      </div>

      <section className="iv-goal-expand" aria-label="Returns and inflation">
        <div className="iv-goal-expand-head">
          <h4>Returns and inflation</h4>
          <button type="button" className="iv-link" aria-expanded={returnsOpen} aria-controls={`${id}-returns`} onClick={() => setOpen(!returnsOpen)}>
            {returnsOpen ? '− Collapse' : '+ Expand'}
          </button>
        </div>
        {returnsOpen && (
          <div id={`${id}-returns`} className="iv-goal-expand-body">
            <div className="iv-field">
              <label htmlFor={`${id}-return`}>Expected return per year (%)</label>
              <input id={`${id}-return`} inputMode="decimal" autoComplete="off" value={draft.returnPct} onChange={(e) => onChange({ returnPct: e.target.value })} aria-invalid={errors.returnPct ? true : undefined} aria-describedby={describedBy('returnPct')} />
              {err('returnPct')}
            </div>
            <div className="iv-field">
              <label htmlFor={`${id}-infl`}>Inflation per year (%, optional)</label>
              <input id={`${id}-infl`} inputMode="decimal" autoComplete="off" value={draft.inflationPct} onChange={(e) => onChange({ inflationPct: e.target.value })} aria-invalid={errors.inflationPct ? true : undefined} aria-describedby={describedBy('inflationPct')} />
              {err('inflationPct')}
            </div>
          </div>
        )}
      </section>

      {saveError && (
        <p className="form-error" role="alert">
          {saveError}
        </p>
      )}
      <button type="submit" className="iv-btn iv-btn-gold iv-goal-save" disabled={saving}>
        {saving ? 'Saving…' : 'Save and calculate'}
      </button>
    </form>
  );
}
