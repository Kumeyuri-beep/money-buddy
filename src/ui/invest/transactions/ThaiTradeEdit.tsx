import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { newId } from '../../../app/ids';
import { linkedCashAccountId, tradeToForm } from '../../../app/tradeEditForm';
import { buildTradeRecord, type TradeField, type TradeForm, type TradeFormError } from '../../../app/tradeForm';
import { previewTradeEdit, type EditSide } from '../../../domain/invest/editImpact';
import { tradeNeedsWallet } from '../../../domain/invest/ledgerLink';
import type { Asset, TradeRecord } from '../../../domain/invest/types';
import type { Account, Entry } from '../../../domain/ledger/types';
import { nextCreatedAt } from '../../../storage/repository';
import { useRepository } from '../../RepositoryContext';
import { KIND_LABEL } from '../../TradeItem';
import { investError, investProblem } from '../investError';
import { EditImpact } from './EditImpact';

interface Props {
  /** รายการที่กำลังแก้ (สินทรัพย์บาท: ซื้อ/ขาย/ปันผล/ปันผลลงทุนต่อ) */
  trade: TradeRecord;
  asset: Asset;
  /** รายการทั้งหมดของสินทรัพย์นี้ (ใช้ตรวจกติกาและคำนวณผลกระทบ) */
  assetTrades: readonly TradeRecord[];
  accounts: readonly Account[];
  entries: readonly Entry[];
  /** กระเป๋าเงินสดบาทที่เลือกได้ */
  wallets: readonly { id: string; name: string }[];
  today: string;
  onClose: () => void;
  onSaved: (text: string) => void;
}

function Field(props: { id: string; label: string; value: string; onChange: (v: string) => void; errors: TradeFormError[]; field: TradeField; hint?: string; placeholder?: string; type?: string; text?: boolean }) {
  const { id, label, value, onChange, errors, field, hint, placeholder, type, text } = props;
  const error = errors.find((e) => e.field === field);
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type ?? 'text'}
        inputMode={type === 'date' || text ? undefined : 'decimal'}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && (
        <p id={`${id}-hint`} className="muted small">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="avg-err" role="alert">
          {investProblem(error)}
        </p>
      )}
    </div>
  );
}

/**
 * แก้รายการของสินทรัพย์บาท (กองทุน/หุ้นไทย) · dialog เฉพาะคอม · ฟอร์มและตัวตรวจเดียวกับตอน Add (buildTradeRecord) เติมค่าเดิม
 * ชนิดรายการเปลี่ยนไม่ได้ (ซื้อยังเป็นซื้อ) · ตรวจกติกาและแสดงต้นทุนเฉลี่ย/กำไรที่ขายแล้ว ก่อน→หลัง แล้วจึงบันทึกด้วย replaceTrade
 */
export function ThaiTradeEdit({ trade, asset, assetTrades, accounts, entries, wallets, today, onClose, onSaved }: Props) {
  const repo = useRepository();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [form, setForm] = useState<TradeForm>(() => tradeToForm(trade));
  const [errors, setErrors] = useState<TradeFormError[]>([]);
  const [problem, setProblem] = useState('');
  const [review, setReview] = useState<{ trade: TradeRecord; before: EditSide; after: EditSide } | null>(null);
  const [busy, setBusy] = useState(false);
  /** ข้อความผิดพลาดอยู่ท้ายฟอร์ม: จอเตี้ยอาจอยู่ใต้ขอบหรือถูกแถบปุ่มบัง จึงเลื่อนเข้ากลาง dialog เมื่อแสดง (ref คงที่ ไม่เลื่อนซ้ำตอนพิมพ์ · ไม่ย้ายโฟกัส) */
  const showProblem = useCallback((el: HTMLElement | null) => el?.scrollIntoView?.({ block: 'center' }), []);
  const needWallet = tradeNeedsWallet(trade.kind);

  // กระเป๋าที่รายการเดิมใช้ (ถ้าเป็นบัญชีที่ไม่อยู่ในรายการกระเป๋า เช่น บัญชีเงินสดที่พักกับโบรกเกอร์ ก็ยังเลือกได้)
  const linked = useMemo(() => linkedCashAccountId(entries.find((e) => e.id === trade.entryId), asset.accountId, accounts), [entries, trade.entryId, asset.accountId, accounts]);
  const options = useMemo(() => {
    const list = [...wallets];
    if (linked !== undefined && !list.some((w) => w.id === linked)) {
      const acc = accounts.find((a) => a.id === linked);
      if (acc) list.push({ id: acc.id, name: acc.name });
    }
    return list;
  }, [wallets, linked, accounts]);
  const [walletId, setWalletId] = useState(linked ?? (options.length === 1 ? options[0]!.id : ''));
  const [walletError, setWalletError] = useState('');

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal(); // modal: โฟกัสถูกกักในกรอบ · พื้นหลังกดไม่ได้
    heading.current?.focus();
  }, []);

  const set = (patch: Partial<TradeForm>) => setForm((f) => ({ ...f, ...patch }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const built = buildTradeRecord(form, newId('trade'), nextCreatedAt(), today);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors([]);
    if (needWallet && !options.some((w) => w.id === walletId)) {
      setWalletError('Choose the wallet to pay from or receive into');
      return;
    }
    setWalletError('');
    const preview = previewTradeEdit({ trades: assetTrades, oldId: trade.id, next: built.trade, usd: false });
    if (!preview.ok) return setProblem(investProblem(preview.problem));
    setProblem('');
    setReview({ trade: built.trade, before: preview.before, after: preview.after });
  };

  /** ขั้นตรวจผลกระทบ → กลับฟอร์ม (ปุ่ม Back และ Esc) ค่าที่กรอกยังอยู่ */
  const backToForm = () => {
    setReview(null);
    heading.current?.focus();
  };

  const confirm = async () => {
    if (busy || !review) return;
    setBusy(true);
    try {
      await repo.replaceTrade({ oldId: trade.id, trade: review.trade, walletId: needWallet ? walletId : undefined });
      onSaved('Transaction updated');
    } catch (err) {
      setReview(null); // ชนกัน/ผิดกติกาจากฐานข้อมูล: กลับไปฟอร์มพร้อมข้อความ
      heading.current?.focus(); // ปุ่มที่โฟกัสอยู่หายไปกับขั้นตรวจผลกระทบ
      setProblem(investError(err));
    } finally {
      setBusy(false);
    }
  };

  const k = trade.kind;
  const kindText = KIND_LABEL[k].toLowerCase();
  return (
    <dialog
      ref={dialog}
      className="entry-dialog"
      aria-labelledby="th-edit-title"
      onCancel={(e) => {
        e.preventDefault();
        if (busy) return;
        if (review) backToForm();
        else onClose();
      }}
    >
      <div className="entry-form">
        <h2 id="th-edit-title" ref={heading} tabIndex={-1}>
          Edit {kindText}: {asset.name}
        </h2>
        {review ? (
          <div className="settings-form">
            <h3 className="edit-review-title">Check the change before you save</h3>
            <EditImpact before={review.before} after={review.after} currency="THB" />
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost btn-small" autoFocus onClick={backToForm} disabled={busy}>
                Back
              </button>
              <button type="button" className="btn btn-primary btn-small" onClick={() => void confirm()} disabled={busy}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="settings-form" noValidate>
            <p className="muted small">The type of a saved transaction cannot be changed. To change it, delete this one and add a new one.</p>
            <Field id="th-e-date" label="Date" type="date" value={form.date} onChange={(v) => set({ date: v })} errors={errors} field="date" />
            <div className="field-row">
              {k === 'buy' && (
                <>
                  <Field id="th-e-amount" label="Amount invested (THB)" value={form.amount} onChange={(v) => set({ amount: v })} errors={errors} field="amount" />
                  <Field id="th-e-price" label="Price per unit (THB)" value={form.price} onChange={(v) => set({ price: v })} errors={errors} field="price" />
                  <Field id="th-e-units" label="Units" value={form.units} onChange={(v) => set({ units: v })} errors={errors} field="units" />
                  <Field id="th-e-fee" label="Fee (THB)" value={form.fee} onChange={(v) => set({ fee: v })} errors={errors} field="fee" hint="Included in cost" />
                </>
              )}
              {k === 'sell' && (
                <>
                  <Field id="th-e-units" label="Units sold" value={form.units} onChange={(v) => set({ units: v })} errors={errors} field="units" />
                  <Field id="th-e-price" label="Price per unit (THB)" value={form.price} onChange={(v) => set({ price: v })} errors={errors} field="price" />
                  <Field id="th-e-fee" label="Fee (THB)" value={form.fee} onChange={(v) => set({ fee: v })} errors={errors} field="fee" hint="Deducted from the proceeds" />
                </>
              )}
              {k === 'dividend' && (
                <>
                  <Field id="th-e-amount" label="Dividend amount (THB)" value={form.amount} onChange={(v) => set({ amount: v })} errors={errors} field="amount" hint="Amount before tax" />
                  <Field id="th-e-wht" label="Withholding tax (THB)" value={form.withholding} onChange={(v) => set({ withholding: v })} errors={errors} field="withholding" />
                </>
              )}
              {k === 'reinvest' && (
                <>
                  <Field id="th-e-units" label="Units received" value={form.units} onChange={(v) => set({ units: v })} errors={errors} field="units" />
                  <Field id="th-e-amount" label="Cost added (THB)" value={form.amount} onChange={(v) => set({ amount: v })} errors={errors} field="amount" hint="Dividend amount after tax" />
                </>
              )}
            </div>
            {needWallet && (
              <div className="field">
                <label htmlFor="th-e-wallet">{k === 'buy' ? 'Pay from wallet' : 'Receive into wallet'}</label>
                <select
                  id="th-e-wallet"
                  value={walletId}
                  aria-invalid={walletError !== '' ? true : undefined}
                  aria-describedby={walletError !== '' ? 'th-e-wallet-err' : undefined}
                  onChange={(e) => {
                    setWalletId(e.target.value);
                    setWalletError('');
                  }}
                >
                  <option value="">Choose wallet</option>
                  {options.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
                {walletError !== '' && (
                  <p id="th-e-wallet-err" className="avg-err" role="alert">
                    {walletError}
                  </p>
                )}
              </div>
            )}
            <Field id="th-e-memo" label="Note (optional)" text value={form.memo} onChange={(v) => set({ memo: v })} errors={errors} field="memo" />
            {problem !== '' && (
              <p ref={showProblem} className="avg-err" role="alert" data-testid="edit-problem">
                {problem}
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-small">
                Review change
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
