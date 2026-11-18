import { useMemo } from 'react';
import { REPORT_ROWS, type ReportRowDef, type RowUnit } from '../../../domain/invest/reportRows';
import type { ReportCurrency, ReportGrouping, ReportTable } from '../../../domain/invest/reportSeries';
import { buildChartModel, CHART_PAD, seriesColor } from './chartModel';
import { columnLabel, formatCell } from './reportFormat';

const UNIT_TITLES: Record<RowUnit, string> = { money: 'Amounts', bps: 'Returns (%)', count: 'Trade counts', market: '' };
const patId = (unit: string, i: number): string => `rp-pat-${unit}-${i}`;

/** ลวดลายของชุดที่ 2 ขึ้นไป (ชุดที่ 1 ทึบ) ให้แยกชุดได้โดยไม่พึ่งสีอย่างเดียว */
function Pattern({ id, color, index }: { id: string; color: string; index: number }) {
  const ink = 'var(--surface-solid)';
  return (
    <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse">
      <rect width="6" height="6" fill={color} />
      {index === 1 && <path d="M-1 7 L7 -1 M-1 1 L1 -1 M5 7 L7 5" stroke={ink} strokeWidth="1.6" />}
      {index === 2 && <circle cx="3" cy="3" r="1.2" fill={ink} />}
      {index === 3 && <path d="M3 0 V6 M0 3 H6" stroke={ink} strokeWidth="1.2" />}
    </pattern>
  );
}

/** กราฟแท่งของแถวที่เลือก · แยกตามชนิดหน่วย (เงิน / % / จำนวนครั้ง) ไม่ปนกันในแกนเดียว · ชุดแยกด้วยเลขลำดับ สี และลวดลาย */
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
        const label = `${UNIT_TITLES[unit]} by ${per}: ${rows.map((r) => `${selected.indexOf(r.id) + 1}. ${r.label}`).join(', ')}`;
        const groupW = (model.width - CHART_PAD.left - CHART_PAD.right) / Math.max(1, cols.length);
        const step = Math.max(1, Math.ceil(64 / groupW));
        const first = rows[0]!;
        const ticks = [
          { v: model.max, y: CHART_PAD.top },
          { v: 0, y: model.zeroY },
          { v: model.min, y: model.height - CHART_PAD.bottom },
        ].filter((t, i, a) => a.findIndex((u) => u.v === t.v) === i);
        const fillFor = (order: number, id: string): string => (order === 0 ? seriesColor(selected.indexOf(id)) : `url(#${patId(unit, order)})`);
        return (
          <figure key={unit} className="rp-chart" data-testid={`report-chart-${unit}`}>
            <figcaption className="rp-legend">
              {rows.map((r, order) => (
                <span key={r.id} className="rp-legend-item" data-testid="report-legend-item">
                  <svg className="rp-legend-swatch" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                    <rect width="14" height="14" rx="3" fill={fillFor(order, r.id)} />
                  </svg>
                  <span className="rp-num" aria-hidden="true">
                    {selected.indexOf(r.id) + 1}
                  </span>
                  <span>
                    {r.label}
                    <span className="rp-legend-hint muted">{r.hint}</span>
                  </span>
                </span>
              ))}
            </figcaption>
            <div className="rp-chart-scroll">
              <svg role="img" aria-label={`${label}. The table below has the exact numbers.`} width={model.width} height={model.height} viewBox={`0 0 ${model.width} ${model.height}`}>
                <defs>
                  {rows.map((r, order) => (order === 0 ? null : <Pattern key={r.id} id={patId(unit, order)} color={seriesColor(selected.indexOf(r.id))} index={order} />))}
                </defs>
                <line x1={CHART_PAD.left} x2={model.width} y1={model.zeroY} y2={model.zeroY} className="rp-zero" />
                {ticks.map((t) => (
                  <text key={t.v} x={CHART_PAD.left - 8} y={t.y + 4} textAnchor="end" className="rp-axis" data-testid="report-y-label">
                    {t.v === 0 ? '0' : formatCell(first, t.v, currency)}
                  </text>
                ))}
                {model.bars.map((b) => {
                  const order = rows.findIndex((r) => r.id === b.seriesId);
                  const row = rows[order]!;
                  return (
                    <rect key={`${b.seriesId}-${b.column}`} x={b.x} y={b.y} width={b.width} height={b.height} rx={1.5} fill={fillFor(order, b.seriesId)} data-series={b.seriesId}>
                      <title>{`${row.label} · ${columnLabel(cols[b.column]!.key, grouping)}: ${formatCell(row, b.value, currency)}`}</title>
                    </rect>
                  );
                })}
                {cols.map((c, i) =>
                  i % step === 0 ? (
                    <text key={c.key} x={CHART_PAD.left + i * groupW + groupW / 2} y={model.height - 10} textAnchor="middle" className="rp-axis">
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
