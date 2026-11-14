import { useEffect, useMemo, useState } from 'react';
import { shortLabel, type CashFlowView } from '../../app/cashFlowView';
import { friendlyError } from '../../app/errorText';
import { thaiMonthKeyLabel } from '../../app/dates';
import { formatPercentBps } from '../../app/overviewFormat';
import { buildCashFlow, cashFlowMonths } from '../../domain/ledger/sankey';
import type { FlowNode } from '../../domain/ledger/sankey';
import type { Account, Entry } from '../../domain/ledger/types';
import { formatBaht, satang } from '../../domain/money/satang';
import { chartColor, type ChartColorKey } from '../chartColors';
import { stackColumn } from './sankeyLayout';
import type { Placed } from './sankeyLayout';

interface CashFlowSankeyProps {
  accounts: readonly Account[];
  entries: readonly Entry[];
  /** YYYY-MM-DD ตามเวลาเครื่อง */
  today: string;
  /** มุมมองบนมือถือที่จำไว้ใน settings (ค่าเริ่มต้น 'diagram') */
  view?: CashFlowView;
  /** บันทึกมุมมองที่เลือก (ไม่ส่ง = สลับได้แต่ไม่จำ) */
  onViewChange?: (view: CashFlowView) => Promise<void> | void;
}

/** สีหมวดตามโทเคนดีไซน์ A หมวดที่ไม่มีสีกำหนดวนใช้สีสำรอง สีไม่ใช่ตัวบอกความหมายเดียว (มีป้ายชื่อและยอดกำกับ) */
const CATEGORY_COLOR_KEYS: Record<string, ChartColorKey> = {
  บิลประจำ: 'catBill',
  บิล: 'catBill',
  อาหาร: 'catFood',
  เดินทาง: 'catTravel',
  ช้อปปิ้ง: 'catShopping',
  อื่นๆ: 'catOther',
  เหลือเก็บ: 'catSaved',
};
const FALLBACK_COLOR_KEYS: readonly ChartColorKey[] = ['fb1', 'fb2', 'fb3', 'fb4'];

/** สีโหนด: อ่านจากตัวแปร CSS ของธีมที่ใช้อยู่ (src/ui/chartColors.ts) */
function colorOf(node: FlowNode, index: number): string {
  if (node.kind === 'income') return chartColor('income');
  if (node.kind === 'shortfall') return chartColor('shortfall');
  const key = CATEGORY_COLOR_KEYS[node.name] ?? FALLBACK_COLOR_KEYS[index % FALLBACK_COLOR_KEYS.length] ?? 'catOther';
  return chartColor(key);
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

// แผนภาพกะทัดรัดสำหรับมือถือ (viewBox กว้าง 300 ไม่มี min-width จึงไม่ต้องเลื่อนแนวนอน): ป้ายสั้น (ชื่อย่อ + %) แตะแท่งเพื่อดูยอด
const CW = 270; // ≈ ความกว้างใช้งานของการ์ดที่ 360px จึงวาดขนาดจริง 1:1 (ฟอนต์ 12px อ่านได้)
const C_AVAILABLE = 240;
const C_MIN_BAR = 14;
const C_GAP = 20;
const C_BAR_W = 12;
const C_LEFT = 76;
const C_MID = 129;
const C_RIGHT = 182;
const C_NAME_MAX = 8;
const HIT_H = 32;

function CompactLabel({ x, anchor, placed, selected }: { x: number; anchor: 'start' | 'end'; placed: Placed; selected: boolean }) {
  const mid = PAD_TOP + placed.y + placed.h / 2;
  return (
    <text className="sankey-label sankey-label-sm" x={x} y={mid} textAnchor={anchor} pointerEvents="none">
      <tspan x={x} dy="-0.2em" className={selected ? 'sankey-name sankey-name-selected' : 'sankey-name'}>
        {shortLabel(placed.node.name, C_NAME_MAX)}
      </tspan>
      <tspan x={x} dy="1.3em" className="sankey-amount">
        {formatPercentBps(placed.node.shareBps)}
      </tspan>
    </text>
  );
}

export function CashFlowSankey({ accounts, entries, today, view: savedView = 'diagram', onViewChange }: CashFlowSankeyProps) {
  // มุมมองบนมือถือ: แสดงทันทีที่แตะ แล้วค่อยบันทึก (ค่าที่จำไว้เปลี่ยน = ตามค่านั้น)
  const [view, setView] = useState<CashFlowView>(savedView);
  const [viewNote, setViewNote] = useState('');
  useEffect(() => setView(savedView), [savedView]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const chooseView = async (next: CashFlowView) => {
    setView(next);
    setViewNote('');
    try {
      await onViewChange?.(next);
    } catch (e) {
      setViewNote(`ใช้มุมมองนี้ในหน้านี้ แต่บันทึกไม่สำเร็จ (${friendlyError(e, 'ลองอีกครั้ง')})`);
    }
  };
  const monthsResult = useMemo(() => {
    try {
      return cashFlowMonths(accounts, entries);
    } catch (error) {
      // cashFlowMonths รวมยอดรายบัญชี: เกินช่วงปลอดภัยโยน RangeError ต้องไม่ล้มใน render
      if (error instanceof RangeError) return 'too-large' as const;
      throw error;
    }
  }, [accounts, entries]);
  const months = monthsResult === 'too-large' ? [] : monthsResult;
  const [picked, setPicked] = useState<string | null>(null);
  const thisMonth = today.slice(0, 7);
  const month = picked !== null && months.includes(picked) ? picked : months.includes(thisMonth) ? thisMonth : months[0];

  const flow = useMemo(() => {
    if (monthsResult === 'too-large') return 'too-large' as const;
    if (month === undefined) return null;
    try {
      return buildCashFlow(accounts, entries, month, today, { groupBills: true });
    } catch (error) {
      // ยอดใหญ่เกินช่วงปลอดภัย (RangeError) ไม่ให้ทั้งหน้าภาพรวมพัง
      if (error instanceof RangeError) return 'too-large' as const;
      throw error;
    }
  }, [accounts, entries, month, today, monthsResult]);

  if (flow === 'too-large') {
    return (
      <section className="glass-lite card sankey" aria-labelledby="sankey-title">
        <h2 id="sankey-title">
          เงินเข้า-ออกเดือนนี้
          <span className="summary-label-en" aria-hidden="true">
            {' · '}CASH FLOW
          </span>
        </h2>
        <p className="summary-empty">ยอดสูงเกินกว่าจะแสดงกราฟได้</p>
        <p className="muted small">ยอดรวมของเดือนนี้ใหญ่เกินช่วงที่คำนวณได้อย่างแม่นยำ</p>
      </section>
    );
  }

  if (month === undefined || flow === null || !flow.hasData) {
    return (
      <section className="glass-lite card sankey" aria-labelledby="sankey-title">
        <h2 id="sankey-title">
          เงินเข้า-ออกเดือนนี้
          <span className="summary-label-en" aria-hidden="true">
            {' · '}CASH FLOW
          </span>
        </h2>
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

  // แผนภาพกะทัดรัด (มือถือ)
  const cLeft = stackColumn(flow.sources, C_AVAILABLE, C_MIN_BAR, C_GAP);
  const cRight = stackColumn(flow.categories, C_AVAILABLE, C_MIN_BAR, C_GAP);
  const cMidHeight = Math.max(cLeft.filled, cRight.filled);
  const cH = Math.max(cLeft.height, cRight.height, cMidHeight) + PAD_TOP + 28;
  let cLeftCursor = 0;
  let cRightCursor = 0;
  const cLeftRibbons = cLeft.placed.map((p, i) => {
    const d = ribbon(C_LEFT + C_BAR_W, PAD_TOP + p.y, p.h, C_MID, PAD_TOP + cLeftCursor, p.h);
    cLeftCursor += p.h;
    return <path key={p.node.key} d={d} fill={colorOf(p.node, i)} fillOpacity={0.35} />;
  });
  const cRightRibbons = cRight.placed.map((p, i) => {
    const d = ribbon(C_MID + C_BAR_W, PAD_TOP + cRightCursor, p.h, C_RIGHT, PAD_TOP + p.y, p.h);
    cRightCursor += p.h;
    return <path key={p.node.key} d={d} fill={colorOf(p.node, i)} fillOpacity={0.35} />;
  });
  const selected = [...flow.sources, ...flow.categories].find((n) => n.key === selectedKey) ?? null;
  const detail = selected ? `${selected.name} · ${formatBaht(satang(selected.amount))} · ${formatPercentBps(selected.shareBps)}` : 'แตะชื่อหรือแถบสีเพื่อดูยอดเงิน';
  const hit = (p: Placed, side: 'left' | 'right') => {
    const mid = PAD_TOP + p.y + p.h / 2;
    const h = Math.max(HIT_H, p.h);
    const x = side === 'left' ? 2 : C_RIGHT - 4;
    const w = side === 'left' ? C_LEFT + C_BAR_W + 2 : CW - 2 - (C_RIGHT - 4);
    return (
      <rect
        key={p.node.key}
        className="sankey-hit"
        x={x}
        y={mid - h / 2}
        width={w}
        height={h}
        rx={6}
        fill="transparent"
        role="button"
        tabIndex={0}
        aria-pressed={selectedKey === p.node.key}
        aria-label={`${side === 'left' ? 'แหล่งเงิน' : 'ปลายทาง'} ${p.node.name} ${formatBaht(satang(p.node.amount))} ${formatPercentBps(p.node.shareBps)}`}
        onClick={() => setSelectedKey(selectedKey === p.node.key ? null : p.node.key)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setSelectedKey(selectedKey === p.node.key ? null : p.node.key);
          }
        }}
      />
    );
  };

  const overspend = flow.shortfall > 0;
  const summary =
    `เงินเข้า-ออก ${thaiMonthKeyLabel(month)}: รายรับ ${formatBaht(satang(flow.income))} ` +
    `รายจ่าย ${formatBaht(satang(flow.expense))} ` +
    (overspend ? `ใช้เกินรายรับ ${formatBaht(satang(flow.shortfall))}` : `เหลือเก็บ ${formatBaht(satang(flow.leftover))}`);

  return (
    <section className="glass-lite card sankey" aria-labelledby="sankey-title" data-view={view}>
      <div className="sankey-head">
        <h2 id="sankey-title">
          เงินเข้า-ออกเดือนนี้
          <span className="summary-label-en" aria-hidden="true">
            {' · '}CASH FLOW
          </span>
        </h2>
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

      {/* ปุ่มสลับมุมมองเฉพาะมือถือ (≤720px) · จอใหญ่เป็น Sankey เสมอ */}
      <div className="sankey-viewtoggle" role="group" aria-label="มุมมองเงินเข้า-ออก">
        <button type="button" className="sankey-viewbtn" aria-pressed={view === 'diagram'} onClick={() => void chooseView('diagram')}>
          แผนภาพ
        </button>
        <button type="button" className="sankey-viewbtn" aria-pressed={view === 'list'} onClick={() => void chooseView('list')}>
          รายการ
        </button>
      </div>
      <div role="status" className="muted small sankey-viewnote">
        {viewNote}
      </div>

      <div className="sankey-compact">
        <svg viewBox={`0 0 ${CW} ${cH}`} role="group" aria-label={`แผนภาพ ${summary}`}>
          <g aria-hidden="true">
            {cLeftRibbons}
            {cRightRibbons}
            {cLeft.placed.map((p, i) => (
              <rect key={p.node.key} x={C_LEFT} y={PAD_TOP + p.y} width={C_BAR_W} height={p.h} rx={3} fill={colorOf(p.node, i)} className={selectedKey === p.node.key ? 'sankey-bar-selected' : undefined} />
            ))}
            <rect x={C_MID} y={PAD_TOP} width={C_BAR_W} height={cMidHeight} rx={3} fill={chartColor('mid')} />
            {cRight.placed.map((p, i) => (
              <rect key={p.node.key} x={C_RIGHT} y={PAD_TOP + p.y} width={C_BAR_W} height={p.h} rx={3} fill={colorOf(p.node, i)} className={selectedKey === p.node.key ? 'sankey-bar-selected' : undefined} />
            ))}
            {cLeft.placed.map((p) => (
              <CompactLabel key={p.node.key} x={C_LEFT - 6} anchor="end" placed={p} selected={selectedKey === p.node.key} />
            ))}
            {cRight.placed.map((p) => (
              <CompactLabel key={p.node.key} x={C_RIGHT + C_BAR_W + 6} anchor="start" placed={p} selected={selectedKey === p.node.key} />
            ))}
            <text className="sankey-label sankey-label-sm" x={C_MID + C_BAR_W / 2} y={PAD_TOP + cMidHeight + 20} textAnchor="middle">
              งบรวมเดือนนี้
            </text>
          </g>
          {cLeft.placed.map((p) => hit(p, 'left'))}
          {cRight.placed.map((p) => hit(p, 'right'))}
        </svg>
        <p className="sankey-detail" role="status">
          {detail}
        </p>
      </div>

      <svg className="sankey-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
        <g aria-hidden="true">
          {leftRibbons}
          {rightRibbons}
          {left.placed.map((p, i) => (
            <rect key={p.node.key} x={X_LEFT} y={PAD_TOP + p.y} width={BAR_W} height={p.h} rx={4} fill={colorOf(p.node, i)} />
          ))}
          <rect x={X_MID} y={PAD_TOP} width={BAR_W} height={midHeight} rx={4} fill={chartColor('mid')} />
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

      {/* มือถือ (≤720px): แผนภาพ Sankey กว้าง 640px อ่านไม่ได้ จึงซ่อนแล้วโชว์กราฟแท่งแนวนอนแทน (เจ้าของตัดสิน 13 พ.ย. 2569) · จอใหญ่ยังเป็น Sankey · กราฟแท่งเป็นภาพ (aria-hidden) ข้อมูลเดียวกันอยู่ในตารางด้านล่างที่โปรแกรมอ่านจออ่านทุกขนาดจอ */}
      <div className="sankey-bars" aria-hidden="true">
        <h3 className="sankey-bars-title">แหล่งเงิน</h3>
        <ul>
          {flow.sources.map((n, i) => (
            <li key={n.key}>
              <div className="sankey-bar-head">
                <span>{n.name}</span>
                <span className="num">{formatBaht(satang(n.amount))}</span>
              </div>
              <div className="sankey-bar">
                <span style={{ width: `${Math.max(2, Math.round(n.shareBps / 100))}%`, background: colorOf(n, i) }} />
              </div>
              <div className="muted small">{formatPercentBps(n.shareBps)}</div>
            </li>
          ))}
        </ul>
        <h3 className="sankey-bars-title">เงินไปไหน</h3>
        <ul>
          {flow.categories.map((n, i) => (
            <li key={n.key}>
              <div className="sankey-bar-head">
                <span>{n.name}</span>
                <span className="num">{formatBaht(satang(n.amount))}</span>
              </div>
              <div className="sankey-bar">
                <span style={{ width: `${Math.max(2, Math.round(n.shareBps / 100))}%`, background: colorOf(n, i) }} />
              </div>
              <div className="muted small">{formatPercentBps(n.shareBps)}</div>
            </li>
          ))}
        </ul>
      </div>

      <table className="sankey-table sr-only" role="table">
        <caption>{summary}</caption>
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col">ฝั่ง</th>
            <th role="columnheader" scope="col">รายการ</th>
            <th role="columnheader" scope="col">จำนวนเงิน</th>
            <th role="columnheader" scope="col">สัดส่วน</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {flow.sources.map((n) => (
            <tr key={n.key} role="row">
              <td role="cell">แหล่งเงิน</td>
              <td role="cell">{n.name}</td>
              <td role="cell">{formatBaht(satang(n.amount))}</td>
              <td role="cell">{formatPercentBps(n.shareBps)}</td>
            </tr>
          ))}
          {flow.categories.map((n) => (
            <tr key={n.key} role="row">
              <td role="cell">ปลายทาง</td>
              <td role="cell">{n.name}</td>
              <td role="cell">{formatBaht(satang(n.amount))}</td>
              <td role="cell">{formatPercentBps(n.shareBps)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
