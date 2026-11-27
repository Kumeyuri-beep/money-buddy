import { describe, expect, it } from 'vitest';
import { categoryReplaceWarning } from '../../src/app/importCategories';
import { importAndVerify } from '../../src/app/migrate';
import type { BackupData } from '../../src/domain/backup/parseBackup';
import type { LedgerRepository } from '../../src/storage/ledgerRepository';

const ui = import.meta.glob(['/src/ui/ImportBackupPanel.tsx', '/src/ui/MigrationWizard.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('ข้อความยืนยันก่อนลบหมวดเดิม', () => {
  it('บอกจำนวนที่จะลบและจำนวนที่มาแทน', () => {
    expect(categoryReplaceWarning(3, 5)).toBe('พบหมวดเดิม 3 หมวด จะถูกลบและแทนด้วยหมวดจากไฟล์สำรอง 5 หมวด');
  });
  it('ไฟล์ไม่มีหมวด: บอกว่าหลังนำเข้าจะไม่มีหมวด', () => {
    expect(categoryReplaceWarning(2, 0)).toBe('พบหมวดเดิม 2 หมวด จะถูกลบ ไฟล์สำรองไม่มีหมวด หลังนำเข้าจะไม่มีหมวดเลย');
  });
  it('ขั้นที่มีแค่การลบ (นำเข้าเสร็จแล้ว): ไม่พูดว่าหลังนำเข้า', () => {
    expect(categoryReplaceWarning(2, 0, true)).toBe('พบหมวดเดิม 2 หมวด จะถูกลบ ไฟล์สำรองไม่มีหมวด หลังลบแล้วจะไม่มีหมวดเลย');
  });
});

describe('importAndVerify ส่งคำยืนยันต่อให้ repository', () => {
  it('options ถึง importBackup', async () => {
    let seen: unknown;
    const repo = {
      importBackup: (_d: unknown, _p: unknown, options: unknown) => {
        seen = options;
        return Promise.reject(new Error('stop'));
      },
    } as unknown as LedgerRepository;
    await expect(importAndVerify({} as BackupData, repo, undefined, { replaceCategories: 4 })).rejects.toThrow('stop');
    expect(seen).toEqual({ replaceCategories: 4 });
  });
});

describe('ทั้งสองทางนำเข้าผ่านด่านเดียวกัน', () => {
  it('หน้านำเข้าไฟล์และตัวย้ายข้อมูลใช้ useCategoryGuard', () => {
    const entries = Object.entries(ui);
    expect(entries).toHaveLength(2);
    for (const [path, text] of entries) expect(text, path).toContain('useCategoryGuard(');
  });
});
