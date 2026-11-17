import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { formatDateEn, MONTHS_EN } from '../app/dateEn';
import { friendlyError } from '../app/errorText';
import { newId } from '../app/ids';
import type { FinanceSettings } from '../domain/bills/settings';
import { dcaPlanProblem, dcaStartMonth, dcaStatus, MAX_DCA_PLANS, type DcaPlan } from '../domain/invest/dcaPlan';
import type { Asset, TradeRecord } from '../domain/invest/types';
import { formatBaht, parseBahtToSatang, satang, toBahtString } from '../domain/money/satang';
import { StorageError } from '../storage/repository';
import { useRepository } from './RepositoryContext';

/** "2026-11" → "Nov 2026" (ข้อความล้วน ไม่ใช้ Date) */
const monthKeyLabelEn = (key: string): string => {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  const month = m ? Number(m[2]) : 0;
  return m && month >= 1 && month <= 12 ? `${MONTHS_EN[month - 1]} ${m[1]}` : key;
};
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

interface Props {
  assets: readonly Asset[];
  trades: readonly TradeRecord[];
  today: string;
  /** กด "Record planned buy": เปิดฟอร์มซื้อของสินทรัพย์นี้ที่กรอกยอดเงินไว้แล้ว ผู้ใช้ตรวจและยืนยันเอง (ไม่ซื้อให้อัตโนมัติ) */
  onBuy: (assetId: string, amountText: string, opener: HTMLElement) => void;
}

/**
 * แผนซื้อประจำ (DCA) แบบตัวเตือน (P5 · R17): ถึงกำหนดแล้วเตือน กดแล้วเปิดฟอร์มซื้อที่กรอกยอดไว้
 * ไม่มีรายการรอยืนยันในฐานข้อมูล ไม่ดึงราคา ไม่ซื้อให้เอง · เก็บในค่าตั้งค่าของผู้ใช้ (รวมในไฟล์สำรอง)
 */
export function DcaPlansCard({ assets, trades, today, onBuy }: Props) {
  const repo = useRepository();
  const [settings, setSettings] = useState<FinanceSettings | null>(null);
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [assetId, setAssetId] = useState('');
  const [amountText, setAmountText] = useState('');
  const [day, setDay] = useState('1');
  const [formError, setFormError] = useState<{ field: 'dca-asset' | 'dca-amount' | 'dca-day'; message: string } | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const [confirmDelete, setConfirmDelete] = useState('');

  const load = useCallback(async () => {
    try {
      setSettings(await repo.loadSettings());
      setLoadError('');
    } catch (e) {
      setLoadError(friendlyError(e));
    }
  }, [repo]);

  useEffect(() => {
    void load();
  }, [load]);

  // เปิดฟอร์ม: โฟกัสช่องแรก
  useEffect(() => {
    if (adding) document.getElementById('dca-asset')?.focus();
  }, [adding]);

  const closeForm = () => {
    setAdding(false);
    setFormError(null);
    // ฟอร์มหาย: คืนโฟกัสให้ปุ่ม "เพิ่มแผน" (รอให้ปุ่มกลับมา render ก่อน)
    window.requestAnimationFrame(() => addBtnRef.current?.focus());
  };
  const onFormKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !e.defaultPrevented && (e.target as HTMLElement).tagName !== 'SELECT') closeForm();
  };

  useEffect(() => {
    if (confirmDelete === '') return;
    const timer = window.setTimeout(() => setConfirmDelete(''), 5000);
    return () => window.clearTimeout(timer);
  }, [confirmDelete]);

  const plans = settings?.dcaPlans ?? [];
  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const activeAssets = assets.filter((a) => a.archived !== true);

  const save = async (change: (current: DcaPlan[]) => DcaPlan[], okText: string): Promise<boolean> => {
    if (settings === null) return false;
    setBusy(true);
    setMessage(null);
    try {
      // คำนวณจากค่าล่าสุดเสมอแล้วเขียนแบบ compare-and-set: ถ้าแท็บอื่นเพิ่งเพิ่ม/ลบแผน จะอ่านใหม่แล้วคำนวณใหม่ ไม่เขียนทับ
      // เปลี่ยนเฉพาะ dcaPlans (ค่าตั้งค่าอื่นไม่ถูกแตะ) · แผนว่าง = ลบคีย์
      const saved = await repo.updateSettings(['dcaPlans'], (current) => {
        const nextPlans = change(current.dcaPlans ?? []);
        return { dcaPlans: nextPlans.length > 0 ? nextPlans : null };
      });
      setSettings(saved);
      setMessage({ text: okText, kind: 'ok' });
      return true;
    } catch (e) {
      setMessage({ text: e instanceof StorageError ? e.message : friendlyError(e), kind: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (assetId === '' || !assetById.has(assetId)) {
      setFormError({ field: 'dca-asset', message: 'Choose a fund or stock' });
      document.getElementById('dca-asset')?.focus();
      return;
    }
    let amount: number;
    try {
      amount = parseBahtToSatang(amountText.replace(/฿/g, ''));
      if (amount < 1 || /^\s*[+-]/.test(amountText)) throw new Error('Amount must be greater than 0');
    } catch {
      setFormError({ field: 'dca-amount', message: 'Invalid amount per period (at least 0.01 THB)' });
      document.getElementById('dca-amount')?.focus();
      return;
    }
    const dayOfMonth = Number(day);
    const validDay = Number.isInteger(dayOfMonth) && dayOfMonth >= 1 && dayOfMonth <= 31;
    const startMonth = validDay ? dcaStartMonth(today, dayOfMonth) : today.slice(0, 7);
    const plan: DcaPlan = { id: newId('dca'), assetId, amount, dayOfMonth, startMonth };
    const problem = dcaPlanProblem(plan);
    if (problem) {
      setFormError({ field: 'dca-day', message: problem });
      document.getElementById('dca-day')?.focus();
      return;
    }
    if (plans.length >= MAX_DCA_PLANS) {
      setFormError({ field: 'dca-asset', message: `You can have at most ${MAX_DCA_PLANS} plans` });
      return;
    }
    setFormError(null);
    const ok = await save(
      (cur) => (cur.length >= MAX_DCA_PLANS ? cur : [...cur, plan]),
      'Plan added. You will be reminded when the date arrives (it does not buy for you).',
    );
    if (ok) {
      setAmountText('');
      closeForm();
    }
  };

  const toggle = (p: DcaPlan) =>
    save(
      (cur) =>
        cur.map((x): DcaPlan => {
          if (x.id !== p.id) return x;
          if (x.paused === true) return { id: x.id, assetId: x.assetId, amount: x.amount, dayOfMonth: x.dayOfMonth, startMonth: x.startMonth };
          return { ...x, paused: true };
        }),
      p.paused === true ? 'Plan resumed' : 'Plan paused. No reminders until you resume it.',
    );

  const remove = async (p: DcaPlan) => {
    if (confirmDelete !== p.id) {
      setConfirmDelete(p.id);
      setMessage({ text: 'Press delete again within 5 seconds to confirm (only the reminder plan is deleted; your trades are not affected)', kind: 'ok' });
      return;
    }
    setConfirmDelete('');
    const ok = await save((cur) => cur.filter((x) => x.id !== p.id), 'Plan deleted');
    if (ok) window.requestAnimationFrame(() => titleRef.current?.focus()); // ปุ่มที่โฟกัสอยู่หายไปแล้ว
  };

  return (
    <section className="solid card" aria-labelledby="dca-title">
      <h2 id="dca-title" ref={titleRef} tabIndex={-1}>
        Recurring buy plans (reminders)
      </h2>
      <p className="muted small">
        Set the day and amount you intend to buy each month. When the day comes you get a reminder and the buy form is pre-filled; you review it and save it yourself (nothing is bought automatically, and this is not investment advice).
      </p>
      <div role="status" aria-live="polite">
        {message?.kind === 'ok' && <p className="muted">{message.text}</p>}
      </div>
      <div role="alert">{message?.kind === 'error' && <p className="form-error">{message.text}</p>}</div>

      {loadError !== '' && (
        <div role="alert">
          <p className="form-error">Could not load plans: {loadError}</p>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}

      {settings !== null && plans.length === 0 && !adding && <p className="muted">No plans yet. Press "Add plan" to be reminded when a buy day arrives.</p>}

      {plans.length > 0 && (
        <ul className="list-plain">
          {plans.map((p) => {
            const asset = assetById.get(p.assetId);
            const status = dcaStatus(p, trades, today, asset !== undefined);
            return (
              <li key={p.id} className="row-item">
                <div>
                  <strong>{asset?.name ?? 'Fund/stock not found'}</strong>
                  <p className="muted small">
                    Buy {formatBaht(satang(p.amount))} on day {p.dayOfMonth} of every month
                    {p.dayOfMonth > 28 && ' (shorter months use the last day of the month)'}
                  </p>
                  {status.state === 'due' && (
                    <p role="note">
                      <strong>Due</strong> for {monthKeyLabelEn(status.cycle)} (due {formatDateEn(status.dueDate)}
                      {status.daysLate > 0 ? `, ${plural(status.daysLate, 'day', 'days')} late` : ', today'})
                      {status.pendingCycles > 1 && ` · ${status.pendingCycles} months behind; reminders come one month at a time`}
                    </p>
                  )}
                  {status.state === 'upcoming' && (
                    <p className="muted small">
                      Next: {formatDateEn(status.dueDate)} (in {plural(status.daysUntil, 'day', 'days')})
                    </p>
                  )}
                  {status.state === 'paused' && <p className="muted small">Plan paused (no reminders)</p>}
                  {status.state === 'unknown-asset' && <p className="form-error">The fund/stock for this plan was not found. You can delete this plan.</p>}
                </div>
                <div className="row-actions">
                  {status.state === 'due' && asset && (
                    <button
                      type="button"
                      className="btn btn-primary btn-small"
                      aria-label={`Record planned buy ${asset.name}`}
                      onClick={(e) => onBuy(p.assetId, toBahtString(satang(p.amount)), e.currentTarget)}
                    >
                      Record planned buy
                    </button>
                  )}
                  {status.state !== 'unknown-asset' && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      disabled={busy}
                      aria-label={`${p.paused === true ? 'Resume plan' : 'Pause plan (stop reminders for now)'} ${asset?.name ?? ''}`}
                      onClick={() => void toggle(p)}
                    >
                      {p.paused === true ? 'Resume' : 'Pause'}
                    </button>
                  )}
                  <button
                    type="button"
                    className={confirmDelete === p.id ? 'btn btn-ghost btn-small confirm-delete' : 'btn btn-ghost btn-small'}
                    disabled={busy}
                    aria-label={`${confirmDelete === p.id ? 'Press again to delete plan' : 'Delete plan'} ${asset?.name ?? ''}`}
                    onClick={() => void remove(p)}
                  >
                    {confirmDelete === p.id ? 'Press again to delete' : 'Delete plan'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {settings !== null && !adding && (
        <button
          type="button"
          ref={addBtnRef}
          className="btn btn-small"
          disabled={busy || activeAssets.length === 0}
          onClick={() => {
            setAdding(true);
            setAssetId(activeAssets.length === 1 ? activeAssets[0]!.id : '');
            setFormError(null);
          }}
        >
          Add plan
        </button>
      )}
      {activeAssets.length === 0 && settings !== null && <p className="muted small">Add a fund or stock first, then you can set up a plan.</p>}

      {adding && (
        <form onSubmit={submit} onKeyDown={onFormKey} className="settings-form" noValidate>
          <div className="field-row">
            <div className="field">
              <label htmlFor="dca-asset">Fund/stock</label>
              <select
                id="dca-asset"
                value={assetId}
                aria-invalid={formError?.field === 'dca-asset' ? true : undefined}
                aria-describedby={formError?.field === 'dca-asset' ? 'dca-form-err' : undefined}
                onChange={(e) => setAssetId(e.target.value)}
              >
                <option value="">Choose fund/stock</option>
                {activeAssets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="dca-amount">Amount per period (THB)</label>
              <input
                id="dca-amount"
                className="num"
                inputMode="decimal"
                autoComplete="off"
                placeholder="1,000.00"
                value={amountText}
                aria-invalid={formError?.field === 'dca-amount' ? true : undefined}
                aria-describedby={formError?.field === 'dca-amount' ? 'dca-form-err' : undefined}
                onChange={(e) => setAmountText(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="dca-day">Buy on day (1-31)</label>
              <input
                id="dca-day"
                className="num"
                inputMode="numeric"
                autoComplete="off"
                value={day}
                aria-invalid={formError?.field === 'dca-day' ? true : undefined}
                aria-describedby={formError?.field === 'dca-day' ? 'dca-form-err' : undefined}
                onChange={(e) => setDay(e.target.value)}
              />
            </div>
          </div>
          {formError !== null && (
            <p id="dca-form-err" className="avg-err" role="alert">
              {formError.message}
            </p>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-ghost btn-small" onClick={closeForm}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-small" disabled={busy}>
              Save plan
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
