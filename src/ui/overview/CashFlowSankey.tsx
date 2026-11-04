import { useMemo, useState } from 'react';
import { thaiMonthKeyLabel } from '../../app/dates';
import { formatPercentBps } from '../../app/overviewFormat';
import { buildCashFlow, cashFlowMonths } from '../../domain/ledger/sankey';
import type { FlowNode } from '../../domain/ledger/sankey';
import type { Account, Entry } from '../../domain/ledger/types';
import { formatBaht, satang } from '../../domain/money/satang';
import { stackColumn } from './sankeyLayout';
import type { Placed } from './sankeyLayout';

interface CashFlowSankeyProps {
  accounts: readonly Account[];
  entries: readonly Entry[];
  /** YYYY-MM-DD ตามเวลาเครื่อง */
  today: string;
}

/** สีหมวดตามโทเคนดีไซน์ A หมวดที่ไม่มีสีกำหนดวนใช้สีสำรอง สีไม่ใช่ตัวบอกความหมายเดียว (มีป้ายชื่อและยอดกำกับ) */
const CATEGORY_COLORS: Record<string, string> = {
  บิลประจำ: '#A99BFF',
  บิล: '#A99BFF',
  อาหาร: '#FF8F82',
  เดินทาง: '#FFB86B',
  ช้อปปิ้ง: '#FF7EB6',
  อื่นๆ: '#9AA0B4',
  เหลือเก็บ: '#6FD9A8',
};
const FALLBACK_COLORS = ['#8FB8FF', '#C9A7FF', '#7FE0E0', '#E5D27A'];
const INCOME_COLOR = '#6FD9A8';
const SHORTFALL_COLOR = '#FFB86B';
const MID_COLOR = '#F2D06B';

function colorOf(node: FlowNode, index: number): string {
  if (node.kind === 'income') return INCOME_COLOR;
  if (node.kind === 'shortfall') return SHORTFALL_COLOR;
  return CATEGORY_COLORS[node.name] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length] ?? '#9AA0B4';
}

// ขนาดวาด (หน่วยพิกเซลของ viewBox)
const W = 1000;
const PAD_TOP = 8;
const AVAILABLE = 300;
const MIN_BAR = 8;
const GAP = 12;
const BAR_W = 16;
const X_LEFT = 250;
const X_MID = 492;
const X_RIGHT = 734;

function ribbon(x0: number, y0: number, h0: number, x1: number, y1: number, h1: number): string {
  const xm = (x0 + x1) / 2;
  return `M${x0} ${y0} C${xm} ${y0},${xm} ${y1},${x1} ${y1} L${x1} ${y1 + h1} C${xm} ${y1 + h1},${xm} ${y0 + h0},${x0} ${y0 + h0} Z`;
}

function amountText(node: FlowNode): string {
  return `${formatBaht(satang(node.amount))} · ${formatPercentBps(node.shareBps)}`;
}

function Label({ x, anchor, placed }: { x: number; anchor: 'start' | 'end'; placed: Placed }) {
  const mid = PAD_TOP + placed.y + placed.h / 2;
  return (
    <text className="sankey-label" x={x} y={mid} textAnchor={anchor}>
      <tspan x={x} dy="-0.2em" className="sankey-name">
        {placed.node.name}
      </tspan>
      <tspan x={x} dy="1.35em" className="sankey-amount">
        {amountText(placed.node)}
      </tspan>
    </text>
  );
}

export function CashFlowSankey({ accounts, entries, today }: CashFlowSankeyProps) {
  const months = useMemo(() => cashFlowMonths(accounts, entries), [accounts, entries]);
  const [picked, setPicked] = useState<string | null>(null);
  const thisMonth = today.slice(0, 7);
  const month = picked !== null && months.includes(picked) ? picked : months.includes(thisMonth) ? thisMonth : months[0];

  const flow = useMemo(() => {
    if (month === undefined) return null;
    try {
      return buildCashFlow(accounts, entries, month, today, { groupBills: true });
    } catch (error) {
      // ยอดใหญ่เกินช่วงปลอดภัย (RangeError) ไม่ให้ทั้งหน้าภาพรวมพัง
      if (error instanceof RangeError) return 'too-large' as const;
      throw error;
    }
  }, [accounts, entries, month, today]);

  if (flow === 'too-large') {
    return (
      <section className="glass-lite card sankey" aria-labelledby="sankey-title">
        <h2 id="sankey-title">Cash Flow</h2>
        <p className="summary-empty">ยอดสูงเกินกว่าจะแสดงกราฟได้</p>
        <p className="muted small">ยอดรวมของเดือนนี้ใหญ่เกินช่วงที่คำนวณได้อย่างแม่นยำ</p>
      </section>
    );
  }

  if (month === undefined || flow === null || !flow.hasData) {
    return (
      <section className="glass-lite card sankey" aria-labelledby="sankey-title">
        <h2 id="sankey-title">Cash Flow</h2>
        <p className="summary-empty">ยังไม่มีรายรับหรือรายจ่าย</p>
        <p className="muted small">เมื่อบันทึกรายรับรายจ่าย เส้นทางของเงินในเดือนนั้นจะแสดงที่นี่</p>
      </section>
    );
  }

  const left = stackColumn(flow.sources, AVAILABLE, MIN_BAR, GAP);
  const right = stackColumn(flow.categories, AVAILABLE, MIN_BAR, GAP);
  const midHeight = Math.max(left.filled, right.filled);
  const bodyHeight = Math.max(left.height, right.height, midHeight);
  const H = bodyHeight + PAD_TOP + 28;

  let leftCursor = 0;
  let rightCursor = 0;
  const leftRibbons = left.placed.map((p, i) => {
    const d = ribbon(X_LEFT + BAR_W, PAD_TOP + p.y, p.h, X_MID, PAD_TOP + leftCursor, p.h);
    leftCursor += p.h;
    return <path key={p.node.key} d={d} fill={colorOf(p.node, i)} fillOpacity={0.35} />;
  });
  const rightRibbons = right.placed.map((p, i) => {
    const d = ribbon(X_MID + BAR_W, PAD_TOP + rightCursor, p.h, X_RIGHT, PAD_TOP + p.y, p.h);
    rightCursor += p.h;
    return <path key={p.node.key} d={d} fill={colorOf(p.node, i)} fillOpacity={0.35} />;
  });

  const overspend = flow.shortfall > 0;
  const summary =
    `Cash Flow ${thaiMonthKeyLabel(month)}: รายรับ ${formatBaht(satang(flow.income))} ` +
    `รายจ่าย ${formatBaht(satang(flow.expense))} ` +
    (overspend ? `ใช้เกินรายรับ ${formatBaht(satang(flow.shortfall))}` : `เหลือเก็บ ${formatBaht(satang(flow.leftover))}`);

  return (
    <section className="glass-lite card sankey" aria-labelledby="sankey-title">
      <div className="sankey-head">
        <h2 id="sankey-title">Cash Flow</h2>
        <div className="field sankey-month">
          <label htmlFor="sankey-month">เดือน</label>
          <select id="sankey-month" value={month} onChange={(e) => setPicked(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {thaiMonthKeyLabel(m)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ul className="sankey-chips" aria-label="สรุปเดือนที่เลือก">
        <li className="chip">รายรับ {formatBaht(satang(flow.income))}</li>
        <li className="chip">รายจ่าย {formatBaht(satang(flow.expense))}</li>
        <li className="chip">
          {overspend ? '⚠ ใช้เกินรายรับ' : '✓ เหลือเก็บ'} {formatBaht(satang(overspend ? flow.shortfall : flow.leftover))}
        </li>
      </ul>

      <svg className="sankey-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
        <g aria-hidden="true">
          {leftRibbons}
          {rightRibbons}
          {left.placed.map((p, i) => (
            <rect key={p.node.key} x={X_LEFT} y={PAD_TOP + p.y} width={BAR_W} height={p.h} rx={4} fill={colorOf(p.node, i)} />
          ))}
          <rect x={X_MID} y={PAD_TOP} width={BAR_W} height={midHeight} rx={4} fill={MID_COLOR} />
          {right.placed.map((p, i) => (
            <rect key={p.node.key} x={X_RIGHT} y={PAD_TOP + p.y} width={BAR_W} height={p.h} rx={4} fill={colorOf(p.node, i)} />
          ))}
          {left.placed.map((p) => (
            <Label key={p.node.key} x={X_LEFT - 12} anchor="end" placed={p} />
          ))}
          {right.placed.map((p) => (
            <Label key={p.node.key} x={X_RIGHT + BAR_W + 12} anchor="start" placed={p} />
          ))}
          <text className="sankey-label" x={X_MID + BAR_W / 2} y={PAD_TOP + midHeight + 20} textAnchor="middle">
            งบรวมเดือนนี้
          </text>
        </g>
      </svg>

      <table className="sr-only">
        <caption>{summary}</caption>
        <thead>
          <tr>
            <th scope="col">ฝั่ง</th>
            <th scope="col">รายการ</th>
            <th scope="col">จำนวนเงิน</th>
            <th scope="col">สัดส่วน</th>
          </tr>
        </thead>
        <tbody>
          {flow.sources.map((n) => (
            <tr key={n.key}>
              <td>แหล่งเงิน</td>
              <td>{n.name}</td>
              <td>{formatBaht(satang(n.amount))}</td>
              <td>{formatPercentBps(n.shareBps)}</td>
            </tr>
          ))}
          {flow.categories.map((n) => (
            <tr key={n.key}>
              <td>ปลายทาง</td>
              <td>{n.name}</td>
              <td>{formatBaht(satang(n.amount))}</td>
              <td>{formatPercentBps(n.shareBps)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
