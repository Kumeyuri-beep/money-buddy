import { useEffect, useRef, useState, type FormEvent } from 'react';
import { thaiIsoDate, thaiDayLabel } from '../app/dates';
import { describeEntry } from '../app/describe';
import { buildEntry, counterOptions, entryToForm, walletOptions, type FormKind } from '../app/entryForm';
import { newId } from '../app/ids';
import { findDuplicateEntry } from '../app/slipDuplicates';
import type { SlipDraft } from '../app/slipParser';
import type { Account, Entry } from '../domain/ledger/types';
import { db } from '../storage/instance';
import { appendEntry, updateEntry } from '../storage/repository';

interface Props {
  accounts: Account[];
  /** รายการทั้งหมด ใช้เตือนสลิปซ้ำ */
  entries?: Entry[];
  /** มีค่า = เติมจากสลิป (บันทึกแล้วมี source = 'ocr') ต้องให้ผู้ใช้ตรวจก่อนบันทึกเสมอ */
  scan?: SlipDraft;
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
export function AddEntryDialog({ accounts, entries = [], scan, editing, onClose, onSaved }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const wallets = walletOptions(accounts);
  const [initial] = useState(() => (editing ? entryToForm(accounts, editing) : (scan?.form ?? null)));

  const [kind, setKind] = useState<FormKind>(initial?.kind ?? 'expense');
  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [walletId, setWalletId] = useState(initial?.walletId ?? wallets[0]?.id ?? '');
  const [chosenCounter, setChosenCounter] = useState(initial?.counterId ?? '');
  const [date, setDate] = useState(() => initial?.date ?? thaiIsoDate());
  const [memo, setMemo] = useState(initial?.memo ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // ค่าที่ OCR เติมให้ (ยอด/วันที่) ถือว่า "ยังไม่ได้ยืนยัน" จนกว่าผู้ใช้จะแก้ หรือกด "ตรงกับสลิป"
  const [confirmed, setConfirmed] = useState({ amount: false, date: false });
  // ข้อความประกาศผลให้โปรแกรมอ่านหน้าจอหลังกดยืนยัน (live region ที่คงอยู่ตลอด)
  const [announce, setAnnounce] = useState('');
  // เตือนครั้งแรกที่กดบันทึกทั้งที่ยังไม่ยืนยัน กดซ้ำเพื่อบันทึกต่อ
  const [warnedUnverified, setWarnedUnverified] = useState(false);

  // ตัวเลือกช่องที่สองเปลี่ยนตามประเภท ถ้าค่าที่เลือกไว้ใช้ไม่ได้แล้ว ใช้ตัวแรกแทน
  const counters = counterOptions(accounts, kind, walletId);
  // เติมจากสลิป: ห้ามเลือกหมวดแรกให้เงียบๆ ถ้าเดาไม่ได้ ต้องให้ผู้ใช้เลือกเอง
  const counterId = counters.some((a) => a.id === chosenCounter) ? chosenCounter : scan ? '' : (counters[0]?.id ?? '');

  const duplicate = scan
    ? findDuplicateEntry(entries, { date, amount, ...(scan.recipient ? { recipient: scan.recipient } : {}) })
    : undefined;
  const transferWarning = scan?.warnings.find((w) => w.code === 'maybe-transfer');
  const otherWarnings = scan?.warnings.filter((w) => w.code !== 'maybe-transfer') ?? [];
  // รายการที่ยังรอผู้ใช้กรอก: หายไปเองเมื่อกรอก/เลือกแล้ว (วันที่: ถือว่ายังไม่ยืนยันจนกว่าจะเปลี่ยนจากค่าที่ระบบใส่ให้)
  const amountMissing = !!scan && scan.missing.includes('amount') && amount.trim() === '';
  const unread: string[] = [];
  if (amountMissing) unread.push('จำนวนเงิน');
  if (scan?.missing.includes('date') && date === initial?.date) unread.push('วันที่');
  if (scan && counterId === '') unread.push(kind === 'transfer' ? 'กระเป๋าปลายทาง' : 'หมวด');

  const amountUnverified = !!scan && !!initial?.amount && !confirmed.amount;
  // วันที่ที่อ่านไม่ได้ (ระบบใส่วันนี้ให้) เสี่ยงกว่าวันที่ที่อ่านได้ จึงขึ้นเครื่องหมายที่ช่องเหมือนกัน
  const dateReadable = !!scan && !scan.missing.includes('date');
  const dateUnverified = !!scan && !confirmed.date;

  const amountRef = useRef<HTMLInputElement>(null);
  const counterRef = useRef<HTMLSelectElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    // showModal ย้ายโฟกัสไปที่ช่องแรกเอง จึงต้องสั่งโฟกัสช่องจำนวนเงินหลังเปิด (ช่องแรกที่ต้องตรวจ แล้ว Tab ไปหมวด/วันที่)
    amountRef.current?.focus();
  }, []);

  const clearError = () => setError(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // เติมจากสลิปและยังไม่ได้ยืนยันยอด/วันที่: เตือนก่อน 1 ครั้ง (ไม่บล็อก กดบันทึกซ้ำเพื่อบันทึกต่อ)
    if (scan && !editing && !warnedUnverified && (amountUnverified || dateUnverified)) {
      setWarnedUnverified(true);
      setError('ยอดหรือวันที่ที่อ่านจากสลิปยังไม่ได้ยืนยัน ตรวจให้ตรงกับสลิป แล้วกดบันทึกอีกครั้ง');
      (amountUnverified ? amountRef : dateRef).current?.focus();
      return;
    }
    setSaving(true);
    try {
      const form = { kind, date, amount, walletId, counterId, memo };
      if (editing) {
        // คงแหล่งที่มาเดิม (เช่น สแกนสลิป) และกลุ่มเดิมไว้
        const input = { ...buildEntry(accounts, form, editing.id), source: editing.source, groupId: editing.groupId };
        const { before, after } = await updateEntry(db, editing.id, input);
        onSaved(after, before);
      } else {
        const built = buildEntry(accounts, form, newId('e'));
        const entry = await appendEntry(db, scan ? { ...built, source: 'ocr' as const } : built);
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
      aria-describedby={scan ? 'slip-notice' : undefined}
      onClose={onClose}
      onCancel={onClose}
    >
      <form onSubmit={submit} className="entry-form">
        <h2 id="entry-dialog-title">{editing ? 'แก้ไขรายการ' : scan ? 'ตรวจรายการจากสลิป' : 'บันทึกรายการ'}</h2>

        {scan && (
          <div className="slip-notice" id="slip-notice" role="group" aria-label="ข้อควรตรวจจากสลิป">
            <p>
              <strong>อ่านจากสลิปแล้ว</strong> ตรวจทุกช่องให้ตรงกับสลิปก่อนกดบันทึก รูปไม่ถูกเก็บไว้
            </p>
            {unread.length > 0 && (
              <p className="slip-warn">
                ยังต้องกรอกหรือเลือกเอง: {unread.join(' และ ')}
              </p>
            )}
            {otherWarnings.map((w) => (
              <p key={w.code} className="slip-warn">
                {w.message}
              </p>
            ))}
            {transferWarning && kind === 'expense' && (
              <div className="slip-warn slip-transfer">
                <p>{transferWarning.message}</p>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => {
                    setKind('transfer');
                    setChosenCounter(transferWarning.transferToWalletId ?? '');
                    clearError();
                  }}
                >
                  สลับเป็นโอนเงิน
                </button>
              </div>
            )}
            {duplicate && (
              <p className="slip-warn">
                ระวัง: คล้ายรายการเดิม — {duplicate.memo}{' '}
                <span className="num">{describeEntry(accounts, duplicate).amountText}</span> ({thaiDayLabel(duplicate.date)})
                <br />
                ถ้าเป็นคนละรายการ กดบันทึกได้เลย
              </p>
            )}
          </div>
        )}

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

        <div className={amountUnverified ? 'field unverified' : 'field'}>
          <label htmlFor="entry-amount">จำนวนเงิน (บาท)</label>
          <input
            id="entry-amount"
            className="amount-input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            ref={amountRef}
            aria-invalid={amountMissing || undefined}
            aria-describedby={amountMissing ? 'entry-amount-hint' : amountUnverified ? 'entry-amount-unverified' : undefined}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setConfirmed((c) => ({ ...c, amount: true })); // แก้เองแล้ว = ผู้ใช้ตรวจแล้ว
              clearError();
            }}
          />
          {amountMissing && (
            <p id="entry-amount-hint" className="field-hint">
              อ่านยอดจากสลิปไม่ได้ กรอกจำนวนเงินก่อนบันทึก
            </p>
          )}
          {amountUnverified && (
            <p className="field-hint field-hint-warn">
              <span id="entry-amount-unverified">ยังไม่ได้ยืนยัน: ตรวจยอดให้ตรงกับสลิป</span>
              <button
                type="button"
                className="btn btn-small"
                aria-label="ยืนยันว่ายอดเงินตรงกับสลิป"
                onClick={() => {
                  setConfirmed((c) => ({ ...c, amount: true }));
                  setAnnounce('ยืนยันยอดเงินตรงกับสลิปแล้ว');
                  amountRef.current?.focus(); // ปุ่มหายไปหลังกด ย้ายโฟกัสกลับช่องยอดไม่ให้หลุด
                }}
              >
                ตรงกับสลิปแล้ว
              </button>
            </p>
          )}
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
              ref={counterRef}
              aria-describedby={scan && counterId === '' ? 'entry-counter-hint' : undefined}
              aria-invalid={(!!scan && counterId === '') || undefined}
              value={counterId}
              onChange={(e) => {
                setChosenCounter(e.target.value);
                clearError();
              }}
            >
              {counterId === '' && <option value="">{kind === 'transfer' ? 'เลือกปลายทาง' : 'เลือกหมวด'}</option>}
              {counters.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            {scan && counterId === '' && (
              <p id="entry-counter-hint" className="field-hint">
                {kind === 'transfer' ? 'เลือกกระเป๋าปลายทางก่อนบันทึก' : 'เลือกหมวดก่อนบันทึก'}
              </p>
            )}
          </div>
        </div>

        <div className="field-row">
          <div className={dateUnverified ? 'field unverified' : 'field'}>
            <label htmlFor="entry-date">วันที่</label>
            <input
              id="entry-date"
              type="date"
              ref={dateRef}
              aria-describedby={dateUnverified ? 'entry-date-unverified' : undefined}
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setConfirmed((c) => ({ ...c, date: true }));
                clearError();
              }}
            />
            {dateUnverified && (
              <p className="field-hint field-hint-warn">
                <span id="entry-date-unverified">
                  {dateReadable
                    ? 'ยังไม่ได้ยืนยัน: ตรวจวันที่ให้ตรงกับสลิป'
                    : 'อ่านวันที่จากสลิปไม่ได้ ระบบใส่วันนี้ให้ ตรวจก่อนบันทึก'}
                </span>
                <button
                  type="button"
                  className="btn btn-small"
                  aria-label={dateReadable ? 'ยืนยันว่าวันที่ตรงกับสลิป' : 'ยืนยันว่าวันที่ถูกต้อง'}
                  onClick={() => {
                    setConfirmed((c) => ({ ...c, date: true }));
                    setAnnounce('ยืนยันวันที่แล้ว');
                    dateRef.current?.focus();
                  }}
                >
                  {dateReadable ? 'ตรงกับสลิปแล้ว' : 'ถูกต้องแล้ว'}
                </button>
              </p>
            )}
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

        {/* live region ที่คงอยู่ตลอด: ประกาศผลหลังกดยืนยัน (เมื่อข้อความเตือนหายไป โปรแกรมอ่านหน้าจอจะได้ยินผล) */}
        <p className="sr-only" role="status">
          {announce}
        </p>

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
