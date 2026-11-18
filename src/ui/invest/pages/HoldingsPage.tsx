import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { formatDateEn } from '../../../app/dateEn';
import { fxRateText } from '../../../app/usdFormat';
import {
  buildHoldingsView, columnsFor, DEFAULT_HOLDINGS_QUERY, filterAndSort, HOLDINGS_TABS, planHoldingDelete, SORT_KEYS, totalsOf,
  type ColumnId, type HoldingRow, type HoldingsQuery, type HoldingsTab, type SortKey,
} from '../../../domain/invest/holdingsView';
import { useRepository } from '../../RepositoryContext';
import { UsStocksView, type UsStocksRequest } from '../../UsStocksView';
import { cellOf, COLUMN_LABEL, totalCellOf } from '../holdings/format';
import { RowMenu, type RowAction } from '../holdings/RowMenu';
import '../holdings/holdings.css';
import { useInvest } from '../InvestContext';
import { investError, investProblem } from '../investError';

type WithoutNonce<T> = T extends unknown ? Omit<T, 'nonce'> : never;

/** Portfolio → Holdings (แบบร่าง 20): ตารางถือครอง 4 แท็บ · ฟอร์มซื้อ/ขาย/ปันผล/แลกเงิน/ราคาเดิมของ A3-2 อยู่ใต้ตาราง (ใช้ UsStocksView เดิมโดยซ่อนตารางเก่า) */
export function HoldingsPage({ addSignal }: { addSignal: number }) {
  const { today, accounts, entries, wallets, onLedgerChanged, reload, data, loadError, currency } = useInvest();
  const repo = useRepository();
  const [tab, setTab] = useState<HoldingsTab>('holdings');
  const [q, setQ] = useState<HoldingsQuery>(DEFAULT_HOLDINGS_QUERY);
  const [openId, setOpenId] = useState('');
  const [confirm, setConfirm] = useState<{ row: HoldingRow; from: HTMLElement } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formsKey, setFormsKey] = useState(0); // ลบแล้วให้ฟอร์ม/รายการด้านล่าง (UsStocksView โหลดข้อมูลเอง) โหลดใหม่
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // สั่งเปิดฟอร์มของ UsStocksView: ปุ่ม Add บนแถบบน (addSignal) และเมนู ⋯ ของแถว · nonce เพิ่มทุกครั้ง
  const counter = useRef(addSignal > 0 ? 1 : 0);
  const [request, setRequest] = useState<UsStocksRequest | undefined>(addSignal > 0 ? { nonce: 1, panel: 'stock' } : undefined);
  const lastSignal = useRef(addSignal);
  const ask = useCallback((r: WithoutNonce<UsStocksRequest>) => {
    counter.current += 1;
    setRequest({ ...r, nonce: counter.current } as UsStocksRequest);
  }, []);
  useEffect(() => {
    if (addSignal !== lastSignal.current) {
      lastSignal.current = addSignal;
      ask({ panel: 'stock' });
    }
  }, [addSignal, ask]);

  const view = useMemo(() => (data ? buildHoldingsView(data, today, currency) : null), [data, today, currency]);
  const shown = useMemo(() => (view ? filterAndSort(view.rows, q) : []), [view, q]);
  const totals = useMemo(() => totalsOf(shown, currency), [shown, currency]);
  const cols = columnsFor(tab);
  const soldCount = view ? view.rows.filter((r) => r.sold).length : 0;
  const noAssets = view !== null && view.rows.length === 0;

  const onPick = (row: HoldingRow, a: RowAction, from: HTMLElement) => {
    setMessage(null);
    if (a === 'add') ask({ panel: 'trade', assetId: row.assetId });
    else if (a === 'edit') ask({ panel: 'price', assetId: row.assetId });
    else if (a === 'open') setOpenId((id) => (id === row.assetId ? '' : row.assetId));
    else setConfirm({ row, from });
  };

  const doDelete = async () => {
    if (!confirm || !data || busy) return;
    const { row, from } = confirm;
    const plan = planHoldingDelete(data.trades, row.assetId);
    if (!plan.ok) {
      setConfirm(null);
      setMessage({ kind: 'error', text: investProblem(plan.problem) });
      from.focus();
      return;
    }
    setBusy(true);
    let done = 0;
    try {
      for (const id of plan.ids) {
        await repo.deleteTrade(id); // ฟังก์ชันลบเดิมของ repository (ตรวจ R17 ซ้ำฝั่งฐานข้อมูลและกลับรายการในสมุด)
        done += 1;
      }
      setMessage({ kind: 'ok', text: `Deleted ${row.ticker || row.name}: ${done} ${done === 1 ? 'record' : 'records'}` });
    } catch (e) {
      setMessage({ kind: 'error', text: `Stopped after ${done} of ${plan.ids.length} records: ${investError(e)}` });
    } finally {
      setBusy(false);
      setConfirm(null);
      try {
        await reload();
      } catch (e) {
        // โหลดใหม่ไม่ได้ ไม่กลบข้อความเดิม (ถ้ามี) และต้องแจ้งสมุดบัญชีเสมอ
        setMessage((m) => m ?? { kind: 'error', text: `Could not refresh holdings: ${investError(e)}` });
      } finally {
        onLedgerChanged();
        if (done > 0) setFormsKey((k) => k + 1);
        if (done > 0) titleRef.current?.focus(); // แถวที่เปิดเมนูอาจหายไปแล้ว: โฟกัสไปที่หัวข้อหน้า
      }
    }
  };

  const closeConfirm = () => {
    confirm?.from.focus();
    setConfirm(null);
  };
  const confirmRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (confirm) confirmRef.current?.scrollIntoView({ block: 'center' });
  }, [confirm]);
  const deleteCount = useMemo(() => {
    if (!confirm || !data) return 0;
    const plan = planHoldingDelete(data.trades, confirm.row.assetId);
    return plan.ok ? plan.ids.length : data.trades.filter((t) => t.assetId === confirm.row.assetId).length;
  }, [confirm, data]);
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
    const n = HOLDINGS_TABS.length;
    const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    const next = HOLDINGS_TABS[to]!.id;
    setTab(next);
    document.getElementById(`hd-tab-${next}`)?.focus();
  };

  return (
    <div className="invest-tab invest-transactions hd-page">
      <div role="region" aria-label="US stocks" id="pf-panel-us">
        <section className="glass-lite card hd-card" aria-labelledby="hd-title">
          <div className="hd-head">
            <h2 id="hd-title" ref={titleRef} tabIndex={-1}>
              Holdings
            </h2>
            <p className="muted hd-fx" role="status">
              {view?.fx
                ? `Latest rate ${fxRateText(view.fx.rateMicro)} · ${formatDateEn(view.fx.date)}${view.fx.stale ? ` (${view.fx.days} days old)` : ''}`
                : view !== null && currency === 'THB'
                  ? 'No exchange rate yet: baht values show "Needs rate"'
                  : ''}
            </p>
          </div>

          <div role="status">{message?.kind === 'ok' && <p className="muted">{message.text}</p>}</div>
          <div role="alert">{message?.kind === 'error' && <p className="form-error">{message.text}</p>}</div>

          {loadError !== '' ? (
            <div role="alert">
              <p className="form-error">Could not load holdings: {loadError}</p>
              <button type="button" className="iv-btn" onClick={() => void reload()}>
                Retry
              </button>
            </div>
          ) : view === null ? (
            <p className="muted" role="status">
              Loading holdings…
            </p>
          ) : noAssets ? (
            <div>
              <h3 className="hd-empty-title">No US stocks yet</h3>
              <p className="muted">Start by creating a USD cash account, exchanging some baht, then adding a stock with the Add stock button below.</p>
            </div>
          ) : (
            <>
              <div className="hd-tabs" role="tablist" aria-label="Holdings columns">
                {HOLDINGS_TABS.map((t, i) => (
                  <button
                    key={t.id}
                    id={`hd-tab-${t.id}`}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.id}
                    aria-controls="hd-panel"
                    tabIndex={tab === t.id ? 0 : -1}
                    className={`iv-tab${tab === t.id ? ' is-active' : ''}`}
                    onClick={() => setTab(t.id)}
                    onKeyDown={(e) => tabKey(e, i)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="hd-tools">
                <div className="iv-field">
                  <label htmlFor="hd-search">Search</label>
                  <input id="hd-search" type="search" value={q.query} placeholder="Ticker or name" onChange={(e) => setQ({ ...q, query: e.target.value })} />
                </div>
                <div className="iv-field">
                  <label htmlFor="hd-sort">Sort by</label>
                  <select id="hd-sort" value={q.sortKey} onChange={(e) => setQ({ ...q, sortKey: e.target.value as SortKey })}>
                    {SORT_KEYS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="button" className="iv-btn" aria-label={`Sort direction: ${q.dir === 'asc' ? 'ascending' : 'descending'}`} onClick={() => setQ({ ...q, dir: q.dir === 'asc' ? 'desc' : 'asc' })}>
                  <span aria-hidden="true">{q.dir === 'asc' ? '↑' : '↓'}</span> {q.dir === 'asc' ? 'Ascending' : 'Descending'}
                </button>
                <label className="hd-check">
                  <input type="checkbox" checked={q.showSold} onChange={(e) => setQ({ ...q, showSold: e.target.checked })} />
                  Show sold{soldCount > 0 ? ` (${soldCount})` : ''}
                </label>
              </div>

              <div id="hd-panel" role="tabpanel" aria-labelledby={`hd-tab-${tab}`}>
                {shown.length === 0 ? (
                  <p className="muted" role="status">
                    {q.query.trim() !== '' ? 'No holdings match your search.' : 'No holdings to show. Turn on Show sold to see positions you have fully sold.'}
                  </p>
                ) : (
                  <div className="migrate-table-wrap hd-wrap" role="region" aria-label="Holdings table, scrollable horizontally" tabIndex={0}>
                    <table className="migrate-table hd-table">
                      <caption className="sr-only">
                        Holdings in {currency}: {HOLDINGS_TABS.find((t) => t.id === tab)?.label}
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Holding</th>
                          {cols.map((c) => (
                            <th key={c} scope="col" className="num">
                              {COLUMN_LABEL[c]}
                            </th>
                          ))}
                          <th scope="col" className="hd-actions">
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((r) => (
                          <HoldingTr key={r.assetId} r={r} cols={cols} currency={currency} open={openId === r.assetId} onPick={onPick} />
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <th scope="row">
                            Total · {totals.count} {totals.count === 1 ? 'holding' : 'holdings'}
                          </th>
                          {cols.map((c) => (
                            <td key={c} className="num">
                              {totalCellOf(c, totals, currency)}
                            </td>
                          ))}
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
                {!totals.complete && shown.length > 0 && (
                  <p className="muted small" role="status">
                    Some holdings have no price or exchange rate, so their values and the totals are incomplete (they are not counted as 0).
                  </p>
                )}
                {tab === 'returns' && currency === 'USD' && shown.length > 0 && (
                  <p className="muted small">The currency source is not shown in USD view; switch to THB to see profit from exchange-rate changes.</p>
                )}
              </div>
            </>
          )}
        </section>

        {confirm && (
          <section ref={confirmRef} onKeyDown={confirmKey} className="solid card hd-confirm" role="alertdialog" aria-labelledby="hd-del-title" aria-describedby="hd-del-desc">
            <h2 id="hd-del-title">Delete {confirm.row.ticker || confirm.row.name}?</h2>
            <p id="hd-del-desc" className="muted">
              This deletes every record of this holding (buys, sells and dividends) and reverses the matching ledger entries. It cannot be undone. If one record can't be deleted, nothing is deleted.
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="iv-btn"
                autoFocus
                onClick={closeConfirm}
              >
                Keep
              </button>
              <button type="button" className="iv-btn iv-btn-danger" disabled={busy} onClick={() => void doDelete()}>
                {busy ? 'Deleting…' : `Delete ${deleteCount} ${deleteCount === 1 ? 'record' : 'records'}`}
              </button>
            </div>
          </section>
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
        />
      </div>
    </div>
  );
}

function HoldingTr(props: { r: HoldingRow; cols: ColumnId[]; currency: 'USD' | 'THB'; open: boolean; onPick: (r: HoldingRow, a: RowAction, from: HTMLElement) => void }) {
  const { r, cols, currency, open, onPick } = props;
  const label = r.ticker || r.name;
  return (
    <>
      <tr className={r.sold ? 'hd-sold' : undefined}>
        <th scope="row">
          <span className="hd-ticker">{label}</span>
          {r.ticker !== '' && <span className="hd-name">{r.name}</span>}
          {r.sold && <span className="hd-badge">Sold</span>}
        </th>
        {cols.map((c) => (
          <td key={c} className="num">
            {cellOf(c, r, currency)}
          </td>
        ))}
        <td className="hd-actions">
          <RowMenu label={`Actions for ${label}`} onPick={(a, from) => onPick(r, a, from)} />
        </td>
      </tr>
      {open && (
        <tr className="hd-detail">
          <td colSpan={cols.length + 2}>
            <dl className="hd-dl" aria-label={`Details of ${label}`}>
              {(['shares', 'avgCost', 'lastPrice', 'currentValue', 'unrealized', 'div12m', 'yieldOnCost', 'totalProfit'] as const).map((c) => (
                <div key={c}>
                  <dt>{COLUMN_LABEL[c]}</dt>
                  <dd>{cellOf(c, r, currency)}</dd>
                </div>
              ))}
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}
