import { useMemo, useState } from 'react';
import { buildReport, type ReportGrouping, type ReportPeriod, type ReportTable } from '../../../domain/invest/reportSeries';
import { buildReportCsv, GROUP_LABELS, REPORT_ROWS, reportCsvFilename, type ReportRowDef, type RowGroup } from '../../../domain/invest/reportRows';
import { Dash } from '../analysis/Dash';
import { useInvest } from '../InvestContext';
import { MAX_SERIES, seriesColor } from '../report/chartModel';
import { ReportChart } from '../report/ReportChart';
import { columnLabel, formatCell, GROUPINGS, PERIODS } from '../report/reportFormat';
import '../report/report.css';

const MISSING_TEXT = { price: 'a price', rate: 'an exchange rate' } as const;
const GROUP_ORDER = Object.keys(GROUP_LABELS) as RowGroup[];

/** ส่งออกไฟล์ในเครื่อง (Blob + ลิงก์ดาวน์โหลด) ไม่ส่งข้อมูลออกนอกเครื่อง */
function downloadCsv(table: ReportTable, asOf: string): void {
  const url = URL.createObjectURL(new Blob([buildReportCsv(table)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = reportCsvFilename(table.currency, asOf);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function cellClass(row: ReportRowDef, v: number | null, extra?: string): string {
  const tone = row.signed && v !== null ? (v > 0 ? ' an-pos' : v < 0 ? ' an-neg' : '') : '';
  return `num${extra ? ` ${extra}` : ''}${tone}`;
}

/** analytics/report · ตารางรายเดือน/ไตรมาส/ปี + กราฟแท่งของแถวที่เลือก · ตัวเลขทุกตัวมาจาก src/domain/invest/reportSeries (ไม่มีสูตรเงินในหน้านี้) */
export function ReportPage({ onHome: _onHome }: { onHome: () => void }) {
  const { data, today, currency } = useInvest();
  const [grouping, setGrouping] = useState<ReportGrouping>('monthly');
  const [period, setPeriod] = useState<ReportPeriod>('all');
  const [selected, setSelected] = useState<string[]>([]);

  const built = useMemo(() => {
    if (data === null) return { table: null, failed: false };
    try {
      const table = buildReport(data, today, currency, grouping, period);
      for (const c of [...table.columns, ...(table.total ? [table.total] : [])]) for (const row of REPORT_ROWS) row.pick(c); // ค่าที่เกินช่วงปลอดภัย (เช่น Turnover) โยน RangeError ที่นี่ ไม่ใช่ตอน render
      return { table, failed: false };
    } catch (e) {
      if (e instanceof RangeError) return { table: null, failed: true };
      throw e;
    }
  }, [data, today, currency, grouping, period]);
  const table = built.table;

  const toggle = (id: string): void => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= MAX_SERIES ? s : [...s, id]));

  return (
    <div className="invest-tab invest-report">
      <header className="an-head">
        <h2 id="inv-report-title">Analytics · Report</h2>
        <p className="muted">Period-by-period results of your US stocks. Every figure is calculated from your recorded transactions and prices.</p>
      </header>
      {built.failed ? (
        <p className="form-error" role="alert">
          Cannot calculate: a number is larger than the supported range.
        </p>
      ) : table === null ? (
        <p className="muted" role="status">
          Loading portfolio data…
        </p>
      ) : (
        <>
          <section className="solid card rp-controls rp-noprint" aria-label="Report options">
            <div className="rp-group" role="group" aria-label="Time grouping">
              {GROUPINGS.map((g) => (
                <button key={g.id} type="button" className={`iv-seg-btn${grouping === g.id ? ' is-active' : ''}`} aria-pressed={grouping === g.id} onClick={() => setGrouping(g.id)}>
                  {g.label}
                </button>
              ))}
            </div>
            <label className="rp-period">
              <span className="muted">Time period</span>
              <select value={period} onChange={(e) => setPeriod(e.target.value as ReportPeriod)}>
                {PERIODS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="rp-actions">
              <button type="button" className="iv-btn" disabled={table.columns.length === 0} onClick={() => downloadCsv(table, today)}>
                Export to Excel (.csv)
              </button>
              <button type="button" className="iv-btn" disabled={table.columns.length === 0} onClick={() => window.print()}>
                Export to PDF
              </button>
            </div>
          </section>

          {table.columns.length === 0 ? (
            <section className="solid card an-card" aria-labelledby="rp-empty-title">
              <h3 id="rp-empty-title">Nothing to report yet</h3>
              <p className="muted">Add a US stock and record a purchase under Portfolio → Holdings. Months with no shares and no transactions are skipped.</p>
            </section>
          ) : (
            <div className="rp-print">
              <h2 className="rp-print-title">Portfolio report · {table.currency}</h2>
              {table.incomplete && (
                <p className="rp-note" role="status" data-testid="report-incomplete">
                  Some figures are missing {table.missing.map((m) => MISSING_TEXT[m]).join(' and ')} for a month, so they show as — instead of 0. A total shows — if any month in the period cannot be calculated.
                </p>
              )}
              <section className="solid card" aria-labelledby="rp-chart-title">
                <div className="an-card-head">
                  <h3 id="rp-chart-title">Compare rows</h3>
                  <button type="button" className="iv-btn rp-noprint" disabled={selected.length === 0} onClick={() => setSelected([])}>
                    Clear all
                  </button>
                </div>
                {selected.length === 0 ? (
                  <p className="muted rp-noprint" data-testid="report-chart-hint">
                    Select the names of rows in the table (up to 4) to compare them as bars.
                  </p>
                ) : (
                  <ReportChart table={table} grouping={grouping} currency={currency} selected={selected} />
                )}
                {selected.length >= MAX_SERIES && (
                  <p className="muted small rp-noprint" role="status" data-testid="report-max-note">
                    You can compare up to {MAX_SERIES} rows. Clear one to pick another.
                  </p>
                )}
              </section>

              <section className="solid card rp-table-card" aria-labelledby="rp-table-title">
                <h3 id="rp-table-title" className="sr-only">
                  Report table
                </h3>
                <div className="migrate-table-wrap" tabIndex={0} role="region" aria-label="Report table, scrolls sideways">
                  <table className="rp-table">
                    <thead>
                      <tr>
                        <th scope="col">Metric</th>
                        {table.columns.map((c) => (
                          <th key={c.key} scope="col" className="num">
                            {columnLabel(c.key, grouping)}
                          </th>
                        ))}
                        <th scope="col" className="num rp-total">
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {GROUP_ORDER.flatMap((g) => [
                        ...(g === 'market'
                          ? []
                          : [
                              <tr key={`g-${g}`} className="rp-group-row">
                                <th scope="colgroup" colSpan={table.columns.length + 2}>
                                  {GROUP_LABELS[g]}
                                </th>
                              </tr>,
                            ]),
                        ...REPORT_ROWS.filter((r) => r.group === g).map((row) => {
                          const idx = selected.indexOf(row.id);
                          const cell = (v: number | null, key: string, extra?: string) => (
                            <td key={key} className={cellClass(row, v, extra)}>
                              {row.unit === 'market' ? <span className="muted">Needs market data</span> : v === null ? <Dash why="Needs a price or exchange rate" /> : formatCell(row, v, table.currency)}
                            </td>
                          );
                          return (
                            <tr key={row.id} data-row={row.id}>
                              <th scope="row">
                                {row.unit === 'market' ? (
                                  <span className="rp-name rp-name-static" title={row.hint}>
                                    {row.label}
                                  </span>
                                ) : (
                                  <>
                                    <button type="button" className={`rp-name${idx >= 0 ? ' is-on' : ''}`} aria-pressed={idx >= 0} aria-describedby={`rp-hint-${row.id}`} title={row.hint} onClick={() => toggle(row.id)}>
                                      <span className="rp-swatch" style={idx >= 0 ? { background: seriesColor(idx) } : undefined} aria-hidden="true" />
                                      {idx >= 0 && (
                                        <span className="rp-num" aria-hidden="true">
                                          {idx + 1}
                                        </span>
                                      )}
                                      {row.label}
                                    </button>
                                    <span id={`rp-hint-${row.id}`} className="sr-only">
                                      {row.hint}
                                    </span>
                                  </>
                                )}
                              </th>
                              {table.columns.map((c) => cell(row.pick(c), c.key))}
                              {table.total && cell(row.pick(table.total), 'total', 'rp-total')}
                            </tr>
                          );
                        }),
                      ])}
                    </tbody>
                  </table>
                </div>
                <p className="muted small">
                  {currency === 'USD' ? 'US dollars. Currency (FX) is not available in this view.' : 'Thai baht. Currency (FX) is the gain or loss from the exchange rate.'} Total profit, % chains the months (a quarter, year or Total is not a simple sum).
                </p>
                <details className="rp-guide rp-noprint">
                  <summary>What do the rows mean?</summary>
                  <dl>
                    {REPORT_ROWS.map((r) => (
                      <div key={r.id}>
                        <dt>{r.label}</dt>
                        <dd className="muted">{r.hint}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
