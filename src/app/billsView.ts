import { dueDateIn } from '../domain/bills/calendar';
import { billProblem, payableCycle } from '../domain/bills/schedule';
import type { Bill } from '../domain/bills/types';

export type BillRowStatus = 'overdue' | 'due' | 'paid' | 'invalid';

export interface BillRow {
  bill: Bill;
  status: BillRowStatus;
  /** รอบที่การจ่ายตอนนี้จะชำระ (เก่าสุดที่ค้าง) null = ไม่มีรอบให้จ่าย */
  cycle: string | null;
  /** วันครบกำหนดของรอบนั้น YYYY-MM-DD */
  dueDate: string | null;
  /** เหตุผลเมื่อข้อมูลบิลผิดรูป */
  problem?: string;
}

const RANK: Record<BillRowStatus, number> = { invalid: 0, overdue: 1, due: 2, paid: 3 };

/**
 * แถวสำหรับหน้า "บิลประจำ": สถานะมาจากฟังก์ชัน domain (payableCycle) ไม่คิดสูตรเองในหน้าจอ
 * บิลข้อมูลเสียแสดงเป็น invalid พร้อมเหตุผล (ไม่ซ่อน) บิลเก็บถาวรถูกข้าม
 */
export function billRows(bills: readonly Bill[], today: string): BillRow[] {
  const rows: BillRow[] = [];
  const seen = new Set<string>();
  for (const bill of bills) {
    if (bill.archived === true) continue;
    const problem = billProblem(bill) ?? (seen.has(bill.id) ? 'รหัสบิลซ้ำ (นับซ้ำไม่ได้)' : null);
    seen.add(bill.id);
    if (problem) {
      rows.push({ bill, status: 'invalid', cycle: null, dueDate: null, problem });
      continue;
    }
    const cycle = payableCycle(bill, today);
    if (cycle === null) {
      rows.push({ bill, status: 'paid', cycle: null, dueDate: null });
      continue;
    }
    const dueDate = dueDateIn(cycle, bill.dueDay);
    rows.push({ bill, status: dueDate < today ? 'overdue' : 'due', cycle, dueDate });
  }
  return rows.sort(
    (a, b) =>
      RANK[a.status] - RANK[b.status] ||
      (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
      a.bill.name.localeCompare(b.bill.name, 'th') ||
      (a.bill.id < b.bill.id ? -1 : a.bill.id > b.bill.id ? 1 : 0),
  );
}
