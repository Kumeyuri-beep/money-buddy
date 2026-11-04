import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildInitialLedger } from '../../src/app/setup';
import { settingsProblem } from '../../src/domain/bills/settings';
import type { Bill } from '../../src/domain/bills/types';
import { MoneyDB, SCHEMA_VERSION } from '../../src/storage/db';
import {
  addBill,
  deleteBill,
  exportSnapshot,
  loadBills,
  loadSettings,
  resetAll,
  saveInitialLedger,
  saveSettings,
  setBillPaidMonth,
  StorageError,
  updateBill,
} from '../../src/storage/repository';

let db: MoneyDB;
let n = 0;
beforeEach(() => {
  n += 1;
  db = new MoneyDB(`bills-${n}-${Math.random().toString(36).slice(2)}`);
});
afterEach(async () => {
  await db.delete();
});

const ledger = () =>
  buildInitialLedger([{ name: 'CashFlow', opening: '5408.41' }, { name: 'Vault Zero', opening: '2500' }], '2026-11-01');

const bill = (over: Partial<Bill> = {}): Bill => ({ id: 'bill-1', name: 'ค่าเน็ต', amount: 59_900, dueDay: 5, ...over });

describe('settingsProblem (R1: เป็นสตางค์จำนวนเต็มไม่ติดลบ, วันเงินเดือน 1-31)', () => {
  it('ค่าว่างใช้ได้ (ยังไม่ตั้ง)', () => expect(settingsProblem({})).toBeNull());
  it('ค่าถูกต้องใช้ได้ รวมขอบ 0 / วัน 1 / วัน 31', () => {
    expect(settingsProblem({ payDay: 1, monthlySavingsGoal: 0, monthlyBudget: 1 })).toBeNull();
    expect(settingsProblem({ payDay: 31 })).toBeNull();
  });
  it.each([0, 32, -1, 1.5, NaN, Infinity])('วันเงินเดือน %s ผิด', (payDay) => {
    expect(settingsProblem({ payDay })).not.toBeNull();
  });
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('เป้าออม %s ผิด', (monthlySavingsGoal) => {
    expect(settingsProblem({ monthlySavingsGoal })).not.toBeNull();
  });
  it('งบรายเดือนติดลบ/ทศนิยมผิด', () => {
    expect(settingsProblem({ monthlyBudget: -100 })).not.toBeNull();
    expect(settingsProblem({ monthlyBudget: 10.5 })).not.toBeNull();
  });
});

describe('Dexie version(2): migration + Snapshot (R6)', () => {
  it('SCHEMA_VERSION เป็น 2', () => expect(SCHEMA_VERSION).toBe(2));

  it('อัปเกรดจาก v1: ข้อมูลเดิมครบไม่เปลี่ยน และมี Snapshot snapshot:v1 ก่อนเพิ่มตาราง', async () => {
    const name = `upgrade-${Math.random().toString(36).slice(2)}`;
    const led = ledger();
    // สร้างฐานข้อมูล v1 แบบเดิมเป๊ะ
    const old = new Dexie(name);
    old.version(1).stores({ accounts: 'id, type', entries: 'id, date, groupId', meta: 'key' });
    await old.table('accounts').bulkAdd(led.accounts);
    await old.table('entries').bulkAdd(led.entries);
    await old.table('meta').put({ key: 'schemaVersion', value: 1 });
    old.close();

    const upgraded = new MoneyDB(name);
    try {
      await upgraded.open();
      expect(await upgraded.accounts.count()).toBe(led.accounts.length);
      expect(await upgraded.entries.count()).toBe(led.entries.length);
      expect(await upgraded.bills.count()).toBe(0);
      expect((await upgraded.meta.get('schemaVersion'))?.value).toBe(2);
      const snap = (await upgraded.meta.get('snapshot:v1'))?.value as {
        schemaVersion: number;
        accounts: unknown[];
        entries: unknown[];
      };
      expect(snap.schemaVersion).toBe(1);
      expect(snap.accounts).toHaveLength(led.accounts.length);
      expect(snap.entries).toHaveLength(led.entries.length);
      expect(snap.entries).toEqual(expect.arrayContaining(led.entries));
    } finally {
      await upgraded.delete();
    }
  });

  it('ฐานข้อมูลใหม่ (ยังไม่เคยมีข้อมูล) เปิดได้และไม่มี Snapshot ว่างๆ', async () => {
    await db.open();
    expect(await db.meta.get('snapshot:v1')).toBeUndefined();
  });

  it('อัปเกรดจาก v1 ที่ว่างเปล่า (ไม่มี schemaVersion) ไม่พัง', async () => {
    const name = `upgrade-empty-${Math.random().toString(36).slice(2)}`;
    const old = new Dexie(name);
    old.version(1).stores({ accounts: 'id, type', entries: 'id, date, groupId', meta: 'key' });
    await old.open();
    old.close();
    const upgraded = new MoneyDB(name);
    try {
      await upgraded.open();
      expect(await upgraded.meta.get('schemaVersion')).toBeUndefined();
    } finally {
      await upgraded.delete();
    }
  });
});

describe('repository บิล', () => {
  beforeEach(async () => {
    await saveInitialLedger(db, ledger());
  });

  it('addBill ตั้ง startMonth จากวันนี้ และอ่านกลับมาได้', async () => {
    const saved = await addBill(db, bill(), '2026-11-04');
    expect(saved.startMonth).toBe('2026-11');
    expect(await loadBills(db)).toEqual([saved]);
  });

  it('addBill ไม่ทับ startMonth ที่ระบุมา', async () => {
    const saved = await addBill(db, bill({ startMonth: '2026-09' }), '2026-11-04');
    expect(saved.startMonth).toBe('2026-09');
  });

  it('ปฏิเสธบิลผิดรูปก่อนเขียน (ยอด 0, ทศนิยม, วัน 32, lastPaidMonth ผิด)', async () => {
    for (const bad of [
      bill({ amount: 0 }),
      bill({ amount: 10.5 }),
      bill({ amount: -1 }),
      bill({ dueDay: 32 }),
      bill({ dueDay: 0 }),
      bill({ lastPaidMonth: '2026-9' }),
      bill({ startMonth: 'abc' }),
      bill({ name: '   ' }),
    ]) {
      await expect(addBill(db, bad, '2026-11-04')).rejects.toBeInstanceOf(StorageError);
    }
    expect(await db.bills.count()).toBe(0);
  });

  it('ปฏิเสธรหัสซ้ำ ไม่ทับของเดิม', async () => {
    await addBill(db, bill(), '2026-11-04');
    await expect(addBill(db, bill({ name: 'อื่น' }), '2026-11-04')).rejects.toBeInstanceOf(StorageError);
    expect((await loadBills(db))[0]?.name).toBe('ค่าเน็ต');
  });

  it('ตรวจกระเป๋าต้องเป็น asset และหมวดต้องเป็น expense ที่มีจริง', async () => {
    const accts = (await db.accounts.toArray());
    const wallet = accts.find((a) => a.type === 'asset')!;
    const expense = accts.find((a) => a.type === 'expense')!;
    const income = accts.find((a) => a.type === 'income')!;
    await expect(addBill(db, bill({ walletId: 'nope' }), '2026-11-04')).rejects.toBeInstanceOf(StorageError);
    await expect(addBill(db, bill({ walletId: expense.id }), '2026-11-04')).rejects.toBeInstanceOf(StorageError);
    await expect(addBill(db, bill({ categoryId: income.id }), '2026-11-04')).rejects.toBeInstanceOf(StorageError);
    const ok = await addBill(db, bill({ walletId: wallet.id, categoryId: expense.id }), '2026-11-04');
    expect(ok.walletId).toBe(wallet.id);
  });

  it('updateBill แก้ได้ ปฏิเสธเมื่อไม่พบ/ผิดรูป และเปลี่ยนรหัสไม่ได้', async () => {
    await addBill(db, bill(), '2026-11-04');
    const after = await updateBill(db, bill({ amount: 65_000 }));
    expect(after.amount).toBe(65_000);
    await expect(updateBill(db, bill({ id: 'ghost' }))).rejects.toBeInstanceOf(StorageError);
    await expect(updateBill(db, bill({ amount: 0 }))).rejects.toBeInstanceOf(StorageError);
    expect((await loadBills(db))[0]?.amount).toBe(65_000);
  });

  it('setBillPaidMonth ตั้งและคืนค่าเดิมได้ (รองรับ Undo) รวมถึงคืนเป็นไม่มีค่า', async () => {
    await addBill(db, bill({ lastPaidMonth: '2026-10' }), '2026-11-04');
    const r = await setBillPaidMonth(db, 'bill-1', '2026-11', '2026-11-04');
    expect(r.before).toBe('2026-10');
    expect((await loadBills(db))[0]?.lastPaidMonth).toBe('2026-11');
    await setBillPaidMonth(db, 'bill-1', r.before, '2026-11-04');
    expect((await loadBills(db))[0]?.lastPaidMonth).toBe('2026-10');
    await setBillPaidMonth(db, 'bill-1', undefined, '2026-11-04');
    expect('lastPaidMonth' in ((await loadBills(db))[0] ?? {})).toBe(false);
    await expect(setBillPaidMonth(db, 'bill-1', '2026-9', '2026-11-04')).rejects.toBeInstanceOf(StorageError);
    await expect(setBillPaidMonth(db, 'ghost', '2026-11', '2026-11-04')).rejects.toBeInstanceOf(StorageError);
  });

  it('deleteBill คืนบิลที่ลบ (กู้ได้) และไม่พบ = error', async () => {
    await addBill(db, bill(), '2026-11-04');
    const gone = await deleteBill(db, 'bill-1');
    expect(gone.id).toBe('bill-1');
    expect(await loadBills(db)).toEqual([]);
    await expect(deleteBill(db, 'bill-1')).rejects.toBeInstanceOf(StorageError);
  });

  it('loadBills เรียงตามชื่อแล้วรหัส (เสถียร)', async () => {
    await addBill(db, bill({ id: 'b2', name: 'น้ำ' }), '2026-11-04');
    await addBill(db, bill({ id: 'b1', name: 'ไฟ' }), '2026-11-04');
    await addBill(db, bill({ id: 'b3', name: 'ก' }), '2026-11-04');
    expect((await loadBills(db)).map((b) => b.id)).toEqual(['b3', 'b2', 'b1']);
  });
});

describe('repository ค่าตั้งค่า', () => {
  it('ยังไม่ตั้ง = {} บันทึกแล้วอ่านกลับ และบันทึกใหม่แทนทั้งชุด', async () => {
    expect(await loadSettings(db)).toEqual({});
    await saveSettings(db, { payDay: 25, monthlySavingsGoal: 500_000, monthlyBudget: 2_000_000 });
    expect(await loadSettings(db)).toEqual({ payDay: 25, monthlySavingsGoal: 500_000, monthlyBudget: 2_000_000 });
    await saveSettings(db, { payDay: 31 });
    expect(await loadSettings(db)).toEqual({ payDay: 31 });
  });

  it('ปฏิเสธค่าผิดโดยไม่แตะของเดิม', async () => {
    await saveSettings(db, { payDay: 25 });
    await expect(saveSettings(db, { payDay: 40 })).rejects.toBeInstanceOf(StorageError);
    await expect(saveSettings(db, { monthlyBudget: -5 })).rejects.toBeInstanceOf(StorageError);
    expect(await loadSettings(db)).toEqual({ payDay: 25 });
  });

  it('ค่าในฐานข้อมูลเสีย/มีคีย์แปลก: loadSettings ไม่เชื่อ คืนเฉพาะฟิลด์ที่ถูกต้อง', async () => {
    await db.meta.put({ key: 'settings', value: { payDay: 99, monthlyBudget: 100, evil: 'x', monthlySavingsGoal: -3 } });
    expect(await loadSettings(db)).toEqual({ monthlyBudget: 100 });
    await db.meta.put({ key: 'settings', value: 'garbage' });
    expect(await loadSettings(db)).toEqual({});
  });
});

describe('ส่งออก/ล้างข้อมูลรวมบิลและค่าตั้งค่า', () => {
  it('exportSnapshot มีบิลและค่าตั้งค่า (ไม่รวม snapshot:v1) และ resetAll ล้างหมด', async () => {
    await saveInitialLedger(db, ledger());
    await addBill(db, bill(), '2026-11-04');
    await saveSettings(db, { payDay: 25 });
    const snap = await exportSnapshot(db, new Date('2026-11-04T08:00:00Z'));
    expect(snap.schemaVersion).toBe(2);
    expect(snap.bills).toHaveLength(1);
    expect(snap.settings).toEqual({ payDay: 25 });
    expect(JSON.stringify(snap)).not.toContain('snapshot:v1');
    await resetAll(db);
    expect(await db.bills.count()).toBe(0);
    expect(await loadSettings(db)).toEqual({});
  });
});

describe('sanitizeBill: ไม่เชื่อข้อมูลภายนอก (ผลตรวจ security-auditor)', () => {
  beforeEach(async () => {
    await saveInitialLedger(db, ledger());
  });

  it('เขียนเฉพาะฟิลด์ที่รู้จัก ทิ้งฟิลด์แปลกและ __proto__', async () => {
    const evil = JSON.parse('{"id":"b1","name":"ค่าเน็ต","amount":100,"dueDay":5,"evil":"x","__proto__":{"polluted":1}}');
    await addBill(db, evil, '2026-11-04');
    const stored = await db.bills.get('b1');
    expect(stored).toBeDefined();
    expect(Object.keys(stored!).sort()).toEqual(['amount', 'dueDay', 'id', 'name', 'startMonth']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('ชนิดผิด (name/id ไม่ใช่ string, archived ไม่ใช่ boolean) ได้ StorageError ไม่ใช่ TypeError', async () => {
    for (const bad of [
      { ...bill(), name: 5 },
      { ...bill(), id: 7 },
      { ...bill(), walletId: 3 },
      { ...bill(), archived: 'yes' },
      null,
    ]) {
      await expect(addBill(db, bad as unknown as Bill, '2026-11-04')).rejects.toBeInstanceOf(StorageError);
    }
  });

  it('loadBills ทนแถวเสียในฐานข้อมูล (ไม่พัง ไม่ทำให้ส่งออกไม่ได้)', async () => {
    await db.bills.put({ id: 'bad', name: 42 as unknown as string, amount: 100, dueDay: 5 });
    await addBill(db, bill(), '2026-11-04');
    const loaded = await loadBills(db);
    expect(loaded).toHaveLength(2);
    await expect(exportSnapshot(db)).resolves.toBeDefined();
  });
});

describe('ผลตรวจ money-auditor B2', () => {
  beforeEach(async () => {
    await saveInitialLedger(db, ledger());
  });

  it('lastPaidMonth เดือนอนาคตถูกปฏิเสธทั้ง addBill และ setBillPaidMonth (ข้อ 16)', async () => {
    await expect(addBill(db, bill({ lastPaidMonth: '2026-12' }), '2026-11-04')).rejects.toBeInstanceOf(StorageError);
    await expect(addBill(db, bill({ lastPaidMonth: '9999-12' }), '2026-11-04')).rejects.toBeInstanceOf(StorageError);
    await addBill(db, bill({ lastPaidMonth: '2026-11' }), '2026-11-04'); // เดือนนี้ได้
    await expect(setBillPaidMonth(db, 'bill-1', '9999-12', '2026-11-04')).rejects.toBeInstanceOf(StorageError);
    await expect(setBillPaidMonth(db, 'bill-1', '2026-12', '2026-11-04')).rejects.toBeInstanceOf(StorageError);
    expect((await loadBills(db))[0]?.lastPaidMonth).toBe('2026-11');
  });

  it('วันนี้ผิดรูป = StorageError ไม่ใช่ RangeError', async () => {
    await expect(addBill(db, bill(), 'ไม่ใช่วันที่')).rejects.toBeInstanceOf(StorageError);
  });

  it('updateBill ไม่ทำให้ lastPaidMonth/startMonth ถอยหลังหรือหาย แม้ฟอร์มเก่าส่งมา', async () => {
    await addBill(db, bill({ startMonth: '2026-09' }), '2026-11-04');
    await setBillPaidMonth(db, 'bill-1', '2026-11', '2026-11-04'); // ผู้ใช้จ่ายระหว่างเปิดฟอร์มแก้
    const stale = bill({ name: 'ค่าเน็ตใหม่', lastPaidMonth: '2026-10' }); // ฟอร์มเก่า ไม่มี startMonth
    const after = await updateBill(db, stale);
    expect(after.name).toBe('ค่าเน็ตใหม่');
    expect(after.lastPaidMonth).toBe('2026-11');
    expect(after.startMonth).toBe('2026-09');
    expect(await db.bills.get('bill-1')).toEqual(after);
  });

  it('setBillPaidMonth compare-and-set: Undo ไม่ทับค่าที่ถูกเปลี่ยนไปแล้ว', async () => {
    await addBill(db, bill({ lastPaidMonth: '2026-09' }), '2026-11-04');
    const first = await setBillPaidMonth(db, 'bill-1', '2026-10', '2026-11-04');
    await setBillPaidMonth(db, 'bill-1', '2026-11', '2026-11-04'); // มีการเปลี่ยนซ้ำ
    await expect(
      setBillPaidMonth(db, 'bill-1', first.before, '2026-11-04', { ifCurrently: '2026-10' }),
    ).rejects.toBeInstanceOf(StorageError);
    expect((await loadBills(db))[0]?.lastPaidMonth).toBe('2026-11');
    // ค่าตรงกัน -> คืนได้ รวมคืนเป็น "ไม่มีค่า"
    await setBillPaidMonth(db, 'bill-1', undefined, '2026-11-04', { ifCurrently: '2026-11' });
    expect('lastPaidMonth' in ((await loadBills(db))[0] ?? {})).toBe(false);
  });

  it('ยอดบิล NaN / Infinity / -0 / MAX_SAFE_INTEGER+1 ถูกปฏิเสธ, MAX_SAFE_INTEGER ผ่านด่านรายใบ', async () => {
    for (const amount of [NaN, Infinity, -0, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(addBill(db, bill({ amount }), '2026-11-04')).rejects.toBeInstanceOf(StorageError);
    }
    expect(await db.bills.count()).toBe(0);
  });

  it('resetAll ล้าง snapshot:v1 ด้วย (ตั้งใจ: ผู้ใช้สั่งล้างต้องไม่เหลือข้อมูลเก่า)', async () => {
    await db.meta.put({ key: 'snapshot:v1', value: { schemaVersion: 1, accounts: [], entries: [] } });
    await resetAll(db);
    expect(await db.meta.get('snapshot:v1')).toBeUndefined();
  });

  it('อัปเกรด v1 ที่มี schemaVersion แต่ไม่มีบัญชี/รายการ ไม่สร้าง Snapshot เปล่า', async () => {
    const name = `upgrade-hollow-${Math.random().toString(36).slice(2)}`;
    const old = new Dexie(name);
    old.version(1).stores({ accounts: 'id, type', entries: 'id, date, groupId', meta: 'key' });
    await old.table('meta').put({ key: 'schemaVersion', value: 1 });
    old.close();
    const upgraded = new MoneyDB(name);
    try {
      await upgraded.open();
      expect(await upgraded.meta.get('snapshot:v1')).toBeUndefined();
      expect((await upgraded.meta.get('schemaVersion'))?.value).toBe(2);
    } finally {
      await upgraded.delete();
    }
  });
});
