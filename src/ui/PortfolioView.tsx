import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { newId } from '../app/ids';
import { buildPortfolio, type AssetRowView } from '../app/portfolio';
import { tradeNeedsWallet } from '../domain/invest/ledgerLink';
import { buildTradeRecord, emptyTradeForm, type TradeField, type TradeForm, type TradeFormError } from '../app/tradeForm';
import { emptyInvestments, type AssetKind, type InvestmentData, type TradeKind, type TradeRecord } from '../domain/invest/types';
import { formatUnits, parsePriceMicro } from '../domain/invest/units';
import { isSupportedEntryDate } from '../domain/ledger/limits';
import { formatMicro } from '../domain/money/micro';
import { StorageError, nextCreatedAt } from '../storage/repository';
import { friendlyError } from '../app/errorText';
import { baht, signed } from '../app/bahtFormat';
import { AssetFigures, ASSET_KIND_LABEL_EN } from './AssetFigures';
import { nextFocusAfterDelete } from '../app/tradeFocus';
import { TermHelp } from './TermHelp';
import { KIND_GLOSSARY, KIND_LABEL, TradeItem, tradeButtonId } from './TradeItem';
import { DcaPlansCard } from './DcaPlansCard';
import { ShareCardPanel } from './ShareCardPanel';
import { useRepository } from './RepositoryContext';

interface Props {
  today: string;
  /** กระเป๋าเงินสดบาทที่เลือกจ่าย/รับเงินได้ */
  wallets: readonly { id: string; name: string }[];
  /** แจ้งเมื่อสร้างสินทรัพย์ (เพิ่มบัญชีลงทุนในสมุด) ให้แอปโหลดสมุดใหม่ */
  onLedgerChanged: () => void;
}


const TRADE_FIELD_ID: Record<TradeField, string> = {
  assetId: 'pf-kind',
  kind: 'pf-kind',
  date: 'pf-date',
  units: 'pf-units',
  price: 'pf-price',
  amount: 'pf-amount',
  fee: 'pf-fee',
  withholding: 'pf-wht',
  memo: 'pf-memo',
};

/** ค่าที่ยังไม่มีข้อมูล: แสดง "—" ให้ตา และบอกโปรแกรมอ่านหน้าจอเป็นข้อความ */
function Dash() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">No data yet</span>
    </>
  );
}

type Panel = { type: 'trade'; assetId: string } | { type: 'price'; assetId: string } | null;

function FieldInput(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  errors: TradeFormError[];
  field?: TradeField;
  placeholder?: string;
  hint?: string;
  type?: string;
  /** ส่วนช่วยอธิบายใต้ช่อง (เช่น ปุ่ม "Meaning" ของศัพท์) */
  help?: ReactNode;
}) {
  const { id, label, value, onChange, errors, field, placeholder, hint, type, help } = props;
  const error = field ? errors.find((e) => e.field === field) : undefined;
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type ?? 'text'}
        inputMode={type === 'date' ? undefined : 'decimal'}
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
        <p id={`${id}-err`} className="avg-err">
          {error.message}
        </p>
      )}
      {help}
    </div>
  );
}

/** หน้า "พอร์ตการลงทุน": สินทรัพย์ รายการซื้อขายปันผล (ผูกสมุดบัญชีคู่ P4) ราคาที่กรอกเอง */
export function PortfolioView({ today, wallets, onLedgerChanged }: Props) {
  const repo = useRepository();
  const [data, setData] = useState<InvestmentData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [assetName, setAssetName] = useState('');
  const [assetKind, setAssetKind] = useState<AssetKind>('fund');
  const [tradeForm, setTradeForm] = useState<TradeForm>(emptyTradeForm('', 'buy', today));
  const [walletId, setWalletId] = useState('');
  const [walletError, setWalletError] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const shareBtnRef = useRef<HTMLButtonElement>(null);
  const [newWalletName, setNewWalletName] = useState('');
  const [newWalletError, setNewWalletError] = useState('');
  const [tradeErrors, setTradeErrors] = useState<TradeFormError[]>([]);
  const [priceForm, setPriceForm] = useState({ date: today, price: '' });
  const [priceError, setPriceError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState('');
  const [assetError, setAssetError] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const messageRef = useRef<HTMLDivElement>(null);

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

  // เปิดฟอร์ม: ย้ายโฟกัสและเลื่อนมาที่หัวข้อฟอร์ม · ปิดฟอร์ม: คืนโฟกัสให้ปุ่มที่เปิด
  useEffect(() => {
    if (panel) {
      headingRef.current?.focus();
      headingRef.current?.scrollIntoView?.({ block: 'nearest' });
    } else if (openerRef.current) {
      openerRef.current.focus();
      openerRef.current = null;
    }
  }, [panel]);

  // ข้อความผลลัพธ์อยู่บนสุดของหน้า: เลื่อนให้เห็นเมื่อมีข้อความใหม่
  useEffect(() => {
    if (message) messageRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [message]);

  // ปุ่มลบสองขั้น: หมดอายุเองใน 5 วินาที (กันกดค้างแล้วกลับมาลบทันที)
  useEffect(() => {
    if (confirmDelete === '') return;
    const timer = window.setTimeout(() => setConfirmDelete(''), 5000);
    return () => window.clearTimeout(timer);
  }, [confirmDelete]);

  const portfolio = useMemo(() => buildPortfolio(data ?? emptyInvestments(), today), [data, today]);

  const act = async (work: () => Promise<void>, okText: string): Promise<boolean> => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
      await load();
      setMessage({ text: okText, kind: 'ok' });
      return true;
    } catch (e) {
      setMessage({ text: e instanceof StorageError ? e.message : friendlyError(e), kind: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addAsset = async (e: FormEvent) => {
    e.preventDefault();
    const name = assetName.trim();
    if (name === '') {
      setAssetError('Enter a fund or stock name');
      document.getElementById('pf-asset-name')?.focus();
      return;
    }
    setAssetError('');
    const ok = await act(async () => {
      await repo.addAsset({ id: newId('asset'), name, kind: assetKind });
      onLedgerChanged();
    }, `Added "${name}"`);
    if (ok) setAssetName('');
  };

  const openTrade = (assetId: string, kind: TradeKind = 'buy', opener?: HTMLElement) => {
    openerRef.current = opener ?? null;
    setTradeForm(emptyTradeForm(assetId, kind, today));
    setTradeErrors([]);
    setWalletError('');
    // ไม่เลือกกระเป๋าให้เองเมื่อมีหลายใบ (เรื่องเงิน: ให้ผู้ใช้เลือกเอง) · มีใบเดียวเลือกให้
    setWalletId((cur) => (wallets.some((w) => w.id === cur) ? cur : wallets.length === 1 ? wallets[0]!.id : ''));
    setPanel({ type: 'trade', assetId });
    setMessage(null);
  };
  const setTrade = (patch: Partial<TradeForm>) => setTradeForm((f) => ({ ...f, ...patch }));

  const submitTrade = async (e: FormEvent) => {
    e.preventDefault();
    const built = buildTradeRecord(tradeForm, newId('trade'), nextCreatedAt(), today);
    if (!built.ok) {
      setTradeErrors(built.errors);
      const first = built.errors[0]?.field;
      if (first) document.getElementById(TRADE_FIELD_ID[first])?.focus();
      return;
    }
    setTradeErrors([]);
    const needWallet = tradeNeedsWallet(built.trade.kind);
    if (needWallet && !wallets.some((w) => w.id === walletId)) {
      setWalletError(wallets.length === 0 ? 'No cash wallet yet. Create a wallet before you can save' : 'Choose the wallet to pay from or receive into');
      document.getElementById(wallets.length === 0 ? 'pf-newwallet' : 'pf-wallet')?.focus();
      return;
    }
    setWalletError('');
    const ok = await act(async () => {
      await repo.recordTrade({ trade: built.trade, walletId: needWallet ? walletId : undefined });
      onLedgerChanged();
    }, built.trade.kind === 'reinvest' ? 'Saved reinvested dividend (no cash moved in or out)' : `Saved ${KIND_LABEL[built.trade.kind].toLowerCase()}. Wallet "${wallets.find((w) => w.id === walletId)?.name ?? ''}" updated.`);
    if (ok) setPanel(null);
  };

  const createWallet = async () => {
    const name = newWalletName.trim();
    if (name === '') {
      setNewWalletError('Enter a wallet name, e.g. "Cash" or "Bank account"');
      document.getElementById('pf-newwallet')?.focus();
      return;
    }
    setNewWalletError('');
    const id = newId('wallet');
    const ok = await act(async () => {
      await repo.addWallet({ id, name });
      onLedgerChanged();
    }, `Created wallet "${name}" and selected it`);
    if (ok) {
      setNewWalletName('');
      setWalletId(id);
      setWalletError('');
      // กล่องสร้างกระเป๋าหายไปแล้ว: ย้ายโฟกัสไปช่องเลือกกระเป๋า ไม่ให้โฟกัสหลุดไปที่ตัวหน้า
      window.requestAnimationFrame(() => document.getElementById('pf-wallet')?.focus());
    }
  };

  const submitPrice = async (e: FormEvent) => {
    e.preventDefault();
    if (panel?.type !== 'price') return;
    let priceMicro: number;
    try {
      if (!isSupportedEntryDate(priceForm.date)) throw new Error('Invalid date');
      if (priceForm.date > today) throw new Error('Cannot save a price for a future date');
      priceMicro = parsePriceMicro(priceForm.price);
    } catch (err) {
      setPriceError(err instanceof Error ? err.message : 'Invalid input');
      document.getElementById(priceForm.date > today || !isSupportedEntryDate(priceForm.date) ? 'pf-pdate' : 'pf-pprice')?.focus();
      return;
    }
    setPriceError('');
    const assetId = panel.assetId;
    const ok = await act(async () => {
      await repo.savePrice({ assetId, date: priceForm.date, priceMicro });
    }, 'Price saved');
    if (ok) setPanel(null);
  };

  const removeTrade = async (t: TradeRecord) => {
    if (confirmDelete !== t.id) {
      setConfirmDelete(t.id);
      setMessage({ text: 'Press the same button again within 5 seconds to confirm deletion', kind: 'ok' });
      return;
    }
    setConfirmDelete('');
    await act(async () => {
      await repo.deleteTrade(t.id);
      onLedgerChanged();
    }, t.entryId !== undefined ? 'Entry deleted and the wallet balance in the ledger was restored' : 'Entry deleted');
  };

  const t = portfolio.totals;
  const hasAssets = portfolio.rows.length > 0;
  const tradePanelAsset = panel?.type === 'trade' ? portfolio.rows.find((r) => r.asset.id === panel.assetId)?.asset : undefined;
  const pricePanelAsset = panel?.type === 'price' ? portfolio.rows.find((r) => r.asset.id === panel.assetId)?.asset : undefined;
  const k = tradeForm.kind;
  const pricedCount = portfolio.rows.filter((r) => r.market !== null).length;
  const noValue = pricedCount === 0 && t.unpriced > 0;
  const partial = pricedCount > 0 && t.unpriced > 0;
  const closeOnEscape = (e: KeyboardEvent) => {
    // Esc ที่ปิดรายการตัวเลือก (select) ไม่ควรปิดทั้งฟอร์มจนข้อมูลที่กรอกหาย
    if (e.key === 'Escape' && !e.defaultPrevented && (e.target as HTMLElement).tagName !== 'SELECT') setPanel(null);
  };

  return (
    <>
      <div className="page-header">
        <h2 className="page-title">Investment portfolio</h2>
        <p className="muted">Your funds and stocks, average cost, and value based on the prices you enter yourself</p>
      </div>

      <div className="notice" role="note">
        <p>Buys, sells and dividends add to or subtract from the wallet you choose. Gains, losses and dividends are shown on this page and are not mixed into everyday income and expenses.</p>
        <p>Older entries recorded before this feature did not adjust wallet balances retroactively.</p>
        <p>Prices are numbers you enter yourself, not live market prices.</p>
      </div>

      <div ref={messageRef}>
        <div role="status" aria-live="polite">
          {message?.kind === 'ok' && <p className="muted">{message.text}</p>}
        </div>
        <div role="alert">{message?.kind === 'error' && <p className="form-error">{message.text}</p>}</div>
      </div>

      {data === null && loadError === '' && (
        <p className="muted" role="status">
          Loading portfolio…
        </p>
      )}
      {loadError !== '' && (
        <div role="alert">
          <p className="form-error">Could not load portfolio data: {loadError}</p>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}

      {data !== null && loadError === '' && (
      <section className="glass-lite card" aria-labelledby="pf-sum-title">
        <h2 id="pf-sum-title">Portfolio summary</h2>
        {!hasAssets ? (
          <p className="muted">No assets yet. Start by entering a fund or stock name in "Add fund/stock" below.</p>
        ) : (
          <dl className="avg-result">
            <div>
              <dt>Total cost (still held)</dt>
              <dd className="num">{baht(t.cost)}</dd>
            </div>
            <div>
              <dt>Value at entered prices{partial && ' (priced items only)'}</dt>
              <dd className="num">{noValue ? <Dash /> : baht(t.value)}</dd>
            </div>
            <div>
              <dt>Unrealized gain/loss{partial && ' (priced items only)'}</dt>
              <dd className="num">{noValue ? <Dash /> : signed(t.unrealized)}</dd>
            </div>
            <div>
              <dt>Realized gain/loss</dt>
              <dd className="num">{signed(t.realized)}</dd>
            </div>
            <div>
              <dt>Total dividends (after tax)</dt>
              <dd className="num">{baht(t.dividends)}</dd>
            </div>
          </dl>
        )}
        {t.unpriced > 0 && (
          <p className="muted small" role="status">
            {t.unpriced} {t.unpriced === 1 ? 'item has' : 'items have'} no price entered yet. Value and gain/loss include priced items only.
          </p>
        )}
        <p className="muted small">Gain/loss is measured against cost; it is not an annualized return.</p>
        <p className="muted small">Average cost = the average price you paid per unit, including purchase fees. It may differ slightly from your broker app because of rounding.</p>
        {hasAssets && (
          <button
            type="button"
            ref={shareBtnRef}
            className="btn btn-ghost btn-small"
            aria-expanded={shareOpen}
            aria-controls="share-title"
            disabled={shareOpen}
            onClick={() => setShareOpen(true)}
          >
            Create portfolio allocation share card
          </button>
        )}
      </section>
      )}

      {shareOpen && hasAssets && <ShareCardPanel portfolio={portfolio} today={today} onClose={() => {
            setShareOpen(false);
            window.requestAnimationFrame(() => shareBtnRef.current?.focus()); // ปิดแล้วคืนโฟกัสให้ปุ่มที่เปิด
          }} />}

      {hasAssets && data !== null && (
        <DcaPlansCard
          assets={data.assets}
          trades={data.trades}
          today={today}
          onBuy={(assetId, amountText, opener) => {
            openTrade(assetId, 'buy', opener);
            setTradeForm((f) => ({ ...f, amount: amountText }));
          }}
        />
      )}

      <section className="solid card" aria-labelledby="pf-add-title">
        <h2 id="pf-add-title">Add fund/stock</h2>
        <form onSubmit={addAsset} className="settings-form">
          <div className="field-row">
            <div className="field">
              <label htmlFor="pf-asset-name">Name</label>
              <input
                id="pf-asset-name"
                type="text"
                autoComplete="off"
                maxLength={200}
                value={assetName}
                aria-invalid={assetError ? true : undefined}
                aria-describedby={assetError ? 'pf-asset-name-err' : undefined}
                onChange={(e) => setAssetName(e.target.value)}
              />
              {assetError && (
                <p id="pf-asset-name-err" className="avg-err">
                  {assetError}
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="pf-asset-kind">Type</label>
              <select id="pf-asset-kind" value={assetKind} onChange={(e) => setAssetKind(e.target.value as AssetKind)}>
                {(Object.keys(ASSET_KIND_LABEL_EN) as AssetKind[]).map((v) => (
                  <option key={v} value={v}>
                    {ASSET_KIND_LABEL_EN[v]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="dialog-actions">
            <button type="submit" className="btn btn-primary btn-small" disabled={busy}>
              Add
            </button>
          </div>
        </form>
      </section>

      {tradePanelAsset && (
        <section className="solid card" aria-labelledby="pf-trade-title">
          <h2 id="pf-trade-title" ref={headingRef} tabIndex={-1}>
            Record trade: {tradePanelAsset.name}
          </h2>
          <form onSubmit={submitTrade} onKeyDown={closeOnEscape} className="settings-form" noValidate>
            <div className="field-row">
              <div className="field">
                <label htmlFor="pf-kind">Trade type</label>
                <select id="pf-kind" value={k} onChange={(e) => setTrade({ kind: e.target.value as TradeKind })}>
                  {(Object.keys(KIND_LABEL) as TradeKind[]).map((v) => (
                    <option key={v} value={v}>
                      {KIND_LABEL[v]}
                    </option>
                  ))}
                </select>
                {(k === 'dividend' || k === 'reinvest') && <TermHelp term={KIND_GLOSSARY[k]} />}
              </div>
              <FieldInput id="pf-date" label="Date" type="date" value={tradeForm.date} onChange={(v) => setTrade({ date: v })} errors={tradeErrors} field="date" />
            </div>
            <div className="field-row">
              {k === 'buy' && (
                <>
                  <FieldInput id="pf-amount" label="Amount invested (THB)" value={tradeForm.amount} onChange={(v) => setTrade({ amount: v })} errors={tradeErrors} field="amount" placeholder="1,000.00" />
                  <FieldInput id="pf-price" label="Price per unit (THB)" value={tradeForm.price} onChange={(v) => setTrade({ price: v })} errors={tradeErrors} field="price" placeholder="12.3456" hint="Enter a price and units are calculated for you, or enter the units yourself from your broker" />
                  <FieldInput id="pf-units" label="Units (if given by your broker)" value={tradeForm.units} onChange={(v) => setTrade({ units: v })} errors={tradeErrors} field="units" placeholder="0" />
                  <FieldInput id="pf-fee" label="Fee (THB)" value={tradeForm.fee} onChange={(v) => setTrade({ fee: v })} errors={tradeErrors} field="fee" placeholder="0.00" hint="Included in cost" />
                </>
              )}
              {k === 'sell' && (
                <>
                  <FieldInput id="pf-units" label="Units sold" value={tradeForm.units} onChange={(v) => setTrade({ units: v })} errors={tradeErrors} field="units" placeholder="0" />
                  <FieldInput id="pf-price" label="Price per unit (THB)" value={tradeForm.price} onChange={(v) => setTrade({ price: v })} errors={tradeErrors} field="price" placeholder="12.3456" />
                  <FieldInput id="pf-fee" label="Fee (THB)" value={tradeForm.fee} onChange={(v) => setTrade({ fee: v })} errors={tradeErrors} field="fee" placeholder="0.00" hint="Deducted from the proceeds" />
                </>
              )}
              {k === 'dividend' && (
                <>
                  <FieldInput id="pf-amount" label="Dividend amount (THB)" value={tradeForm.amount} onChange={(v) => setTrade({ amount: v })} errors={tradeErrors} field="amount" placeholder="0.00" hint="Amount before tax" />
                  <FieldInput id="pf-wht" label="Withholding tax (THB)" value={tradeForm.withholding} onChange={(v) => setTrade({ withholding: v })} errors={tradeErrors} field="withholding" placeholder="0.00" help={<TermHelp term="ภาษีหัก ณ ที่จ่าย" />} />
                </>
              )}
              {k === 'reinvest' && (
                <>
                  <FieldInput id="pf-units" label="Units received" value={tradeForm.units} onChange={(v) => setTrade({ units: v })} errors={tradeErrors} field="units" placeholder="0" />
                  <FieldInput id="pf-amount" label="Cost added (THB)" value={tradeForm.amount} onChange={(v) => setTrade({ amount: v })} errors={tradeErrors} field="amount" placeholder="0.00" hint="Dividend amount after tax" />
                </>
              )}
            </div>
            {tradeNeedsWallet(k) && wallets.length === 0 && (
              <div className="field notice" role="group" aria-labelledby="pf-nowallet-title">
                <p id="pf-nowallet-title">
                  <strong>No cash wallet yet.</strong> You need a wallet before saving, because the money from buys, sells or dividends is taken from or added to it.
                </p>
                <label htmlFor="pf-newwallet">New wallet name</label>
                <input
                  id="pf-newwallet"
                  type="text"
                  autoComplete="off"
                  maxLength={100}
                  value={newWalletName}
                  placeholder="e.g. Cash or Bank account"
                  aria-invalid={newWalletError !== '' || walletError !== '' ? true : undefined}
                  aria-describedby={[newWalletError !== '' ? 'pf-newwallet-err' : '', walletError !== '' ? 'pf-newwallet-werr' : ''].filter(Boolean).join(' ') || undefined}
                  onChange={(e) => {
                    setNewWalletName(e.target.value);
                    setNewWalletError('');
                    setWalletError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void createWallet();
                    }
                  }}
                />
                {newWalletError !== '' && (
                  <p id="pf-newwallet-err" className="avg-err" role="alert">
                    {newWalletError}
                  </p>
                )}
                {walletError !== '' && (
                  <p id="pf-newwallet-werr" className="avg-err" role="alert">
                    {walletError}
                  </p>
                )}
                <button type="button" className="btn btn-small" disabled={busy} onClick={() => void createWallet()}>
                  Create wallet
                </button>
              </div>
            )}
            {tradeNeedsWallet(k) && wallets.length > 0 && (
              <div className="field">
                <label htmlFor="pf-wallet">{k === 'buy' ? 'Pay from wallet' : 'Receive into wallet'}</label>
                <select
                  id="pf-wallet"
                  value={walletId}
                  aria-invalid={walletError !== '' ? true : undefined}
                  aria-describedby={walletError !== '' ? 'pf-wallet-err' : undefined}
                  onChange={(e) => {
                    setWalletId(e.target.value);
                    setWalletError('');
                  }}
                >
                  <option value="">Choose wallet</option>
                  {wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
                {walletError !== '' && (
                  <p id="pf-wallet-err" className="avg-err">
                    {walletError}
                  </p>
                )}
              </div>
            )}
            <div className="field">
              <label htmlFor="pf-memo">Note (optional)</label>
              <input
                id="pf-memo"
                type="text"
                autoComplete="off"
                maxLength={2000}
                value={tradeForm.memo}
                aria-invalid={tradeErrors.some((x) => x.field === 'memo') ? true : undefined}
                aria-describedby={tradeErrors.some((x) => x.field === 'memo') ? 'pf-memo-err' : undefined}
                onChange={(e) => setTrade({ memo: e.target.value })}
              />
              {tradeErrors.find((x) => x.field === 'memo') && (
                <p id="pf-memo-err" className="avg-err">
                  {tradeErrors.find((x) => x.field === 'memo')?.message}
                </p>
              )}
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setPanel(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-small" disabled={busy}>
                Save
              </button>
            </div>
          </form>
        </section>
      )}

      {pricePanelAsset && (
        <section className="solid card" aria-labelledby="pf-price-title">
          <h2 id="pf-price-title" ref={headingRef} tabIndex={-1}>
            Enter latest price: {pricePanelAsset.name}
          </h2>
          <form onSubmit={submitPrice} onKeyDown={closeOnEscape} className="settings-form" noValidate>
            <div className="field-row">
              <div className="field">
                <label htmlFor="pf-pdate">Price date</label>
                <input id="pf-pdate" type="date" value={priceForm.date} onChange={(e) => setPriceForm((f) => ({ ...f, date: e.target.value }))} />
              </div>
              <div className="field">
                <label htmlFor="pf-pprice">Price per unit (THB)</label>
                <input
                  id="pf-pprice"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="12.3456"
                  value={priceForm.price}
                  aria-invalid={priceError ? true : undefined}
                  aria-describedby={priceError ? 'pf-pprice-err' : undefined}
                  onChange={(e) => setPriceForm((f) => ({ ...f, price: e.target.value }))}
                />
                {priceError && (
                  <p id="pf-pprice-err" className="avg-err">
                    {priceError}
                  </p>
                )}
              </div>
            </div>
            <p className="muted small">Entering the same date again replaces the price for that day</p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setPanel(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-small" disabled={busy}>
                Save price
              </button>
            </div>
          </form>
        </section>
      )}

      {hasAssets && (
        <section className="solid card" aria-labelledby="pf-list-title">
          <h2 id="pf-list-title">Assets</h2>
          <ul className="bill-list">
            {portfolio.rows.map((row) => (
              <AssetRow
                key={row.asset.id}
                row={row}
                today={today}
                trades={(data?.trades ?? []).filter((x) => x.assetId === row.asset.id)}
                confirmDelete={confirmDelete}
                busy={busy}
                onTrade={(el) => openTrade(row.asset.id, 'buy', el)}
                onPrice={(el) => {
                  openerRef.current = el;
                  setPriceForm({ date: today, price: '' });
                  setPriceError('');
                  setPanel({ type: 'price', assetId: row.asset.id });
                  setMessage(null);
                }}
                onDelete={(tr) => void removeTrade(tr)}
              />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function AssetRow(props: {
  row: AssetRowView;
  today: string;
  trades: TradeRecord[];
  confirmDelete: string;
  busy: boolean;
  onTrade: (opener: HTMLElement) => void;
  onPrice: (opener: HTMLElement) => void;
  onDelete: (t: TradeRecord) => void;
}) {
  const { row, today, trades, confirmDelete, busy } = props;
  const sorted = [...trades].sort(
    (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
  // โฟกัสหลังลบรายการ (เจ้าของสั่ง 14 พ.ย. 2569): ปุ่มลบหายไปพร้อมรายการ โฟกัสจะหลุดไป body → ย้ายไปรายการถัดไป (ไม่มี = รายการก่อนหน้า ไม่มี = หัว "ประวัติรายการ")
  // จดไว้ตอนกด "ยืนยันลบ" แล้วย้ายเมื่อรายการนั้นหายจากรายการจริง (ลบไม่สำเร็จ = รายการยังอยู่ ไม่ย้ายและล้างทิ้ง)
  const focusAfterDelete = useRef<{ deletedId: string; nextId: string | null } | null>(null);
  const summaryId = `history-sum-${row.asset.id}`;
  useEffect(() => {
    const pending = focusAfterDelete.current;
    if (!pending) return;
    if (trades.some((x) => x.id === pending.deletedId)) {
      // รายการยังอยู่: ถ้างานลบจบแล้ว (ไม่ busy และไม่ได้รอยืนยันรายการนี้) = ลบไม่สำเร็จ ล้างทิ้ง ไม่ให้ไปดึงโฟกัสทีหลัง
      if (!busy && confirmDelete !== pending.deletedId) focusAfterDelete.current = null;
      return;
    }
    focusAfterDelete.current = null;
    const target = (pending.nextId !== null ? document.getElementById(tradeButtonId(pending.nextId)) : null) ?? document.getElementById(summaryId);
    target?.focus();
  }, [trades, summaryId, busy, confirmDelete]);
  const handleDelete = (tr: TradeRecord) => {
    if (confirmDelete === tr.id) {
      focusAfterDelete.current = { deletedId: tr.id, nextId: nextFocusAfterDelete(sorted.map((x) => x.id), tr.id) };
    }
    props.onDelete(tr);
  };
  return (
    <li className="tx bill-row">
      <div className="tx-main">
        <AssetFigures row={row} today={today} />
        <details className="archived-details">
          <summary id={summaryId}>Trade history ({trades.length})</summary>
          {sorted.length === 0 ? (
            <p className="muted small">No entries yet</p>
          ) : (
            <ul className="bill-list">
              {sorted.map((tr) => (
                <TradeItem key={tr.id} tr={tr} confirmDelete={confirmDelete === tr.id} busy={busy} onDelete={() => handleDelete(tr)} />
              ))}
            </ul>
          )}
        </details>
      </div>
      <div className="bill-figures">
        <button type="button" className="btn btn-primary btn-small" onClick={(e) => props.onTrade(e.currentTarget)}>
          Record trade
        </button>
        <button type="button" className="btn btn-ghost btn-small" onClick={(e) => props.onPrice(e.currentTarget)}>
          Enter price
        </button>
      </div>
    </li>
  );
}
