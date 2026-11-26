import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { parseBackup } from '../../src/domain/backup/parseBackup';
import { buildInitialLedger } from '../../src/app/setup';
import { MoneyDB } from '../../src/storage/db';
import { createDexieRepository } from '../../src/storage/ledgerRepository';

/** หมวดใหม่และหมวดที่ซ่อนต้องอยู่ในไฟล์สำรองและนำเข้ากลับได้ครบ (ฟีดแบ็ก 14 พ.ย. 2569): ส่งออก → ตรวจ → นำเข้าฐานเปล่า → เหมือนเดิม */
const opened: MoneyDB[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((d) => d.delete()));
});
const fresh = () => {
  const db = new MoneyDB(`cat-backup-${Math.random().toString(36).slice(2)}`);
  opened.push(db);
  return createDexieRepository(db);
};

describe('ไฟล์สำรองกับหมวดใหม่/หมวดที่ซ่อน', () => {
  it('ไปกลับ: เพิ่มหมวด ซ่อนหมวดที่มีรายการ → ส่งออก → parseBackup → นำเข้า → บัญชี/รายการ/สถานะซ่อนตรงเดิม', async () => {
    const a = fresh();
    await a.saveInitialLedger(buildInitialLedger([{ name: 'เงินสด', opening: '1000' }], '2026-11-01'));
    const { accounts } = await a.loadLedger();
    const wallet = accounts.find((x) => x.type === 'asset')!;
    const food = accounts.find((x) => x.type === 'expense')!;
    await a.appendEntry({ id: 'bk1', date: '2026-11-02', memo: 'ข้าว', lines: [{ accountId: food.id, amount: 6_500 }, { accountId: wallet.id, amount: -6_500 }] });
    await a.addCategory({ id: 'cat-new-bk', type: 'expense', name: 'ค่ากาแฟ' });
    await a.setCategoryHidden(food.id, true);

    const snap = await a.exportSnapshot();
    const parsed = parseBackup(JSON.stringify(snap), '2026-11-14');
    if (!parsed.ok) throw new Error(parsed.problems.join('\n'));
    expect(parsed.data.accounts.find((x) => x.id === food.id)?.archived).toBe(true);
    expect(parsed.data.accounts.find((x) => x.id === 'cat-new-bk')).toMatchObject({ name: 'ค่ากาแฟ', type: 'expense', currency: 'THB' });

    const b = fresh();
    await b.importBackup(parsed.data);
    const restored = await b.loadLedger();
    const before = await a.loadLedger();
    expect(restored.accounts).toEqual(before.accounts);
    expect(restored.entries).toEqual(before.entries);
    expect(restored.accounts.find((x) => x.id === food.id)?.archived).toBe(true);
    // นำเข้าแล้วเปิดกลับ/ซ่อนต่อได้ตามปกติ
    await expect(b.setCategoryHidden(food.id, false)).resolves.toMatchObject({ id: food.id });
  });

  it('ไฟล์ที่ข้อมูลลงทุนมีแต่หมวดสินทรัพย์ (ยังไม่มีสินทรัพย์): หมวดต้องไม่หายตอนตรวจไฟล์', async () => {
    const a = fresh();
    await a.saveInitialLedger(buildInitialLedger([{ name: 'เงินสด', opening: '1000' }], '2026-11-01'));
    const categories = [
      { id: 'c1', name: 'หมวดหนึ่ง', targetBps: 6000, sortOrder: 1 },
      { id: 'c2', name: 'หมวดสอง', targetBps: 4000, sortOrder: 2 },
    ];
    const file = { ...(await a.exportSnapshot()), investments: { assets: [], trades: [], prices: [], categories } };
    const parsed = parseBackup(JSON.stringify(file), '2026-11-14');
    if (!parsed.ok) throw new Error(parsed.problems.join('\n'));
    expect(parsed.data.investments?.categories).toEqual(categories);
  });
});
