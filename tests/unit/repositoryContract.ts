import { beforeEach, describe, expect, it } from 'vitest';
import { buildInitialLedger } from '../../src/app/setup';
import type { Bill } from '../../src/domain/bills/types';
import { runIntegrityCheck } from '../../src/domain/ledger/integrity';
import type { NewEntry } from '../../src/domain/ledger/types';
import type { LedgerRepository } from '../../src/storage/ledgerRepository';
import { StorageError } from '../../src/storage/repository';

/**
 * ชุดเทสต์สัญญา: ทุก implementation ของ LedgerRepository (Dexie, Supabase) ต้องผ่านชุดนี้เหมือนกันทุกข้อ (แผน M2 ข้อ 4.4)
 * factory ต้องคืน repository ที่ว่างเปล่าและแยกจากเทสต์อื่นทุกครั้ง
 */
export function describeRepositoryContract(name: string, factory: () => Promise<LedgerRepository>): void {
  describe(`สัญญา LedgerRepository: ${name}`, () => {
    let repo: LedgerRepository;
    let walletId = '';
    let walletId2 = '';
    let categoryId = '';

    beforeEach(async () => {
      repo = await factory();
    });

    const setup = () =>
      buildInitialLedger([{ name: 'CashFlow', opening: '5408.41' }, { name: 'Vault Zero', opening: '2500' }], '2026-11-01');

    const seed = async () => {
      await repo.saveInitialLedger(setup());
      const { accounts } = await repo.loadLedger();
      const wallets = accounts.filter((a) => a.type === 'asset');
      walletId = wallets[0]!.id;
      walletId2 = wallets[1]!.id;
      categoryId = accounts.find((a) => a.type === 'expense')!.id;
    };

    const spend = (id: string, amount: number, date = '2026-11-02'): NewEntry => ({
      id,
      date,
      memo: 'ข้าว',
      lines: [
        { accountId: categoryId, amount },
        { accountId: walletId, amount: -amount },
      ],
    });
    const bill = (over: Partial<Bill> = {}): Bill => ({ id: 'bill-1', name: 'ค่าเน็ต', amount: 59_900, dueDay: 5, ...over });

    it('ว่างเมื่อเริ่ม · ตั้งต้นแล้วอ่านกลับครบและสมดุล · ตั้งต้นซ้ำถูกปฏิเสธ', async () => {
      expect(await repo.isEmpty()).toBe(true);
      await seed();
      expect(await repo.isEmpty()).toBe(false);
      const { accounts, entries } = await repo.loadLedger();
      expect(accounts.length).toBeGreaterThan(2);
      expect(entries).toHaveLength(2);
      expect(runIntegrityCheck(accounts, entries).ok).toBe(true);
      await expect(repo.saveInitialLedger(setup())).rejects.toThrow(StorageError);
      expect((await repo.loadLedger()).entries).toHaveLength(2);
    });

    it('เพิ่มรายการ: เรียงตามวันที่ · รายการไม่สมดุลถูกปฏิเสธและไม่เขียนอะไร · id ซ้ำห้ามเขียนทับ', async () => {
      await seed();
      await repo.appendEntry(spend('e-late', 5_000, '2026-11-03'));
      await repo.appendEntry(spend('e-early', 3_000, '2026-11-02'));
      const ids = (await repo.loadLedger()).entries.map((e) => e.id);
      expect(ids.indexOf('e-early')).toBeLessThan(ids.indexOf('e-late'));
      const bad: NewEntry = {
        id: 'e-bad',
        date: '2026-11-02',
        memo: 'x',
        lines: [
          { accountId: categoryId, amount: 100 },
          { accountId: walletId, amount: -99 },
        ],
      };
      await expect(repo.appendEntry(bad)).rejects.toThrow();
      expect((await repo.loadLedger()).entries.some((e) => e.id === 'e-bad')).toBe(false);
      await expect(repo.appendEntry(spend('e-late', 1))).rejects.toThrow();
    });

    it('แก้รายการ: คืนก่อน/หลัง · ตำแหน่งเดิม · แก้ยอดยกมาไม่ได้ · ไม่พบ = ปฏิเสธ', async () => {
      await seed();
      await repo.appendEntry(spend('e1', 5_000));
      const { before, after } = await repo.updateEntry('e1', { ...spend('e1', 7_000), memo: 'ก๋วยเตี๋ยว' });
      expect(before.lines.find((l) => l.accountId === categoryId)?.amount).toBe(5_000);
      expect(after.lines.find((l) => l.accountId === categoryId)?.amount).toBe(7_000);
      expect(after.createdAt).toBe(before.createdAt);
      const system = (await repo.loadLedger()).entries.find((e) => e.source === 'system')!;
      await expect(repo.updateEntry(system.id, spend(system.id, 1))).rejects.toThrow(StorageError);
      await expect(repo.updateEntry('nope', spend('nope', 1))).rejects.toThrow(StorageError);
      await expect(repo.updateEntry('e1', spend('other', 1))).rejects.toThrow(StorageError);
    });

    it('ลบรายการ: คืนรายการที่ลบ · ใส่กลับได้ตำแหน่งเดิม · ลบยอดยกมาไม่ได้', async () => {
      await seed();
      await repo.appendEntry(spend('e1', 5_000));
      await repo.appendEntry(spend('e2', 6_000));
      const removed = await repo.deleteEntry('e1');
      expect(removed.id).toBe('e1');
      expect((await repo.loadLedger()).entries.some((e) => e.id === 'e1')).toBe(false);
      await repo.appendEntry(removed);
      const ids = (await repo.loadLedger()).entries.map((e) => e.id);
      expect(ids.indexOf('e1')).toBeLessThan(ids.indexOf('e2'));
      const system = (await repo.loadLedger()).entries.find((e) => e.source === 'system')!;
      await expect(repo.deleteEntry(system.id)).rejects.toThrow(StorageError);
      await expect(repo.deleteEntry('nope')).rejects.toThrow(StorageError);
    });

    it('ยอดสุดขอบ: เกินช่วงปลอดภัย / NaN / 0 ถูกปฏิเสธ (R1)', async () => {
      await seed();
      await expect(repo.appendEntry(spend('e-big', Number.MAX_SAFE_INTEGER + 2))).rejects.toThrow();
      await expect(repo.appendEntry(spend('e-nan', Number.NaN))).rejects.toThrow();
      await expect(repo.appendEntry(spend('e-zero', 0))).rejects.toThrow();
      expect((await repo.loadLedger()).entries).toHaveLength(2);
    });

    it('ขอบเขตรายการ: บรรทัดเดียว/วันที่ผิด/id ว่างถูกปฏิเสธ · ยอดสูงสุดที่ปลอดภัยพอดีผ่าน', async () => {
      await seed();
      const one: NewEntry = { id: 'e-one', date: '2026-11-02', memo: 'x', lines: [{ accountId: walletId, amount: 0 }] };
      await expect(repo.appendEntry(one)).rejects.toThrow();
      for (const date of ['2026-02-30', '2026-13-01', '']) {
        await expect(repo.appendEntry(spend('e-date', 100, date))).rejects.toThrow();
      }
      const max = Number.MAX_SAFE_INTEGER;
      await repo.appendEntry(spend('e-max', max));
      const back = (await repo.loadLedger()).entries.find((e) => e.id === 'e-max')!;
      expect(back.lines.find((l) => l.accountId === categoryId)?.amount).toBe(max);
      expect(back.lines.find((l) => l.accountId === walletId)?.amount).toBe(-max);
    });

    it('ลำดับวันเดียวกัน: เรียงตามเวลาที่บันทึก ไม่ใช่ตามรหัส', async () => {
      await seed();
      await repo.appendEntry(spend('z-first', 100));
      await repo.appendEntry(spend('a-second', 200));
      const ids = (await repo.loadLedger()).entries.map((e) => e.id);
      expect(ids.indexOf('z-first')).toBeLessThan(ids.indexOf('a-second'));
    });

    it('จ่ายบิลล้มกลางทาง (entry id ซ้ำ) ต้องไม่ตั้ง lastPaidMonth ครึ่งๆ กลางๆ (R15)', async () => {
      await seed();
      await repo.addBill(bill(), '2026-11-04');
      await repo.appendEntry(spend('dup', 100));
      await expect(repo.payBill('bill-1', { today: '2026-11-04', walletId, categoryId, entryId: 'dup' })).rejects.toThrow();
      expect((await repo.loadBills())[0]?.lastPaidMonth).toBeUndefined();
      expect((await repo.loadLedger()).entries.filter((e) => e.source === 'recurring')).toHaveLength(0);
    });

    it('จ่ายบิลวันสิ้นเดือน: dueDay 31 ในเดือนที่มี 28 วัน จ่ายรอบเดือนนั้นได้ครั้งเดียว', async () => {
      await seed();
      await repo.addBill(bill({ dueDay: 31 }), '2026-02-28');
      const r = await repo.payBill('bill-1', { today: '2026-02-28', walletId, categoryId, entryId: 'pay-feb' });
      expect(r.cycle).toBe('2026-02');
      expect(r.entry.date).toBe('2026-02-28');
      await expect(repo.payBill('bill-1', { today: '2026-02-28', walletId, categoryId, entryId: 'pay-feb2' })).rejects.toThrow();
    });

    it('บิล: เพิ่ม/แก้/ลบ · ชื่อว่างหรือกระเป๋าไม่มีจริงถูกปฏิเสธ · เรียงตามชื่อ', async () => {
      await seed();
      await repo.addBill(bill({ id: 'b2', name: 'ค่าน้ำ' }), '2026-11-04');
      await repo.addBill(bill({ id: 'b1', name: 'ก ค่าเน็ต', walletId, categoryId }), '2026-11-04');
      expect((await repo.loadBills()).map((b) => b.id)).toEqual(['b1', 'b2']);
      const saved = await repo.updateBill(bill({ id: 'b2', name: 'ค่าน้ำประปา', amount: 20_000 }));
      expect(saved.amount).toBe(20_000);
      await expect(repo.addBill(bill({ id: 'b3', name: '  ' }), '2026-11-04')).rejects.toThrow(StorageError);
      await expect(repo.addBill(bill({ id: 'b4', walletId: 'ไม่มี' }), '2026-11-04')).rejects.toThrow(StorageError);
      await expect(repo.addBill(bill({ id: 'b1' }), '2026-11-04')).rejects.toThrow();
      const removed = await repo.deleteBill('b2');
      expect(removed.id).toBe('b2');
      expect((await repo.loadBills()).map((b) => b.id)).toEqual(['b1']);
      await expect(repo.deleteBill('b2')).rejects.toThrow(StorageError);
    });

    it('จ่ายบิล (R15): รายจ่าย recurring + lastPaidMonth ในครั้งเดียว · จ่ายซ้ำรอบเดิมไม่ได้ · เลิกทำคืนสถานะ', async () => {
      await seed();
      await repo.addBill(bill(), '2026-11-04');
      const r = await repo.payBill('bill-1', { today: '2026-11-04', walletId, categoryId, entryId: 'pay-1' });
      expect(r.cycle).toBe('2026-11');
      expect(r.entry).toMatchObject({ id: 'pay-1', source: 'recurring' });
      expect(r.entry.lines).toEqual([
        { accountId: categoryId, amount: 59_900 },
        { accountId: walletId, amount: -59_900 },
      ]);
      expect((await repo.loadBills())[0]?.lastPaidMonth).toBe('2026-11');
      await expect(repo.payBill('bill-1', { today: '2026-11-04', walletId, categoryId, entryId: 'pay-2' })).rejects.toThrow();
      const { accounts, entries } = await repo.loadLedger();
      expect(entries.filter((e) => e.source === 'recurring')).toHaveLength(1);
      expect(runIntegrityCheck(accounts, entries).ok).toBe(true);

      await repo.undoPayBill({ entryId: 'pay-1', billId: 'bill-1', cycle: r.cycle, before: r.before });
      expect((await repo.loadBills())[0]?.lastPaidMonth).toBeUndefined();
      expect((await repo.loadLedger()).entries.some((e) => e.id === 'pay-1')).toBe(false);
    });

    it('จ่ายบิลไม่มีกระเป๋า/ไม่มีบิล = ปฏิเสธและไม่เขียนอะไร', async () => {
      await seed();
      await repo.addBill(bill(), '2026-11-04');
      const before = (await repo.loadLedger()).entries.length;
      await expect(repo.payBill('bill-1', { today: '2026-11-04', entryId: 'p' })).rejects.toThrow();
      await expect(repo.payBill('ไม่มี', { today: '2026-11-04', walletId, categoryId, entryId: 'p' })).rejects.toThrow();
      expect((await repo.loadLedger()).entries).toHaveLength(before);
      expect((await repo.loadBills())[0]?.lastPaidMonth).toBeUndefined();
    });

    it('ยกเลิกการจ่าย: ลบรายการจ่ายจากสมุด = คืน lastPaidMonth · รายการ recurring แก้ตรงๆ ไม่ได้', async () => {
      await seed();
      await repo.addBill(bill(), '2026-11-04');
      await repo.payBill('bill-1', { today: '2026-11-04', walletId, categoryId, entryId: 'pay-1' });
      await expect(repo.updateEntry('pay-1', spend('pay-1', 1))).rejects.toThrow(StorageError);
      const cancelled = await repo.cancelBillPayment('pay-1');
      expect(cancelled.entry.id).toBe('pay-1');
      expect(cancelled.bill?.lastPaidMonth).toBeUndefined();

      await repo.payBill('bill-1', { today: '2026-11-04', walletId: walletId2, categoryId, entryId: 'pay-2' });
      const latest = await repo.cancelLatestBillPayment('bill-1');
      expect(latest.entry.id).toBe('pay-2');
      expect((await repo.loadBills())[0]?.lastPaidMonth).toBeUndefined();
      await expect(repo.cancelBillPayment('nope')).rejects.toThrow(StorageError);
    });

    it('ค่าตั้งค่า: ค่าเริ่มต้นว่าง · บันทึกแทนทั้งชุด · ค่าผิดรูปถูกปฏิเสธ', async () => {
      await seed();
      expect(await repo.loadSettings()).toEqual({});
      const saved = await repo.saveSettings({ payDay: 25, monthlyBudget: 1_000_000 });
      expect(saved).toEqual({ payDay: 25, monthlyBudget: 1_000_000 });
      expect(await repo.loadSettings()).toEqual(saved);
      await repo.saveSettings({ payDay: 1 });
      expect(await repo.loadSettings()).toEqual({ payDay: 1 });
      await expect(repo.saveSettings({ payDay: 40 })).rejects.toThrow(StorageError);
      await expect(repo.saveSettings({ monthlyBudget: -1 })).rejects.toThrow(StorageError);
      expect(await repo.loadSettings()).toEqual({ payDay: 1 });
    });

    it('ส่งออก: ครบทุกส่วนและสอดคล้องกัน · ล้างทั้งหมดแล้วว่างจริง', async () => {
      await seed();
      await repo.addBill(bill(), '2026-11-04');
      await repo.saveSettings({ payDay: 25 });
      await repo.appendEntry(spend('e1', 5_000));
      const snap = await repo.exportSnapshot(new Date('2026-11-05T00:00:00Z'));
      expect(snap.exportedAt).toBe('2026-11-05T00:00:00.000Z');
      expect(snap.accounts.length).toBeGreaterThan(2);
      expect(snap.entries).toHaveLength(3);
      expect(snap.bills).toHaveLength(1);
      expect(snap.settings).toEqual({ payDay: 25 });
      expect(runIntegrityCheck(snap.accounts, snap.entries).ok).toBe(true);

      await repo.resetAll();
      expect(await repo.isEmpty()).toBe(true);
      expect((await repo.loadLedger()).entries).toHaveLength(0);
      expect(await repo.loadBills()).toEqual([]);
      expect(await repo.loadSettings()).toEqual({});
    });
  });
}
