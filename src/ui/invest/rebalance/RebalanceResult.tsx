import { usd, usdPrice } from '../../../app/usdFormat';
import { bpsText, REBALANCE_DISCLAIMER, REBALANCE_RESULT_TITLE, REBALANCE_TRADES_TITLE, type RebalanceView } from '../../../domain/invest/rebalanceView';

interface Props {
  /** ไม่คำนวณ: เหตุผลเป็นข้อความ (ไม่เดา) */
  notCalculated: string | null;
  view: RebalanceView | null;
  allowSales: boolean;
  /** อินพุตเปลี่ยนไปจากตอนกด See result */
  stale: boolean;
  onExport: () => void;
}

const mark = (bps: number | null): string => (bps === null ? '—' : `${bpsText(bps)}%`);

/**
 * ผลลัพธ์ (Result) ของหน้า Rebalancing: ตัวเลขทุกตัวมาจาก rebalance() ผ่าน buildRebalanceView · ไม่มีสูตรเงินในคอมโพเนนต์
 * ข้อความบังคับติดกับ Result ทุกครั้ง · ไม่มีปุ่มสร้างรายการซื้อขาย ไม่เขียนสมุด/ฐานข้อมูล
 * ตารางและรายการพื้นทึบ (ไม่ใช่กระจก)
 */
export function RebalanceResult({ notCalculated, view, allowSales, stale, onExport }: Props) {
  return (
    <section className="iv-card rb-result" aria-labelledby="rb-result-title" aria-live="polite">
      <div className="rb-result-head">
        <div>
          <h3 id="rb-result-title">{REBALANCE_RESULT_TITLE}</h3>
          <p className="rb-sub">{REBALANCE_TRADES_TITLE}</p>
        </div>
        {view !== null && (
          <button type="button" className="iv-btn" onClick={onExport}>
            Export CSV
          </button>
        )}
      </div>
      {stale && <p className="rb-stale">Inputs changed. Press See result to update.</p>}
      {notCalculated !== null && (
        <p className="rb-notcalc" role="status">
          <strong>Not calculated.</strong> {notCalculated}
        </p>
      )}
      {view !== null && (
        <>
          {view.warnings.length > 0 && (
            <ul className="rb-warnings" aria-label="Notes">
              {view.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {view.noTrades ? (
            <p className="iv-empty">{view.alreadyAtTargets ? 'Already at your targets. No trades are needed.' : 'No trades to show for these inputs.'}</p>
          ) : (
            <div className="migrate-table-wrap rb-wrap" role="region" aria-label="Trades table, scrollable horizontally" tabIndex={0}>
              <table className="migrate-table rb-table">
                <caption className="sr-only">Trades needed to reach your target, in USD. Shares are rounded down; the amount is calculated from the shares shown.</caption>
                <thead>
                  <tr>
                    <th scope="col">Holding</th>
                    <th scope="col">Category</th>
                    <th scope="col">Action</th>
                    <th scope="col" className="num">Price</th>
                    <th scope="col" className="num">Shares</th>
                    <th scope="col" className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {view.trades.map((t) => (
                    <tr key={`${t.side}-${t.holdingId}`} className={`rb-row is-${t.side}`}>
                      <th scope="row">
                        <span className="rb-name">{t.ticker}</span>
                        <span className="rb-subtext">{t.name}</span>
                      </th>
                      <td>{t.categoryName}</td>
                      <td>{t.side === 'buy' ? 'Buy' : 'Sell'}</td>
                      <td className="num">
                        {usdPrice(t.priceMicro)}
                        <span className="rb-subtext">{t.priceDate === null ? 'No date' : `as of ${t.priceDate}`}</span>
                      </td>
                      <td className="num rb-strong">{t.sharesText}</td>
                      <td className="num rb-strong">{usd(t.cents)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {view.buyTotalCents > 0 && (
                    <tr>
                      <th scope="row" colSpan={5}>Total buy</th>
                      <td className="num rb-strong">{usd(view.buyTotalCents)}</td>
                    </tr>
                  )}
                  {view.sellTotalCents > 0 && (
                    <tr>
                      <th scope="row" colSpan={5}>Total sell</th>
                      <td className="num rb-strong">{usd(view.sellTotalCents)}</td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          )}
          <dl className="rb-totals">
            {view.mode === 'deposit' ? (
              <div>
                <dt>Left over</dt>
                <dd>{usd(view.leftOverCents)}</dd>
              </div>
            ) : (
              <div>
                <dt>Short by</dt>
                <dd>{usd(view.shortByCents)}</dd>
              </div>
            )}
          </dl>
          {view.dropped.length > 0 && (
            <div className="rb-dropped">
              <h4>Not traded</h4>
              <ul>
                {view.dropped.map((d) => (
                  <li key={d.holdingId}>
                    <strong>{d.ticker}</strong> ({d.categoryName}): {d.reasonText}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="migrate-table-wrap rb-wrap" role="region" aria-label="Allocation table, scrollable horizontally" tabIndex={0}>
            <table className="migrate-table rb-table rb-cats">
              <caption className="rb-cat-caption">
                Allocation before and after
                {!allowSales && <span className="rb-subtext"> After shows the closest you can get without selling. It can differ from your target.</span>}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col" className="num">Now</th>
                  <th scope="col" className="num">Target</th>
                  <th scope="col" className="num">{allowSales ? 'After' : 'After (closest without selling)'}</th>
                </tr>
              </thead>
              <tbody>
                {view.categories.map((c) => (
                  <tr key={c.categoryId}>
                    <th scope="row">{c.name}</th>
                    <td className="num">
                      {mark(c.nowBps)}
                      <span className="rb-subtext">{usd(c.nowCents)}</span>
                    </td>
                    <td className="num">{bpsText(c.targetBps)}%</td>
                    <td className="num">
                      {mark(c.afterBps)}
                      <span className="rb-subtext">{usd(c.afterCents)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="rb-disclaimer">{REBALANCE_DISCLAIMER}</p>
    </section>
  );
}
