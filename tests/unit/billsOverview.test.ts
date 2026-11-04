import { describe, expect, it } from 'vitest';
import {
  buildOutgoingSplit,
  buildSafeToSpend,
  buildUpcomingPanel,
} from '../../src/app/billsOverview';
import { buildOverview } from '../../src/app/overview';
import { buildInitialLedger } from '../../src/app/setup';
import { effectiveNextPayday } from '../../src/domain/bills/calendar';
import { sanitizeSettings, settingsProblem } from '../../src/domain/bills/settings';
import type { Bill } from '../../src/domain/bills/types';
import { createEntry } from '../../src/domain/ledger/entry';
import { buildCashFlow } from '../../src/domain/ledger/sankey';
import type { Entry } from '../../src/domain/ledger/types';

// ยอดยกมา 10,000.00 บาท = 1,000,000 สตางค์ ณ 1 พ.ย. 2569
const { accounts, entries: opening } = buildInitialLedger([{ name: 'CashFlow', opening: '10000' }], '2026-11-01');

const bill = (over: Partial<Bill> = {}): Bill => ({ id: 'b1', name: 'ค่าเน็ต', amount: 60_000, dueDay: 10, ...over });
const spend = (id: string, date: string, amount: number, source: Entry['source'] = 'manual', category = 'expense-food'): Entry =>
  createEntry(accounts, {
    id,
    date,
    memo: id,
    source,
    lines: [
      { accountId: category, amount },
      { accountId: 'wallet-1', amount: -amount },
    ],
  });

describe('วันเงินเดือนถัดไปที่ผู้ใช้กำหนดเอง (override)', () => {
  it('override หลังวันนี้ใช้ได้ · ไม่เกินวันนี้ถือว่าหมดอายุและกลับไปคำนวณปกติ', () => {
    expect(effectiveNextPayday(25, '2026-11-04', '2026-11-20')).toBe('2026-11-20');
    expect(effectiveNextPayday(25, '2026-11-04', '2026-11-04')).toBe('2026-11-25');
    expect(effectiveNextPayday(25, '2026-11-04', '2026-11-01')).toBe('2026-11-25');
    expect(effectiveNextPayday(25, '2026-11-04', undefined)).toBe('2026-11-25');
  });
  it('settings: ตรวจรูปแบบวันที่ ทิ้งค่าผิดตอนอ่าน', () => {
    expect(settingsProblem({ nextPaydayOverride: '2026-02-30' })).not.toBeNull();
    expect(settingsProblem({ nextPaydayOverride: '2026-11-20' })).toBeNull();
    expect(sanitizeSettings({ nextPaydayOverride: 'xx', payDay: 5 })).toEqual({ payDay: 5 });
    expect(sanitizeSettings({ nextPaydayOverride: '2026-11-20' })).toEqual({ nextPaydayOverride: '2026-11-20' });
  });
});

describe('buildSafeToSpend (R15)', () => {
  it('ยังไม่ตั้งวันเงินเดือน = needs-setup', () => {
    expect(buildSafeToSpend(accounts, opening, { bills: [], settings: {} }, '2026-11-04').kind).toBe('needs-setup');
  });

  it('หักบิลค้างก่อนเงินเดือนและเป้าออม แล้วหารจำนวนวัน (1,000,000 − 60,000 − 100,000) ÷ 22 วัน', () => {
    const s = buildSafeToSpend(
      accounts,
      opening,
      { bills: [bill()], settings: { payDay: 26, monthlySavingsGoal: 100_000 } },
      '2026-11-04',
    );
    expect(s).toMatchObject({
      kind: 'value',
      daysLeft: 22,
      nextPayday: '2026-11-26',
      outstanding: 60_000,
      reserve: 100_000,
      available: 840_000,
      perDay: 38_182, // 840000/22 = 38181.8 ปัดครึ่งขึ้น
      shortfall: 0,
      lowDays: false,
      invalidBills: 0,
      overridden: false,
    });
  });

  it('บิลที่จ่ายแล้วไม่ถูกหัก · บิลครบกำหนดหลังเงินเดือนไม่ถูกหัก', () => {
    const paid = bill({ lastPaidMonth: '2026-11' });
    const later = bill({ id: 'b2', dueDay: 28 });
    const s = buildSafeToSpend(accounts, opening, { bills: [paid, later], settings: { payDay: 26 } }, '2026-11-04');
    expect(s).toMatchObject({ kind: 'value', outstanding: 0 });
  });

  it('ยอดไม่พอ: perDay = 0 พร้อมยอดที่ขาด (ไม่ติดลบ)', () => {
    const s = buildSafeToSpend(accounts, opening, { bills: [bill({ amount: 2_000_000 })], settings: { payDay: 26 } }, '2026-11-04');
    expect(s).toMatchObject({ kind: 'value', perDay: 0, shortfall: 1_000_000 });
  });

  it('เหลือน้อยกว่า 3 วันก่อนเงินเดือน = lowDays', () => {
    expect(buildSafeToSpend(accounts, opening, { bills: [], settings: { payDay: 6 } }, '2026-11-04')).toMatchObject({
      daysLeft: 2,
      lowDays: true,
    });
    expect(buildSafeToSpend(accounts, opening, { bills: [], settings: { payDay: 7 } }, '2026-11-04')).toMatchObject({
      daysLeft: 3,
      lowDays: false,
    });
  });

  it('override เงินเดือนถัดไป เปลี่ยนจำนวนวันและบอกว่ามีการ override', () => {
    const s = buildSafeToSpend(accounts, opening, { bills: [], settings: { payDay: 26, nextPaydayOverride: '2026-11-14' } }, '2026-11-04');
    expect(s).toMatchObject({ daysLeft: 10, nextPayday: '2026-11-14', overridden: true, perDay: 100_000 });
  });

  it('override ที่หมดอายุไม่มีผล', () => {
    const s = buildSafeToSpend(accounts, opening, { bills: [], settings: { payDay: 26, nextPaydayOverride: '2026-11-02' } }, '2026-11-04');
    expect(s).toMatchObject({ nextPayday: '2026-11-26', overridden: false });
  });

  it('บิลข้อมูลผิดถูกข้ามและนับจำนวนไว้เตือน (ไม่ทำให้การ์ดพัง)', () => {
    const s = buildSafeToSpend(
      accounts,
      opening,
      { bills: [bill(), bill({ id: 'bad', dueDay: 99 })], settings: { payDay: 26 } },
      '2026-11-04',
    );
    expect(s).toMatchObject({ kind: 'value', invalidBills: 1, outstanding: 60_000 });
  });

  it('ยอดรวมบิลใหญ่เกินช่วงปลอดภัย = error พร้อมข้อความ (ไม่ throw)', () => {
    const huge = Number.MAX_SAFE_INTEGER;
    const s = buildSafeToSpend(
      accounts,
      opening,
      { bills: [bill({ id: 'a', amount: huge }), bill({ id: 'c', amount: huge })], settings: { payDay: 26 } },
      '2026-11-04',
    );
    expect(s.kind).toBe('error');
  });

  it('ยอดกระเป๋า 0 และไม่มีบิล: perDay 0 ไม่ใช่ error', () => {
    const empty = buildInitialLedger([{ name: 'A', opening: '' }], '2026-11-01');
    expect(buildSafeToSpend(empty.accounts, empty.entries, { bills: [], settings: { payDay: 26 } }, '2026-11-04')).toMatchObject({
      kind: 'value',
      perDay: 0,
      shortfall: 0,
    });
  });
});

describe('buildOutgoingSplit: แยกบิล / ใช้จ่าย + งบเดือน', () => {
  const entries = [...opening, spend('food', '2026-11-02', 30_000), spend('net', '2026-11-03', 60_000, 'recurring', 'expense-housing')];

  it('บิล = รายจ่ายของรายการ recurring · ใช้จ่าย = ที่เหลือ รวมกันเท่ายอดรายจ่าย', () => {
    const r = buildOutgoingSplit(accounts, entries, {}, '2026-11-04');
    expect(r).toMatchObject({ total: 90_000, bills: 60_000, spend: 30_000, budget: null });
  });

  it('ไม่นับรายการเดือนอื่นหรือวันล่วงหน้า', () => {
    const e = [...entries, spend('old', '2026-10-30', 10_000, 'recurring'), spend('future', '2026-11-20', 10_000, 'recurring')];
    expect(buildOutgoingSplit(accounts, e, {}, '2026-11-04')).toMatchObject({ total: 90_000, bills: 60_000 });
  });

  it('มีเป้างบ: บอกเหลือ/เกิน · งบ 0 ไม่ใช่ยังไม่ตั้ง', () => {
    expect(buildOutgoingSplit(accounts, entries, { monthlyBudget: 100_000 }, '2026-11-04').budget).toEqual({
      limit: 100_000,
      remaining: 10_000,
      over: 0,
    });
    expect(buildOutgoingSplit(accounts, entries, { monthlyBudget: 50_000 }, '2026-11-04').budget).toEqual({
      limit: 50_000,
      remaining: 0,
      over: 40_000,
    });
    expect(buildOutgoingSplit(accounts, entries, { monthlyBudget: 0 }, '2026-11-04').budget).toEqual({
      limit: 0,
      remaining: 0,
      over: 90_000,
    });
  });
});

describe('buildUpcomingPanel', () => {
  it('ยังไม่มีบิล = none · มีบิลแต่ไม่มีที่ต้องจ่ายในช่วง = none พร้อมจำนวนบิลทั้งหมด', () => {
    expect(buildUpcomingPanel({ bills: [], settings: {} }, '2026-11-04')).toMatchObject({ kind: 'no-bills' });
    expect(buildUpcomingPanel({ bills: [bill({ lastPaidMonth: '2026-11' })], settings: { payDay: 26 } }, '2026-11-04')).toMatchObject({
      kind: 'clear',
    });
  });

  it('เรียงตามวันครบกำหนด เลยกำหนดขึ้นก่อน และตัดแสดงไม่เกิน 5 พร้อมจำนวนที่ซ่อน', () => {
    const bills = Array.from({ length: 7 }, (_, i) => bill({ id: `b${i}`, name: `บิล${i}`, dueDay: 5 + i }));
    const r = buildUpcomingPanel({ bills, settings: { payDay: 26 } }, '2026-11-04');
    expect(r.kind).toBe('list');
    if (r.kind !== 'list') return;
    expect(r.items.map((i) => i.bill.id)).toEqual(['b0', 'b1', 'b2', 'b3', 'b4']);
    expect(r.hidden).toBe(2);
    expect(r.total).toBe(7 * 60_000);
  });

  it('ไม่ตั้งวันเงินเดือน: มองล่วงหน้า 30 วัน · บิลเสียนับไว้เตือน', () => {
    const r = buildUpcomingPanel({ bills: [bill({ dueDay: 30 }), bill({ id: 'x', dueDay: 0 })], settings: {} }, '2026-11-04');
    expect(r).toMatchObject({ kind: 'list', invalidBills: 1 });
  });

  it('ยอดรวมใหญ่เกินช่วง = error', () => {
    const huge = Number.MAX_SAFE_INTEGER;
    const r = buildUpcomingPanel(
      { bills: [bill({ id: 'a', amount: huge }), bill({ id: 'c', amount: huge })], settings: { payDay: 26 } },
      '2026-11-04',
    );
    expect(r.kind).toBe('error');
  });
});

describe('buildOverview รับข้อมูลบิล', () => {
  it('ไม่ส่ง finance = เหมือนเดิม (needs-setup)', () => {
    expect(buildOverview(accounts, opening, '2026-11-04').safeToSpend.kind).toBe('needs-setup');
  });
  it('ส่ง finance = การ์ด SAFE-TO-SPEND และ OUTGOING มีข้อมูลบิล', () => {
    const entries = [...opening, spend('net', '2026-11-03', 60_000, 'recurring', 'expense-housing')];
    const o = buildOverview(accounts, entries, '2026-11-04', { bills: [bill()], settings: { payDay: 26, monthlyBudget: 100_000 } });
    expect(o.safeToSpend).toMatchObject({ kind: 'value', daysLeft: 22 });
    expect(o.outgoing).toMatchObject({ kind: 'value', total: 60_000, bills: 60_000 });
  });
});

describe('Sankey: โหนดบิลประจำ (groupBills)', () => {
  const entries = [
    ...opening,
    spend('food', '2026-11-02', 30_000),
    spend('net', '2026-11-03', 60_000, 'recurring', 'expense-housing'),
    spend('rent', '2026-11-03', 500_000, 'recurring', 'expense-housing'),
  ];

  it('ปิดไว้เป็นค่าเริ่มต้น ผลเดิมไม่เปลี่ยน', () => {
    const f = buildCashFlow(accounts, entries, '2026-11');
    expect(f.categories.some((c) => c.key === 'bills')).toBe(false);
  });

  it('เปิด: รวมรายจ่ายของรายการ recurring เป็นโหนดเดียว ยอดรวม/สัดส่วนไม่เพี้ยน', () => {
    const plain = buildCashFlow(accounts, entries, '2026-11');
    const grouped = buildCashFlow(accounts, entries, '2026-11', undefined, { groupBills: true });
    const node = grouped.categories.find((c) => c.key === 'bills');
    expect(node).toMatchObject({ name: 'บิลประจำ', amount: 560_000, kind: 'bills' });
    expect(grouped.expense).toBe(plain.expense);
    expect(grouped.total).toBe(plain.total);
    const sum = grouped.categories.filter((c) => c.kind !== 'leftover').reduce((s, c) => s + c.amount, 0);
    expect(sum).toBe(grouped.expense);
  });

  it('ไม่มีรายการ recurring = ไม่มีโหนด', () => {
    const f = buildCashFlow(accounts, [...opening, spend('food', '2026-11-02', 30_000)], '2026-11', undefined, { groupBills: true });
    expect(f.categories.some((c) => c.key === 'bills')).toBe(false);
  });
});
