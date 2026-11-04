import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildInitialLedger } from '../../src/app/setup';
import { balanceOf } from '../../src/domain/ledger/balance';
import { LedgerError } from '../../src/domain/ledger/entry';
import { MoneyDB } from '../../src/storage/db';
import {
  appendEntry,
  deleteEntry,
  exportSnapshot,
  isEmpty,
  loadLedger,
  resetAll,
  saveInitialLedger,
  StorageError,
  updateEntry,
} from '../../src/storage/repository';

let db: MoneyDB;
let n = 0;

beforeEach(() => {
  n += 1;
  db = new MoneyDB(`test-${n}-${Math.random().toString(36).slice(2)}`);
});
afterEach(async () => {
  await db.delete();
});

const setup = () =>
  buildInitialLedger(
    [
      { name: 'CashFlow', opening: '5408.41' },
      { name: 'Vault Zero', opening: '2500' },
    ],
    '2026-11-01',
  );

describe('ที่เก็บข้อมูล (IndexedDB)', () => {
  it('ฐานข้อมูลใหม่ว่าง และหลังตั้งต้นอ่านกลับมาได้ครบ', async () => {
    expect(await isEmpty(db)).toBe(true);
    const ledger = setup();
    await saveInitialLedger(db, ledger);
    expect(await isEmpty(db)).toBe(false);

    const loaded = await loadLedger(db);
    expect(loaded.accounts).toHaveLength(ledger.accounts.length);
    expect(loaded.entries).toHaveLength(2);
    expect(balanceOf('wallet-1', loaded.entries)).toBe(540_841);
    expect((await db.meta.get('schemaVersion'))?.value).toBe(2);
  });

  it('อ่านบัญชีกลับมาตามลำดับที่สร้าง ไม่ใช่ตามตัวอักษรของรหัส (wallet-10 ต้องอยู่หลัง wallet-2)', async () => {
    const wallets = Array.from({ length: 11 }, (_, i) => ({ name: `กระเป๋า ${i + 1}`, opening: '' }));
    const ledger = buildInitialLedger(wallets, '2026-11-01');
    await saveInitialLedger(db, ledger);
    const loaded = await loadLedger(db);
    expect(loaded.accounts.map((a) => a.id)).toEqual(ledger.accounts.map((a) => a.id));
    const income = loaded.accounts.filter((a) => a.type === 'income').map((a) => a.name);
    expect(income[0]).toBe('เงินเดือน'); // ไม่ใช่ "รายรับอื่นๆ"
  });

  it('ไม่เขียนทับฐานข้อมูลที่มีข้อมูลแล้ว และไม่ทิ้งข้อมูลครึ่งๆ กลางๆ', async () => {
    await saveInitialLedger(db, setup());
    await expect(saveInitialLedger(db, setup())).rejects.toThrow(StorageError);
    expect(await db.entries.count()).toBe(2);
  });

  it('ปฏิเสธข้อมูลตั้งต้นที่ไม่ผ่าน Integrity Check ก่อนเขียนอะไรลงไป', async () => {
    const ledger = setup();
    const bad = {
      ...ledger,
      entries: [
        ...ledger.entries,
        {
          id: 'bad',
          date: '2026-11-01',
          memo: '',
          source: 'manual' as const,
          lines: [
            { accountId: 'wallet-1', amount: 100 },
            { accountId: 'opening', amount: -90 },
          ],
        },
      ],
    };
    await expect(saveInitialLedger(db, bad)).rejects.toThrow(/ไม่ผ่านการตรวจ/);
    expect(await isEmpty(db)).toBe(true);
  });

  it('appendEntry เพิ่มรายการที่สมดุล และปฏิเสธรายการไม่สมดุลโดยไม่เขียน', async () => {
    await saveInitialLedger(db, setup());
    const added = await appendEntry(db, {
      id: 'coffee',
      date: '2026-11-01',
      memo: 'กาแฟ',
      source: 'quick',
      lines: [
        { accountId: 'expense-food', amount: 6500 },
        { accountId: 'wallet-1', amount: -6500 },
      ],
    });
    expect(added.source).toBe('quick');
    const { entries } = await loadLedger(db);
    expect(balanceOf('wallet-1', entries)).toBe(540_841 - 6500);

    await expect(
      appendEntry(db, {
        id: 'bad',
        date: '2026-11-01',
        memo: '',
        lines: [
          { accountId: 'expense-food', amount: 100 },
          { accountId: 'wallet-1', amount: -99 },
        ],
      }),
    ).rejects.toThrow(LedgerError);
    expect(await db.entries.count()).toBe(3);
  });

  it('appendEntry ปฏิเสธ id ซ้ำ ไม่เขียนทับรายการเดิม', async () => {
    await saveInitialLedger(db, setup());
    const input = {
      id: 'dup',
      date: '2026-11-01',
      memo: 'ครั้งแรก',
      lines: [
        { accountId: 'expense-food', amount: 100 },
        { accountId: 'wallet-1', amount: -100 },
      ],
    };
    await appendEntry(db, input);
    await expect(appendEntry(db, { ...input, memo: 'ซ้ำ' })).rejects.toThrow();
    expect((await db.entries.get('dup'))?.memo).toBe('ครั้งแรก');
  });

  it('loadLedger เรียงรายการตามวันที่', async () => {
    await saveInitialLedger(db, setup());
    const line = (amount: number) => [
      { accountId: 'expense-food', amount },
      { accountId: 'wallet-1', amount: -amount },
    ];
    await appendEntry(db, { id: 'late', date: '2026-11-20', memo: '', lines: line(1) });
    await appendEntry(db, { id: 'early', date: '2026-11-02', memo: '', lines: line(2) });
    const dates = (await loadLedger(db)).entries.map((e) => e.date);
    expect(dates).toEqual([...dates].sort());
  });

  it('deleteEntry (เลิกทำ) ลบรายการที่เพิ่งเพิ่ม ยอดกลับเป็นเหมือนเดิม', async () => {
    await saveInitialLedger(db, setup());
    await appendEntry(db, {
      id: 'coffee',
      date: '2026-11-01',
      memo: 'กาแฟ',
      lines: [
        { accountId: 'expense-food', amount: 6500 },
        { accountId: 'wallet-1', amount: -6500 },
      ],
    });
    const removed = await deleteEntry(db, 'coffee');
    expect(removed.memo).toBe('กาแฟ');
    expect(balanceOf('wallet-1', (await loadLedger(db)).entries)).toBe(540_841);
    await expect(deleteEntry(db, 'coffee')).rejects.toThrow(/ไม่พบรายการ/);
  });

  it('รายการวันเดียวกัน: ยอดยกมามาก่อน แล้วเรียงตามลำดับที่บันทึก แม้กดติดกันมากๆ', async () => {
    await saveInitialLedger(db, setup());
    const line = (amount: number) => [
      { accountId: 'expense-food', amount },
      { accountId: 'wallet-1', amount: -amount },
    ];
    // รหัสตั้งให้เรียงตามตัวอักษรกลับด้าน เพื่อพิสูจน์ว่าไม่ได้เรียงตามรหัส
    for (const id of ['z', 'y', 'x', 'w']) {
      await appendEntry(db, { id, date: '2026-11-01', memo: id, lines: line(100) });
    }
    const order = (await loadLedger(db)).entries.map((e) => e.id);
    expect(order).toEqual(['opening-wallet-1', 'opening-wallet-2', 'z', 'y', 'x', 'w']);
  });

  it('แก้ไขและกู้คืนรายการ ยังอยู่ตำแหน่งเดิมในวันนั้น', async () => {
    await saveInitialLedger(db, setup());
    const input = (id: string, amount = 100) => ({
      id,
      date: '2026-11-01',
      memo: id,
      lines: [
        { accountId: 'expense-food', amount },
        { accountId: 'wallet-1', amount: -amount },
      ],
    });
    for (const id of ['a', 'b', 'c']) await appendEntry(db, input(id));
    await updateEntry(db, 'a', input('a', 999));
    const removed = await deleteEntry(db, 'b');
    await appendEntry(db, removed);
    const order = (await loadLedger(db)).entries.filter((e) => e.source !== 'system').map((e) => e.id);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('updateEntry แก้รายการเดิม คืนก่อนและหลังแก้ และย้อนกลับได้', async () => {
    await saveInitialLedger(db, setup());
    const line = (amount: number) => [
      { accountId: 'expense-food', amount },
      { accountId: 'wallet-1', amount: -amount },
    ];
    await appendEntry(db, { id: 'c', date: '2026-11-01', memo: 'กาแฟ', source: 'quick', lines: line(6500) });

    const { before, after } = await updateEntry(db, 'c', { id: 'c', date: '2026-11-02', memo: 'กาแฟเย็น', source: 'quick', lines: line(7500) });
    expect(before.memo).toBe('กาแฟ');
    expect(after).toMatchObject({ memo: 'กาแฟเย็น', date: '2026-11-02', source: 'quick' });
    expect(await db.entries.count()).toBe(3); // แก้ทับ ไม่ได้เพิ่มรายการใหม่
    expect(balanceOf('wallet-1', (await loadLedger(db)).entries)).toBe(540_841 - 7500);

    await updateEntry(db, 'c', before); // เลิกทำ
    expect(balanceOf('wallet-1', (await loadLedger(db)).entries)).toBe(540_841 - 6500);
  });

  it('updateEntry ปฏิเสธรายการไม่สมดุล ยอดยกมา รหัสไม่ตรง และรายการที่ไม่มี โดยไม่เขียนอะไร', async () => {
    await saveInitialLedger(db, setup());
    await appendEntry(db, {
      id: 'c',
      date: '2026-11-01',
      memo: 'กาแฟ',
      lines: [
        { accountId: 'expense-food', amount: 6500 },
        { accountId: 'wallet-1', amount: -6500 },
      ],
    });
    const bad = {
      id: 'c',
      date: '2026-11-01',
      memo: 'x',
      lines: [
        { accountId: 'expense-food', amount: 100 },
        { accountId: 'wallet-1', amount: -99 },
      ],
    };
    await expect(updateEntry(db, 'c', bad)).rejects.toThrow(LedgerError);
    await expect(updateEntry(db, 'opening-wallet-1', { ...bad, id: 'opening-wallet-1' })).rejects.toThrow(/ยอดยกมา/);
    await expect(updateEntry(db, 'c', { ...bad, id: 'other' })).rejects.toThrow(/ไม่ตรง/);
    await expect(updateEntry(db, 'ghost', { ...bad, id: 'ghost' })).rejects.toThrow(/ไม่พบ/);
    expect((await db.entries.get('c'))?.memo).toBe('กาแฟ');
  });

  it('ลบแล้วกู้คืน (เลิกทำการลบ) ได้รายการเดิมครบทุกช่อง', async () => {
    await saveInitialLedger(db, setup());
    await appendEntry(db, {
      id: 'c',
      date: '2026-11-01',
      memo: 'กาแฟ',
      source: 'ocr',
      groupId: 'g1',
      lines: [
        { accountId: 'expense-food', amount: 6500 },
        { accountId: 'wallet-1', amount: -6500 },
      ],
    });
    const original = await db.entries.get('c');
    const removed = await deleteEntry(db, 'c');
    await appendEntry(db, removed);
    expect(await db.entries.get('c')).toEqual(original);
  });

  it('deleteEntry ไม่ยอมลบรายการยอดยกมาของระบบ', async () => {
    await saveInitialLedger(db, setup());
    await expect(deleteEntry(db, 'opening-wallet-1')).rejects.toThrow(/ยอดยกมา/);
    expect(await db.entries.count()).toBe(2);
  });

  it('exportSnapshot มีเวอร์ชันและข้อมูลครบ และ resetAll ล้างหมด', async () => {
    await saveInitialLedger(db, setup());
    const snap = await exportSnapshot(db, new Date('2026-11-01T08:00:00Z'));
    expect(snap).toMatchObject({ schemaVersion: 2, exportedAt: '2026-11-01T08:00:00.000Z' });
    expect(snap.entries).toHaveLength(2);
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap); // เป็น JSON ล้วน ไม่มี BigInt/undefined

    await resetAll(db);
    expect(await isEmpty(db)).toBe(true);
    expect(await db.entries.count()).toBe(0);
    expect(await db.meta.count()).toBe(0);
  });
});
