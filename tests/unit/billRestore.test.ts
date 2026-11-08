import { describe, expect, it } from 'vitest';
import { canRestoreDeletedBill } from '../../src/domain/bills/restore';
import type { Bill } from '../../src/domain/bills/types';
import type { Entry } from '../../src/domain/ledger/types';

const bill = (over: Partial<Bill> = {}): Bill => ({ id: 'b1', name: 'ค่าเน็ต', amount: 59_900, dueDay: 5, ...over });
const pay = (cycle: string, id = `p-${cycle}`, billId = 'b1', source: Entry['source'] = 'recurring'): Entry => ({
  id,
  date: `${cycle}-05`,
  memo: 'ค่าเน็ต',
  source,
  bill: { id: billId, cycle },
  lines: [
    { accountId: 'exp', amount: 59_900 },
    { accountId: 'w', amount: -59_900 },
  ],
});

/** ต้องตรงกับกติกา INSERT ของ private.bills_guard (migration 20261108001300): ลบบิลแล้วเลิกทำ = เพิ่มบิลกลับพร้อมสถานะเดิม */
describe('ลบบิลแล้วเลิกทำได้ไหม (กู้คืนได้ก็ต่อเมื่อสถานะจ่ายตรงกับรายการจ่ายที่ผูกอยู่)', () => {
  it('ยังไม่เคยจ่ายและไม่มีรายการผูก = กู้คืนได้', () => {
    expect(canRestoreDeletedBill(bill(), [])).toBe(true);
  });

  it('จ่ายแล้วโดยมีรายการจ่ายผูกรอบล่าสุดตรงกับ lastPaidMonth = กู้คืนได้ (หลายรอบก็ใช้รอบล่าสุด)', () => {
    expect(canRestoreDeletedBill(bill({ lastPaidMonth: '2026-11' }), [pay('2026-11')])).toBe(true);
    expect(canRestoreDeletedBill(bill({ lastPaidMonth: '2026-11' }), [pay('2026-10'), pay('2026-11')])).toBe(true);
    expect(canRestoreDeletedBill(bill({ lastPaidMonth: '2026-11' }), [pay('2026-11'), pay('2026-10')])).toBe(true);
  });

  it('lastPaidMonth ไม่มีรายการจ่ายรองรับ (ไฟล์เก่าก่อนมีการผูกบิล) = กู้คืนไม่ได้ → ควรเก็บถาวรแทน', () => {
    expect(canRestoreDeletedBill(bill({ lastPaidMonth: '2026-11' }), [])).toBe(false);
    expect(canRestoreDeletedBill(bill({ lastPaidMonth: '2026-11' }), [pay('2026-10')])).toBe(false);
  });

  it('มีรายการจ่ายผูกอยู่แต่บิลไม่มีสถานะจ่าย (ไม่ตรงกัน) = กู้คืนไม่ได้', () => {
    expect(canRestoreDeletedBill(bill(), [pay('2026-11')])).toBe(false);
    expect(canRestoreDeletedBill(bill({ lastPaidMonth: '2026-09' }), [pay('2026-11')])).toBe(false);
  });

  it('นับเฉพาะรายการ recurring ที่ผูกกับบิลนี้ (บิลอื่น/รายการทั่วไปไม่เกี่ยว)', () => {
    const other = pay('2026-12', 'p-other', 'b2');
    const manual: Entry = { ...pay('2026-12', 'p-manual'), source: 'manual' };
    expect(canRestoreDeletedBill(bill({ lastPaidMonth: '2026-11' }), [pay('2026-11'), other, manual])).toBe(true);
    expect(canRestoreDeletedBill(bill(), [other, manual])).toBe(true);
  });
});
