import { describe, expect, it } from 'vitest';
import { verifyOnline } from '../../src/app/migrate';
import type { BackupData } from '../../src/domain/backup/parseBackup';
import type { LedgerRepository } from '../../src/storage/ledgerRepository';

describe('verifyOnline ยืนยันว่ายังเป็นบัญชีเดิมหลังอ่าน', () => {
  it('บัญชีเปลี่ยน = ไม่คืนผลตรวจ (ผลที่เทียบกับบัญชีอื่นใช้ไม่ได้)', async () => {
    const order: string[] = [];
    const repo = {
      loadLedger: () => (order.push('read'), Promise.resolve({ accounts: [], entries: [] })),
      loadBills: () => Promise.resolve([]),
      loadSettings: () => Promise.resolve({}),
      confirmSameAccount: () => (order.push('confirm'), Promise.reject(new Error('เปลี่ยน'))),
    } as unknown as LedgerRepository;
    await expect(verifyOnline({ accounts: [], entries: [], bills: [], settings: {} } as unknown as BackupData, repo)).rejects.toThrow('เปลี่ยน');
    expect(order).toEqual(['read', 'confirm']);
  });
});

const wizard = import.meta.glob('/src/ui/MigrationWizard.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('ตัวย้ายข้อมูล: ธงรอยืนยันไม่ถูกล้างจากข้อมูลของบัญชีอื่น', () => {
  // isEmpty อ่านของบัญชีที่ล็อกอินอยู่ตอนนั้น ต้องยืนยันบัญชีหลังอ่านและก่อนล้างธง
  it('ยืนยันบัญชีระหว่าง isEmpty กับการเขียนธง none ในทางที่นำเข้าล้ม', () => {
    const text = Object.values(wizard)[0]!;
    const empty = text.indexOf('if (await online.isEmpty())');
    const confirm = text.indexOf('await online.confirmSameAccount();', empty);
    const write = text.indexOf("writeMigrationFlag(window.localStorage, userId, 'none')", empty);
    expect(empty).toBeGreaterThan(-1);
    expect(confirm).toBeGreaterThan(empty);
    expect(write).toBeGreaterThan(confirm);
  });
});
