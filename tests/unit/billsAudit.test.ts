import { describe, expect, it } from 'vitest';
import { addDays, addMonths, dueDateIn, nextPayday } from '../../src/domain/bills/calendar';
import { computeSafeToSpend } from '../../src/domain/bills/safeToSpend';
import {
  isBillPaid,
  markBillPaid,
  outstandingBeforePayday,
  payableCycle,
  splitValidBills,
  upcomingBills,
} from '../../src/domain/bills/schedule';
import type { Bill } from '../../src/domain/bills/types';

// กรณีเพิ่มจากผลตรวจ money-auditor 4 พ.ย. 2569 (B1) ข้อมูลทั้งหมดสมมติ ยอดเป็นสตางค์
const bill = (over: Partial<Bill> = {}): Bill => ({ id: 'b1', name: 'ค่าไฟ', amount: 150_000, dueDay: 10, ...over });

describe('lastPaidMonth ผิดรูปต้องไม่ทำให้บิลหายเงียบๆ', () => {
  it.each(['2026-9', '2026-11-05', '', 'Z', '2026-13', '26-11'])('"%s" -> RangeError', (bad) => {
    expect(() => isBillPaid(bill({ lastPaidMonth: bad }), '2026-11')).toThrow(RangeError);
    expect(() => upcomingBills([bill({ lastPaidMonth: bad })], '2026-11-05', '2026-11-24')).toThrow(RangeError);
  });

  it('บิลที่เก็บถาวรที่ lastPaidMonth ผิดรูปไม่ทำให้พัง', () => {
    expect(upcomingBills([bill({ archived: true, lastPaidMonth: 'Z' })], '2026-11-05', '2026-11-24')).toEqual([]);
  });
});

describe('markBillPaid: ห้ามจ่ายรอบอนาคต (กัน lastPaidMonth ล้ำหน้าจนบล็อกการจ่ายจริง)', () => {
  it('รอบของเดือนนี้และรอบก่อนหน้าจ่ายได้', () => {
    expect(markBillPaid(bill(), '2026-11', '2026-11-30').lastPaidMonth).toBe('2026-11');
    expect(markBillPaid(bill({ lastPaidMonth: '2026-08' }), '2026-10', '2026-11-04').lastPaidMonth).toBe('2026-10');
  });

  it('รอบหลังเดือนนี้ -> BillError', () => {
    expect(() => markBillPaid(bill(), '2026-12', '2026-11-30')).toThrow(/ล่วงหน้า/);
    expect(() => markBillPaid(bill(), '2027-01', '2026-12-31')).toThrow(/ล่วงหน้า/);
  });
});

describe('startMonth: นับบิลค้างจ่ายย้อนหลังได้ไม่เกิน 1 เดือน (ไม่แต่งหนี้ย้อนหลัง)', () => {
  it('บิลที่ตั้งเมื่อเดือนก่อนและยังไม่จ่าย: รอบเดือนก่อนที่เลยกำหนดยังนับเป็นหนี้ค้าง', () => {
    const r = upcomingBills([bill({ dueDay: 30, startMonth: '2026-10' })], '2026-11-01', '2026-11-24');
    expect(r.map((u) => [u.cycleMonth, u.dueDate, u.overdue])).toEqual([['2026-10', '2026-10-30', true]]);
  });

  it('จ่ายรอบเดือนก่อนแล้ว -> หายจากยอด', () => {
    const paid = bill({ dueDay: 30, startMonth: '2026-10', lastPaidMonth: '2026-10' });
    expect(upcomingBills([paid], '2026-11-01', '2026-11-24')).toEqual([]);
  });

  it('บิลที่ตั้งมานานแล้วไม่เคยบันทึกจ่าย: ย้อนหลังนับแค่เดือนก่อน ไม่ท่วมหนี้หลายเดือน', () => {
    const r = upcomingBills([bill({ dueDay: 10, startMonth: '2026-01' })], '2026-11-05', '2026-11-24');
    expect(r.map((u) => u.cycleMonth)).toEqual(['2026-10', '2026-11']);
  });

  it('ไม่ใส่ startMonth หรือตั้งเดือนนี้ = ไม่ย้อนหลัง (บิลที่เพิ่งสร้างไม่ถูกมองว่าค้างมาก่อน)', () => {
    expect(upcomingBills([bill({ dueDay: 3 })], '2026-11-05', '2026-11-24').map((u) => u.cycleMonth)).toEqual(['2026-11']);
    const thisMonth = bill({ dueDay: 3, startMonth: '2026-11' });
    expect(upcomingBills([thisMonth], '2026-11-05', '2026-11-24').map((u) => u.cycleMonth)).toEqual(['2026-11']);
  });

  it('บิลที่เริ่มเดือนหน้า (startMonth ในอนาคต) ยังไม่ถูกนับเดือนนี้', () => {
    const future = bill({ dueDay: 10, startMonth: '2026-12' });
    expect(upcomingBills([future], '2026-11-05', '2026-11-24')).toEqual([]);
    expect(upcomingBills([future], '2026-11-05', '2026-12-24').map((u) => u.cycleMonth)).toEqual(['2026-12']);
  });

  it('ข้ามปี: บิลเริ่ม ธ.ค. ค้าง วันที่ 2 ม.ค. ยังนับ', () => {
    const r = upcomingBills([bill({ dueDay: 20, startMonth: '2026-12' })], '2027-01-02', '2027-01-24');
    expect(r.map((u) => u.dueDate)).toEqual(['2026-12-20', '2027-01-20']);
  });

  it('startMonth ผิดรูป -> RangeError', () => {
    expect(() => upcomingBills([bill({ startMonth: '2026-9' })], '2026-11-05', '2026-11-24')).toThrow(RangeError);
  });

  it('payableCycle เลือกรอบที่ค้างเก่าที่สุดก่อน แล้วจึงรอบปัจจุบัน', () => {
    const b = bill({ startMonth: '2026-10' });
    expect(payableCycle(b, '2026-11-04')).toBe('2026-10');
    const paidOct = markBillPaid(b, '2026-10', '2026-11-04');
    expect(payableCycle(paidOct, '2026-11-04')).toBe('2026-11');
    expect(payableCycle(markBillPaid(paidOct, '2026-11', '2026-11-04'), '2026-11-04')).toBeNull();
  });

  it('payableCycle: บิลที่เริ่มเดือนหน้ายังไม่มีรอบให้จ่าย', () => {
    expect(payableCycle(bill({ startMonth: '2026-12' }), '2026-11-04')).toBeNull();
  });
});

describe('splitValidBills: แยกบิลเสียออกมา แทนทำให้ทั้งการ์ดพัง', () => {
  it('คืนบิลที่ใช้ได้ และเหตุผลของบิลที่เสีย (มีรหัสบิล)', () => {
    const r = splitValidBills([
      bill({ id: 'ok' }),
      bill({ id: 'bad-day', dueDay: 40 }),
      bill({ id: 'bad-amount', amount: 0 }),
      bill({ id: 'bad-paid', lastPaidMonth: '2026-9' }),
    ]);
    expect(r.valid.map((b) => b.id)).toEqual(['ok']);
    expect(r.invalid.map((p) => p.id)).toEqual(['bad-day', 'bad-amount', 'bad-paid']);
    expect(r.invalid.every((p) => p.reason.length > 0)).toBe(true);
  });

  it('รหัสบิลซ้ำ: ตัวที่สองถือว่าเสีย (กันนับยอดซ้ำ)', () => {
    const r = splitValidBills([bill({ id: 'x' }), bill({ id: 'x', name: 'ซ้ำ' })]);
    expect(r.valid).toHaveLength(1);
    expect(r.invalid).toEqual([{ id: 'x', name: 'ซ้ำ', reason: expect.stringContaining('ซ้ำ') }]);
  });

  it('upcomingBills ที่ได้รับบิลรหัสซ้ำโยน RangeError (ไม่นับซ้ำเงียบๆ)', () => {
    expect(() => upcomingBills([bill({ id: 'x' }), bill({ id: 'x' })], '2026-11-05', '2026-11-24')).toThrow(RangeError);
  });

  it('บิลที่เก็บถาวรไม่ถูกตรวจและไม่อยู่ในผลทั้งสองฝั่ง · archived ต้องเป็น true จริงๆ', () => {
    expect(splitValidBills([bill({ id: 'a', archived: true, dueDay: 99 })])).toEqual({ valid: [], invalid: [] });
    const truthyString = bill({ id: 'b', archived: 'false' as unknown as boolean });
    expect(splitValidBills([truthyString]).valid).toHaveLength(1);
  });

  it('ไม่มีบิล -> ว่าง', () => {
    expect(splitValidBills([])).toEqual({ valid: [], invalid: [] });
  });
});

describe('outstandingBeforePayday: ประกอบ nextPayday + upcomingBills ให้ตรงกับจำนวนวันของสูตร R15', () => {
  const run = (bills: Bill[], today: string, payDay: number) => outstandingBeforePayday(bills, today, payDay);

  it('คืนวันเงินเดือนถัดไป รายการ และยอดรวม', () => {
    const r = run(
      [bill({ amount: 150_000, dueDay: 10 }), bill({ id: 'b2', name: 'น้ำ', amount: 20_000, dueDay: 20 })],
      '2026-11-05',
      25,
    );
    expect(r.nextPayday).toBe('2026-11-25');
    expect(r.items.map((u) => u.dueDate)).toEqual(['2026-11-10', '2026-11-20']);
    expect(r.total).toBe(170_000);
  });

  it('บิลที่ครบกำหนดตรงวันเงินเดือนถัดไปถูกหักด้วย (R15 ทางปลอดภัย) · วันหลังเงินเดือน 1 วันไม่ถูกหัก', () => {
    expect(run([bill({ dueDay: 25 })], '2026-11-05', 25).total).toBe(150_000);
    expect(run([bill({ dueDay: 26 })], '2026-11-05', 25).total).toBe(0);
    expect(run([bill({ dueDay: 24 })], '2026-11-05', 25).total).toBe(150_000);
  });

  it('วันนี้คือวันเงินเดือน: ช่วงคือเดือนหน้า บิลก่อนวันเงินเดือนเดือนหน้าถูกหัก (บิลเดือนนี้จ่ายแล้ว)', () => {
    const r = run([bill({ dueDay: 10, lastPaidMonth: '2026-11' })], '2026-11-25', 25);
    expect(r.nextPayday).toBe('2026-12-25');
    expect(r.items.map((u) => u.dueDate)).toEqual(['2026-12-10']);
  });

  it('วันนี้คือวันเงินเดือนและบิลครบกำหนดวันนั้น (ยังไม่จ่าย): หักทั้งรอบนี้และรอบวันเงินเดือนถัดไป', () => {
    const r = run([bill({ dueDay: 25 })], '2026-11-25', 25);
    expect(r.items.map((u) => u.dueDate)).toEqual(['2026-11-25', '2026-12-25']);
    expect(r.total).toBe(300_000);
  });

  it('บิลครบกำหนด 31 ในเดือนสั้น ตรงวันเงินเดือนที่บีบเป็นวันสุดท้าย (28 ก.พ.) ถูกหัก', () => {
    const r = run([bill({ dueDay: 31 })], '2026-02-10', 31);
    expect(r.nextPayday).toBe('2026-02-28');
    expect(r.items.map((u) => u.dueDate)).toEqual(['2026-02-28']);
    expect(r.total).toBe(150_000);
    // บิลวันที่ 30 บีบเป็น 28 ก.พ. เหมือนกัน ถูกหักด้วย
    expect(run([bill({ dueDay: 30 })], '2026-02-10', 31).total).toBe(150_000);
  });

  it('บิลวันเงินเดือนที่จ่ายรอบนั้นแล้ว (lastPaidMonth) ไม่ถูกหัก', () => {
    expect(run([bill({ dueDay: 25, lastPaidMonth: '2026-11' })], '2026-11-05', 25).total).toBe(0);
  });

  it('วันนี้คือวันเงินเดือนแต่บิลเดือนนี้ยังไม่จ่าย: นับเป็นบิลเลยกำหนดด้วย (ไม่หายไป)', () => {
    const r = run([bill({ dueDay: 10 })], '2026-11-25', 25);
    expect(r.items.map((u) => [u.dueDate, u.overdue])).toEqual([
      ['2026-11-10', true],
      ['2026-12-10', false],
    ]);
    expect(r.total).toBe(300_000);
  });

  it('วันที่ 31 ธ.ค. กับเงินเดือนวันที่ 30 (ข้ามปี) และ 30 เม.ย. กับวันที่ 31', () => {
    expect(run([], '2026-12-31', 30).nextPayday).toBe('2027-01-30');
    expect(run([], '2026-04-30', 31).nextPayday).toBe('2026-05-31');
  });

  it('วันที่เหลือ 1 วัน (วันก่อนเงินเดือน): บิลที่ครบกำหนดวันนี้ถูกหัก', () => {
    const r = run([bill({ dueDay: 24 })], '2026-11-24', 25);
    expect(r.items).toHaveLength(1);
    expect(r.total).toBe(150_000);
  });

  it('ต่อกับ computeSafeToSpend ได้ครบวงจร (บิลหักแล้ว วันที่เหลือตรงกัน)', () => {
    const r = run([bill({ dueDay: 10, amount: 100_000 })], '2026-11-05', 25);
    const s = computeSafeToSpend({ spendable: 400_000, outstanding: r.total, reserve: 100_000, today: '2026-11-05', payDay: 25 });
    expect(s).toMatchObject({ kind: 'ok', available: 200_000, daysLeft: 20, perDay: 10_000, nextPayday: r.nextPayday });
  });

  it('บิลค้างเดือนก่อน (startMonth) ถูกรวมในยอดก่อนเงินเดือน', () => {
    const r = run([bill({ dueDay: 30, startMonth: '2026-10', amount: 80_000 })], '2026-11-01', 25);
    expect(r.total).toBe(80_000);
    expect(r.items[0]).toMatchObject({ overdue: true, cycleMonth: '2026-10' });
  });
});

describe('addDays', () => {
  it('บวก/ลบวัน ข้ามสิ้นเดือน ข้ามปี ปีอธิกสุรทิน', () => {
    expect(addDays('2026-11-25', -1)).toBe('2026-11-24');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-11-05', 0)).toBe('2026-11-05');
  });

  it('วันที่ไม่จริงหรือจำนวนวันไม่ใช่จำนวนเต็ม -> RangeError', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
    expect(() => addDays('2026-11-05', 0.5)).toThrow(RangeError);
  });
});

describe('ปีนอกช่วง 1000-9999 ถูกปฏิเสธ (กันสตริงเสียจากปี 0000 หรือ 5 หลัก)', () => {
  it('addMonths ที่ผลออกนอกช่วง -> RangeError', () => {
    expect(() => addMonths('1000-01', -1)).toThrow(RangeError);
    expect(() => addMonths('9999-12', 1)).toThrow(RangeError);
    expect(addMonths('1000-01', 0)).toBe('1000-01');
    expect(addMonths('9999-11', 1)).toBe('9999-12');
  });

  it('รอบเดือนปี 0000 หรือปีที่ขึ้นต้นด้วยศูนย์ -> RangeError', () => {
    expect(() => addMonths('0000-01', -1)).toThrow(RangeError);
    expect(() => dueDateIn('0099-01', 5)).toThrow(RangeError);
  });

  it('จำนวนเดือนใหญ่เกินช่วงปลอดภัย -> RangeError', () => {
    expect(() => addMonths('2026-01', Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
    expect(() => addMonths('2026-01', Number.NaN)).toThrow(RangeError);
  });

  it('upcomingBills ที่ช่วงสิ้นสุดปี 9999 ไม่วนไม่รู้จบ (จบด้วยผลหรือ RangeError ที่ชัดเจน)', () => {
    expect(() => upcomingBills([bill()], '9999-11-05', '9999-12-31')).not.toThrow();
  });
});

describe('nextPayday: ก.พ. ปีอธิกสุรทิน/ปีศตวรรษ (เพิ่มตามผลตรวจ)', () => {
  it('วันเงินเดือน 29/30 ใน ก.พ. ปี 2024 (29 วัน) และ 2100 (28 วัน)', () => {
    expect(nextPayday(29, '2024-02-10')).toBe('2024-02-29');
    expect(nextPayday(30, '2024-02-10')).toBe('2024-02-29');
    expect(nextPayday(29, '2100-02-10')).toBe('2100-02-28');
    expect(nextPayday(30, '2100-02-28')).toBe('2100-03-30');
  });
});

describe('computeSafeToSpend: -0 และยอดกระเป๋าติดลบมาก', () => {
  const base = { spendable: 300_000, outstanding: 50_000, reserve: 100_000, today: '2026-11-05', payDay: 25 };

  it('spendable เป็น -0 ไม่ทำให้ available เป็น -0', () => {
    const r = computeSafeToSpend({ ...base, spendable: -0, outstanding: 0, reserve: 0 });
    expect(Object.is(r.available, -0)).toBe(false);
    expect(r).toMatchObject({ kind: 'ok', perDay: 0, available: 0 });
  });

  it('กระเป๋าติดลบ + เงินสำรองก้อนใหญ่ -> shortfall รวมทั้งคู่', () => {
    const r = computeSafeToSpend({ spendable: -250_000, outstanding: 0, reserve: 1_000_000, today: '2026-11-05', payDay: 25 });
    expect(r).toMatchObject({ kind: 'shortfall', perDay: 0, shortfall: 1_250_000 });
  });
});
