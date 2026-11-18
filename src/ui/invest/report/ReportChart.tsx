import { useMemo } from 'react';
import { REPORT_ROWS, type ReportRowDef, type RowUnit } from '../../../domain/invest/reportRows';
import type { ReportCurrency, ReportGrouping, ReportTable } from '../../../domain/invest/reportSeries';
import { buildChartModel, CHART_PAD, seriesColor } from './chartModel';
import { columnLabel, formatCell } from './reportFormat';

const UNIT_TITLES: Record<RowUnit, string> = { money: 'Amounts', bps: 'Returns (%)', count: 'Trade counts', market: '' };

/** กราฟแท่งของแถวที่เลือก · แยกตามชนิดหน่วย (เงิน / % / จำนวนครั้ง) ไม่ปนกันในแกนเดียว · สีของแถวตรงกับที่เลือกในตาราง */
export function ReportChart({ table, grouping, currency, selected }: { table: ReportTable; grouping: ReportGrouping; currency: ReportCurrency; selected: readonly string[] }) {
  const units = useMemo(() => {
    const out: { unit: RowUnit; rows: ReportRowDef[] }[] = [];
    for (const id of selected) {
      const row = REPORT_ROWS.find((r) => r.id === id);
      if (!row || row.unit === 'market') continue;
      const slot = out.find((u) => u.unit === row.unit);
      if (slot) slot.rows.push(row);
      else out.push({ unit: row.unit, rows: [row] });
    }
    return out;
  }, [selected]);

  if (units.length === 0) return null;
  const cols = table.columns;
  const per = grouping === 'monthly' ? 'month' : grouping === 'quarterly' ? 'quarter' : 'year';
  return (
    <div className="rp-charts">
      {units.map(({ unit, rows }) => {
        const model = buildChartModel(
          rows.map((r) => ({ id: r.id, values: cols.map((c) => r.pick(c)) })),
          cols.length,
        );
        const label = `${UNIT_TITLES[unit]} by ${per}: ${rows.map((r) => r.label).join(', ')}`;
        const groupW = (model.width - CHART_PAD.left - CHART_PAD.right) / Math.max(1, cols.length);
        const step = Math.max(1, Math.ceil(56 / groupW));
        return (
          <figure key={unit} className="rp-chart" data-testid={`report-chart-${unit}`}>
            <figcaption className="rp-legend">
              {rows.map((r) => (
                <span key={r.id} className="rp-legend-item" data-testid="report-legend-item">
                  <span className="rp-swatch" style={{ background: seriesColor(selected.indexOf(r.id)) }} aria-hidden="true" />
                  {r.label}
                </span>
              ))}
            </figcaption>
            <div className="rp-chart-scroll">
              <svg role="img" aria-label={`${label}. The table below has the exact numbers.`} width={model.width} height={model.height} viewBox={`0 0 ${model.width} ${model.height}`}>
                <line x1={0} x2={model.width} y1={model.zeroY} y2={model.zeroY} className="rp-zero" />
                {model.bars.map((b) => {
                  const row = rows.find((r) => r.id === b.seriesId)!;
                  return (
                    <rect key={`${b.seriesId}-${b.column}`} x={b.x} y={b.y} width={b.width} height={b.height} rx={1.5} fill={seriesColor(selected.indexOf(b.seriesId))} data-series={b.seriesId}>
                      <title>{`${row.label} · ${columnLabel(cols[b.column]!.key, grouping)}: ${formatCell(row, b.value, currency)}`}</title>
                    </rect>
                  );
                })}
                {cols.map((c, i) =>
                  i % step === 0 ? (
                    <text key={c.key} x={CHART_PAD.left + i * groupW + groupW / 2} y={model.height - 8} textAnchor="middle" className="rp-axis">
                      {columnLabel(c.key, grouping)}
                    </text>
                  ) : null,
                )}
              </svg>
            </div>
          </figure>
        );
      })}
    </div>
  );
}
