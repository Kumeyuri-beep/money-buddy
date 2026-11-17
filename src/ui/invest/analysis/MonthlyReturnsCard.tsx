import { Dash } from './Dash';
import type { AnalysisModel } from './analysisModel';
import { MONTHS_SHORT, naReasonText, signedPercentBps, toneOf } from './format';

/** ตารางผลตอบแทนรายเดือน (Modified Dietz · R25.4): แถว = ปี คอลัมน์ ม.ค.-ธ.ค. + ทั้งปี · เซลล์เขียว/แดงพร้อมเครื่องหมาย +/- · null = "—" พร้อมเหตุผล */
export function MonthlyReturnsCard({ model }: { model: AnalysisModel }) {
  return (
    <section className="solid card an-card" aria-labelledby="an-mon-title">
      <h2 id="an-mon-title">Monthly returns</h2>
      {model.monthly.length === 0 ? (
        <p className="muted">No returns to show yet. Once you have US stocks and purchases, the table appears here.</p>
      ) : (
        <>
          <div className="migrate-table-wrap" role="region" aria-label="Monthly returns table, scrolls horizontally" tabIndex={0}>
            <table className="migrate-table an-table an-months">
              <caption className="sr-only">Monthly and full-year returns of the US stock portfolio, in percent, measured in THB</caption>
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  {MONTHS_SHORT.map((m) => (
                    <th key={m} scope="col" className="num">
                      {m}
                    </th>
                  ))}
                  <th scope="col" className="num">
                    Full year
                  </th>
                </tr>
              </thead>
              <tbody>
                {model.monthly.map((y) => (
                  <tr key={y.year}>
                    <th scope="row">{y.year}</th>
                    {y.cells.map((c, i) => (
                      <td key={i} className={`num an-cell${c.kind === 'ok' ? ` an-cell-${toneOf(c.bps)}` : ''}`}>
                        {c.kind === 'ok' ? signedPercentBps(c.bps) : c.kind === 'na' ? <Dash why={naReasonText(c.reason)} /> : <span className="sr-only">Month not reached yet</span>}
                      </td>
                    ))}
                    <td className={`num an-cell an-total${y.total === null ? '' : ` an-cell-${toneOf(y.total)}`}`}>
                      {y.total === null ? <Dash why="A month cannot be calculated, so the full year cannot be totalled" /> : signedPercentBps(y.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Returns are time-weighted by the dates cash moved in and out, in THB, including dividends after tax. "—" means it cannot be calculated; the app never guesses.</p>
        </>
      )}
    </section>
  );
}
