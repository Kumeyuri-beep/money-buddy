import { describe, expect, it } from 'vitest';
import { billRows } from '../../src/app/billsView';
import type { Bill } from '../../src/domain/bills/types';

const bill = (over: Partial<Bill> = {}): Bill => ({ id: 'b1', name: 'ค่าเน็ต', amount: 59_900, dueDay: 10, ...over });

describe('billRows (สถานะบิลบนหน้าจอ ใช้ฟังก์ชัน domain ไม่คิดเอง)', () => {
  it('ยังไม่ถึงกำหนด = due พร้อมวันครบกำหนดของรอบเดือนนี้', () => {
    const [row] = billRows([bill()], '2026-11-04');
    expect(row).toMatchObject({ status: 'due', cycle: '2026-11', dueDate: '2026-11-10' });
  });
  it('เลยกำหนดแต่ยังไม่จ่าย = overdue', () => {
    const [row] = billRows([bill({ dueDay: 3 })], '2026-11-04');
    expect(row).toMatchObject({ status: 'overdue', cycle: '2026-11', dueDate: '2026-11-03' });
  });
  it('ครบกำหนดวันนี้ = due ไม่ใช่ overdue', () => {
    expect(billRows([bill({ dueDay: 4 })], '2026-11-04')[0]?.status).toBe('due');
  });
  it('จ่ายรอบนี้แล้ว = paid และไม่มีรอบให้จ่าย', () => {
    const [row] = billRows([bill({ lastPaidMonth: '2026-11' })], '2026-11-04');
    expect(row).toMatchObject({ status: 'paid', cycle: null });
  });
  it('มี startMonth เดือนก่อนและยังไม่จ่าย = ชี้รอบเก่าสุดที่ค้าง และเป็น overdue', () => {
    const [row] = billRows([bill({ startMonth: '2026-10', dueDay: 20 })], '2026-11-04');
    expect(row).toMatchObject({ status: 'overdue', cycle: '2026-10', dueDate: '2026-10-20' });
  });
  it('วันครบกำหนด 31 ในเดือนสั้นถูกบีบเป็นวันสุดท้ายของเดือน', () => {
    expect(billRows([bill({ dueDay: 31 })], '2026-02-04')[0]?.dueDate).toBe('2026-02-28');
  });
  it('บิลข้อมูลเสียไม่หายเงียบ: ขึ้นเป็น invalid พร้อมเหตุผล', () => {
    const rows = billRows([bill({ id: 'bad', amount: 0 }), bill()], '2026-11-04');
    expect(rows.find((r) => r.bill.id === 'bad')).toMatchObject({ status: 'invalid' });
    expect(rows.find((r) => r.bill.id === 'bad')?.problem).toBeTruthy();
    expect(rows.find((r) => r.bill.id === 'b1')?.status).toBe('due');
  });
  it('บิลเก็บถาวรถูกข้าม', () => {
    expect(billRows([bill({ archived: true })], '2026-11-04')).toEqual([]);
  });
  it('เรียงตามสถานะ: เลยกำหนด ก่อน ยังไม่ถึง ก่อน จ่ายแล้ว แล้วตามวันครบกำหนด/ชื่อ', () => {
    const rows = billRows(
      [
        bill({ id: 'p', name: 'ก', lastPaidMonth: '2026-11' }),
        bill({ id: 'd2', name: 'ข', dueDay: 20 }),
        bill({ id: 'o', name: 'ค', dueDay: 2 }),
        bill({ id: 'd1', name: 'ง', dueDay: 8 }),
      ],
      '2026-11-04',
    );
    expect(rows.map((r) => r.bill.id)).toEqual(['o', 'd1', 'd2', 'p']);
  });
  it('รหัสซ้ำ: ตัวที่สองเป็น invalid (ไม่นับซ้ำ)', () => {
    const rows = billRows([bill(), bill({ name: 'ซ้ำ' })], '2026-11-04');
    expect(rows.filter((r) => r.status === 'invalid')).toHaveLength(1);
  });
});
