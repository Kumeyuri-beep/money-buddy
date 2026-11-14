/**
 * มุมมองการ์ดเงินเข้า-ออกบนมือถือ (14 พ.ย. 2569): แผนภาพ (Sankey · ค่าเริ่มต้น) หรือ รายการแท่ง
 * เก็บใน settings คีย์ cashFlowView เฉพาะ 'list' (เลือกแผนภาพ = ลบคีย์) · ไม่มีสูตรเงิน
 */
export type CashFlowView = 'diagram' | 'list';

export function parseCashFlowView(raw: unknown): CashFlowView {
  return raw === 'list' ? 'list' : 'diagram';
}

export function cashFlowViewPatch(view: CashFlowView): { cashFlowView: 'list' | null } {
  return { cashFlowView: view === 'list' ? 'list' : null };
}

/** ตัดชื่อให้สั้นสำหรับป้ายแผนภาพบนมือถือ: ตัดตามกลุ่มอักษร (ไม่ทำให้สระ/วรรณยุคขาด) แล้วต่อ "…" · ชื่อเต็มดูได้ตอนแตะ */
export function shortLabel(name: string, max: number): string {
  const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('th', { granularity: 'grapheme' }) : null;
  const parts = segmenter ? Array.from(segmenter.segment(name), (s) => s.segment) : Array.from(name);
  return parts.length <= max ? name : parts.slice(0, Math.max(1, max - 1)).join('') + '…';
}
