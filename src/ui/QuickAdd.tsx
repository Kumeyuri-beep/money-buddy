import { useMemo, useRef, useState, type FormEvent } from 'react';
import { thaiIsoDate, thaiDayLabel } from '../app/dates';
import { buildEntry, counterOptions, walletOptions, type FormKind } from '../app/entryForm';
import { newId } from '../app/ids';
import { learnFromHistory, parseQuickText } from '../app/quickText';
import type { Entry } from '../domain/ledger/types';
import { formatBaht, parseBahtToSatang } from '../domain/money/satang';
import { db } from '../storage/instance';
import { appendEntry, type Ledger } from '../storage/repository';

interface QuickAddProps {
  ledger: Ledger;
  onSaved: (entry: Entry) => void;
}

const KIND_LABEL: Record<FormKind, string> = { expense: 'รายจ่าย', income: 'รายรับ', transfer: 'โอนเงิน' };

/** ช่องพิมพ์สั้นๆ เช่น "กาแฟ 65" พร้อมตัวอย่างที่แก้ได้ก่อนกด Enter บันทึก */
export function QuickAdd({ ledger, onSaved }: QuickAddProps) {
  const { accounts, entries } = ledger;
  const [text, setText] = useState('');
  const [override, setOverride] = useState<{ walletId?: string; counterId?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const counterRef = useRef<HTMLSelectElement>(null);

  const learned = useMemo(() => learnFromHistory(accounts, entries), [accounts, entries]);
  const result = useMemo(
    () => parseQuickText(text, { accounts, today: thaiIsoDate(), learned }),
    [text, accounts, learned],
  );

  const wallets = walletOptions(accounts);
  const draft = result.ok ? result.draft : null;

  // ค่าที่ใช้จริง = ที่ระบบเดา แต่ถ้าผู้ใช้เลือกเองแล้วให้ตามนั้น
  const form = draft
    ? {
        ...draft.form,
        walletId: override.walletId ?? draft.form.walletId,
        counterId: override.counterId ?? draft.form.counterId,
      }
    : null;
  const counters = form ? counterOptions(accounts, form.kind, form.walletId) : [];
  const counterId = form && counters.some((a) => a.id === form.counterId) ? form.counterId : '';

  const reset = () => {
    setText('');
    setOverride({});
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    if (!counterId) {
      setError(form.kind === 'transfer' ? 'เลือกกระเป๋าปลายทางก่อน' : 'เลือกหมวดก่อน');
      counterRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const input = { ...buildEntry(accounts, { ...form, counterId }, newId('e')), source: 'quick' as const };
      const entry = await appendEntry(db, input);
      reset();
      onSaved(entry);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const today = thaiIsoDate();
  const amountText = form ? formatBaht(parseBahtToSatang(form.amount)) : '';
  const counterLabel = form?.kind === 'transfer' ? 'ไปกระเป๋า' : 'หมวด';
  const walletLabel = form?.kind === 'income' ? 'เข้ากระเป๋า' : form?.kind === 'transfer' ? 'จากกระเป๋า' : 'จากกระเป๋า';

  return (
    <form className="quick" onSubmit={submit}>
      <div className="quick-input">
        <label htmlFor="quick-text" className="sr-only">
          พิมพ์รายการสั้นๆ
        </label>
        <input
          id="quick-text"
          type="text"
          autoComplete="off"
          placeholder="พิมพ์สั้นๆ เช่น กาแฟ 65"
          title="ตัวอย่าง: กาแฟ 65 / เงินเดือน 17000 เข้า Mainframe / โอน 2500 ไป Vault / เมื่อวาน ข้าว 50"
          aria-describedby="quick-preview"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
            if (e.target.value.trim() === '') setOverride({});
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') reset();
          }}
        />
        <button type="submit" className="btn btn-primary" disabled={saving || !form}>
          บันทึก
        </button>
      </div>

      <div id="quick-preview" className="quick-preview" aria-live="polite">
        {result.ok === false && result.message && <p className="muted quick-hint">{result.message}</p>}

        {form && (
          <div className="quick-draft">
            <span className={`quick-kind kind-${form.kind}`}>{KIND_LABEL[form.kind]}</span>
            <strong className="num quick-amount">{amountText}</strong>

            <label className="quick-field">
              <span>{walletLabel}</span>
              <select
                value={form.walletId}
                onChange={(e) => setOverride((o) => ({ ...o, walletId: e.target.value }))}
              >
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="quick-field">
              <span>{counterLabel}</span>
              <select
                ref={counterRef}
                value={counterId}
                aria-invalid={!counterId}
                onChange={(e) => {
                  setOverride((o) => ({ ...o, counterId: e.target.value }));
                  setError(null);
                }}
              >
                {!counterId && <option value="">{form.kind === 'transfer' ? 'เลือกปลายทาง' : 'เลือกหมวด'}</option>}
                {counters.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>

            {form.date !== today && <span className="quick-date">{thaiDayLabel(form.date)}</span>}
            {form.memo && <span className="muted quick-memo">{form.memo}</span>}
          </div>
        )}

        {error && (
          <p role="alert" className="form-error quick-error">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
