import { describe, expect, it } from 'vitest';
import type { Bill } from '../../src/domain/bills/types';
import { isBillPaid, markBillPaid, outstandingTotal, payableCycle, upcomingBills } from '../../src/domain/bills/schedule';

// ข้อมูลทั้งหมดสมมติ ยอดเป็นสตางค์
const bill = (over: Partial<Bill> = {}): Bill => ({ id: 'b1', name: 'ค่าไฟ', amount: 150_000, dueDay: 10, ...over });

describe('isBillPaid: จ่ายแล้วเมื่อ lastPaidMonth ครอบคลุมรอบนั้น (R15)', () => {
  it('ยังไม่เคยจ่าย -> ยังไม่จ่าย', () => {
    expect(isBillPaid(bill(), '2026-11')).toBe(false);
  });

  it('จ่ายรอบนี้แล้ว -> จ่ายแล้ว · จ่ายแค่รอบก่อน -> รอบนี้ยังไม่จ่าย', () => {
    expect(isBillPaid(bill({ lastPaidMonth: '2026-11' }), '2026-11')).toBe(true);
    expect(isBillPaid(bill({ lastPaidMonth: '2026-10' }), '2026-11')).toBe(false);
  });

  it('จ่ายล่วงหน้ารอบหลัง -> รอบก่อนถือว่าจ่ายแล้ว (เทียบเดือนแบบ >=)', () => {
    expect(isBillPaid(bill({ lastPaidMonth: '2026-12' }), '2026-11')).toBe(true);
    expect(isBillPaid(bill({ lastPaidMonth: '2027-01' }), '2026-12')).toBe(true);
  });

  it('ข้ามปี: จ่ายธันวาคมแล้ว มกราคมปีหน้ายังไม่จ่าย', () => {
    expect(isBillPaid(bill({ lastPaidMonth: '2026-12' }), '2027-01')).toBe(false);
  });
});

describe('payableCycle / markBillPaid: จ่ายได้ครั้งเดียวต่อรอบ (R15)', () => {
  it('รอบที่จ่ายได้วันนี้คือรอบของเดือนนี้ ถ้ายังไม่จ่าย', () => {
    expect(payableCycle(bill(), '2026-11-04')).toBe('2026-11');
    expect(payableCycle(bill({ lastPaidMonth: '2026-10' }), '2026-11-30')).toBe('2026-11');
  });

  it('จ่ายรอบนี้แล้ว -> null (ไม่มีรอบให้จ่ายซ้ำ)', () => {
    expect(payableCycle(bill({ lastPaidMonth: '2026-11' }), '2026-11-04')).toBeNull();
  });

  it('markBillPaid ตั้ง lastPaidMonth และไม่แก้ของเดิม', () => {
    const original = bill();
    const paid = markBillPaid(original, '2026-11', '2026-11-04');
    expect(paid.lastPaidMonth).toBe('2026-11');
    expect(original.lastPaidMonth).toBeUndefined();
    expect(paid).not.toBe(original);
  });

  it('จ่ายรอบเดิมซ้ำ -> โยนข้อผิดพลาด (กันจ่ายซ้ำ)', () => {
    const paid = markBillPaid(bill(), '2026-11', '2026-11-04');
    expect(() => markBillPaid(paid, '2026-11', '2026-11-04')).toThrow(/จ่าย/);
    expect(() => markBillPaid(bill({ lastPaidMonth: '2026-12' }), '2026-11', '2026-12-04')).toThrow(/จ่าย/);
  });

  it('จ่ายรอบถัดไปได้หลังจ่ายรอบก่อน', () => {
    const next = markBillPaid(markBillPaid(bill(), '2026-11', '2026-11-04'), '2026-12', '2026-12-04');
    expect(next.lastPaidMonth).toBe('2026-12');
  });

  it('รอบเดือนที่ผิดรูป -> RangeError', () => {
    expect(() => markBillPaid(bill(), '2026-13', '2026-11-04')).toThrow(RangeError);
  });
});

describe('upcomingBills: บิลที่ยังไม่จ่ายตั้งแต่วันนี้ถึงวันสุดท้ายของช่วง (รวมวันนั้น)', () => {
  it('บิลที่ครบกำหนดในช่วง', () => {
    const r = upcomingBills([bill({ dueDay: 10 })], '2026-11-05', '2026-11-24');
    expect(r.map((u) => [u.dueDate, u.cycleMonth, u.overdue])).toEqual([['2026-11-10', '2026-11', false]]);
  });

  it('บิลที่ครบกำหนดหลังวันสุดท้ายของช่วงไม่ถูกนับ · ตรงวันสุดท้ายพอดีนับ', () => {
    expect(upcomingBills([bill({ dueDay: 28 })], '2026-11-05', '2026-11-24')).toEqual([]);
    expect(upcomingBills([bill({ dueDay: 24 })], '2026-11-05', '2026-11-24')).toHaveLength(1);
  });

  it('บิลที่จ่ายรอบนี้แล้วไม่ถูกนับ แต่จ่ายแค่รอบก่อนยังนับ', () => {
    expect(upcomingBills([bill({ lastPaidMonth: '2026-11' })], '2026-11-05', '2026-11-24')).toEqual([]);
    expect(upcomingBills([bill({ lastPaidMonth: '2026-10' })], '2026-11-05', '2026-11-24')).toHaveLength(1);
  });

  it('บิลที่เลยกำหนดในเดือนนี้และยังไม่จ่าย -> นับ ติดป้ายเลยกำหนด', () => {
    const r = upcomingBills([bill({ dueDay: 3 })], '2026-11-05', '2026-11-24');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ dueDate: '2026-11-03', overdue: true });
  });

  it('ครบกำหนดวันนี้พอดี -> ยังไม่เลยกำหนด', () => {
    const r = upcomingBills([bill({ dueDay: 5 })], '2026-11-05', '2026-11-24');
    expect(r[0]).toMatchObject({ dueDate: '2026-11-05', overdue: false });
  });

  it('ช่วงข้ามเดือน: นับทั้งรอบเดือนนี้ (เลยกำหนด) และรอบเดือนหน้า', () => {
    const r = upcomingBills([bill({ dueDay: 5 })], '2026-11-20', '2026-12-24');
    expect(r.map((u) => [u.dueDate, u.overdue])).toEqual([
      ['2026-11-05', true],
      ['2026-12-05', false],
    ]);
  });

  it('ช่วงข้ามเดือน และจ่ายรอบเดือนนี้แล้ว: เหลือรอบเดือนหน้า', () => {
    const r = upcomingBills([bill({ dueDay: 5, lastPaidMonth: '2026-11' })], '2026-11-20', '2026-12-24');
    expect(r.map((u) => u.dueDate)).toEqual(['2026-12-05']);
  });

  it('ช่วงข้ามปี', () => {
    const r = upcomingBills([bill({ dueDay: 10 })], '2026-12-20', '2027-01-24');
    expect(r.map((u) => u.dueDate)).toEqual(['2026-12-10', '2027-01-10']);
  });

  it('บิลวันที่ 31 ในเดือนสั้นครบกำหนดวันสุดท้ายของเดือน', () => {
    expect(upcomingBills([bill({ dueDay: 31 })], '2026-11-05', '2026-11-30').map((u) => u.dueDate)).toEqual(['2026-11-30']);
    expect(upcomingBills([bill({ dueDay: 31 })], '2026-02-01', '2026-02-28').map((u) => u.dueDate)).toEqual(['2026-02-28']);
    expect(upcomingBills([bill({ dueDay: 31 })], '2024-02-01', '2024-02-29').map((u) => u.dueDate)).toEqual(['2024-02-29']);
  });

  it('บิลที่เก็บถาวรไม่ถูกนับ', () => {
    expect(upcomingBills([bill({ archived: true })], '2026-11-05', '2026-11-24')).toEqual([]);
  });

  it('เรียงตามวันครบกำหนด แล้วชื่อ แล้วรหัส', () => {
    const r = upcomingBills(
      [
        bill({ id: 'c', name: 'น้ำ', dueDay: 20 }),
        bill({ id: 'b', name: 'อินเทอร์เน็ต', dueDay: 10 }),
        bill({ id: 'a', name: 'ค่าไฟ', dueDay: 10 }),
        bill({ id: 'd', name: 'ค่าไฟ', dueDay: 10 }),
      ],
      '2026-11-05',
      '2026-11-24',
    );
    expect(r.map((u) => u.bill.id)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('ไม่มีบิล หรือวันสุดท้ายของช่วงอยู่ก่อนวันนี้ -> ว่าง', () => {
    expect(upcomingBills([], '2026-11-05', '2026-11-24')).toEqual([]);
    expect(upcomingBills([bill()], '2026-11-05', '2026-11-04')).toEqual([]);
  });

  it('วันนี้เท่ากับวันสุดท้ายของช่วง: นับเฉพาะบิลที่ครบกำหนดวันนี้หรือเลยกำหนดแล้ว', () => {
    expect(upcomingBills([bill({ dueDay: 5 })], '2026-11-05', '2026-11-05')).toHaveLength(1);
    expect(upcomingBills([bill({ dueDay: 6 })], '2026-11-05', '2026-11-05')).toHaveLength(0);
  });

  it('ข้อมูลผิดรูปโยน RangeError: วันที่ไม่จริง, วันครบกำหนดนอก 1-31, ยอดไม่ใช่จำนวนเต็มบวก', () => {
    expect(() => upcomingBills([bill()], '2026-02-30', '2026-03-10')).toThrow(RangeError);
    expect(() => upcomingBills([bill({ dueDay: 0 })], '2026-11-05', '2026-11-24')).toThrow(RangeError);
    expect(() => upcomingBills([bill({ dueDay: 32 })], '2026-11-05', '2026-11-24')).toThrow(RangeError);
    expect(() => upcomingBills([bill({ amount: 0 })], '2026-11-05', '2026-11-24')).toThrow(RangeError);
    expect(() => upcomingBills([bill({ amount: -1 })], '2026-11-05', '2026-11-24')).toThrow(RangeError);
    expect(() => upcomingBills([bill({ amount: 12.5 })], '2026-11-05', '2026-11-24')).toThrow(RangeError);
  });

  it('บิลที่เก็บถาวรไม่ถูกตรวจรูปแบบ (ข้อมูลเก่าที่ไม่ใช้แล้วไม่ทำให้ทั้งหน้าพัง)', () => {
    expect(upcomingBills([bill({ archived: true, dueDay: 99 })], '2026-11-05', '2026-11-24')).toEqual([]);
  });
});

describe('outstandingTotal', () => {
  it('รวมยอดเป็นสตางค์ ว่าง = 0', () => {
    const list = upcomingBills(
      [bill({ id: 'a', amount: 150_000, dueDay: 10 }), bill({ id: 'b', amount: 1, dueDay: 12 }), bill({ id: 'c', amount: 99_999, dueDay: 14 })],
      '2026-11-05',
      '2026-11-24',
    );
    expect(outstandingTotal(list)).toBe(250_000);
    expect(outstandingTotal([])).toBe(0);
  });

  it('ยอดน้อยมาก 1 สตางค์', () => {
    expect(outstandingTotal(upcomingBills([bill({ amount: 1 })], '2026-11-05', '2026-11-24'))).toBe(1);
  });

  it('ยอดรวมเกินช่วงปลอดภัย -> RangeError ไม่ปัดเงียบ', () => {
    const list = upcomingBills(
      [bill({ id: 'a', amount: Number.MAX_SAFE_INTEGER, dueDay: 10 }), bill({ id: 'b', amount: 2, dueDay: 12 })],
      '2026-11-05',
      '2026-11-24',
    );
    expect(() => outstandingTotal(list)).toThrow(RangeError);
  });
});
