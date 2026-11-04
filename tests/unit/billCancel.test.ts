import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildInitialLedger } from '../../src/app/setup';
import type { Bill } from '../../src/domain/bills/types';
import { runIntegrityCheck } from '../../src/domain/ledger/integrity';
import { createEntry } from '../../src/domain/ledger/entry';
import { MoneyDB } from '../../src/storage/db';
import {
  addBill,
  cancelBillPayment,
  cancelLatestBillPayment,
  deleteBill,
  deleteEntry,
  loadLedger,
  payBill,
  saveInitialLedger,
  StorageError,
  updateEntry,
} from '../../src/storage/repository';

let db: MoneyDB;
let n = 0;
let walletId: string;
let categoryId: string;

beforeEach(async () => {
  n += 1;
  db = new MoneyDB(`cancel-${n}-${Math.random().toString(36).slice(2)}`);
  await saveInitialLedger(db, buildInitialLedger([{ name: 'CashFlow', opening: '5408.41' }], '2026-11-01'));
  const accts = await db.accounts.toArray();
  walletId = accts.find((a) => a.type === 'asset')!.id;
  categoryId = accts.find((a) => a.type === 'expense')!.id;
});
afterEach(async () => {
  await db.delete();
});

const bill = (over: Partial<Bill> = {}): Bill => ({ id: 'bill-1', name: 'ค่าเน็ต', amount: 59_900, dueDay: 5, ...over });
const pay = (over = {}) => payBill(db, 'bill-1', { today: '2026-11-04', walletId, categoryId, entryId: 'pay-1', ...over });

describe('ผูกรายการจ่ายกับบิลและรอบ (R15)', () => {
  it('payBill ใส่ bill = {id, cycle, before} ในรายการที่บันทึกจริง', async () => {
    await addBill(db, bill({ lastPaidMonth: '2026-10' }), '2026-11-04');
    const r = await pay();
    expect(r.entry.bill).toEqual({ id: 'bill-1', cycle: '2026-11', before: '2026-10' });
    expect((await db.entries.get('pay-1'))?.bill).toEqual({ id: 'bill-1', cycle: '2026-11', before: '2026-10' });
  });

  it('จ่ายรอบแรก (ไม่เคยจ่าย) -> ไม่มีคีย์ before', async () => {
    await addBill(db, bill(), '2026-11-04');
    const r = await pay();
    expect(r.entry.bill).toEqual({ id: 'bill-1', cycle: '2026-11' });
    expect('before' in r.entry.bill!).toBe(false);
  });

  it('createEntry ปฏิเสธลิงก์ผิดรูป และคัดลอกเฉพาะฟิลด์ที่รู้จัก', () => {
    const lines = [
      { accountId: categoryId, amount: 100 },
      { accountId: walletId, amount: -100 },
    ];
    const base = { id: 'x', date: '2026-11-04', memo: 'm', source: 'recurring' as const, lines };
    const accounts = [
      { id: categoryId, type: 'expense' as const, name: 'c', currency: 'THB' },
      { id: walletId, type: 'asset' as const, name: 'w', currency: 'THB' },
    ];
    expect(() => createEntry(accounts, { ...base, bill: { id: '', cycle: '2026-11' } })).toThrow();
    expect(() => createEntry(accounts, { ...base, bill: { id: 'b', cycle: '2026-13' } })).toThrow();
    expect(() => createEntry(accounts, { ...base, bill: { id: 'b', cycle: '2026-11', before: 'nope' } })).toThrow();
    const ok = createEntry(accounts, { ...base, bill: { id: 'b', cycle: '2026-11', extra: 1 } as never });
    expect(ok.bill).toEqual({ id: 'b', cycle: '2026-11' });
  });
});

describe('ยกเลิกการจ่ายบิล (atomic)', () => {
  it('ลบรายการและคืน lastPaidMonth เดิมพร้อมกัน สมุดบัญชียังสมดุล ยอดกระเป๋าคืน', async () => {
    await addBill(db, bill({ lastPaidMonth: '2026-10' }), '2026-11-04');
    const r = await pay();
    const res = await cancelBillPayment(db, r.entry.id);
    expect(res.entry.id).toBe('pay-1');
    expect(res.bill?.lastPaidMonth).toBe('2026-10');
    expect(await db.entries.get('pay-1')).toBeUndefined();
    expect((await db.bills.get('bill-1'))?.lastPaidMonth).toBe('2026-10');
    const { accounts, entries } = await loadLedger(db);
    expect(runIntegrityCheck(accounts, entries).ok).toBe(true);
  });

  it('คืนเป็น "ยังไม่เคยจ่าย" ได้ และจ่ายใหม่ได้อีกครั้งในรอบเดิม', async () => {
    await addBill(db, bill(), '2026-11-04');
    await pay();
    await cancelBillPayment(db, 'pay-1');
    expect((await db.bills.get('bill-1'))?.lastPaidMonth).toBeUndefined();
    const again = await pay({ entryId: 'pay-2' });
    expect(again.cycle).toBe('2026-11');
  });

  it('ยกเลิกได้เฉพาะรอบล่าสุด: รอบเก่าที่มีรอบใหม่ตามหลังถูกปฏิเสธ ไม่แตะอะไร', async () => {
    await addBill(db, bill({ startMonth: '2026-10' }), '2026-11-04');
    await pay();
    await pay({ entryId: 'pay-2' });
    await expect(cancelBillPayment(db, 'pay-1')).rejects.toBeInstanceOf(StorageError);
    expect(await db.entries.get('pay-1')).toBeDefined();
    expect((await db.bills.get('bill-1'))?.lastPaidMonth).toBe('2026-11');
    await cancelBillPayment(db, 'pay-2');
    await cancelBillPayment(db, 'pay-1');
    expect((await db.bills.get('bill-1'))?.lastPaidMonth).toBeUndefined();
  });

  it('ยกเลิกซ้ำ/รายการหาย/ไม่ใช่รายการจ่ายบิล/รายการเก่าไม่มีลิงก์ -> StorageError', async () => {
    await addBill(db, bill(), '2026-11-04');
    await pay();
    await cancelBillPayment(db, 'pay-1');
    await expect(cancelBillPayment(db, 'pay-1')).rejects.toBeInstanceOf(StorageError);
    await expect(cancelBillPayment(db, 'opening-wallet-1')).rejects.toBeInstanceOf(StorageError);
    const manual = createEntry(await db.accounts.toArray(), {
      id: 'm1',
      date: '2026-11-04',
      memo: 'x',
      lines: [
        { accountId: categoryId, amount: 100 },
        { accountId: walletId, amount: -100 },
      ],
    });
    await db.entries.add(manual);
    await expect(cancelBillPayment(db, 'm1')).rejects.toBeInstanceOf(StorageError);
    await db.entries.add({ ...manual, id: 'legacy', source: 'recurring' });
    await expect(cancelBillPayment(db, 'legacy')).rejects.toBeInstanceOf(StorageError);
    expect(await db.entries.get('legacy')).toBeDefined();
  });

  it('สถานะจ่ายถูกเปลี่ยนไปแล้ว (lastPaidMonth ไม่ตรงรอบ) -> ปฏิเสธ รายการยังอยู่', async () => {
    await addBill(db, bill(), '2026-11-04');
    await pay();
    await db.bills.put({ ...(await db.bills.get('bill-1'))!, lastPaidMonth: '2026-10' });
    await expect(cancelBillPayment(db, 'pay-1')).rejects.toBeInstanceOf(StorageError);
    expect(await db.entries.get('pay-1')).toBeDefined();
  });

  it('บิลถูกลบไปแล้ว -> ลบเฉพาะรายการ (ไม่มี lastPaidMonth ให้คืน) ไม่ค้างล็อกถาวร', async () => {
    await addBill(db, bill(), '2026-11-04');
    await pay();
    await deleteBill(db, 'bill-1');
    const res = await cancelBillPayment(db, 'pay-1');
    expect(res.bill).toBeUndefined();
    expect(await db.entries.get('pay-1')).toBeUndefined();
  });

  it('ถ้าเขียนบิลล้มเหลว รายการไม่ถูกลบ (atomic) -- ลิงก์ before ผิดรูปถูกปฏิเสธก่อนลบ', async () => {
    await addBill(db, bill(), '2026-11-04');
    await pay();
    const e = (await db.entries.get('pay-1'))!;
    await db.entries.put({ ...e, bill: { id: 'bill-1', cycle: '2026-11', before: '2099-99' } });
    await expect(cancelBillPayment(db, 'pay-1')).rejects.toBeInstanceOf(StorageError);
    expect(await db.entries.get('pay-1')).toBeDefined();
    expect((await db.bills.get('bill-1'))?.lastPaidMonth).toBe('2026-11');
  });
});

describe('ข้อมูลลิงก์เสีย (ผลตรวจ money-auditor)', () => {
  const lines = () => [
    { accountId: categoryId, amount: 100 },
    { accountId: walletId, amount: -100 },
  ];

  it('before ต้องมาก่อน cycle: createEntry ปฏิเสธ before >= cycle และอนาคตไม่หลุดเข้า lastPaidMonth', async () => {
    const accounts = await db.accounts.toArray();
    const mk = (before: string) =>
      createEntry(accounts, { id: 'x', date: '2026-11-04', memo: 'm', source: 'recurring', bill: { id: 'b', cycle: '2026-10', before }, lines: lines() });
    expect(() => mk('2026-10')).toThrow();
    expect(() => mk('2099-12')).toThrow();
    expect(mk('2026-09').bill?.before).toBe('2026-09');
  });

  it('ข้อมูลเสียในฐาน (before >= cycle) -> ยกเลิกถูกปฏิเสธก่อนลบ ไม่ตั้ง lastPaidMonth อนาคต', async () => {
    await addBill(db, bill(), '2026-11-04');
    await pay();
    const e = (await db.entries.get('pay-1'))!;
    await db.entries.put({ ...e, bill: { id: 'bill-1', cycle: '2026-11', before: '2099-12' } });
    await expect(cancelBillPayment(db, 'pay-1')).rejects.toBeInstanceOf(StorageError);
    await db.entries.put({ ...e, bill: { id: 'bill-1', cycle: '2026-11', before: '2026-11' } });
    await expect(cancelBillPayment(db, 'pay-1')).rejects.toBeInstanceOf(StorageError);
    expect(await db.entries.get('pay-1')).toBeDefined();
    expect((await db.bills.get('bill-1'))?.lastPaidMonth).toBe('2026-11');
  });

  it('ลิงก์บิลใช้ได้เฉพาะ source recurring และ deleteEntry ไม่ลบรายการที่มีลิงก์แบบเงียบๆ', async () => {
    const accounts = await db.accounts.toArray();
    expect(() =>
      createEntry(accounts, { id: 'x', date: '2026-11-04', memo: 'm', bill: { id: 'b', cycle: '2026-11' }, lines: lines() }),
    ).toThrow();
    await addBill(db, bill(), '2026-11-04');
    await pay();
    const e = (await db.entries.get('pay-1'))!;
    await db.entries.put({ ...e, source: 'manual' }); // ข้อมูลเสีย: มีลิงก์แต่ source ผิด
    await expect(deleteEntry(db, 'pay-1')).rejects.toBeInstanceOf(StorageError);
    expect(await db.entries.get('pay-1')).toBeDefined();
  });
});

describe('ยกเลิกรอบล่าสุดจากหน้าบิล', () => {
  it('หารายการของ lastPaidMonth ปัจจุบันแล้วยกเลิก', async () => {
    await addBill(db, bill(), '2026-11-04');
    await pay();
    const res = await cancelLatestBillPayment(db, 'bill-1');
    expect(res.entry.id).toBe('pay-1');
    expect((await db.bills.get('bill-1'))?.lastPaidMonth).toBeUndefined();
  });

  it('ยังไม่เคยจ่าย / ไม่พบบิล / จ่ายก่อนมีลิงก์ -> StorageError ไม่แตะข้อมูล', async () => {
    await addBill(db, bill(), '2026-11-04');
    await expect(cancelLatestBillPayment(db, 'bill-1')).rejects.toBeInstanceOf(StorageError);
    await expect(cancelLatestBillPayment(db, 'ghost')).rejects.toBeInstanceOf(StorageError);
    await db.bills.put({ ...(await db.bills.get('bill-1'))!, lastPaidMonth: '2026-11' });
    await expect(cancelLatestBillPayment(db, 'bill-1')).rejects.toBeInstanceOf(StorageError);
    expect((await db.bills.get('bill-1'))?.lastPaidMonth).toBe('2026-11');
  });
});

describe('ลบ/แก้จากสมุดบัญชี', () => {
  it('deleteEntry ของรายการจ่ายบิลที่มีลิงก์ = ยกเลิกการจ่าย (คืน lastPaidMonth ด้วย)', async () => {
    await addBill(db, bill(), '2026-11-04');
    await pay();
    await deleteEntry(db, 'pay-1');
    expect(await db.entries.get('pay-1')).toBeUndefined();
    expect((await db.bills.get('bill-1'))?.lastPaidMonth).toBeUndefined();
  });

  it('deleteEntry ของรายการ recurring ที่ไม่มีลิงก์ ยังถูกล็อก', async () => {
    const manual = createEntry(await db.accounts.toArray(), {
      id: 'legacy',
      date: '2026-11-04',
      memo: 'x',
      source: 'recurring',
      lines: [
        { accountId: categoryId, amount: 100 },
        { accountId: walletId, amount: -100 },
      ],
    });
    await db.entries.add(manual);
    await expect(deleteEntry(db, 'legacy')).rejects.toBeInstanceOf(StorageError);
  });

  it('updateEntry ของรายการจ่ายบิลยังถูกล็อก (แก้ยอดทำให้ไม่ตรงบิล)', async () => {
    await addBill(db, bill(), '2026-11-04');
    const r = await pay();
    await expect(
      updateEntry(db, 'pay-1', { id: 'pay-1', date: r.entry.date, memo: 'x', lines: r.entry.lines }),
    ).rejects.toBeInstanceOf(StorageError);
  });
});
