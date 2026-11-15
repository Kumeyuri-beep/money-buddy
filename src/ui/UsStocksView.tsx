import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { friendlyError } from '../app/errorText';
import { baht, signed } from '../app/bahtFormat';
import { thaiDayLabel } from '../app/dates';
import { newId } from '../app/ids';
import { buildFxExchange, buildUsTradeRecord, emptyFxExchangeForm, emptyUsTradeForm, parseFxRate, type FxExchangeForm, type UsFormError, type UsTradeForm, type UsTradeKind } from '../app/usForms';
import { fxRateText, usd, usdPrice, usdSigned } from '../app/usdFormat';
import { buildUsPortfolio, type UsStockRow } from '../app/usPortfolio';
import { formatBps } from '../domain/invest/allocation';
import { suggestWithholding } from '../domain/invest/fx';
import { INSTRUMENT_EXCHANGES, assetCurrency, emptyInvestments, type InvestmentData } from '../domain/invest/types';
import { formatUnits, parsePriceMicro } from '../domain/invest/units';
import type { Account, Entry } from '../domain/ledger/types';
import { formatMicro } from '../domain/money/micro';
import { nextCreatedAt } from '../storage/repository';
import { useRepository } from './RepositoryContext';

interface Props {
  today: string;
  accounts: readonly Account[];
  entries: readonly Entry[];
  /** กระเป๋าเงินสดบาทที่ใช้แลกเงินได้ (ป้ายเงินใช้จ่ายเท่านั้น · กระเป๋าที่ติดป้ายเงินลงทุนถูกซ่อน ดู backlog ใน HANDOFF) */
  wallets: readonly { id: string; name: string }[];
  onLedgerChanged: () => void;
}

type Panel =
  | { type: 'exchange' }
  | { type: 'stock' }
  | { type: 'cash' }
  | { type: 'trade'; assetId: string; kind: UsTradeKind }
  | { type: 'price'; assetId: string }
  | null;

const KIND_LABEL: Record<UsTradeKind, string> = { buy: 'ซื้อ', sell: 'ขาย', dividend: 'ปันผล' };

/** ค่าที่ยังไม่มีข้อมูล: แสดง "—" ให้ตา และบอกโปรแกรมอ่านหน้าจอเป็นข้อความ */
function Dash() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">ยังไม่มีข้อมูล</span>
    </>
  );
}

function Field(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  type?: string;
  placeholder?: string;
  /** ช่องข้อความ (ชื่อ ticker หมายเหตุ) ใช้แป้นพิมพ์ปกติ · ช่องตัวเลขใช้แป้นทศนิยม */
  text?: boolean;
}) {
  const { id, label, value, onChange, error, hint, type, placeholder, text } = props;
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
          {error}
        </p>
      )}
    </div>
  );
}

const errOf = <F extends string>(errors: UsFormError<F>[], field: F): string | undefined => errors.find((e) => e.field === field)?.message;

/** แท็บ "หุ้นสหรัฐ": หุ้นสกุล USD (หุ้นเศษส่วนได้) แลกเงินบาท↔USD ราคา/อัตรากรอกเอง (A3-2 · R20) */
export function UsStocksView({ today, accounts, entries, wallets, onLedgerChanged }: Props) {
  const repo = useRepository();
  const [data, setData] = useState<InvestmentData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [confirmDelete, setConfirmDelete] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const [exForm, setExForm] = useState<FxExchangeForm>(emptyFxExchangeForm(today));
  const [exErrors, setExErrors] = useState<UsFormError<keyof FxExchangeForm>[]>([]);
  const [walletId, setWalletId] = useState('');
  const [cashId, setCashId] = useState('');
  const [stockForm, setStockForm] = useState({ name: '', ticker: '', exchange: 'NASDAQ' });
  const [stockError, setStockError] = useState('');
  const [cashName, setCashName] = useState('เงินสด USD');
  const [cashError, setCashError] = useState('');
  const [tradeForm, setTradeForm] = useState<UsTradeForm>(emptyUsTradeForm('', 'buy', today));
  const [tradeErrors, setTradeErrors] = useState<UsFormError<keyof UsTradeForm>[]>([]);
  const [priceForm, setPriceForm] = useState({ date: today, price: '', fxRate: '' });
  const [priceError, setPriceError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await repo.loadInvestments());
      setLoadError('');
    } catch (e) {
      setLoadError(friendlyError(e));
    }
  }, [repo]);
  useEffect(() => {
    void load();
  }, [load]);

  const view = useMemo(() => buildUsPortfolio(accounts, entries, data ?? emptyInvestments(), today), [accounts, entries, data, today]);
  const usdTrades = useMemo(() => {
    const own = new Map((data?.assets ?? []).filter((a) => assetCurrency(a) === 'USD').map((a) => [a.id, a]));
    return (data?.trades ?? [])
      .filter((t) => own.has(t.assetId) && t.fxRateMicro !== undefined)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 30)
      .map((t) => ({ t, asset: own.get(t.assetId)! }));
  }, [data]);

  const cashAccounts = view.cash;
  const activeCash = cashAccounts.find((c) => c.accountId === cashId)?.accountId ?? cashAccounts[0]?.accountId ?? '';
  const activeWallet = wallets.find((w) => w.id === walletId)?.id ?? wallets[0]?.id ?? '';

  useEffect(() => {
    if (panel) headingRef.current?.focus();
  }, [panel]);

  const open = (next: Panel, opener?: HTMLElement) => {
    openerRef.current = opener ?? null;
    setMessage(null);
    setPanel(next);
  };
  const close = () => {
    setPanel(null);
    const el = openerRef.current;
    if (el && el.isConnected) window.setTimeout(() => el.focus(), 0);
  };
  const closeOnEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !e.defaultPrevented && !(e.target instanceof HTMLSelectElement)) close();
  };
  const finish = async (text: string) => {
    await load();
    onLedgerChanged();
    setMessage({ text, kind: 'ok' });
    close();
  };
  const fail = (e: unknown) => setMessage({ text: friendlyError(e), kind: 'error' });

  const submitExchange = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const r = buildFxExchange(exForm, newId('fx'), nextCreatedAt(), today);
    if (!r.ok) return setExErrors(r.errors);
    setExErrors([]);
    setBusy(true);
    try {
      await repo.recordFxExchange({ exchange: r.exchange, walletId: activeWallet, cashAccountId: activeCash });
      setExForm(emptyFxExchangeForm(today));
      await finish('บันทึกการแลกเงินแล้ว');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const submitCash = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (cashName.trim() === '') return setCashError('กรอกชื่อบัญชีเงินสด USD');
    setCashError('');
    setBusy(true);
    try {
      await repo.addUsdCash({ id: newId('usd-cash'), name: cashName });
      await finish('สร้างบัญชีเงินสด USD แล้ว');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const submitStock = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (stockForm.name.trim() === '' || stockForm.ticker.trim() === '') return setStockError('กรอกชื่อหุ้นและ ticker (เช่น AAPL)');
    setStockError('');
    setBusy(true);
    try {
      await repo.addUsdStock({ id: newId('usstock'), name: stockForm.name, ticker: stockForm.ticker, exchange: stockForm.exchange });
      setStockForm({ name: '', ticker: '', exchange: stockForm.exchange });
      await finish('เพิ่มหุ้นแล้ว');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const openTrade = (row: UsStockRow, kind: UsTradeKind, opener: HTMLElement) => {
    setTradeForm(emptyUsTradeForm(row.assetId, kind, today, view.fx ? formatMicro(view.fx.rateMicro) : ''));
    setTradeErrors([]);
    open({ type: 'trade', assetId: row.assetId, kind }, opener);
  };

  const submitTrade = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const r = buildUsTradeRecord(tradeForm, newId('trade'), nextCreatedAt(), today);
    if (!r.ok) return setTradeErrors(r.errors);
    setTradeErrors([]);
    setBusy(true);
    try {
      await repo.recordTradeFx({ trade: r.trade, cashAccountId: activeCash });
      await finish(`บันทึก${KIND_LABEL[tradeForm.kind as UsTradeKind]}แล้ว`);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const submitPrice = async (e: FormEvent, assetId: string) => {
    e.preventDefault();
    if (busy) return;
    const hasPrice = priceForm.price.trim() !== '';
    const hasFx = priceForm.fxRate.trim() !== '';
    if (!hasPrice && !hasFx) return setPriceError('กรอกราคาหุ้นหรืออัตราแลกเปลี่ยนอย่างน้อยหนึ่งอย่าง');
    let priceMicro = 0;
    let rateMicro = 0;
    try {
      if (hasPrice) priceMicro = parsePriceMicro(priceForm.price);
    } catch (err) {
      return setPriceError(err instanceof Error ? err.message : 'ราคาไม่ถูกต้อง');
    }
    if (hasFx) {
      const fx = parseFxRate(priceForm.fxRate);
      if (!fx.ok) return setPriceError(fx.message);
      rateMicro = fx.rateMicro;
    }
    if (priceForm.date > today) return setPriceError('บันทึกวันที่ในอนาคตไม่ได้');
    if (hasFx && activeCash === '') return setPriceError('ต้องมีบัญชีเงินสด USD ก่อนจึงจะบันทึกอัตราแลกเปลี่ยนได้');
    setPriceError('');
    setBusy(true);
    try {
      if (hasPrice) await repo.savePrice({ assetId, date: priceForm.date, priceMicro });
      if (hasFx) await repo.saveFxRate({ accountId: activeCash, date: priceForm.date, rateMicro });
      await finish('บันทึกราคา/อัตราแล้ว');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (kind: 'trade' | 'exchange', id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      if (kind === 'trade') await repo.deleteTrade(id);
      else await repo.deleteFxExchange(id);
      setConfirmDelete('');
      await load();
      onLedgerChanged();
      setMessage({ text: 'ลบรายการแล้ว', kind: 'ok' });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const t = view.totals;
  const noValue = view.rows.some((r) => r.units > 0n && r.valueThb === null);
  const stockRow = (id: string): UsStockRow | undefined => view.rows.find((r) => r.assetId === id);
  const tradeKind = panel?.type === 'trade' ? (tradeForm.kind as UsTradeKind) : 'buy';
  const form = tradeForm;
  const setT = (patch: Partial<UsTradeForm>) => setTradeForm((f) => ({ ...f, ...patch }));
  const exSet = (patch: Partial<FxExchangeForm>) => setExForm((f) => ({ ...f, ...patch }));
  const exPreview = (() => {
    const r = buildFxExchange(exForm, 'preview', 'preview', today);
    return r.ok ? fxRateText(r.rateMicro) : null;
  })();

  return (
    <div className="us-stocks">
      <div className="page-header">
        <h2 className="page-title">พอร์ตหุ้นสหรัฐ</h2>
        <p className="muted">หุ้นสกุลดอลลาร์ (ซื้อเป็นหุ้นเศษส่วนได้) แลกเงินบาท↔ดอลลาร์ ราคาและอัตราแลกเปลี่ยนกรอกเอง</p>
      </div>

      <div role="status">{message?.kind === 'ok' && <p className="muted">{message.text}</p>}</div>
      <div role="alert">{message?.kind === 'error' && <p className="form-error">{message.text}</p>}</div>
      {loadError !== '' && (
        <div role="alert">
          <p className="form-error">โหลดข้อมูลหุ้นสหรัฐไม่สำเร็จ: {loadError}</p>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => void load()}>
            ลองโหลดใหม่
          </button>
        </div>
      )}

      {view.negativeCash.length > 0 && (
        <div className="notice" role="alert" aria-labelledby="us-neg-title">
          <p id="us-neg-title">
            <strong>เงินสด USD ติดลบ</strong>
          </p>
          {view.negativeCash.map((c) => (
            <p key={c.accountId} className="small">
              {c.name}: {usd(c.cents)} · ดอลลาร์ไม่พอ: บันทึกแลกเงินเพิ่ม หรือตรวจรายการแลกเงิน/ซื้อ แล้วแก้ให้ยอดไม่ติดลบ (เกิดได้เมื่อลบรายการแลกเงินที่ดอลลาร์ถูกใช้ซื้อหุ้นไปแล้ว หรือซื้อเกินเงินสด)
            </p>
          ))}
        </div>
      )}

      <section className="glass-lite card" aria-labelledby="us-cash-title">
        <h2 id="us-cash-title">เงินสด USD และอัตราแลกเปลี่ยน</h2>
        {cashAccounts.length === 0 ? (
          <p className="muted">ยังไม่มีบัญชีเงินสด USD สร้างก่อน แล้วแลกเงินบาทเป็นดอลลาร์เพื่อซื้อหุ้น</p>
        ) : (
          <dl className="avg-result">
            {cashAccounts.map((c) => (
              <div key={c.accountId}>
                <dt>{c.name}</dt>
                <dd className="num">{usd(c.cents)}</dd>
              </div>
            ))}
            <div>
              <dt>อัตราล่าสุดที่กรอก</dt>
              <dd className="num">{view.fx ? fxRateText(view.fx.rateMicro) : <Dash />}</dd>
            </div>
          </dl>
        )}
        {view.fx?.stale && (
          <p className="muted small" role="status">
            อัตราแลกเปลี่ยนเก่า {view.fx.days} วัน (วันที่ {thaiDayLabel(view.fx.date)}) มูลค่าเป็นบาทอาจคลาดเคลื่อน
          </p>
        )}
        <div className="dialog-actions">
          {cashAccounts.length === 0 ? (
            <button type="button" className="btn btn-primary btn-small" onClick={(e) => open({ type: 'cash' }, e.currentTarget)}>
              สร้างบัญชีเงินสด USD
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-small" onClick={(e) => open({ type: 'exchange' }, e.currentTarget)}>
              แลกเงิน
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-small" onClick={(e) => open({ type: 'stock' }, e.currentTarget)}>
            เพิ่มหุ้น
          </button>
        </div>
      </section>

      {panel?.type === 'cash' && (
        <section className="solid card" aria-labelledby="us-cashnew-title">
          <h2 id="us-cashnew-title" ref={headingRef} tabIndex={-1}>
            สร้างบัญชีเงินสด USD
          </h2>
          <form onSubmit={submitCash} onKeyDown={closeOnEscape} className="settings-form" noValidate>
            <Field id="us-cash-name" text label="ชื่อบัญชี" value={cashName} onChange={setCashName} error={cashError} />
            <p className="muted small">บัญชีนี้เป็นบัญชีเงินลงทุนสกุลดอลลาร์ ยอดเริ่มต้น 0 ไม่นับเป็นเงินใช้จ่ายรายวัน</p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost btn-small" onClick={close}>
                ยกเลิก
              </button>
              <button type="submit" className="btn btn-primary btn-small" disabled={busy}>
                {busy ? 'กำลังบันทึก…' : 'สร้างบัญชี'}
              </button>
            </div>
          </form>
        </section>
      )}

      {panel?.type === 'exchange' && (
        <section className="solid card" aria-labelledby="us-ex-title">
          <h2 id="us-ex-title" ref={headingRef} tabIndex={-1}>
            แลกเงิน
          </h2>
          <form onSubmit={submitExchange} onKeyDown={closeOnEscape} className="settings-form" noValidate>
            <div className="field-row">
              <div className="field">
                <label htmlFor="us-ex-dir">ทิศทาง</label>
                <select id="us-ex-dir" value={exForm.direction} onChange={(e) => exSet({ direction: e.target.value as FxExchangeForm['direction'] })}>
                  <option value="thb_to_usd">แลกบาทเป็นดอลลาร์</option>
                  <option value="usd_to_thb">แลกดอลลาร์เป็นบาท</option>
                </select>
              </div>
              <Field id="us-ex-date" label="วันที่" type="date" value={exForm.date} onChange={(v) => exSet({ date: v })} error={errOf(exErrors, 'date')} />
            </div>
            <div className="field-row">
              <Field id="us-ex-thb" label="จำนวนเงินบาท" value={exForm.thb} onChange={(v) => exSet({ thb: v })} error={errOf(exErrors, 'thb')} placeholder="เช่น 70,000" />
              <Field id="us-ex-usd" label="จำนวนดอลลาร์" value={exForm.usd} onChange={(v) => exSet({ usd: v })} error={errOf(exErrors, 'usd')} placeholder="เช่น 2,000" />
            </div>
            <p className="muted small" aria-live="polite" aria-atomic="false">
              {exPreview ? `อัตราที่ได้ ≈ ${exPreview} (คำนวณจากสองจำนวน)` : 'กรอกจำนวนเงินบาทและดอลลาร์ ระบบคำนวณอัตราให้'}
            </p>
            <div className="field-row">
              <div className="field">
                <label htmlFor="us-ex-wallet">กระเป๋าเงินบาท</label>
                <select id="us-ex-wallet" value={activeWallet} onChange={(e) => setWalletId(e.target.value)}>
                  {wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
                <p className="muted small">แสดงเฉพาะกระเป๋าเงินใช้จ่าย (กระเป๋าที่ติดป้ายเงินลงทุนยังแลกจากหน้านี้ไม่ได้)</p>
              </div>
              {cashAccounts.length > 1 && (
                <div className="field">
                  <label htmlFor="us-ex-cash">บัญชีเงินสด USD</label>
                  <select id="us-ex-cash" value={activeCash} onChange={(e) => setCashId(e.target.value)}>
                    {cashAccounts.map((c) => (
                      <option key={c.accountId} value={c.accountId}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <Field id="us-ex-memo" text label="หมายเหตุ (ไม่บังคับ)" value={exForm.memo} onChange={(v) => exSet({ memo: v })} error={errOf(exErrors, 'memo')} />
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost btn-small" onClick={close}>
                ยกเลิก
              </button>
              <button type="submit" className="btn btn-primary btn-small" disabled={busy || wallets.length === 0}>
                {busy ? 'กำลังบันทึก…' : 'บันทึกการแลกเงิน'}
              </button>
            </div>
          </form>
        </section>
      )}

      {panel?.type === 'stock' && (
        <section className="solid card" aria-labelledby="us-stock-title">
          <h2 id="us-stock-title" ref={headingRef} tabIndex={-1}>
            เพิ่มหุ้นสหรัฐ
          </h2>
          <form onSubmit={submitStock} onKeyDown={closeOnEscape} className="settings-form" noValidate>
            <div className="field-row">
              <Field id="us-stock-name" text label="ชื่อหุ้น" value={stockForm.name} onChange={(v) => setStockForm((f) => ({ ...f, name: v }))} placeholder="เช่น Apple Inc." />
              <Field id="us-stock-ticker" text label="ชื่อย่อหุ้น (Ticker)" value={stockForm.ticker} onChange={(v) => setStockForm((f) => ({ ...f, ticker: v }))} placeholder="เช่น AAPL" />
              <div className="field">
                <label htmlFor="us-stock-ex">ตลาด</label>
                <select id="us-stock-ex" value={stockForm.exchange} onChange={(e) => setStockForm((f) => ({ ...f, exchange: e.target.value }))}>
                  {INSTRUMENT_EXCHANGES.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {stockError && <p className="avg-err">{stockError}</p>}
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost btn-small" onClick={close}>
                ยกเลิก
              </button>
              <button type="submit" className="btn btn-primary btn-small" disabled={busy}>
                {busy ? 'กำลังบันทึก…' : 'เพิ่มหุ้น'}
              </button>
            </div>
          </form>
        </section>
      )}

      {panel?.type === 'trade' && (
        <section className="solid card" aria-labelledby="us-trade-title">
          <h2 id="us-trade-title" ref={headingRef} tabIndex={-1}>
            {KIND_LABEL[tradeKind]} {stockRow(panel.assetId)?.ticker}
          </h2>
          <form onSubmit={submitTrade} onKeyDown={closeOnEscape} className="settings-form" noValidate>
            <div className="field-row">
              <Field id="us-t-date" label="วันที่" type="date" value={form.date} onChange={(v) => setT({ date: v })} error={errOf(tradeErrors, 'date')} />
              <Field id="us-t-fx" label="อัตราแลกเปลี่ยนวันนั้น (บาทต่อ 1 ดอลลาร์)" value={form.fxRate} onChange={(v) => setT({ fxRate: v })} error={errOf(tradeErrors, 'fxRate')} placeholder="เช่น 35.25" hint="ใช้คำนวณต้นทุนเป็นบาท ค่าตั้งต้นคืออัตราล่าสุดที่กรอก แก้ได้" />
            </div>
            {tradeKind === 'buy' && (
              <div className="field-row">
                <Field id="us-t-amount" label="เงินที่ซื้อ (ดอลลาร์)" value={form.amount} onChange={(v) => setT({ amount: v })} error={errOf(tradeErrors, 'amount')} placeholder="เช่น 100" />
                <Field id="us-t-units" label="จำนวนหุ้น (เศษส่วนได้)" value={form.units} onChange={(v) => setT({ units: v })} error={errOf(tradeErrors, 'units')} placeholder="เช่น 0.5" hint="หรือเว้นว่างแล้วกรอกราคาต่อหุ้นให้ระบบคำนวณจำนวนหุ้น" />
                <Field id="us-t-price" label="ราคาต่อหุ้น (ดอลลาร์)" value={form.price} onChange={(v) => setT({ price: v })} error={errOf(tradeErrors, 'price')} />
                <Field id="us-t-fee" label="ค่าธรรมเนียม (ดอลลาร์)" value={form.fee} onChange={(v) => setT({ fee: v })} error={errOf(tradeErrors, 'fee')} />
              </div>
            )}
            {tradeKind === 'sell' && (
              <div className="field-row">
                <Field id="us-t-units" label="จำนวนหุ้นที่ขาย" value={form.units} onChange={(v) => setT({ units: v })} error={errOf(tradeErrors, 'units')} hint={stockRow(panel.assetId) ? `ถืออยู่ ${formatUnits(stockRow(panel.assetId)!.units)} หุ้น` : undefined} />
                <Field id="us-t-price" label="ราคาที่ขายต่อหุ้น (ดอลลาร์)" value={form.price} onChange={(v) => setT({ price: v })} error={errOf(tradeErrors, 'price')} />
                <Field id="us-t-fee" label="ค่าธรรมเนียม (ดอลลาร์)" value={form.fee} onChange={(v) => setT({ fee: v })} error={errOf(tradeErrors, 'fee')} />
              </div>
            )}
            {tradeKind === 'dividend' && (
              <div className="field-row">
                <Field id="us-t-amount" label="ยอดปันผลก่อนภาษี (ดอลลาร์)" value={form.amount} onChange={(v) => setT({ amount: v })} error={errOf(tradeErrors, 'amount')} />
                <Field id="us-t-wht" label="ภาษีที่ถูกหัก ณ ที่จ่าย (ดอลลาร์)" value={form.withholding} onChange={(v) => setT({ withholding: v })} error={errOf(tradeErrors, 'withholding')} hint="แนะนำ 15% ถ้ายื่นแบบ W-8BEN (แบบแจ้งสถานะผู้ไม่ใช่คนสหรัฐ) แล้ว ไม่ยื่นอาจ 30% · แก้ตามที่โบรกเกอร์หักจริง" />
                <div className="field">
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    onClick={() => {
                      const r = buildUsTradeRecord({ ...form, withholding: '' }, 'x', 'x', today);
                      const amt = r.ok ? r.trade.amount : undefined;
                      const cents = amt ?? Number.NaN;
                      if (Number.isSafeInteger(cents) && cents > 0) {
                        const w = suggestWithholding(cents);
                        setT({ withholding: `${Math.floor(w / 100)}.${String(w % 100).padStart(2, '0')}` });
                      } else {
                        setTradeErrors([{ field: 'amount', message: 'กรอกยอดปันผลให้ถูกต้องก่อนใส่ภาษี 15%' }]);
                      }
                    }}
                  >
                    ใส่ภาษีหัก 15%
                  </button>
                </div>
              </div>
            )}
            {cashAccounts.length > 1 && (
              <div className="field">
                <label htmlFor="us-t-cash">บัญชีเงินสด USD</label>
                <select id="us-t-cash" value={activeCash} onChange={(e) => setCashId(e.target.value)}>
                  {cashAccounts.map((c) => (
                    <option key={c.accountId} value={c.accountId}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <Field id="us-t-memo" text label="หมายเหตุ (ไม่บังคับ)" value={form.memo} onChange={(v) => setT({ memo: v })} error={errOf(tradeErrors, 'memo')} />
            {activeCash === '' && <p className="avg-err">ต้องสร้างบัญชีเงินสด USD และแลกเงินก่อนจึงจะบันทึกรายการได้</p>}
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost btn-small" onClick={close}>
                ยกเลิก
              </button>
              <button type="submit" className="btn btn-primary btn-small" disabled={busy || activeCash === ''}>
                {busy ? 'กำลังบันทึก…' : `บันทึก${KIND_LABEL[tradeKind]}`}
              </button>
            </div>
          </form>
        </section>
      )}

      {panel?.type === 'price' && (
        <section className="solid card" aria-labelledby="us-price-title">
          <h2 id="us-price-title" ref={headingRef} tabIndex={-1}>
            อัปเดตราคา/อัตรา {stockRow(panel.assetId)?.ticker}
          </h2>
          <form onSubmit={(e) => void submitPrice(e, panel.assetId)} onKeyDown={closeOnEscape} className="settings-form" noValidate>
            <div className="field-row">
              <Field id="us-p-date" label="วันที่" type="date" value={priceForm.date} onChange={(v) => setPriceForm((f) => ({ ...f, date: v }))} />
              <Field id="us-p-price" label="ราคาหุ้นล่าสุด (ดอลลาร์ต่อหุ้น)" value={priceForm.price} onChange={(v) => setPriceForm((f) => ({ ...f, price: v }))} />
              <Field id="us-p-fx" label="อัตราแลกเปลี่ยนล่าสุด (บาทต่อ 1 ดอลลาร์)" value={priceForm.fxRate} onChange={(v) => setPriceForm((f) => ({ ...f, fxRate: v }))} />
            </div>
            <p className="muted small">กรอกอย่างใดอย่างหนึ่งหรือทั้งสอง กรอกซ้ำวันเดิมจะแก้ค่าของวันนั้น (ดึงอัตโนมัติจะมาในเฟสถัดไป)</p>
            {priceError && (
              <p className="avg-err" role="alert">
                {priceError}
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost btn-small" onClick={close}>
                ยกเลิก
              </button>
              <button type="submit" className="btn btn-primary btn-small" disabled={busy}>
                {busy ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="solid card" aria-labelledby="us-list-title">
        <h2 id="us-list-title">หุ้นที่ถืออยู่</h2>
        {view.rows.length === 0 ? (
          <p className="muted">ยังไม่มีหุ้นสหรัฐ เริ่มจากสร้างบัญชีเงินสด USD แลกเงิน แล้วเพิ่มหุ้น</p>
        ) : (
          <>
            <div className="migrate-table-wrap" role="region" aria-label="ตารางหุ้นสหรัฐ เลื่อนซ้ายขวาได้" tabIndex={0}>
              <table className="migrate-table tax-stack">
                <caption className="sr-only">หุ้นสหรัฐที่ถืออยู่ จำนวน ต้นทุนเฉลี่ย ราคาล่าสุด มูลค่า กำไรยังไม่ขาย และปันผลสะสมสุทธิ</caption>
                <thead>
                  <tr>
                    <th scope="col">หุ้น</th>
                    <th scope="col" className="num">จำนวนหุ้น</th>
                    <th scope="col" className="num">ต้นทุนเฉลี่ย/หุ้น</th>
                    <th scope="col" className="num">ราคาล่าสุด</th>
                    <th scope="col" className="num">มูลค่า</th>
                    <th scope="col" className="num">กำไรยังไม่ขาย (บาท)</th>
                    <th scope="col" className="num">ปันผลสะสมสุทธิ</th>
                    <th scope="col">ทำรายการ</th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((r) => (
                    <tr key={r.assetId}>
                      <th scope="row">
                        {r.ticker} <span className="muted small">{r.name} · {r.exchange}</span>
                      </th>
                      <td className="num" data-label="จำนวนหุ้น">{formatUnits(r.units)}</td>
                      <td className="num" data-label="ต้นทุนเฉลี่ย/หุ้น">{r.avgCostMicro === null ? <Dash /> : usdPrice(r.avgCostMicro)}</td>
                      <td className="num" data-label="ราคาล่าสุด">
                        {r.price ? usdPrice(r.price.priceMicro) : <Dash />}
                        {r.price?.stale && <span className="muted small"> · เก่า {r.price.days} วัน</span>}
                      </td>
                      <td className="num" data-label="มูลค่า">
                        {r.valueUsd === null ? <Dash /> : usd(r.valueUsd)}
                        {r.valueThb !== null && <span className="muted small"> ≈ {baht(r.valueThb)}</span>}
                      </td>
                      <td className="num" data-label="กำไรยังไม่ขาย (บาท)">{r.unrealizedThb === null ? <Dash /> : signed(r.unrealizedThb)}</td>
                      <td className="num" data-label="ปันผลสะสมสุทธิ">{usd(r.dividendNetUsd)}</td>
                      <td data-label="ทำรายการ">
                        <span className="dialog-actions">
                          <button type="button" className="btn btn-primary btn-small" onClick={(e) => openTrade(r, 'buy', e.currentTarget)} aria-label={`ซื้อ ${r.ticker}`}>ซื้อ</button>
                          <button type="button" className="btn btn-small" onClick={(e) => openTrade(r, 'sell', e.currentTarget)} aria-label={`ขาย ${r.ticker}`} disabled={r.units === 0n}>ขาย</button>
                          <button type="button" className="btn btn-small" onClick={(e) => openTrade(r, 'dividend', e.currentTarget)} aria-label={`บันทึกปันผล ${r.ticker}`}>ปันผล</button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-small"
                            onClick={(e) => {
                              setPriceForm({ date: today, price: '', fxRate: '' });
                              setPriceError('');
                              open({ type: 'price', assetId: r.assetId }, e.currentTarget);
                            }}
                            aria-label={`อัปเดตราคา ${r.ticker}`}
                          >
                            ราคา
                          </button>
                        </span>
                        {r.error && <p className="form-error small">คำนวณไม่ได้: {r.error}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {noValue && (
              <p className="muted small" role="status">
                มีหุ้นที่ยังไม่มีราคาหรืออัตราแลกเปลี่ยน มูลค่ารวมจึงไม่ครบ (ระบบไม่ใช้ต้นทุนแทน) กด "ราคา" เพื่อกรอก
              </p>
            )}
            <p className="muted small">ต้นทุนเฉลี่ย = ต้นทุนรวมรวมค่าธรรมเนียมซื้อ หารจำนวนหุ้นที่ถือ · กำไรยังไม่ขายแปลงเป็นบาทที่อัตราล่าสุดที่กรอก · ปันผลสะสมสุทธิ = หลังหักภาษี ณ ที่จ่าย</p>
          </>
        )}
      </section>

      {view.dividends.length > 0 && (
        <section className="solid card" aria-labelledby="us-div-title">
          <h2 id="us-div-title">ปันผลล่าสุด</h2>
          <div className="migrate-table-wrap" role="region" aria-label="ตารางปันผลล่าสุด" tabIndex={0}>
            <table className="migrate-table tax-stack">
              <caption className="sr-only">ปันผลล่าสุด ก่อนภาษี ภาษีที่ถูกหัก และสุทธิ</caption>
              <thead>
                <tr>
                  <th scope="col">วันที่</th>
                  <th scope="col">หุ้น</th>
                  <th scope="col" className="num">ก่อนภาษี</th>
                  <th scope="col" className="num">ภาษีที่ถูกหัก</th>
                  <th scope="col" className="num">สุทธิ</th>
                </tr>
              </thead>
              <tbody>
                {view.dividends.map((d) => (
                  <tr key={d.id}>
                    <th scope="row">{thaiDayLabel(d.date)}</th>
                    <td data-label="หุ้น">{d.ticker}</td>
                    <td className="num" data-label="ก่อนภาษี">{usd(d.grossUsd)}</td>
                    <td className="num" data-label="ภาษีที่ถูกหัก">{usd(d.whtUsd)}</td>
                    <td className="num" data-label="สุทธิ">{usd(d.netUsd)} <span className="muted small">≈ {baht(d.netThb)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {view.exchanges.length > 0 && (
        <section className="solid card" aria-labelledby="us-exh-title">
          <h2 id="us-exh-title">ประวัติแลกเงิน</h2>
          <ul className="bill-list">
            {view.exchanges.map((x) => (
              <li key={x.id} className="tx bill-row">
                <div className="tx-main">
                  <strong>{x.direction === 'thb_to_usd' ? 'บาท → ดอลลาร์' : 'ดอลลาร์ → บาท'}</strong>
                  <p className="muted small">
                    {thaiDayLabel(x.date)} · {baht(x.thbSatang)} ↔ {usd(x.usdCents)} · อัตรา {fxRateText(x.rateMicro)}
                    {x.memo !== '' ? ` · ${x.memo}` : ''}
                  </p>
                </div>
                <div className="bill-figures">
                  {confirmDelete === `ex-${x.id}` ? (
                    <>
                      <p className="muted small" role="alert">ลบรายการแลกเงินนี้ (ยอดบาทและดอลลาร์ในสมุดคืนตาม) ถ้าดอลลาร์ถูกใช้ซื้อหุ้นไปแล้ว เงินสด USD จะติดลบ</p>
                      <button type="button" className="btn btn-ghost btn-small" autoFocus onClick={() => setConfirmDelete('')}>ไม่ลบ</button>
                      <button type="button" className="btn btn-small" disabled={busy} onClick={() => void doDelete('exchange', x.id)}>ยืนยันลบ</button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirmDelete(`ex-${x.id}`)} aria-label={`ลบการแลกเงินวันที่ ${thaiDayLabel(x.date)}`}>
                      ลบ
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {usdTrades.length > 0 && (
        <section className="solid card" aria-labelledby="us-hist-title">
          <h2 id="us-hist-title">รายการซื้อขายล่าสุด</h2>
          <ul className="bill-list">
            {usdTrades.map(({ t: tr, asset }) => (
              <li key={tr.id} className="tx bill-row">
                <div className="tx-main">
                  <strong>
                    {KIND_LABEL[tr.kind as UsTradeKind] ?? tr.kind} {asset.ticker}
                  </strong>
                  <p className="muted small">
                    {thaiDayLabel(tr.date)}
                    {tr.units !== undefined ? ` · ${formatUnits(BigInt(tr.units))} หุ้น` : ''}
                    {tr.kind === 'sell' && tr.priceMicro !== undefined ? ` @ ${usdPrice(tr.priceMicro)}` : ''}
                    {tr.amount !== undefined ? ` · ${usd(tr.amount)}` : ''}
                    {tr.fee > 0 ? ` · ค่าธรรมเนียม ${usd(tr.fee)}` : ''}
                    {tr.withholding > 0 ? ` · ภาษีหัก ${usd(tr.withholding)}` : ''}
                    {tr.fxRateMicro !== undefined ? ` · ${fxRateText(tr.fxRateMicro)}` : ''}
                  </p>
                </div>
                <div className="bill-figures">
                  {confirmDelete === `tr-${tr.id}` ? (
                    <>
                      <button type="button" className="btn btn-ghost btn-small" autoFocus onClick={() => setConfirmDelete('')}>ไม่ลบ</button>
                      <button type="button" className="btn btn-small" disabled={busy} onClick={() => void doDelete('trade', tr.id)}>ยืนยันลบ</button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirmDelete(`tr-${tr.id}`)} aria-label={`ลบรายการ ${KIND_LABEL[tr.kind as UsTradeKind] ?? tr.kind} ${asset.ticker} วันที่ ${thaiDayLabel(tr.date)}`}>
                      ลบ
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.rows.length > 0 && t.valueThb > 0 && (
        <p className="muted small" role="note">
          สัดส่วนตามมูลค่า: {view.allocation.map((s) => `${s.key === 'other' ? 'อื่นๆ' : (view.rows.find((r) => r.assetId === s.key)?.ticker ?? s.key)} ${formatBps(s.bps)}`).join(' · ')} · กำไรรวมที่ขายแล้ว {signed(t.realizedGainThb)} (ตัวเลขช่วยดู ไม่ใช่ตัวเลขสำหรับยื่นภาษี)
          · ปันผลสะสมสุทธิรวม {usdSigned(view.rows.reduce((n, r) => n + r.dividendNetUsd, 0))}
        </p>
      )}
    </div>
  );
}
