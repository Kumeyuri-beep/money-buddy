import type { FlowNode } from '../../domain/ledger/sankey';

/**
 * เรขาคณิตของ Sankey (พิกเซล) สำหรับวาดเท่านั้น ไม่ใช่ยอดเงิน
 * ความสูงคิดจาก shareBps (จำนวนเต็มจาก domain) ไม่คำนวณจากยอดสตางค์ใน UI
 */

const BPS = 10000;

export interface Placed {
  node: FlowNode;
  y: number;
  h: number;
}

export interface Column {
  placed: Placed[];
  /** ความสูงรวมรวมช่องว่าง */
  height: number;
  /** ผลรวมความสูงแท่ง ไม่รวมช่องว่าง */
  filled: number;
}

export function stackColumn(nodes: readonly FlowNode[], availablePx: number, minPx: number, gapPx: number): Column {
  const placed: Placed[] = [];
  let y = 0;
  let filled = 0;
  for (const node of nodes) {
    const h = Math.max(minPx, (node.shareBps * availablePx) / BPS);
    placed.push({ node, y, h });
    filled += h;
    y += h + gapPx;
  }
  return { placed, height: placed.length === 0 ? 0 : y - gapPx, filled };
}
