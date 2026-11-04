import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildInitialLedger } from '../../src/app/setup';
import type { Bill } from '../../src/domain/bills/types';
import { runIntegrityCheck } from '../../src/domain/ledger/integrity';
import { MoneyDB } from '../../src/storage/db';
import {
  addBill,
  clearMigrationSnapshot,
  deleteBill,
  deleteEntry,
  updateBill,
  updateEntry,
  loadLedger,
  migrationSnapshotInfo,
  payBill,
  saveInitialLedger,
  StorageError,
  undoPayBill,
} from '../../src/storage/repository';

let db: MoneyDB;
let n = 0;
let walletId: string;
let categoryId: string;

beforeEach(async () => {
  n += 1;
  db = new MoneyDB(`pay-${n}-${Math.random().toString(36).slice(2)}`);
  await saveInitialLedger(
    db,
    buildInitialLedger([{ name: 'CashFlow', opening: '5408.41' }, { name: 'Vault Zero', opening: '2500' }], '2026-11-01'),
  );
  const accts = await db.accounts.toArray();
  walletId = accts.find((a) => a.type === 'asset')!.id;
  categoryId = accts.find((a) => a.type === 'expense')!.id;
});
afterEach(async () => {
  await db.delete();
});

const bill = (over: Partial<Bill> = {}): Bill => ({ id: 'bill-1', name: 'ค่าเน็ต', amount: 59_900, dueDay: 5, ...over });
const pay = (over = {}) => payBill(db, 'bill-1', { today: '2026-11-04', walletId, categoryId, entryId: 'pay-1', ...over });

describe('จ่ายบิล (R15: ครั้งเดียวต่อรอบ, R4: เป็นรายจ่าย)', () => {
  it('สร้างรายจ่าย source=recurring ยอดตรงบิล + ตั้ง lastPaidMonth ในครั้งเดียว และสมุดบัญชียังสมดุล', async () => {
    await addBill(db, bill(), '2026-11-04');
    const before = await db.entries.count();
    const r = await pay();
    expect(r.cycle).toBe('2026-11');
    expect(r.before).toBeUndefined();
    expect(r.entry).toMatchObject({ id: 'pay-1', date: '2026-11-04', memo: 'ค่าเน็ต', source: 'recurring' });
    expect(r.entry.lines).toEqual([
      { accountId: categoryId, amount: 59_900 },
      { accountId: walletId, amount: -59_900 },
    ]);
    expect(await db.entries.count()).toBe(before + 1);
    expect((await db.bills.get('bill-1'))?.lastPaidMonth).toBe('2026-11');
    const { accounts, entries } = await loadLedger(db);
    expect(runIntegrityCheck(accounts, entries).ok).toBe(true);
  });

  it('จ่ายซ้ำรอบเดิมถูกปฏิเสธ ไม่สร้างรายการเพิ่ม', async () => {
    await addBill(db, bill(), '2026-11-04');
    await pay();
    const count = await db.entries.count();
    await expect(pay({ entryId: 'pay-2' })).rejects.toBeInstanceOf(StorageError);
    expect(await db.entries.count()).toBe(count);
  });

  it('ใช้กระเป๋า/หมวดของบิลได้ แต่ถ้าไม่มีที่ไหนเลย ต้องปฏิเสธ (ไม่เลือกให้เงียบๆ)', async () => {
    await addBill(db, bill({ walletId, categoryId }), '2026-11-04');
    const r = await payBill(db, 'bill-1', { today: '2026-11-04', entryId: 'p' });
    expect(r.entry.lines.map((l) => l.accountId)).toEqual([categoryId, walletId]);
    await addBill(db, bill({ id: 'bill-2' }), '2026-11-04');
    await expect(payBill(db, 'bill-2', { today: '2026-11-04', entryId: 'p2' })).rejects.toBeInstanceOf(StorageError);
  });

  it('กระเป๋าต้องเป็น asset หมวดต้องเป็น expense และไม่เปลี่ยนสถานะเมื่อล้มเหลว', async () => {
    await addBill(db, bill(), '2026-11-04');
    const income = (await db.accounts.toArray()).find((a) => a.type === 'income')!;
    await expect(pay({ categoryId: income.id })).rejects.toBeInstanceOf(StorageError);
    await expect(pay({ walletId: categoryId })).rejects.toBeInstanceOf(StorageError);
    await expect(pay({ walletId: 'nope' })).rejects.toBeInstanceOf(StorageError);
    expect((await db.bills.get('bill-1'))?.lastPaidMonth).toBeUndefined();
    expect(await db.entries.get('pay-1')).toBeUndefined();
  });

  it('รหัสรายการซ้ำ -> ล้มทั้งก้อน บิลไม่ถูกตั้งว่าจ่าย (atomic)', async () => {
    await addBill(db, bill(), '2026-11-04');
    await expect(pay({ entryId: 'opening-wallet-1' })).rejects.toThrow();
    expect((await db.bills.get('bill-1'))?.lastPaidMonth).toBeUndefined();
  });

  it('จ่ายรอบที่ค้างเก่าที่สุดก่อน (บิลมี startMonth เดือนก่อน)', async () => {
    await addBill(db, bill({ startMonth: '2026-10' }), '2026-11-04');
    expect((await pay()).cycle).toBe('2026-10');
    expect((await pay({ entryId: 'pay-2' })).cycle).toBe('2026-11');
    await expect(pay({ entryId: 'pay-3' })).rejects.toBeInstanceOf(StorageError);
  });

  it('บิลที่เก็บถาวรหรือไม่พบ จ่ายไม่ได้', async () => {
    await addBill(db, bill({ archived: true }), '2026-11-04');
    await expect(pay()).rejects.toBeInstanceOf(StorageError);
    await expect(payBill(db, 'ghost', { today: '2026-11-04', walletId, categoryId, entryId: 'x' })).rejects.toBeInstanceOf(
      StorageError,
    );
  });

  it('วันนี้ผิดรูป -> StorageError', async () => {
    await addBill(db, bill(), '2026-11-04');
    await expect(pay({ today: 'xx' })).rejects.toBeInstanceOf(StorageError);
  });
});

describe('เลิกทำการจ่ายบิล', () => {
  it('ลบรายการจ่ายและคืน lastPaidMonth เดิมในธุรกรรมเดียว', async () => {
    await addBill(db, bill({ lastPaidMonth: '2026-10' }), '2026-11-04');
    const r = await pay();
    await undoPayBill(db, { entryId: r.entry.id, billId: 'bill-1', cycle: r.cycle, before: r.before });
    expect(await db.entries.get('pay-1')).toBeUndefined();
    expect((await db.bills.get('bill-1'))?.lastPaidMonth).toBe('2026-10');
  });

  it('คืนเป็น "ยังไม่เคยจ่าย" ได้ (before = undefined)', async () => {
    await addBill(db, bill(), '2026-11-04');
    const r = await pay();
    await undoPayBill(db, { entryId: r.entry.id, billId: 'bill-1', cycle: r.cycle, before: undefined });
    expect('lastPaidMonth' in ((await db.bills.get('bill-1')) ?? {})).toBe(false);
  });

  it('ปฏิเสธเมื่อสถานะถูกเปลี่ยนไปแล้ว และไม่ลบรายการ', async () => {
    await addBill(db, bill({ startMonth: '2026-10' }), '2026-11-04');
    const r1 = await pay();
    await pay({ entryId: 'pay-2' });
    await expect(
      undoPayBill(db, { entryId: r1.entry.id, billId: 'bill-1', cycle: r1.cycle, before: r1.before }),
    ).rejects.toBeInstanceOf(StorageError);
    expect(await db.entries.get('pay-1')).toBeDefined();
    expect((await db.bills.get('bill-1'))?.lastPaidMonth).toBe('2026-11');
  });

  it('รายการถูกลบไปก่อนแล้ว -> ปฏิเสธ ไม่แตะบิล', async () => {
    await addBill(db, bill(), '2026-11-04');
    const r = await pay();
    await db.entries.delete('pay-1');
    await expect(
      undoPayBill(db, { entryId: r.entry.id, billId: 'bill-1', cycle: r.cycle, before: r.before }),
    ).rejects.toBeInstanceOf(StorageError);
    expect((await db.bills.get('bill-1'))?.lastPaidMonth).toBe('2026-11');
  });

  it('ไม่ยอมลบรายการที่ไม่ใช่ source=recurring', async () => {
    await addBill(db, bill(), '2026-11-04');
    await pay();
    await expect(
      undoPayBill(db, { entryId: 'opening-wallet-1', billId: 'bill-1', cycle: '2026-11', before: undefined }),
    ).rejects.toBeInstanceOf(StorageError);
    expect(await db.entries.get('opening-wallet-1')).toBeDefined();
  });
});

describe('สำเนาก่อนอัปเกรด (snapshot:v1)', () => {
  it('อ่านสรุป ลบทิ้งได้ ลบซ้ำไม่พัง และไม่แตะข้อมูลจริง', async () => {
    expect(await migrationSnapshotInfo(db)).toBeNull();
    await db.meta.put({
      key: 'snapshot:v1',
      value: { schemaVersion: 1, takenAt: '2026-11-04T01:00:00.000Z', accounts: [{}, {}], entries: [{}] },
    });
    expect(await migrationSnapshotInfo(db)).toEqual({ takenAt: '2026-11-04T01:00:00.000Z', accounts: 2, entries: 1 });
    const accountsBefore = await db.accounts.count();
    await clearMigrationSnapshot(db);
    expect(await migrationSnapshotInfo(db)).toBeNull();
    await clearMigrationSnapshot(db);
    expect(await db.accounts.count()).toBe(accountsBefore);
  });

  it('ทนข้อมูลเสีย', async () => {
    await db.meta.put({ key: 'snapshot:v1', value: 'garbage' });
    expect(await migrationSnapshotInfo(db)).toEqual({ takenAt: undefined, accounts: 0, entries: 0 });
  });
});

describe('ผลตรวจ money-auditor B3', () => {
  it('expectedCycle ไม่ตรงรอบที่ต้องจ่ายจริง -> ปฏิเสธ ไม่จ่ายผิดรอบเงียบๆ', async () => {
    await addBill(db, bill({ startMonth: '2026-10' }), '2026-11-04');
    await pay({ expectedCycle: '2026-10' }); // แท็บ A จ่าย ต.ค.
    await expect(pay({ entryId: 'pay-2', expectedCycle: '2026-10' })).rejects.toBeInstanceOf(StorageError); // แท็บ B ยังเห็น ต.ค.
    expect((await db.bills.get('bill-1'))?.lastPaidMonth).toBe('2026-10');
    expect(await db.entries.get('pay-2')).toBeUndefined();
  });

  it('รายการจ่ายบิลลบ/แก้จากสมุดบัญชีตรงๆ ไม่ได้ (กันบิลค้างสถานะจ่าย)', async () => {
    await addBill(db, bill(), '2026-11-04');
    const r = await pay();
    await expect(deleteEntry(db, r.entry.id)).rejects.toBeInstanceOf(StorageError);
    await expect(
      updateEntry(db, r.entry.id, { id: r.entry.id, date: r.entry.date, memo: 'x', lines: r.entry.lines }),
    ).rejects.toBeInstanceOf(StorageError);
    expect(await db.entries.get(r.entry.id)).toBeDefined();
    // เลิกทำผ่านทางที่ถูกต้องยังทำได้
    await undoPayBill(db, { entryId: r.entry.id, billId: 'bill-1', cycle: r.cycle, before: r.before });
    expect(await db.entries.get(r.entry.id)).toBeUndefined();
  });

  it('จ่ายแล้วแก้บิล แล้วเลิกทำ ยังคืนสถานะถูก (updateBill คง lastPaidMonth)', async () => {
    await addBill(db, bill(), '2026-11-04');
    const r = await pay();
    await updateBill(db, bill({ name: 'ค่าเน็ตใหม่', amount: 70_000 }));
    await undoPayBill(db, { entryId: r.entry.id, billId: 'bill-1', cycle: r.cycle, before: r.before });
    const b = await db.bills.get('bill-1');
    expect(b?.name).toBe('ค่าเน็ตใหม่');
    expect(b?.lastPaidMonth).toBeUndefined();
  });

  it('ลบบิลที่จ่ายแล้วแล้วกู้คืน ยังคง lastPaidMonth และ startMonth', async () => {
    await addBill(db, bill(), '2026-11-04');
    await pay();
    const removed = await deleteBill(db, 'bill-1');
    await addBill(db, removed, '2026-11-04');
    expect(await db.bills.get('bill-1')).toMatchObject({ lastPaidMonth: '2026-11', startMonth: '2026-11' });
  });
});
