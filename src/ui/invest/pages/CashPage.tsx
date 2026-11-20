import { useMemo, useRef, useState, type MouseEvent } from 'react';
import { formatDateEn } from '../../../app/dateEn';
import { investUrl } from '../../../app/investRoute';
import { fxRateText } from '../../../app/usdFormat';
import { buildCashView, CASH_CURRENCY_NAME, cashAccountBalances, cashPortfolioShares, filterCashRows, percentOneDecimal, recentCashMovements } from '../../../domain/invest/cashView';
import { buildHoldingsView, totalsOf } from '../../../domain/invest/holdingsView';
import { investError } from '../investError';
import { useInvest } from '../InvestContext';
import { useDesktop } from '../../useDesktop';
import { ChangeBalanceDialog } from '../cash/ChangeBalanceDialog';
import { MOVEMENT_LABEL, minorText, signedMinorText } from '../cash/cashFormat';
import '../cash/cash.css';

/**
 * portfolio/cash · Cash (แบบร่าง 24 · R16 R20 R23 R26): ยอดเงินสดของพอร์ตสกุลบาท/USD อ่านจากสมุด + รายการเงินเข้า/ออก + ปุ่ม Change balance
 * ตัวเลขและส่วนต่างทั้งหมดมาจาก src/domain/invest/cashView.ts · ไม่มีสูตรเงินในคอมโพเนนต์
 */
export function CashPage(_props: { onHome: () => void }) {
  const { today, accounts, entries, data, loadError, reload, onLedgerChanged, currency } = useInvest();
  const [dialog, setDialog] = useState<{ accountId: string } | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const desktop = useDesktop();
  const [query, setQuery] = useState('');
  const [showZero, setShowZero] = useState(false);

  const built = useMemo(() => {
    try {
      const inv = data ?? undefined;
      const cashView = buildCashView(accounts, entries, inv, currency, today);
      // มูลค่าตลาดของหุ้นในสกุลที่แสดง (ตัวเดียวกับแถวรวมของ Holdings) · ราคา/เรตไม่ครบ = null → Share of portfolio แสดง "—"
      const stocks = data === null ? null : totalsOf(buildHoldingsView(data, today, currency).rows, currency).value;
      return {
        view: cashView,
        pf: cashPortfolioShares(cashView, stocks),
        cash: cashAccountBalances(accounts, entries, inv, today),
        movements: recentCashMovements(accounts, entries, inv, 20),
        failure: '',
      };
    } catch (e) {
      return { view: null, pf: null, cash: [], movements: [], failure: investError(e, 'Could not read your cash balances.') };
    }
  }, [accounts, entries, data, currency, today]);
  const { view, pf, cash, movements } = built;
  // ค้นหา + Show zero balances เฉพาะคอม · มือถือแสดงทุกสกุลเหมือนเดิม (ไม่เปลี่ยนหน้าตา)
  const shownRows = view === null ? [] : desktop ? filterCashRows(view.rows, { query, showZero }) : view.rows;
  const filtering = desktop && view !== null && shownRows.length < view.rows.length;

  // ลิงก์ไปหน้า Holdings: ใช้ pushState + popstate ให้ InvestMode อ่านหน้าจาก URL (ไม่แตะไฟล์กลาง)
  const goHoldings = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    window.history.pushState({ view: 'portfolio', invest: 'portfolio/holdings' }, '', investUrl('portfolio/holdings', window.location));
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const saved = async (text: string) => {
    setDialog(null);
    setMessage({ kind: 'ok', text });
    try {
      await reload();
    } catch (e) {
      setMessage({ kind: 'error', text: `Saved, but could not refresh: ${investError(e)}` });
    } finally {
      onLedgerChanged();
    }
  };

  return (
    <div className="invest-tab cs-page" lang="en">
      <div className="cs-head">
        <h2 id="cs-title" ref={titleRef} tabIndex={-1}>
          Cash
        </h2>
        <p className="cs-flash cs-rate" role="status">
          {view?.rate
            ? `Latest rate ${fxRateText(view.rate.rateMicro)} · ${formatDateEn(view.rate.date)}`
            : view !== null && view.rows.length > 1
              ? 'No exchange rate yet: values in the other currency show "Needs rate"'
              : ''}
        </p>
      </div>

      <section className="glass-lite card cs-note" aria-label="How cash works">
        <p>
          <strong>How cash works</strong>
        </p>
        <ul className="cs-list">
          <li>Money you move from your spending accounts into the portfolio is a <strong>transfer</strong>, not an expense. Buying shares takes cash out; selling and dividends put it back.</li>
          <li>Changing a balance here records money moving in or out of the portfolio. It is not income or spending.</li>
          <li>Cash is part of your wealth but is not counted in your &quot;safe to spend&quot; amount. Return figures on other pages are calculated without cash.</li>
        </ul>
      </section>

      <div role="status">{message?.kind === 'ok' && <p className="cs-flash cs-msg">{message.text}</p>}</div>
      <div role="alert">{message?.kind === 'error' && <p className="cs-flash form-error">{message.text}</p>}</div>

      {loadError !== '' ? (
        <div role="alert">
          <p className="cs-flash form-error">Could not load your records: {loadError}</p>
          <button type="button" className="iv-btn" onClick={() => void reload()}>
            Retry
          </button>
        </div>
      ) : built.failure !== '' ? (
        <p className="cs-flash form-error" role="alert">
          {built.failure}
        </p>
      ) : view === null ? null : (
        <>
          {view.warnings.map((w) => (
            <p key={w.accountId} className="cs-flash cs-warn" role="status">
              <strong>Warning:</strong> {w.name} ({w.currency}) is below zero at {minorText(w.currency, w.minor)}. Check your records: a purchase or withdrawal may be missing a deposit.
            </p>
          ))}

          {view.noAccounts ? (
            <section className="solid card cs-empty" aria-labelledby="cs-empty-title">
              <h3 id="cs-empty-title">No cash accounts yet</h3>
              <p className="muted">Create a USD cash account on the Holdings page (under Portfolio) to keep your broker cash here. Baht cash appears once a baht account is set as a portfolio account.</p>
              <a className="iv-btn iv-btn-gold" href={investUrl('portfolio/holdings', window.location)} onClick={goHoldings}>
                Go to Holdings
              </a>
            </section>
          ) : (
            <>
              <section className="solid card cs-card" aria-labelledby="cs-balances-title">
                <div className="cs-card-head">
                  <h3 id="cs-balances-title">Cash balances in {currency}</h3>
                  <button type="button" className="iv-btn iv-btn-gold" onClick={() => setDialog({ accountId: cash[0]?.accountId ?? '' })}>
                    Change balance
                  </button>
                </div>
                {view.allZero && (!desktop || showZero) && <p className="muted">All cash balances are zero for now. Use Change balance to add your broker cash.</p>}
                <div className="cs-tools">
                  <label className="cs-check">
                    <input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} />
                    Show zero balances
                  </label>
                  <div className="iv-field cs-search">
                    <label htmlFor="cs-search">Search cash balances</label>
                    <input id="cs-search" type="search" value={query} placeholder="Currency or account" autoComplete="off" onChange={(e) => setQuery(e.target.value)} />
                  </div>
                </div>
                <div role="status">
                  {desktop && shownRows.length === 0 && (
                    <p className="muted">
                      {query.trim() !== '' ? 'No cash balances match your search.' : 'No cash balances to show. Turn on Show zero balances to see currencies with a zero balance.'}
                    </p>
                  )}
                </div>
                <div className="migrate-table-wrap" role="region" aria-label="Cash balances, scrollable horizontally" tabIndex={0}>
                  <table className="migrate-table cs-table">
                    <caption className="sr-only">Cash balances by currency, shown in {currency}</caption>
                    <thead>
                      <tr>
                        <th scope="col">Currency</th>
                        <th scope="col" className="num">
                          Balance ({currency})
                        </th>
                        <th scope="col" className="num">
                          In account
                        </th>
                        <th scope="col" className="num">
                          Share of cash
                        </th>
                        <th scope="col" className="num cs-pf">
                          Share of portfolio
                        </th>
                        <th scope="col" className="num">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownRows.map((r) => (
                        <tr key={r.currency}>
                          <th scope="row">
                            <span className="cs-cur">
                              {CASH_CURRENCY_NAME[r.currency]}
                              <small>
                                {r.currency} · {r.accounts.length} {r.accounts.length === 1 ? 'account' : 'accounts'}
                              </small>
                            </span>
                          </th>
                          <td className="num">{r.displayMinor === null ? 'Needs rate' : minorText(currency, r.displayMinor)}</td>
                          <td className="num">{minorText(r.currency, r.minor)}</td>
                          <td className="num">{percentOneDecimal(r.shareBps)}</td>
                          <td className="num cs-pf">{percentOneDecimal(pf?.rows.get(r.currency) ?? null)}</td>
                          <td className="num">
                            <button type="button" className="iv-btn cs-row-btn" aria-label={`Change ${r.currency} balance`} onClick={() => setDialog({ accountId: r.accounts[0]!.accountId })}>
                              Change
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="cs-total">
                        <th scope="row">Total cash</th>
                        <td className="num">{view.totalDisplayMinor === null ? 'Needs rate' : minorText(currency, view.totalDisplayMinor)}</td>
                        <td />
                        <td className="num">{view.rows.some((r) => r.shareBps === null) ? '—' : '100%'}</td>
                        <td className="num cs-pf">{percentOneDecimal(pf?.total ?? null)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p className="muted small cs-pf-note">
                  Share of portfolio = cash ÷ (US stocks + cash), in {currency}.{filtering ? ' Totals include every currency, including the ones hidden above.' : ''}
                </p>
              </section>

              <section className="solid card cs-card" aria-labelledby="cs-moves-title">
                <div className="cs-card-head">
                  <h3 id="cs-moves-title">Money in and out of the portfolio</h3>
                </div>
                {movements.length === 0 ? (
                  <p className="muted" role="status">
                    No deposits, withdrawals, transfers or exchanges yet.
                  </p>
                ) : (
                  <div className="migrate-table-wrap" role="region" aria-label="Recent cash movements, scrollable horizontally" tabIndex={0}>
                    <table className="migrate-table cs-table">
                      <caption className="sr-only">Most recent cash movements, newest first</caption>
                      <thead>
                        <tr>
                          <th scope="col">Date</th>
                          <th scope="col">Type</th>
                          <th scope="col" className="num">
                            Amount
                          </th>
                          <th scope="col">Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {movements.map((m) => (
                          <tr key={m.entryId}>
                            <td>{formatDateEn(m.date)}</td>
                            <td>{MOVEMENT_LABEL[m.kind]}</td>
                            <td className="num">{m.legs.map((l) => signedMinorText(l.currency, l.minor)).join(' / ')}</td>
                            <td>{m.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}

      {dialog && <ChangeBalanceDialog accounts={cash} initialAccountId={dialog.accountId} today={today} onClose={() => setDialog(null)} onSaved={(t) => void saved(t)} />}
    </div>
  );
}
