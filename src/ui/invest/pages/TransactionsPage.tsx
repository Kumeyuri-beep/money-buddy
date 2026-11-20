import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { formatDateEn } from '../../../app/dateEn';
import { fxRateText, usd } from '../../../app/usdFormat';
import type { UsTradeKind } from '../../../app/usForms';
import {
  buildTransactionsView, dateRangeReversed, DEFAULT_TX_QUERY, filterTransactions, hasActiveFilters, planTransactionDelete, totalsOf, TX_KIND_LABEL, TX_KINDS, TX_TABS,
  type TxKind, type TxQuery, type TxRow, type TxTab,
} from '../../../domain/invest/transactionsView';
import { assetCurrency } from '../../../domain/invest/types';
import { formatUnits } from '../../../domain/invest/units';
import { usdCashBalances } from '../../../domain/invest/usdIntegrity';
import { PortfolioTransfer } from '../../PortfolioTransfer';
import { useRepository } from '../../RepositoryContext';
import { UsStocksView, type UsStocksRequest } from '../../UsStocksView';
import { InfoTip } from '../Tip';
import { useInvest } from '../InvestContext';
import { investError, investProblem } from '../investError';
import { IncompleteTag } from '../MissingRateNotice';
import { AddMenu, type AddAction } from '../transactions/AddMenu';
import { CashAdjustForm } from '../transactions/CashAdjustForm';
import { AmountCell, amountText, NoValue, signedAmountText } from '../transactions/format';
import { StockPicker } from '../transactions/StockPicker';
import '../transactions/transactions.css';

type WithoutNonce<T> = T extends unknown ? Omit<T, 'nonce'> : never;
type Panel = { type: 'pick'; kind: UsTradeKind } | { type: 'cash' } | { type: 'transfer' } | { type: 'needCash' } | null;

const EDIT_NOTE = 'Editing is not available yet. Delete and add it again.';

/** Portfolio → Transactions (แบบร่าง 21): ตารางรายการทุกชนิด + Filters + เมนู Add + ลบพร้อม confirm · ตัวเลขทั้งหมดมาจาก src/domain/invest/transactionsView */
export function TransactionsPage() {
  const { today, accounts, entries, wallets, onLedgerChanged, reload, data, loadError, currency } = useInvest();
  const repo = useRepository();
  const [q, setQ] = useState<TxQuery>(DEFAULT_TX_QUERY);
  const [showFilters, setShowFilters] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [confirm, setConfirm] = useState<{ row: TxRow; from: HTMLElement } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formsKey, setFormsKey] = useState(0); // ลบแล้วให้ฟอร์มด้านล่าง (UsStocksView โหลดข้อมูลเอง) โหลดใหม่
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const needRef = useRef<HTMLHeadingElement>(null);
  const transferRef = useRef<HTMLDivElement>(null);

  // สั่งเปิดฟอร์มเดิมของ UsStocksView (ซื้อ/ขาย/ปันผล/แลกเงิน/เพิ่มหุ้น/สร้างบัญชี USD) · nonce เพิ่มทุกครั้ง
  const counter = useRef(0);
  const [request, setRequest] = useState<UsStocksRequest | undefined>(undefined);
  const ask = useCallback((r: WithoutNonce<UsStocksRequest>) => {
    counter.current += 1;
    setRequest({ ...r, nonce: counter.current } as UsStocksRequest);
  }, []);

  const view = useMemo(() => (data ? buildTransactionsView({ data, accounts, entries, currency, today }) : null), [data, accounts, entries, currency, today]);
  const shown = useMemo(() => (view ? filterTransactions(view.rows, q) : []), [view, q]);
  const totals = useMemo(() => totalsOf(shown), [shown]);
  const usdCash = useMemo(() => (data ? usdCashBalances(accounts, entries, data) : []), [data, accounts, entries]);
  const stocks = useMemo(() => (data ? data.assets.filter((a) => assetCurrency(a) === 'USD' && a.archived !== true) : []), [data]);
  const hasBroker = useMemo(() => {
    if (!data) return false;
    const bound = new Set(data.assets.map((a) => a.accountId));
    return accounts.some((a) => a.type === 'asset' && a.currency === 'THB' && a.kind === 'investment' && !a.archived && !bound.has(a.id));
  }, [data, accounts]);
  const filtered = hasActiveFilters(q);
  const reversed = dateRangeReversed(q);
  const activeCount = [q.kind !== '', q.assetId !== '', q.from !== '' || q.to !== ''].filter(Boolean).length;

  const panelType = panel?.type;
  useEffect(() => {
    if (panelType === 'needCash') needRef.current?.focus();
    else if (panelType === 'transfer') transferRef.current?.focus();
  }, [panelType]); // ย้ายโฟกัสครั้งเดียวตอนแผงเปิด (ไม่ดึงกลับทุก render)

  const closePanel = () => {
    setPanel(null);
    const el = opener.current;
    if (el && el.isConnected) window.setTimeout(() => el.focus(), 0);
  };

  const onAdd = (a: AddAction, from: HTMLElement) => {
    opener.current = from;
    setMessage(null);
    if (a === 'buy' || a === 'sell' || a === 'dividend') setPanel({ type: 'pick', kind: a });
    else if (a === 'cash') setPanel({ type: 'cash' });
    else if (a === 'transfer') setPanel({ type: 'transfer' });
    else if (usdCash.length === 0) setPanel({ type: 'needCash' });
    else {
      setPanel(null);
      ask({ panel: 'exchange' });
    }
  };

  const refresh = async (text: string) => {
    setMessage({ kind: 'ok', text });
    try {
      await reload();
    } catch (e) {
      setMessage({ kind: 'error', text: `Could not refresh transactions: ${investError(e)}` });
    }
    onLedgerChanged();
    setFormsKey((k) => k + 1);
  };

  // ---------- ลบ ----------
  const plan = useMemo(() => (confirm && data ? planTransactionDelete(confirm.row, data) : null), [confirm, data]);
  const closeConfirm = () => {
    confirm?.from.focus();
    setConfirm(null);
  };
  const doDelete = async () => {
    if (!confirm || !data || !plan || !plan.ok || busy) return;
    const { row } = confirm;
    setBusy(true);
    let ok = false;
    try {
      if (plan.source === 'trade') await repo.deleteTrade(plan.id); // ตรวจ R17 ซ้ำฝั่ง repository/ฐานข้อมูล และกลับรายการในสมุด
      else if (plan.source === 'fx') await repo.deleteFxExchange(plan.id);
      else await repo.deleteEntry(plan.id);
      ok = true;
      setMessage({ kind: 'ok', text: `Deleted ${TX_KIND_LABEL[row.kind].toLowerCase()} on ${formatDateEn(row.date)}` });
    } catch (e) {
      setMessage({ kind: 'error', text: `Could not delete: ${investError(e)}` });
    } finally {
      setBusy(false);
      setConfirm(null);
      try {
        await reload();
      } catch (e) {
        setMessage((m) => m ?? { kind: 'error', text: `Could not refresh transactions: ${investError(e)}` });
      } finally {
        onLedgerChanged();
        if (ok) {
          setFormsKey((k) => k + 1);
          titleRef.current?.focus(); // แถวที่กดลบหายไปแล้ว: โฟกัสไปที่หัวข้อหน้า
        } else confirm.from.focus();
      }
    }
  };
  const confirmRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (confirm) confirmRef.current?.scrollIntoView({ block: 'center' });
  }, [confirm]);
  const confirmKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeConfirm();
    } else if (e.key === 'Tab') {
      const btns = [...(confirmRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])];
      if (btns.length === 0) return;
      const i = btns.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? btns.length - 1 : i - 1) : i === btns.length - 1 ? 0 : i + 1;
      e.preventDefault();
      btns[next]?.focus();
    }
  };

  const tabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = TX_TABS.length;
    const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    const next = TX_TABS[to]!.id;
    setQ((p) => ({ ...p, tab: next }));
    document.getElementById(`tx-tab-${next}`)?.focus();
  };
  const clear = () => setQ((p) => ({ ...DEFAULT_TX_QUERY, tab: p.tab }));
  const setTab = (tab: TxTab) => setQ((p) => ({ ...p, tab }));

  const total = view?.rows.length ?? 0;
  const needsRateCount = shown.filter((r) => r.needsRate).length;
  const failedCount = shown.filter((r) => r.failed).length;

  return (
    <div className="invest-tab invest-transactions tx-page">
      <div role="region" aria-label="Transactions" id="pf-panel-overview">
        <section className="glass-lite card tx-card" aria-labelledby="tx-title">
          <div className="tx-head">
            <h2 id="tx-title" ref={titleRef} tabIndex={-1}>
              Transactions
            </h2>
            <p className="muted tx-fx" role="status">
              {view?.fx ? `Latest rate ${fxRateText(view.fx.rateMicro)} · ${formatDateEn(view.fx.date)}${view.fx.stale ? ` (${view.fx.days} days old, values converted with it may be out of date)` : ''}` : view !== null && currency === 'THB' ? 'No exchange rate yet: values that need one show "Needs rate"' : ''}
            </p>
          </div>

          <div role="status">{message?.kind === 'ok' && <p className="muted">{message.text}</p>}</div>
          <div role="alert">{message?.kind === 'error' && <p className="form-error">{message.text}</p>}</div>

          {loadError !== '' ? (
            <div role="alert">
              <p className="form-error">Could not load transactions: {loadError}</p>
              <button type="button" className="iv-btn" onClick={() => void reload()}>
                Retry
              </button>
            </div>
          ) : view === null ? (
            <p className="muted" role="status">
              Loading transactions…
            </p>
          ) : (
            <>
              <p className="sr-only" role="status">
                {shown.length} of {total} transactions
              </p>
              <div className="tx-tabs" role="tablist" aria-label="Transaction groups">
                {TX_TABS.map((t, i) => (
                  <button
                    key={t.id}
                    id={`tx-tab-${t.id}`}
                    type="button"
                    role="tab"
                    aria-selected={q.tab === t.id}
                    aria-controls="tx-panel"
                    tabIndex={q.tab === t.id ? 0 : -1}
                    className={`iv-tab${q.tab === t.id ? ' is-active' : ''}`}
                    onClick={() => setTab(t.id)}
                    onKeyDown={(e) => tabKey(e, i)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="tx-tools">
                <AddMenu onPick={onAdd} />
                <div className="iv-field tx-search">
                  <label htmlFor="tx-search">Search</label>
                  <input id="tx-search" type="search" value={q.query} placeholder="Ticker, name or note" onChange={(e) => setQ({ ...q, query: e.target.value })} />
                </div>
                <button type="button" className="iv-btn" aria-expanded={showFilters} aria-controls={showFilters ? 'tx-filters' : undefined} onClick={() => setShowFilters((s) => !s)}>
                  Filters{activeCount > 0 ? ` (${activeCount})` : ''}
                </button>
                {filtered && (
                  <button type="button" className="iv-btn" onClick={clear}>
                    Clear filters
                  </button>
                )}
                <span className="tx-r11">
                  Average cost
                  <InfoTip label="About average cost" tip="Cost of what you still hold uses the average cost method: total cost including purchase fees, divided by shares held." />
                </span>
              </div>

              {showFilters && (
                <div id="tx-filters" className="tx-filters" role="group" aria-label="Filters">
                  <div className="iv-field">
                    <label htmlFor="tx-f-kind">Type</label>
                    <select id="tx-f-kind" value={q.kind} onChange={(e) => setQ({ ...q, kind: e.target.value as TxKind | '' })}>
                      <option value="">All types</option>
                      {TX_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {TX_KIND_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="iv-field">
                    <label htmlFor="tx-f-asset">Asset</label>
                    <select id="tx-f-asset" value={q.assetId} onChange={(e) => setQ({ ...q, assetId: e.target.value })}>
                      <option value="">All assets</option>
                      {view.assets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="iv-field">
                    <label htmlFor="tx-f-from">From</label>
                    <input id="tx-f-from" type="date" value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })} />
                  </div>
                  <div className="iv-field">
                    <label htmlFor="tx-f-to">To</label>
                    <input id="tx-f-to" type="date" value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })} />
                  </div>
                  {reversed && (
                    <p className="form-error tx-range-err" role="alert">
                      The From date is after the To date, so nothing matches.
                    </p>
                  )}
                </div>
              )}

              {view.negativeCash.length > 0 && (
                <section className="solid mr-notice tx-neg" role="alert" aria-label="Negative USD cash" data-testid="tx-negative-cash">
                  <p className="mr-title">USD cash is negative</p>
                  {view.negativeCash.map((c) => (
                    <p key={c.accountId}>
                      {c.name}: {usd(c.cents)}. Record a currency exchange or a cash deposit, or review your exchange and buy entries so the balance is not negative.
                    </p>
                  ))}
                </section>
              )}

              {total > 0 && (
                <ul className="tx-chips" aria-label={`Totals for the ${totals.count} transactions shown, in ${currency}`}>
                  <Chip label="Buy" tone="buy" value={totals.buy} currency={currency} />
                  <Chip label="Sell" tone="sell" value={totals.sell} currency={currency} />
                  <Chip label="Fee & tax" tone="fee" value={totals.feeTax} currency={currency} />
                  <Chip label="Dividends (net)" tone="div" value={totals.dividendNet} currency={currency} />
                </ul>
              )}

              <div id="tx-panel" role="tabpanel" aria-labelledby={`tx-tab-${q.tab}`}>
                {total === 0 ? (
                  <div>
                    <h3 className="tx-empty-title">No transactions yet</h3>
                    <p className="muted">Use Add to record a buy, sell, dividend, cash deposit, transfer or currency exchange. They will all appear here.</p>
                  </div>
                ) : shown.length === 0 ? (
                  <div role="status">
                    <p className="muted">{filtered ? 'No transactions match your filters.' : 'No transactions in this group.'}</p>
                    {filtered && (
                      <button type="button" className="iv-btn" onClick={clear}>
                        Clear filters
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="migrate-table-wrap tx-wrap" role="region" aria-label="Transactions table, scrollable horizontally" tabIndex={0}>
                    <table className="migrate-table tx-table">
                      <caption className="sr-only">
                        {shown.length} {shown.length === 1 ? 'transaction' : 'transactions'} in {currency}, newest first
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col" aria-sort="descending">
                            Date <span aria-hidden="true">↓</span>
                          </th>
                          <th scope="col">Type</th>
                          <th scope="col">Asset</th>
                          <th scope="col" className="num">
                            Shares
                          </th>
                          <th scope="col" className="num">
                            Price
                          </th>
                          <th scope="col" className="num">
                            Value
                          </th>
                          <th scope="col" className="num">
                            Fee / tax
                          </th>
                          <th scope="col">Currency</th>
                          <th scope="col" className="tx-actions">
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((r) => (
                          <TxTr key={r.key} r={r} onDelete={(row, from) => setConfirm({ row, from })} onEdit={() => setMessage({ kind: 'ok', text: EDIT_NOTE })} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {shown.length > 0 && (
                  <>
                    <p id="tx-edit-note" className="muted small">
                      {EDIT_NOTE}
                    </p>
                    {needsRateCount > 0 && (
                      <p className="muted small" role="status" data-testid="tx-needs-rate-note">
                        {needsRateCount} {needsRateCount === 1 ? 'transaction needs' : 'transactions need'} an exchange rate, so {needsRateCount === 1 ? 'it shows' : 'they show'} "Needs rate". The trade totals above marked Incomplete leave {needsRateCount === 1 ? 'it' : 'them'} out (not counted as 0).
                      </p>
                    )}
                    {failedCount > 0 && (
                      <p className="muted small" role="status">
                        {failedCount} {failedCount === 1 ? 'transaction' : 'transactions'} could not be converted (invalid rate or amount) and {failedCount === 1 ? 'is' : 'are'} left out of the totals.
                      </p>
                    )}
                    {totals.excluded > 0 && (
                      <p className="muted small" role="status">
                        {totals.excluded} baht {totals.excluded === 1 ? 'asset transaction is' : 'asset transactions are'} shown in THB and not included in the USD totals.
                      </p>
                    )}
                    <p className="muted small">
                      Value is the amount of each transaction (− money out of the portfolio, + money in). Fee / tax is the fee plus tax withheld at source. Totals above count only buys, sells, fees and dividends: reinvested dividends, exchanges, transfers and cash deposits are not included. In THB view each amount uses the exchange rate of its own date; cash deposits and transfers use the latest rate you entered.
                    </p>
                  </>
                )}
              </div>
            </>
          )}
        </section>

        {confirm && plan && (
          <section ref={confirmRef} onKeyDown={confirmKey} className="solid card tx-confirm" role="alertdialog" aria-labelledby="tx-del-title" aria-describedby="tx-del-desc">
            <h2 id="tx-del-title">
              {plan.ok ? 'Delete' : 'Cannot delete'} {TX_KIND_LABEL[confirm.row.kind].toLowerCase()} on {formatDateEn(confirm.row.date)}?
            </h2>
            <p className="tx-del-what">{describeRow(confirm.row)}</p>
            <p id="tx-del-desc" className={plan.ok ? 'muted' : 'form-error'}>
              {plan.ok ? deleteText(confirm.row) : investProblem(plan.problem)}
            </p>
            <div className="dialog-actions">
              <button type="button" className="iv-btn" autoFocus onClick={closeConfirm}>
                {plan.ok ? 'Keep' : 'Close'}
              </button>
              {plan.ok && (
                <button type="button" className="iv-btn iv-btn-danger" disabled={busy} onClick={() => void doDelete()}>
                  {busy ? 'Deleting…' : 'Delete'}
                </button>
              )}
            </div>
          </section>
        )}

        {panel?.type === 'pick' && data && (
          <StockPicker
            kind={panel.kind}
            stocks={stocks}
            noUsdCash={usdCash.length === 0}
            onClose={closePanel}
            onContinue={(assetId) => {
              setPanel(null);
              ask({ panel: 'trade', assetId, kind: panel.kind });
            }}
            onAddStock={() => {
              setPanel(null);
              ask({ panel: 'stock' });
            }}
            onCreateCash={() => {
              setPanel(null);
              ask({ panel: 'cash' });
            }}
          />
        )}
        {panel?.type === 'needCash' && (
          <section className="solid card tx-panel" aria-labelledby="tx-need-title" onKeyDown={(e) => e.key === 'Escape' && closePanel()}>
            <h2 id="tx-need-title" tabIndex={-1} ref={needRef}>
              Currency exchange needs a USD cash account
            </h2>
            <p className="muted">Create a USD cash account first. Then you can exchange baht into dollars.</p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost btn-small" onClick={closePanel}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-small"
                onClick={() => {
                  setPanel(null);
                  ask({ panel: 'cash' });
                }}
              >
                Create USD cash account
              </button>
            </div>
          </section>
        )}
        {panel?.type === 'cash' && data && (
          <CashAdjustForm
            today={today}
            accounts={accounts}
            entries={entries}
            data={data}
            onClose={closePanel}
            onSaved={(text) => {
              closePanel();
              void refresh(text);
            }}
          />
        )}
        {panel?.type === 'transfer' && (
          <div
            className="tx-transfer"
            role="group"
            aria-label="Transfer to or from portfolio"
            tabIndex={-1}
            ref={transferRef}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !e.defaultPrevented && !(e.target instanceof HTMLSelectElement)) closePanel();
            }}
          >
            {hasBroker ? (
              <PortfolioTransfer
                today={today}
                accounts={accounts}
                wallets={wallets}
                onLedgerChanged={() => {
                  void reload();
                  onLedgerChanged();
                  setFormsKey((k) => k + 1);
                }}
              />
            ) : (
              <section className="solid card tx-panel">
                <h2>Transfer to / from portfolio</h2>
                <p className="muted">You need a baht cash account tagged as investment money (for example, cash held with a broker). Tag one in Accounts first.</p>
              </section>
            )}
            <div className="dialog-actions">
              <button type="button" className="iv-btn" onClick={closePanel}>
                Close
              </button>
            </div>
          </div>
        )}

        <UsStocksView
          key={formsKey}
          today={today}
          accounts={accounts}
          entries={entries}
          wallets={wallets}
          onLedgerChanged={() => {
            void reload();
            onLedgerChanged();
          }}
          request={request}
          hideList
          formsOnly
        />
      </div>
    </div>
  );
}

/** บอกว่ากำลังลบอะไร: ชนิด สินทรัพย์ วันที่ จำนวนหุ้น มูลค่า (ข้อความล้วนจากค่าในแถวที่ domain คำนวณแล้ว) */
function describeRow(r: TxRow): string {
  const parts = [`${TX_KIND_LABEL[r.kind]} ${r.label}`, formatDateEn(r.date)];
  if (r.units !== null) parts.push(`${formatUnits(r.units)} shares`);
  if (r.value !== null && !r.needsRate) parts.push(signedAmountText(r.value, r.direction));
  return parts.join(' · ');
}

function deleteText(r: TxRow): string {
  if (r.source === 'fx') return 'This deletes the exchange and reverses its baht and dollar amounts in your ledger. If the dollars were already used to buy stock, USD cash will go negative and a warning will show. It cannot be undone.';
  if (r.source === 'entry') {
    if (r.sourceCurrency === 'USD') return r.kind === 'cash_in' ? 'This deletes the deposit from your ledger. If the dollars were already used, USD cash will go negative and a warning will show. It cannot be undone.' : 'This deletes the withdrawal from your ledger and adds the dollars back to USD cash. It cannot be undone.';
    return 'This deletes the baht entry from your ledger. A warning is shown only for negative USD cash, so check your baht balance yourself. It cannot be undone.';
  }
  return 'This deletes the record and reverses its ledger entry. It cannot be undone.';
}

function Chip({ label, tone, value, currency }: { label: string; tone: string; value: number | null; currency: 'USD' | 'THB' }) {
  return (
    <li className={`tx-chip tx-chip-${tone}`}>
      <span className="tx-chip-label">{label}</span>
      <strong className="num">{value === null ? <IncompleteChip /> : amountText({ minor: value, currency })}</strong>
    </li>
  );
}
function IncompleteChip() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <IncompleteTag />
    </>
  );
}

function TxTr({ r, onDelete, onEdit }: { r: TxRow; onDelete: (r: TxRow, from: HTMLElement) => void; onEdit: () => void }) {
  const desc = `${TX_KIND_LABEL[r.kind]} ${r.label} on ${formatDateEn(r.date)}`;
  return (
    <tr>
      <th scope="row" className="tx-date">
        {formatDateEn(r.date)}
      </th>
      <td>
        <span className={`tx-kind tx-kind-${r.kind}`}>{TX_KIND_LABEL[r.kind]}</span>
      </td>
      <td>
        <span className="tx-label">{r.label}</span>
        {r.name !== '' && r.name !== r.label && <span className="tx-sub">{r.name}</span>}
        {r.memo !== '' && <span className="tx-sub">{r.memo}</span>}
      </td>
      <td className="num">{r.units === null ? <NoValue /> : formatUnits(r.units)}</td>
      <td className="num">
        {r.kind === 'fx' && r.fxRateMicro !== null ? fxRateText(r.fxRateMicro) : <AmountCell a={r.price} row={r} />}
        {(r.kind === 'buy' || r.kind === 'reinvest') && r.price !== null && (
          <span className="tx-avg">
            avg
            <InfoTip label="About the average price" tip="Average price per share of this purchase: purchase value divided by shares." />
          </span>
        )}
      </td>
      <td className="num">
        <AmountCell a={r.value} row={r} flag signed />
      </td>
      <td className="num">
        <AmountCell a={r.feeTax} row={r} hideZero />
      </td>
      <td>{r.sourceCurrency}</td>
      <td className="tx-actions">
        <button type="button" className="tx-act" aria-disabled="true" aria-label={`Edit ${desc}`} aria-describedby="tx-edit-note" onClick={(e) => {
            e.preventDefault();
            onEdit();
          }}>
          Edit
        </button>
        <button type="button" className="tx-act tx-act-del" aria-label={`Delete ${desc}`} onClick={(e) => onDelete(r, e.currentTarget)}>
          Delete
        </button>
      </td>
    </tr>
  );
}
