import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { investError, investProblem } from './invest/investError';
import { baht, signed } from '../app/bahtFormat';
import { formatDateEn } from '../app/dateEn';
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
import { safeAdd } from '../domain/money/safe';
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

const KIND_LABEL: Record<UsTradeKind, string> = { buy: 'Buy', sell: 'Sell', dividend: 'Dividend' };

/** ค่าที่ยังไม่มีข้อมูล: แสดง "—" ให้ตา และบอกโปรแกรมอ่านหน้าจอเป็นข้อความ */
function Dash() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">No data</span>
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

const errOf = <F extends string>(errors: UsFormError<F>[], field: F): string | undefined => (() => { const f = errors.find((e) => e.field === field); return f ? investProblem(f) : undefined; })();

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
  const [cashName, setCashName] = useState('USD cash');
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
      setLoadError(investError(e));
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
  const fail = (e: unknown) => setMessage({ text: investError(e), kind: 'error' });

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
      await finish('Currency exchange saved');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const submitCash = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (cashName.trim() === '') return setCashError('Enter a name for the USD cash account');
    setCashError('');
    setBusy(true);
    try {
      await repo.addUsdCash({ id: newId('usd-cash'), name: cashName });
      await finish('USD cash account created');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const submitStock = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (stockForm.name.trim() === '' || stockForm.ticker.trim() === '') return setStockError('Enter the stock name and ticker (for example, AAPL)');
    setStockError('');
    setBusy(true);
    try {
      await repo.addUsdStock({ id: newId('usstock'), name: stockForm.name, ticker: stockForm.ticker, exchange: stockForm.exchange });
      setStockForm({ name: '', ticker: '', exchange: stockForm.exchange });
      await finish('Stock added');
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
      await finish(`${KIND_LABEL[tradeForm.kind as UsTradeKind]} saved`);
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
    if (!hasPrice && !hasFx) return setPriceError('Enter a stock price or an exchange rate (at least one)');
    let priceMicro = 0;
    let rateMicro = 0;
    try {
      if (hasPrice) priceMicro = parsePriceMicro(priceForm.price);
    } catch (err) {
      return setPriceError(investError(err, 'Invalid price'));
    }
    if (hasFx) {
      const fx = parseFxRate(priceForm.fxRate);
      if (!fx.ok) return setPriceError(investProblem(fx));
      rateMicro = fx.rateMicro;
    }
    if (priceForm.date > today) return setPriceError('Cannot record a future date');
    if (hasFx && activeCash === '') return setPriceError('You need a USD cash account before you can record an exchange rate');
    setPriceError('');
    setBusy(true);
    try {
      if (hasPrice) await repo.savePrice({ assetId, date: priceForm.date, priceMicro });
      if (hasFx) await repo.saveFxRate({ accountId: activeCash, date: priceForm.date, rateMicro });
      await finish('Price/rate saved');
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
      setMessage({ text: 'Entry deleted', kind: 'ok' });
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
        <h2 className="page-title">US stock portfolio</h2>
        <p className="muted">USD-denominated stocks (fractional shares supported), THB↔USD currency exchange. Prices and exchange rates are entered manually.</p>
      </div>

      <div role="status">{message?.kind === 'ok' && <p className="muted">{message.text}</p>}</div>
      <div role="alert">{message?.kind === 'error' && <p className="form-error">{message.text}</p>}</div>
      {loadError !== '' && (
        <div role="alert">
          <p className="form-error">Could not load US stock data: {loadError}</p>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {view.negativeCash.length > 0 && (
        <div className="notice" role="alert" aria-labelledby="us-neg-title">
          <p id="us-neg-title">
            <strong>USD cash is negative</strong>
          </p>
          {view.negativeCash.map((c) => (
            <p key={c.accountId} className="small">
              {c.name}: {usd(c.cents)} · not enough dollars: record another currency exchange, or review the exchange/buy entries so the balance is not negative (this can happen when you delete an exchange whose dollars were already used to buy stock, or when a purchase exceeds the cash).
            </p>
          ))}
        </div>
      )}

      <section className="glass-lite card" aria-labelledby="us-cash-title">
        <h2 id="us-cash-title">USD cash and exchange rate</h2>
        {cashAccounts.length === 0 ? (
          <p className="muted">No USD cash account yet. Create one first, then exchange baht into dollars to buy stock.</p>
        ) : (
          <dl className="avg-result">
            {cashAccounts.map((c) => (
              <div key={c.accountId}>
                <dt>{c.name}</dt>
                <dd className="num">{usd(c.cents)}</dd>
              </div>
            ))}
            <div>
              <dt>Latest rate entered</dt>
              <dd className="num">{view.fx ? fxRateText(view.fx.rateMicro) : <Dash />}</dd>
            </div>
          </dl>
        )}
        {view.fx?.stale && (
          <p className="muted small" role="status">
            Exchange rate is {view.fx.days} days old (as of {formatDateEn(view.fx.date)}); the THB value may be inaccurate
          </p>
        )}
        <div className="dialog-actions">
          {cashAccounts.length === 0 ? (
            <button type="button" className="btn btn-primary btn-small" onClick={(e) => open({ type: 'cash' }, e.currentTarget)}>
              Create USD cash account
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-small" onClick={(e) => open({ type: 'exchange' }, e.currentTarget)}>
              Exchange currency
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-small" onClick={(e) => open({ type: 'stock' }, e.currentTarget)}>
            Add stock
          </button>
        </div>
      </section>

      {panel?.type === 'cash' && (
        <section className="solid card" aria-labelledby="us-cashnew-title">
          <h2 id="us-cashnew-title" ref={headingRef} tabIndex={-1}>
            Create USD cash account
          </h2>
          <form onSubmit={submitCash} onKeyDown={closeOnEscape} className="settings-form" noValidate>
            <Field id="us-cash-name" text label="Account name" value={cashName} onChange={setCashName} error={cashError} />
            <p className="muted small">This is a USD investment account. It starts at 0 and is not counted as everyday spending money.</p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost btn-small" onClick={close}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-small" disabled={busy}>
                {busy ? 'Saving…' : 'Create account'}
              </button>
            </div>
          </form>
        </section>
      )}

      {panel?.type === 'exchange' && (
        <section className="solid card" aria-labelledby="us-ex-title">
          <h2 id="us-ex-title" ref={headingRef} tabIndex={-1}>
            Exchange currency
          </h2>
          <form onSubmit={submitExchange} onKeyDown={closeOnEscape} className="settings-form" noValidate>
            <div className="field-row">
              <div className="field">
                <label htmlFor="us-ex-dir">Direction</label>
                <select id="us-ex-dir" value={exForm.direction} onChange={(e) => exSet({ direction: e.target.value as FxExchangeForm['direction'] })}>
                  <option value="thb_to_usd">Exchange THB to USD</option>
                  <option value="usd_to_thb">Exchange USD to THB</option>
                </select>
              </div>
              <Field id="us-ex-date" label="Date" type="date" value={exForm.date} onChange={(v) => exSet({ date: v })} error={errOf(exErrors, 'date')} />
            </div>
            <div className="field-row">
              <Field id="us-ex-thb" label="Amount (THB)" value={exForm.thb} onChange={(v) => exSet({ thb: v })} error={errOf(exErrors, 'thb')} placeholder="e.g. 70,000" />
              <Field id="us-ex-usd" label="Amount (USD)" value={exForm.usd} onChange={(v) => exSet({ usd: v })} error={errOf(exErrors, 'usd')} placeholder="e.g. 2,000" />
            </div>
            <p className="muted small" aria-live="polite" aria-atomic="false">
              {exPreview ? `Resulting rate ≈ ${exPreview} (calculated from the two amounts)` : 'Enter the THB and USD amounts and the rate is calculated for you'}
            </p>
            <div className="field-row">
              <div className="field">
                <label htmlFor="us-ex-wallet">THB wallet</label>
                <select id="us-ex-wallet" value={activeWallet} onChange={(e) => setWalletId(e.target.value)}>
                  {wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
                <p className="muted small">Only spending wallets are shown (wallets tagged as investment money cannot be exchanged from this page)</p>
              </div>
              {cashAccounts.length > 1 && (
                <div className="field">
                  <label htmlFor="us-ex-cash">USD cash account</label>
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
            <Field id="us-ex-memo" text label="Note (optional)" value={exForm.memo} onChange={(v) => exSet({ memo: v })} error={errOf(exErrors, 'memo')} />
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost btn-small" onClick={close}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-small" disabled={busy || wallets.length === 0}>
                {busy ? 'Saving…' : 'Save exchange'}
              </button>
            </div>
          </form>
        </section>
      )}

      {panel?.type === 'stock' && (
        <section className="solid card" aria-labelledby="us-stock-title">
          <h2 id="us-stock-title" ref={headingRef} tabIndex={-1}>
            Add US stock
          </h2>
          <form onSubmit={submitStock} onKeyDown={closeOnEscape} className="settings-form" noValidate>
            <div className="field-row">
              <Field id="us-stock-name" text label="Stock name" value={stockForm.name} onChange={(v) => setStockForm((f) => ({ ...f, name: v }))} placeholder="e.g. Apple Inc." />
              <Field id="us-stock-ticker" text label="Ticker" value={stockForm.ticker} onChange={(v) => setStockForm((f) => ({ ...f, ticker: v }))} placeholder="e.g. AAPL" />
              <div className="field">
                <label htmlFor="us-stock-ex">Exchange</label>
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
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-small" disabled={busy}>
                {busy ? 'Saving…' : 'Add stock'}
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
              <Field id="us-t-date" label="Date" type="date" value={form.date} onChange={(v) => setT({ date: v })} error={errOf(tradeErrors, 'date')} />
              <Field id="us-t-fx" label="Exchange rate on that day (THB per 1 USD)" value={form.fxRate} onChange={(v) => setT({ fxRate: v })} error={errOf(tradeErrors, 'fxRate')} placeholder="e.g. 35.25" hint="Used to compute cost basis in THB. Defaults to the latest rate entered; you can edit it." />
            </div>
            {tradeKind === 'buy' && (
              <div className="field-row">
                <Field id="us-t-amount" label="Amount invested (USD)" value={form.amount} onChange={(v) => setT({ amount: v })} error={errOf(tradeErrors, 'amount')} placeholder="e.g. 100" />
                <Field id="us-t-units" label="Shares (fractions allowed)" value={form.units} onChange={(v) => setT({ units: v })} error={errOf(tradeErrors, 'units')} placeholder="e.g. 0.5" hint="Or leave blank and enter the price per share to calculate the number of shares" />
                <Field id="us-t-price" label="Price per share (USD)" value={form.price} onChange={(v) => setT({ price: v })} error={errOf(tradeErrors, 'price')} />
                <Field id="us-t-fee" label="Fee (USD)" value={form.fee} onChange={(v) => setT({ fee: v })} error={errOf(tradeErrors, 'fee')} />
              </div>
            )}
            {tradeKind === 'sell' && (
              <div className="field-row">
                <Field id="us-t-units" label="Shares sold" value={form.units} onChange={(v) => setT({ units: v })} error={errOf(tradeErrors, 'units')} hint={stockRow(panel.assetId) ? `Holding ${formatUnits(stockRow(panel.assetId)!.units)} shares` : undefined} />
                <Field id="us-t-price" label="Sale price per share (USD)" value={form.price} onChange={(v) => setT({ price: v })} error={errOf(tradeErrors, 'price')} />
                <Field id="us-t-fee" label="Fee (USD)" value={form.fee} onChange={(v) => setT({ fee: v })} error={errOf(tradeErrors, 'fee')} />
              </div>
            )}
            {tradeKind === 'dividend' && (
              <div className="field-row">
                <Field id="us-t-amount" label="Dividend before tax (USD)" value={form.amount} onChange={(v) => setT({ amount: v })} error={errOf(tradeErrors, 'amount')} />
                <Field id="us-t-wht" label="Tax withheld (USD)" value={form.withholding} onChange={(v) => setT({ withholding: v })} error={errOf(tradeErrors, 'withholding')} hint="Typically 15% if you have filed Form W-8BEN (certificate of foreign status); it can be 30% if you have not. Edit it to match what the broker actually withheld." />
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
                        setTradeErrors([{ field: 'amount', message: 'Enter a valid dividend amount before applying 15% tax' }]);
                      }
                    }}
                  >
                    Apply 15% withholding
                  </button>
                </div>
              </div>
            )}
            {cashAccounts.length > 1 && (
              <div className="field">
                <label htmlFor="us-t-cash">USD cash account</label>
                <select id="us-t-cash" value={activeCash} onChange={(e) => setCashId(e.target.value)}>
                  {cashAccounts.map((c) => (
                    <option key={c.accountId} value={c.accountId}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <Field id="us-t-memo" text label="Note (optional)" value={form.memo} onChange={(v) => setT({ memo: v })} error={errOf(tradeErrors, 'memo')} />
            {activeCash === '' && <p className="avg-err">Create a USD cash account and exchange some baht first before you can record entries</p>}
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost btn-small" onClick={close}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-small" disabled={busy || activeCash === ''}>
                {busy ? 'Saving…' : `Save ${KIND_LABEL[tradeKind].toLowerCase()}`}
              </button>
            </div>
          </form>
        </section>
      )}

      {panel?.type === 'price' && (
        <section className="solid card" aria-labelledby="us-price-title">
          <h2 id="us-price-title" ref={headingRef} tabIndex={-1}>
            Update price/rate {stockRow(panel.assetId)?.ticker}
          </h2>
          <form onSubmit={(e) => void submitPrice(e, panel.assetId)} onKeyDown={closeOnEscape} className="settings-form" noValidate>
            <div className="field-row">
              <Field id="us-p-date" label="Date" type="date" value={priceForm.date} onChange={(v) => setPriceForm((f) => ({ ...f, date: v }))} />
              <Field id="us-p-price" label="Latest stock price (USD per share)" value={priceForm.price} onChange={(v) => setPriceForm((f) => ({ ...f, price: v }))} />
              <Field id="us-p-fx" label="Latest exchange rate (THB per 1 USD)" value={priceForm.fxRate} onChange={(v) => setPriceForm((f) => ({ ...f, fxRate: v }))} />
            </div>
            <p className="muted small">Enter either or both. Entering the same date again overwrites that day's values (automatic fetching will come in a later phase).</p>
            {priceError && (
              <p className="avg-err" role="alert">
                {priceError}
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost btn-small" onClick={close}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-small" disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="solid card" aria-labelledby="us-list-title">
        <h2 id="us-list-title">Holdings</h2>
        {view.rows.length === 0 ? (
          <p className="muted">No US stocks yet. Start by creating a USD cash account, exchanging some baht, then adding a stock.</p>
        ) : (
          <>
            <div className="migrate-table-wrap" role="region" aria-label="US stocks table, scrollable horizontally" tabIndex={0}>
              <table className="migrate-table tax-stack">
                <caption className="sr-only">US stock holdings: shares, average cost, latest price, value, unrealized gain, and net dividends received</caption>
                <thead>
                  <tr>
                    <th scope="col">Stock</th>
                    <th scope="col" className="num">Shares</th>
                    <th scope="col" className="num">Avg cost/share</th>
                    <th scope="col" className="num">Latest price</th>
                    <th scope="col" className="num">Value</th>
                    <th scope="col" className="num">Unrealized gain (THB)</th>
                    <th scope="col" className="num">Net dividends</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((r) => (
                    <tr key={r.assetId}>
                      <th scope="row">
                        {r.ticker} <span className="muted small">{r.name} · {r.exchange}</span>
                      </th>
                      <td className="num" data-label="Shares">{formatUnits(r.units)}</td>
                      <td className="num" data-label="Avg cost/share">{r.avgCostMicro === null ? <Dash /> : usdPrice(r.avgCostMicro)}</td>
                      <td className="num" data-label="Latest price">
                        {r.price ? usdPrice(r.price.priceMicro) : <Dash />}
                        {r.price?.stale && <span className="muted small"> · {r.price.days} days old</span>}
                      </td>
                      <td className="num" data-label="Value">
                        {r.valueUsd === null ? <Dash /> : usd(r.valueUsd)}
                        {r.valueThb !== null && <span className="muted small"> ≈ {baht(r.valueThb)}</span>}
                      </td>
                      <td className="num" data-label="Unrealized gain (THB)">{r.unrealizedThb === null ? <Dash /> : signed(r.unrealizedThb)}</td>
                      <td className="num" data-label="Net dividends">{usd(r.dividendNetUsd)}</td>
                      <td data-label="Actions">
                        <span className="dialog-actions">
                          <button type="button" className="btn btn-primary btn-small" onClick={(e) => openTrade(r, 'buy', e.currentTarget)} aria-label={`Buy ${r.ticker}`}>Buy</button>
                          <button type="button" className="btn btn-small" onClick={(e) => openTrade(r, 'sell', e.currentTarget)} aria-label={`Sell ${r.ticker}`} disabled={r.units === 0n}>Sell</button>
                          <button type="button" className="btn btn-small" onClick={(e) => openTrade(r, 'dividend', e.currentTarget)} aria-label={`Record dividend ${r.ticker}`}>Dividend</button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-small"
                            onClick={(e) => {
                              setPriceForm({ date: today, price: '', fxRate: '' });
                              setPriceError('');
                              open({ type: 'price', assetId: r.assetId }, e.currentTarget);
                            }}
                            aria-label={`Update price ${r.ticker}`}
                          >
                            Price
                          </button>
                        </span>
                        {r.error && <p className="form-error small">Cannot calculate: {investProblem({ message: r.error, code: r.errorCode, params: r.errorParams })}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {noValue && (
              <p className="muted small" role="status">
                Some stocks have no price or exchange rate, so the total value is incomplete (cost basis is not used as a substitute). Press "Price" to enter them.
              </p>
            )}
            <p className="muted small">Average cost = total cost basis including purchase fees, divided by shares held · Unrealized gain is converted to THB at the latest rate entered · Net dividends = after tax withheld at source</p>
          </>
        )}
      </section>

      {view.dividends.length > 0 && (
        <section className="solid card" aria-labelledby="us-div-title">
          <h2 id="us-div-title">Recent dividends</h2>
          <div className="migrate-table-wrap" role="region" aria-label="Recent dividends table" tabIndex={0}>
            <table className="migrate-table tax-stack">
              <caption className="sr-only">Recent dividends: before tax, tax withheld, and net</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Stock</th>
                  <th scope="col" className="num">Before tax</th>
                  <th scope="col" className="num">Tax withheld</th>
                  <th scope="col" className="num">Net</th>
                </tr>
              </thead>
              <tbody>
                {view.dividends.map((d) => (
                  <tr key={d.id}>
                    <th scope="row">{formatDateEn(d.date)}</th>
                    <td data-label="Stock">{d.ticker}</td>
                    <td className="num" data-label="Before tax">{usd(d.grossUsd)}</td>
                    <td className="num" data-label="Tax withheld">{usd(d.whtUsd)}</td>
                    <td className="num" data-label="Net">{usd(d.netUsd)} <span className="muted small">≈ {baht(d.netThb)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {view.exchanges.length > 0 && (
        <section className="solid card" aria-labelledby="us-exh-title">
          <h2 id="us-exh-title">Currency exchange history</h2>
          <ul className="bill-list">
            {view.exchanges.map((x) => (
              <li key={x.id} className="tx bill-row">
                <div className="tx-main">
                  <strong>{x.direction === 'thb_to_usd' ? 'THB → USD' : 'USD → THB'}</strong>
                  <p className="muted small">
                    {formatDateEn(x.date)} · {baht(x.thbSatang)} ↔ {usd(x.usdCents)} · Rate {fxRateText(x.rateMicro)}
                    {x.memo !== '' ? ` · ${x.memo}` : ''}
                  </p>
                </div>
                <div className="bill-figures">
                  {confirmDelete === `ex-${x.id}` ? (
                    <>
                      <p className="muted small" role="alert">Delete this exchange (the THB and USD amounts in the ledger are reversed). If the dollars were already used to buy stock, USD cash will go negative.</p>
                      <button type="button" className="btn btn-ghost btn-small" autoFocus onClick={() => setConfirmDelete('')}>Keep</button>
                      <button type="button" className="btn btn-small" disabled={busy} onClick={() => void doDelete('exchange', x.id)}>Confirm delete</button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirmDelete(`ex-${x.id}`)} aria-label={`Delete currency exchange on ${formatDateEn(x.date)}`}>
                      Delete
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
          <h2 id="us-hist-title">Recent trades</h2>
          <ul className="bill-list">
            {usdTrades.map(({ t: tr, asset }) => (
              <li key={tr.id} className="tx bill-row">
                <div className="tx-main">
                  <strong>
                    {KIND_LABEL[tr.kind as UsTradeKind] ?? tr.kind} {asset.ticker}
                  </strong>
                  <p className="muted small">
                    {formatDateEn(tr.date)}
                    {tr.units !== undefined ? ` · ${formatUnits(BigInt(tr.units))} shares` : ''}
                    {tr.kind === 'sell' && tr.priceMicro !== undefined ? ` @ ${usdPrice(tr.priceMicro)}` : ''}
                    {tr.amount !== undefined ? ` · ${usd(tr.amount)}` : ''}
                    {tr.fee > 0 ? ` · fee ${usd(tr.fee)}` : ''}
                    {tr.withholding > 0 ? ` · tax withheld ${usd(tr.withholding)}` : ''}
                    {tr.fxRateMicro !== undefined ? ` · ${fxRateText(tr.fxRateMicro)}` : ''}
                  </p>
                </div>
                <div className="bill-figures">
                  {confirmDelete === `tr-${tr.id}` ? (
                    <>
                      <button type="button" className="btn btn-ghost btn-small" autoFocus onClick={() => setConfirmDelete('')}>Keep</button>
                      <button type="button" className="btn btn-small" disabled={busy} onClick={() => void doDelete('trade', tr.id)}>Confirm delete</button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirmDelete(`tr-${tr.id}`)} aria-label={`Delete ${KIND_LABEL[tr.kind as UsTradeKind] ?? tr.kind} ${asset.ticker} on ${formatDateEn(tr.date)}`}>
                      Delete
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
          Allocation by value: {view.allocation.map((s) => `${s.key === 'other' ? 'Other' : (view.rows.find((r) => r.assetId === s.key)?.ticker ?? s.key)} ${formatBps(s.bps)}`).join(' · ')} · Total realized gain {signed(t.realizedGainThb)} (for reference only, not a figure for tax filing)
          · Total net dividends received {usdSigned(view.rows.reduce((n, r) => safeAdd(n, r.dividendNetUsd), 0))}
        </p>
      )}
    </div>
  );
}
