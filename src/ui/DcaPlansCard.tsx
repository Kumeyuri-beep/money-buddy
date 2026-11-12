import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { thaiDayLabel, thaiMonthKeyLabel } from '../app/dates';
import { friendlyError } from '../app/errorText';
import { newId } from '../app/ids';
import type { FinanceSettings } from '../domain/bills/settings';
import { dcaPlanProblem, dcaStartMonth, dcaStatus, MAX_DCA_PLANS, type DcaPlan } from '../domain/invest/dcaPlan';
import type { Asset, TradeRecord } from '../domain/invest/types';
import { formatBaht, parseBahtToSatang, satang, toBahtString } from '../domain/money/satang';
import { StorageError } from '../storage/repository';
import { useRepository } from './RepositoryContext';

interface Props {
  assets: readonly Asset[];
  trades: readonly TradeRecord[];
  today: string;
  /** กด "บันทึกซื้อตามแผน": เปิดฟอร์มซื้อของสินทรัพย์นี้ที่กรอกยอดเงินไว้แล้ว ผู้ใช้ตรวจและยืนยันเอง (ไม่ซื้อให้อัตโนมัติ) */
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
      // อ่านค่าล่าสุดก่อนรวม: ถ้าแท็บอื่นเพิ่งเปลี่ยนแผนหรือค่าตั้งค่า เราไม่ย้อนค่านั้นกลับ
      const fresh = await repo.loadSettings();
      // เปลี่ยนเฉพาะ dcaPlans (ค่าตั้งค่าอื่นไม่ถูกแตะ จึงไม่เขียนทับสิ่งที่แท็บอื่นเพิ่งบันทึก) · แผนว่าง = ลบคีย์
      const nextPlans = change(fresh.dcaPlans ?? []);
      const saved = await repo.patchSettings({ dcaPlans: nextPlans.length > 0 ? nextPlans : null });
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
      setFormError({ field: 'dca-asset', message: 'เลือกกองทุนหรือหุ้น' });
      document.getElementById('dca-asset')?.focus();
      return;
    }
    let amount: number;
    try {
      amount = parseBahtToSatang(amountText.replace(/฿/g, ''));
      if (amount < 1 || /^\s*[+-]/.test(amountText)) throw new Error('จำนวนเงินต้องมากกว่า 0');
    } catch {
      setFormError({ field: 'dca-amount', message: 'จำนวนเงินต่อรอบไม่ถูกต้อง (อย่างน้อย 0.01 บาท)' });
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
      setFormError({ field: 'dca-asset', message: `มีแผนได้ไม่เกิน ${MAX_DCA_PLANS} แผน` });
      return;
    }
    setFormError(null);
    const ok = await save(
      (cur) => (cur.length >= MAX_DCA_PLANS ? cur : [...cur, plan]),
      'เพิ่มแผนแล้ว ระบบจะเตือนเมื่อถึงวันที่กำหนด (ไม่ซื้อให้เอง)',
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
      p.paused === true ? 'เริ่มแผนต่อแล้ว' : 'พักแผนแล้ว จะไม่เตือนจนกว่าจะเริ่มต่อ',
    );

  const remove = async (p: DcaPlan) => {
    if (confirmDelete !== p.id) {
      setConfirmDelete(p.id);
      setMessage({ text: 'กดปุ่มลบอีกครั้งภายใน 5 วินาทีเพื่อยืนยัน (ลบเฉพาะแผนเตือน ไม่กระทบรายการซื้อขาย)', kind: 'ok' });
      return;
    }
    setConfirmDelete('');
    const ok = await save((cur) => cur.filter((x) => x.id !== p.id), 'ลบแผนแล้ว');
    if (ok) window.requestAnimationFrame(() => titleRef.current?.focus()); // ปุ่มที่โฟกัสอยู่หายไปแล้ว
  };

  return (
    <section className="solid card" aria-labelledby="dca-title">
      <h2 id="dca-title" ref={titleRef} tabIndex={-1}>
        แผนซื้อประจำ (ตัวเตือน)
      </h2>
      <p className="muted small">
        ตั้งวันและเงินที่ตั้งใจซื้อทุกเดือน ถึงวันแล้วระบบเตือนและกรอกยอดในฟอร์มซื้อให้ คุณตรวจแล้วกดบันทึกเอง (ไม่ซื้อให้อัตโนมัติ และไม่ใช่คำแนะนำการลงทุน)
      </p>
      <div role="status" aria-live="polite">
        {message?.kind === 'ok' && <p className="muted">{message.text}</p>}
      </div>
      <div role="alert">{message?.kind === 'error' && <p className="form-error">{message.text}</p>}</div>

      {loadError !== '' && (
        <div role="alert">
          <p className="form-error">โหลดแผนไม่สำเร็จ: {loadError}</p>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => void load()}>
            ลองอีกครั้ง
          </button>
        </div>
      )}

      {settings !== null && plans.length === 0 && !adding && <p className="muted">ยังไม่มีแผน กด "เพิ่มแผน" เพื่อให้ระบบเตือนเมื่อถึงวันซื้อ</p>}

      {plans.length > 0 && (
        <ul className="list-plain">
          {plans.map((p) => {
            const asset = assetById.get(p.assetId);
            const status = dcaStatus(p, trades, today, asset !== undefined);
            return (
              <li key={p.id} className="row-item">
                <div>
                  <strong>{asset?.name ?? 'ไม่พบกองทุน/หุ้น'}</strong>
                  <p className="muted small">
                    ซื้อ {formatBaht(satang(p.amount))} ทุกวันที่ {p.dayOfMonth} ของเดือน
                    {p.dayOfMonth > 28 && ' (เดือนที่สั้นกว่าจะใช้วันสุดท้ายของเดือน)'}
                  </p>
                  {status.state === 'due' && (
                    <p role="note">
                      <strong>ถึงกำหนดแล้ว</strong> ของเดือน {thaiMonthKeyLabel(status.cycle)} (กำหนด {thaiDayLabel(status.dueDate)}
                      {status.daysLate > 0 ? ` เลยมา ${status.daysLate} วัน` : ' วันนี้'})
                      {status.pendingCycles > 1 && ` · ค้างซื้อ ${status.pendingCycles} เดือน ระบบเตือนทีละเดือน`}
                    </p>
                  )}
                  {status.state === 'upcoming' && (
                    <p className="muted small">
                      ครั้งถัดไป {thaiDayLabel(status.dueDate)} (อีก {status.daysUntil} วัน)
                    </p>
                  )}
                  {status.state === 'paused' && <p className="muted small">พักแผนอยู่ (ไม่เตือน)</p>}
                  {status.state === 'unknown-asset' && <p className="form-error">ไม่พบกองทุน/หุ้นของแผนนี้ ลบแผนนี้ได้</p>}
                </div>
                <div className="row-actions">
                  {status.state === 'due' && asset && (
                    <button
                      type="button"
                      className="btn btn-primary btn-small"
                      aria-label={`บันทึกซื้อตามแผน ${asset.name}`}
                      onClick={(e) => onBuy(p.assetId, toBahtString(satang(p.amount)), e.currentTarget)}
                    >
                      บันทึกซื้อตามแผน
                    </button>
                  )}
                  {status.state !== 'unknown-asset' && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      disabled={busy}
                      aria-label={`${p.paused === true ? 'เริ่มแผนต่อ' : 'พักแผน (หยุดเตือนชั่วคราว)'} ${asset?.name ?? ''}`}
                      onClick={() => void toggle(p)}
                    >
                      {p.paused === true ? 'เริ่มต่อ' : 'พักแผน'}
                    </button>
                  )}
                  <button
                    type="button"
                    className={confirmDelete === p.id ? 'btn btn-ghost btn-small confirm-delete' : 'btn btn-ghost btn-small'}
                    disabled={busy}
                    aria-label={`${confirmDelete === p.id ? 'กดอีกครั้งเพื่อลบแผน' : 'ลบแผน'} ${asset?.name ?? ''}`}
                    onClick={() => void remove(p)}
                  >
                    {confirmDelete === p.id ? 'กดอีกครั้งเพื่อลบ' : 'ลบแผน'}
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
          เพิ่มแผน
        </button>
      )}
      {activeAssets.length === 0 && settings !== null && <p className="muted small">เพิ่มกองทุนหรือหุ้นก่อน จึงตั้งแผนได้</p>}

      {adding && (
        <form onSubmit={submit} onKeyDown={onFormKey} className="settings-form" noValidate>
          <div className="field-row">
            <div className="field">
              <label htmlFor="dca-asset">กองทุน/หุ้น</label>
              <select
                id="dca-asset"
                value={assetId}
                aria-invalid={formError?.field === 'dca-asset' ? true : undefined}
                aria-describedby={formError?.field === 'dca-asset' ? 'dca-form-err' : undefined}
                onChange={(e) => setAssetId(e.target.value)}
              >
                <option value="">เลือกกองทุน/หุ้น</option>
                {activeAssets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="dca-amount">เงินที่ซื้อต่อรอบ (บาท)</label>
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
              <label htmlFor="dca-day">ซื้อทุกวันที่ (1-31)</label>
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
              ยกเลิก
            </button>
            <button type="submit" className="btn btn-primary btn-small" disabled={busy}>
              บันทึกแผน
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
