import { thaiIsoDate } from '../app/dates';
import { prepareLocalBackup } from '../app/localBackup';
import { defaultLedgerRepository } from './RepositoryContext';

function saveJson(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * ดาวน์โหลดข้อมูลที่เก็บในเบราว์เซอร์นี้โดยไม่ต้องล็อกอิน (ใช้จนกว่า M2-D จะนำเข้าข้อมูลขึ้นบัญชีออนไลน์)
 * อ่านจากฐานข้อมูลในเครื่องเท่านั้น ไม่ผ่านเครือข่าย · คืน false ถ้าไม่มีข้อมูลในเครื่องนี้
 */
export async function downloadLocalData(): Promise<{ saved: boolean; accounts: number; entries: number }> {
  const prepared = await prepareLocalBackup(defaultLedgerRepository());
  if (prepared.status === 'empty') return { saved: false, accounts: 0, entries: 0 };
  saveJson(prepared.json, prepared.filename);
  return { saved: true, accounts: prepared.accounts, entries: prepared.entries };
}

/** ดาวน์โหลดไฟล์สำรองข้อมูล (JSON) อ่านจากฐานข้อมูลในเครื่องตรงๆ ไม่ผ่านสูตรเงิน จึงใช้ได้แม้หน้าจอล้ม */
export async function downloadBackup(): Promise<void> {
  const snapshot = await defaultLedgerRepository().exportSnapshot();
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `money-buddy-backup-${thaiIsoDate()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
