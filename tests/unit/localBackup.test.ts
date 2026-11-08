import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareLocalBackup } from '../../src/app/localBackup';
import { buildInitialLedger } from '../../src/app/setup';
import { MoneyDB } from '../../src/storage/db';
import { createDexieRepository } from '../../src/storage/ledgerRepository';

const dbs: MoneyDB[] = [];
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.delete()));
});
const fresh = () => {
  const db = new MoneyDB(`bk-${Math.random().toString(36).slice(2)}`);
  dbs.push(db);
  return createDexieRepository(db);
};

describe('สำรองข้อมูลในเครื่องโดยไม่ต้องล็อกอิน', () => {
  it('ฐานว่าง = ไม่สร้างไฟล์', async () => {
    expect(await prepareLocalBackup(fresh())).toEqual({ status: 'empty' });
  });

  it('มีข้อมูล = ได้ JSON ครบ ชื่อไฟล์ตามวันที่เวลาไทย และอ่านกลับเป็นสำเนาเดียวกับที่ส่งออกปกติ', async () => {
    const repo = fresh();
    await repo.saveInitialLedger(buildInitialLedger([{ name: 'CashFlow', opening: '5408.41' }], '2026-11-01'));
    await repo.saveSettings({ payDay: 25 });
    // 2026-11-08T18:00Z = 9 พ.ย. 01:00 เวลาไทย
    const out = await prepareLocalBackup(repo, new Date('2026-11-08T18:00:00Z'));
    if (out.status !== 'ready') throw new Error('ควรได้ไฟล์');
    expect(out.filename).toBe('money-buddy-backup-2026-11-09.json');
    const parsed = JSON.parse(out.json) as { accounts: unknown[]; entries: unknown[]; settings: unknown; schemaVersion: number };
    expect(parsed.accounts).toHaveLength(out.accounts);
    expect(parsed.entries).toHaveLength(out.entries);
    expect(parsed.settings).toEqual({ payDay: 25 });
    expect(parsed.schemaVersion).toBe(2);
  });
});
