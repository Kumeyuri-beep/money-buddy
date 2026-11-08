import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { importAndVerify, readLocalForMigration, verifyOnline } from '../../src/app/migrate';
import { buildInitialLedger } from '../../src/app/setup';
import { MoneyDB } from '../../src/storage/db';
import { createDexieRepository } from '../../src/storage/ledgerRepository';
import type { LedgerRepository } from '../../src/storage/ledgerRepository';
import { StorageError } from '../../src/storage/repository';

const TODAY = '2026-11-09';
const dbs: MoneyDB[] = [];
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.delete()));
});
/** ใช้ Dexie อีกก้อนแทน "ออนไลน์" (ทำตามสัญญาเดียวกัน) · ของจริงทดสอบใน tests/live */
const fresh = (): { db: MoneyDB; repo: LedgerRepository } => {
  const db = new MoneyDB(`mig-${Math.random().toString(36).slice(2)}`);
  dbs.push(db);
  return { db, repo: createDexieRepository(db) };
};

/** สมุดในเครื่องที่ใช้งานมาแล้ว: ยอดยกมา 13 บัญชีเหมือนของจริง + รายจ่าย + บิลที่จ่ายแล้ว + ตั้งค่า */
async function seedLocal(repo: LedgerRepository): Promise<void> {
  const wallets = Array.from({ length: 4 }, (_, i) => ({ name: `กระเป๋า ${i + 1}`, opening: i === 0 ? '5408.41' : '' }));
  await repo.saveInitialLedger(buildInitialLedger(wallets, '2026-11-01'));
  const { accounts } = await repo.loadLedger();
  const wallet = accounts.find((a) => a.type === 'asset')!;
  const category = accounts.find((a) => a.type === 'expense')!;
  await repo.appendEntry({ id: 'e1', date: '2026-11-02', memo: 'ข้าว', lines: [{ accountId: category.id, amount: 5000 }, { accountId: wallet.id, amount: -5000 }] });
  await repo.addBill({ id: 'bill-1', name: 'ค่าเน็ต', amount: 59_900, dueDay: 5, walletId: wallet.id, categoryId: category.id }, '2026-11-04');
  await repo.payBill('bill-1', { today: '2026-11-04', entryId: 'pay-1' });
  await repo.saveSettings({ payDay: 25 });
}

describe('ย้ายข้อมูลในเครื่องขึ้นออนไลน์', () => {
  it('ทั้งขั้นตอน: อ่าน -> ตรวจ -> นำเข้า -> อ่านกลับ ยอดตรงทุกบัญชี · ต้นทางไม่เปลี่ยนแม้แต่ไบต์เดียว', async () => {
    const local = fresh();
    const online = fresh();
    await seedLocal(local.repo);
    const before = JSON.stringify(await local.repo.exportSnapshot(new Date(0)));

    const read = await readLocalForMigration(local.repo, TODAY);
    if (!read.ok) throw new Error(read.problems.join('\n'));
    expect(read.summary.entries).toBe(read.data.entries.length);

    const result = await importAndVerify(read.data, online.repo);
    expect(result.report.ok, result.report.problems.join('|')).toBe(true);
    expect(result.counts).toEqual({ accounts: read.data.accounts.length, entries: read.data.entries.length, bills: 1 });
    expect(result.report.balances.every((b) => b.match)).toBe(true);
    expect((await online.repo.loadBills())[0]?.lastPaidMonth).toBe('2026-11');

    const after = JSON.stringify(await local.repo.exportSnapshot(new Date(0)));
    expect(after).toBe(before);
    expect(await local.repo.isEmpty()).toBe(false);
  });

  it('ข้อมูลในเครื่องเสีย (ไม่สมดุล) = ปฏิเสธก่อนนำเข้า ไม่เขียนออนไลน์ ไม่แตะต้นทาง', async () => {
    const local = fresh();
    const online = fresh();
    await seedLocal(local.repo);
    // ทำให้ข้อมูลเสียตรงๆ ในฐานข้อมูลเครื่อง (จำลองข้อมูลเก่าที่เสียหาย)
    const e1 = (await local.db.entries.get('e1'))!;
    e1.lines[0]!.amount = 5001;
    await local.db.entries.put(e1);
    const read = await readLocalForMigration(local.repo, TODAY);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.problems.join('|')).toMatch(/e1/);
    expect(await online.repo.isEmpty()).toBe(true);
    expect((await local.db.entries.get('e1'))!.lines[0]!.amount).toBe(5001);
  });

  it('ออนไลน์มีข้อมูลอยู่แล้ว = นำเข้าไม่ได้ ไม่ทับ', async () => {
    const local = fresh();
    const online = fresh();
    await seedLocal(local.repo);
    await seedLocal(online.repo);
    const read = await readLocalForMigration(local.repo, TODAY);
    if (!read.ok) throw new Error('ควรผ่าน');
    const before = (await online.repo.loadLedger()).entries.length;
    await expect(importAndVerify(read.data, online.repo)).rejects.toThrow(StorageError);
    expect((await online.repo.loadLedger()).entries).toHaveLength(before);
  });

  it('ตรวจซ้ำภายหลัง (เปิดแอปใหม่ที่ยังไม่ยืนยัน): ตรงเมื่อไม่มีอะไรเปลี่ยน · จับได้เมื่อออนไลน์เพี้ยน', async () => {
    const local = fresh();
    const online = fresh();
    await seedLocal(local.repo);
    const read = await readLocalForMigration(local.repo, TODAY);
    if (!read.ok) throw new Error('ควรผ่าน');
    await importAndVerify(read.data, online.repo);
    expect((await verifyOnline(read.data, online.repo)).ok).toBe(true);
    // ออนไลน์ถูกแก้หลังนำเข้า (เช่น เพิ่มรายการ) -> ต้องเห็นว่าไม่ตรงกับต้นทาง
    const { accounts } = await online.repo.loadLedger();
    await online.repo.appendEntry({
      id: 'later',
      date: '2026-11-03',
      memo: 'x',
      lines: [{ accountId: accounts.find((a) => a.type === 'expense')!.id, amount: 1 }, { accountId: accounts.find((a) => a.type === 'asset')!.id, amount: -1 }],
    });
    const report = await verifyOnline(read.data, online.repo);
    expect(report.ok).toBe(false);
    expect(report.problems.join('|')).toMatch(/ฝั่งออนไลน์ที่ไม่มีในต้นทาง|ไม่ตรง/);
  });

  it('ในเครื่องว่าง = อ่านได้สมุดว่าง (ผู้เรียกไม่ควรเรียกขั้นตอนนี้)', async () => {
    const local = fresh();
    const read = await readLocalForMigration(local.repo, TODAY);
    if (!read.ok) throw new Error(read.problems.join('\n'));
    expect(read.data.entries).toEqual([]);
  });
});
