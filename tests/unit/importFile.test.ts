import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_IMPORT_BYTES } from '../../src/domain/backup/parseBackup';
import { readBackupFile, type BackupFileLike } from '../../src/app/importFile';
import { importAndVerify } from '../../src/app/migrate';
import { buildInitialLedger } from '../../src/app/setup';
import { MoneyDB } from '../../src/storage/db';
import { createDexieRepository, type LedgerRepository } from '../../src/storage/ledgerRepository';

const TODAY = '2026-11-09';
const dbs: MoneyDB[] = [];
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.delete()));
});
const fresh = (): LedgerRepository => {
  const db = new MoneyDB(`imf-${Math.random().toString(36).slice(2)}`);
  dbs.push(db);
  return createDexieRepository(db);
};
const file = (text: string, over: Partial<BackupFileLike> = {}): BackupFileLike => ({ name: 'backup.json', size: new Blob([text]).size, text: () => Promise.resolve(text), ...over });

async function seededJson(): Promise<string> {
  const repo = fresh();
  await repo.saveInitialLedger(buildInitialLedger([{ name: 'กระเป๋า 1', opening: '1234.56' }, { name: 'กระเป๋า 2', opening: '' }], '2026-11-01'));
  const { accounts } = await repo.loadLedger();
  const wallet = accounts.find((a) => a.type === 'asset')!;
  const category = accounts.find((a) => a.type === 'expense')!;
  await repo.appendEntry({ id: 'e1', date: '2026-11-02', memo: 'ข้าว', lines: [{ accountId: category.id, amount: 5000 }, { accountId: wallet.id, amount: -5000 }] });
  return JSON.stringify(await repo.exportSnapshot(new Date(0)));
}

describe('อ่านไฟล์สำรองที่ผู้ใช้เลือกเอง', () => {
  it('ไฟล์ที่แอปส่งออกเอง: ผ่านการตรวจและนำเข้าบัญชีว่างได้ ยอดตรงทุกบัญชี', async () => {
    const read = await readBackupFile(file(await seededJson()), TODAY);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.summary.entries).toBeGreaterThan(0);
    const target = fresh();
    const result = await importAndVerify(read.data, target);
    expect(result.report.ok).toBe(true);
    expect(result.report.problems).toEqual([]);
  });

  it('ไฟล์ใหญ่เกินเพดาน: ปฏิเสธจากขนาดโดยไม่อ่านเนื้อไฟล์เข้าหน่วยความจำ', async () => {
    const text = vi.fn(() => Promise.resolve('{}'));
    const read = await readBackupFile({ name: 'big.json', size: MAX_IMPORT_BYTES + 1, text }, TODAY);
    expect(read.ok).toBe(false);
    expect(text).not.toHaveBeenCalled();
  });

  it('ไฟล์ว่าง / ไม่ใช่ JSON / JSON ผิดรูป: ปฏิเสธด้วยข้อความไทย ไม่โยน error', async () => {
    for (const body of ['', 'not json', '[]', '{"schemaVersion":1}', 'null']) {
      const read = await readBackupFile(file(body), TODAY);
      expect(read.ok, body).toBe(false);
      if (!read.ok) expect(read.problems.length).toBeGreaterThan(0);
    }
  });

  it('อ่านไฟล์ไม่ได้ (เช่น ไฟล์ถูกลบ/สิทธิ์หาย): คืนข้อความผิดพลาด ไม่โยน error', async () => {
    const read = await readBackupFile(file('{}', { text: () => Promise.reject(new Error('NotReadableError')) }), TODAY);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.problems[0]).toMatch(/อ่านไฟล์/);
  });

  it('รายการเสียแม้รายการเดียว (ยอดไม่สมดุล R16): ปฏิเสธทั้งไฟล์ ไม่นำเข้าบางส่วน', async () => {
    const snap = JSON.parse(await seededJson()) as { entries: { lines: { amount: number }[] }[] };
    snap.entries[snap.entries.length - 1]!.lines[0]!.amount += 1;
    const read = await readBackupFile(file(JSON.stringify(snap)), TODAY);
    expect(read.ok).toBe(false);
  });

  it('ตัวเลข -0 และเศษสตางค์ในไฟล์ (เขียนเป็นข้อความ JSON ตรงๆ): ไม่ถูกนำเข้าเป็นยอดผิด', async () => {
    const base = await seededJson();
    const snap = JSON.parse(base) as { entries: { lines: { amount: number }[] }[] };
    const last = snap.entries[snap.entries.length - 1]!;
    const withText = (amount: string): string => JSON.stringify(snap).replace(`"amount":${last.lines[0]!.amount}`, `"amount":${amount}`);
    for (const amount of ['-0', '0.5', '1e300']) {
      const read = await readBackupFile(file(withText(amount)), TODAY);
      expect(read.ok, amount).toBe(false);
    }
  });

  it('ชื่อไฟล์ที่แสดงถูกตัดอักขระควบคุมและความยาว (ไม่เชื่อชื่อไฟล์)', async () => {
    const read = await readBackupFile(file(await seededJson(), { name: '\u202E\u200E\u200Bevil\n' + 'x'.repeat(200) + '.json' }), TODAY);
    expect(read.fileName).not.toMatch(/[\u202E\u200E\u200B\n]/);
    expect(Array.from(read.fileName).length).toBeLessThanOrEqual(61);
  });

  it('นำเข้าซ้ำลงบัญชีที่มีข้อมูลแล้ว: ถูกปฏิเสธ ไม่ทับข้อมูลเดิม', async () => {
    const read = await readBackupFile(file(await seededJson()), TODAY);
    if (!read.ok) throw new Error('ต้องผ่าน');
    const target = fresh();
    await importAndVerify(read.data, target);
    const before = JSON.stringify(await target.exportSnapshot(new Date(0)));
    await expect(importAndVerify(read.data, target)).rejects.toThrow();
    expect(JSON.stringify(await target.exportSnapshot(new Date(0)))).toBe(before);
  });
});
