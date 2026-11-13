import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { buildSafeToSpend, buildUpcomingPanel } from '../../src/app/billsOverview';
import { friendlyError } from '../../src/app/errorText';
import { addDays, addMonths, dueDateIn, nextPayday } from '../../src/domain/bills/calendar';
import { computeSafeToSpend } from '../../src/domain/bills/safeToSpend';
import {
  isBillPaid,
  markBillPaid,
  payableCycle,
  splitValidBills,
  upcomingBills,
} from '../../src/domain/bills/schedule';
import type { FinanceSettings } from '../../src/domain/bills/settings';
import type { Bill } from '../../src/domain/bills/types';
import type { Account, Entry } from '../../src/domain/ledger/types';
import { SummaryCards } from '../../src/ui/overview/SummaryCards';
import { UpcomingBillsPanel } from '../../src/ui/overview/UpcomingBillsPanel';

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

// เดิมทดสอบ outstandingBeforePayday (ลบแล้ว 14 พ.ย. 2569: production ใช้ buildSafeToSpend/buildUpcomingPanel ที่กรองบิลเสียด้วย splitValidBills ก่อน)
// เทสต์กรณีปกติทั้งชุดย้ายมาตรวจตัวที่ใช้จริง · ข้อมูลทั้งหมดสมมติ
describe('ช่วงบิลก่อนเงินเดือน (R15) ตรวจผ่าน buildSafeToSpend + buildUpcomingPanel ที่ production ใช้จริง', () => {
  const accounts: Account[] = [
    { id: 'w1', type: 'asset', name: 'เงินสด', currency: 'THB' },
    { id: 'open', type: 'equity', name: 'ยอดยกมา', currency: 'THB' },
  ];
  const opening = (amount: number): Entry[] => [
    { id: 'e0', date: '2026-01-01', memo: '', source: 'system', lines: [{ accountId: 'w1', amount }, { accountId: 'open', amount: -amount }] },
  ];
  const run = (bills: Bill[], today: string, payDay: number, extra: { cash?: number; reserve?: number } = {}) => {
    const settings: FinanceSettings = { payDay, ...(extra.reserve !== undefined ? { monthlySavingsGoal: extra.reserve } : {}) };
    const safe = buildSafeToSpend(accounts, opening(extra.cash ?? 0), { bills, settings }, today);
    const panel = buildUpcomingPanel({ bills, settings }, today);
    if (safe.kind !== 'value') throw new Error('ต้องได้ค่า (kind=value) แต่ได้ ' + safe.kind);
    return { safe, nextPayday: safe.nextPayday, total: safe.outstanding, items: panel.kind === 'list' ? panel.items : [], panel };
  };

  it('คืนวันเงินเดือนถัดไป รายการ และยอดรวม', () => {
    const r = run(
      [bill({ amount: 150_000, dueDay: 10 }), bill({ id: 'b2', name: 'น้ำ', amount: 20_000, dueDay: 20 })],
      '2026-11-05',
      25,
    );
    expect(r.nextPayday).toBe('2026-11-25');
    expect(r.items.map((u) => u.dueDate)).toEqual(['2026-11-10', '2026-11-20']);
    expect(r.total).toBe(170_000);
    expect(r.panel).toMatchObject({ kind: 'list', total: 170_000, until: '2026-11-25', hidden: 0, invalidBills: 0 });
  });

  it('บิลที่ครบกำหนดตรงวันเงินเดือนถัดไปถูกหักด้วย (R15 ทางปลอดภัย)', () => {
    expect(run([bill({ dueDay: 25 })], '2026-11-05', 25).total).toBe(150_000);
    expect(run([bill({ dueDay: 26 })], '2026-11-05', 25).total).toBe(0);
    expect(run([bill({ dueDay: 24 })], '2026-11-05', 25).total).toBe(150_000);
  });

  it('วันนี้คือวันเงินเดือน: ช่วงคือเดือนหน้า บิลก่อนวันเงินเดือนที่จ่ายแล้วไม่ถูกหัก', () => {
    const r = run([bill({ dueDay: 10, lastPaidMonth: '2026-11' })], '2026-11-25', 25);
    expect(r.nextPayday).toBe('2026-12-25');
    expect(r.items.map((u) => u.dueDate)).toEqual(['2026-12-10']);
  });

  it('วันนี้คือวันเงินเดือนและบิลครบกำหนดวันนั้น (ยังไม่จ่าย): หักทั้งรอบวันนี้และรอบเงินเดือนหน้า', () => {
    const r = run([bill({ dueDay: 25 })], '2026-11-25', 25);
    expect(r.items.map((u) => u.dueDate)).toEqual(['2026-11-25', '2026-12-25']);
    expect(r.total).toBe(300_000);
  });

  it('บิลครบกำหนด 31 ในเดือนสั้น ตรงวันเงินเดือนที่บีบเป็นวันสุดท้ายของเดือน', () => {
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

  it('วันนี้คือวันเงินเดือนแต่บิลเดือนนี้ยังไม่จ่าย: นับเป็นบิลค้าง (overdue) + รอบหน้า', () => {
    const r = run([bill({ dueDay: 10 })], '2026-11-25', 25);
    expect(r.items.map((u) => [u.dueDate, u.overdue])).toEqual([
      ['2026-11-10', true],
      ['2026-12-10', false],
    ]);
    expect(r.total).toBe(300_000);
  });

  it('ข้ามปีและเดือนสั้น: 31 ธ.ค. กับเงินเดือนวันที่ 30 และ 30 เม.ย. กับวันที่ 31', () => {
    expect(run([], '2026-12-31', 30).nextPayday).toBe('2027-01-30');
    expect(run([], '2026-04-30', 31).nextPayday).toBe('2026-05-31');
  });

  it('วันที่เหลือ 1 วัน (วันก่อนเงินเดือน): บิลที่ครบกำหนดวันนี้ถูกหัก', () => {
    const r = run([bill({ dueDay: 24 })], '2026-11-24', 25);
    expect(r.items).toHaveLength(1);
    expect(r.total).toBe(150_000);
  });

  it('ครบวงจรกับ computeSafeToSpend (บิลหักแล้ว วันที่เหลือตรงกัน): เงินในกระเป๋า 400,000 สำรอง 100,000 บิล 100,000 → ใช้ได้ 200,000 / 20 วัน = 10,000 ต่อวัน', () => {
    const r = run([bill({ dueDay: 10, amount: 100_000 })], '2026-11-05', 25, { cash: 400_000, reserve: 100_000 });
    expect(r.safe).toMatchObject({ kind: 'value', available: 200_000, daysLeft: 20, perDay: 10_000, nextPayday: r.nextPayday, outstanding: 100_000, reserve: 100_000, invalidBills: 0 });
    // ผลเท่ากับสูตรหลักที่ production เรียกข้างใน
    expect(computeSafeToSpend({ spendable: 400_000, outstanding: r.total, reserve: 100_000, today: '2026-11-05', payDay: 25 })).toMatchObject({ kind: 'ok', available: 200_000, daysLeft: 20, perDay: 10_000 });
  });

  it('บิลค้างเดือนก่อน (startMonth) ถูกรวมในยอดก่อนเงินเดือน', () => {
    const r = run([bill({ dueDay: 30, startMonth: '2026-10', amount: 80_000 })], '2026-11-01', 25);
    expect(r.total).toBe(80_000);
    expect(r.items[0]).toMatchObject({ overdue: true, cycleMonth: '2026-10' });
  });

  it('ไม่ตั้งวันเงินเดือน = needs-setup (ไม่คำนวณ) · บิลเก็บถาวรไม่ถูกนับ', () => {
    expect(buildSafeToSpend(accounts, opening(1000), { bills: [bill()], settings: {} }, '2026-11-05')).toEqual({ kind: 'needs-setup' });
    expect(run([bill({ archived: true, dueDay: 99 })], '2026-11-05', 25).total).toBe(0);
  });
});

describe('บิลข้อมูลเสียต้องไม่ทำให้หน้าเว็บพัง: แสดงข้อความภาษาคนผ่าน friendlyError', () => {
  const accounts: Account[] = [{ id: 'w1', type: 'asset', name: 'เงินสด', currency: 'THB' }];
  const settings: FinanceSettings = { payDay: 25 };
  const bad: Bill[] = [
    bill({ id: 'zero', amount: 0 }),
    bill({ id: 'neg', amount: -100 }),
    bill({ id: 'day32', dueDay: 32 }),
    bill({ id: 'badpaid', lastPaidMonth: '2026-13' }),
    bill({ id: 'frac', amount: 10.5 }),
  ];
  const good = bill({ id: 'ok', amount: 90_000, dueDay: 10 });

  it('บิลเสียถูกข้าม + นับจำนวนเตือน · ยอดค้างนับเฉพาะบิลที่ถูกต้อง (ไม่โยน error ทั้งก้อน)', () => {
    const safe = buildSafeToSpend(accounts, [], { bills: [...bad, good], settings }, '2026-11-05');
    expect(safe).toMatchObject({ kind: 'value', outstanding: 90_000, invalidBills: 5 });
    const panel = buildUpcomingPanel({ bills: [...bad, good], settings }, '2026-11-05');
    expect(panel).toMatchObject({ kind: 'list', total: 90_000, invalidBills: 5 });
  });

  it('มีแต่บิลเสียทั้งหมด: ไม่พัง ยอดค้าง 0 และบอกจำนวนบิลเสีย', () => {
    expect(buildSafeToSpend(accounts, [], { bills: bad, settings }, '2026-11-05')).toMatchObject({ kind: 'value', outstanding: 0, invalidBills: 5 });
    expect(buildUpcomingPanel({ bills: bad, settings }, '2026-11-05')).toEqual({ kind: 'clear', invalidBills: 5 });
  });

  it('ยอดรวมใหญ่เกินช่วงปลอดภัย (RangeError): คืน kind=error พร้อมข้อความไทยจาก friendlyError ไม่ใช่การโยนข้อผิดพลาด', () => {
    const huge = [bill({ id: 'h1', amount: Number.MAX_SAFE_INTEGER }), bill({ id: 'h2', amount: Number.MAX_SAFE_INTEGER })];
    const expected = friendlyError(new RangeError('x'));
    const safe = buildSafeToSpend(accounts, [], { bills: huge, settings }, '2026-11-05');
    expect(safe).toEqual({ kind: 'error', message: expected });
    const panel = buildUpcomingPanel({ bills: huge, settings }, '2026-11-05');
    expect(panel).toEqual({ kind: 'error', message: expected });
    expect(expected).toMatch(/[ก-๙]/);
  });

  it('ข้อมูลผิดชนิดจนเกิดข้อผิดพลาดอื่น (ไม่ใช่ RangeError): คืน kind=error ข้อความไทยทั่วไป ไม่พังทั้งหน้า', () => {
    const weird = [null as unknown as Bill];
    const safe = buildSafeToSpend(accounts, [], { bills: weird, settings }, '2026-11-05');
    const generic = 'คำนวณไม่สำเร็จ ตรวจข้อมูลบิลและค่าตั้งค่า';
    expect(safe).toEqual({ kind: 'error', message: generic });
    // เดิม buildUpcomingPanel อ่านบิลก่อนเข้า try จึงโยน TypeError ทำให้ทั้งหน้าพัง (พบตอนย้ายเทสต์ 14 พ.ย. 2569) · ตอนนี้ต้องเป็น error ภาษาคน
    expect(buildUpcomingPanel({ bills: weird, settings }, '2026-11-05')).toEqual({ kind: 'error', message: generic });
    expect(friendlyError(new TypeError('x'), generic)).toBe(generic);
  });

  it('หน้าจอ: การ์ดและแผงบิลแสดงคำเตือน "ข้อมูลผิด" และข้อความผิดพลาดภาษาไทย (ไม่โยน error ตอนเรนเดอร์)', () => {
    const cards = (bills: Bill[]) =>
      renderToString(
        createElement(SummaryCards, { accounts, entries: [], today: '2026-11-05', finance: { bills, settings }, onOpenLedger: () => undefined, onOpenBills: () => undefined, onAdd: () => undefined }),
      ).replace(/<!-- -->/g, '');
    expect(cards([...bad, good])).toContain('มีบิล 5 ใบข้อมูลผิด');
    const huge = [bill({ id: 'h1', amount: Number.MAX_SAFE_INTEGER }), bill({ id: 'h2', amount: Number.MAX_SAFE_INTEGER })];
    expect(cards(huge)).toContain(friendlyError(new RangeError('x')));
    const panel = (bills: Bill[]) =>
      renderToString(createElement(UpcomingBillsPanel, { finance: { bills, settings }, today: '2026-11-05', onOpenBills: () => undefined })).replace(/<!-- -->/g, '');
    expect(panel([...bad, good])).toContain('มีบิล 5 ใบข้อมูลผิด');
    expect(panel(huge)).toContain(friendlyError(new RangeError('x')));
  });
});
