/**
 * บัญชีออนไลน์สมมติของหน้าย้ายข้อมูล (?wizard=ok|categories|fail|mismatch) สำหรับ harness/Playwright เท่านั้น · ไม่ต่อฐานข้อมูล ไม่ถูกรวมใน build จริง
 * ต้นทาง = ข้อมูลสมมติในเครื่อง (?seed=1) · ปลายทาง = หน่วยความจำของหน้านี้ · ตัวเลือกที่หน้าจอส่งมาจดไว้ที่ window.__importOptions
 * categories = มีหมวดพอร์ตค้าง 2 หมวด · fail = นำเข้าถูกปฏิเสธ · mismatch = เข้าแต่เนื้อหาไม่ตรง (resetAll ล้างได้)
 */
import type { BackupData } from '../domain/backup/parseBackup';
import type { ImportOptions, LedgerRepository } from '../storage/ledgerRepository';
import { StorageError } from '../storage/repository';
import { localLedgerRepository } from '../ui/RepositoryContext';

export type WizardDemoKind = 'ok' | 'categories' | 'fail' | 'mismatch';

export function wizardDemoRepository(kind: WizardDemoKind): LedgerRepository {
  let saved: BackupData | null = null;
  return {
    ...localLedgerRepository(),
    isEmpty: () => Promise.resolve(saved === null),
    countCategories: () => Promise.resolve(kind === 'categories' ? 2 : 0),
    confirmSameAccount: () => Promise.resolve(),
    importBackup: (data: BackupData, _onProgress, options?: ImportOptions) => {
      const w = window as unknown as { __importOptions?: unknown[] };
      (w.__importOptions ??= []).push(options ?? null);
      if (kind === 'fail') return Promise.reject(new StorageError('นำเข้าไม่สำเร็จ (จำลอง)'));
      saved = kind === 'mismatch' ? { ...data, entries: data.entries.map((e) => ({ ...e, memo: 'ต่างจากต้นทาง (จำลอง)' })) } : data;
      return Promise.resolve({ accounts: data.accounts.length, entries: data.entries.length, bills: data.bills.length });
    },
    loadLedger: () => Promise.resolve({ accounts: saved?.accounts ?? [], entries: saved?.entries ?? [] }),
    loadBills: () => Promise.resolve(saved?.bills ?? []),
    loadSettings: () => Promise.resolve(saved?.settings ?? {}),
    resetAll: () => {
      saved = null;
      return Promise.resolve();
    },
  };
}
